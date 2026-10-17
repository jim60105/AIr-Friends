// src/platforms/email/incoming-auth.ts
//
// Inbound email authentication and allowlist admission layer owned by `email-incoming-auth`.
// Implements:
// 1. Authoritative receiving prerequisite: requires operator-attested MTA stripping
//    (receivingAuth.attestedStripping === true) and trusted authserv-id matching.
// 2. Strict Authentication-Results parsing (RFC 7601 / RFC 8601): exactly one trusted
//    authserv-id header, exactly one authoritative DMARC pass result, and verified
//    From-domain alignment. Fails closed on missing, duplicate, conflicting, or ambiguous results.
// 3. Sender allowlist validation: requires enabled account entry (`email/account/<userId>`)
//    in configured channels, independent of global replyPolicy.
// 4. Loop & destination protection: silent ignore for self-originated mail (own address),
//    Auto-Submitted mail (RFC 3834), delivery failure notifications (DSN / bounces).
// 5. Verified sender binding: verified reply destination strictly binds canonicalAddress.
//    Never sends rejection replies for rejected or ignored messages.
// 6. Security & transparency: DMARC proves aligned domain-level control only, not local-part exclusivity.

import { createLogger } from "@utils/logger.ts";
import type { ChannelConfig, EmailReceivingAuthConfig } from "../../types/config.ts";
import { parseChannelId } from "../../types/config.ts";
import type { EmailProvenance } from "./message-store.ts";
import type { ParsedEmail } from "./incoming-mime.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";

const logger = createLogger("EmailIncomingAuth");

/**
 * High-level admission action status.
 */
export type AdmissionStatus = "admit" | "ignore" | "reject";

/**
 * Safe admission reason enum for detailed audit and processing journal tracking.
 */
export enum AdmissionReason {
  // Successful admission
  ADMITTED = "ADMITTED",

  // Silent ignores (loop / bot / bounce protection - no reply, no session)
  IGNORED_SELF_ORIGINATED = "IGNORED_SELF_ORIGINATED",
  IGNORED_AUTO_SUBMITTED = "IGNORED_AUTO_SUBMITTED",
  IGNORED_DELIVERY_FAILURE = "IGNORED_DELIVERY_FAILURE",

  // Precondition rejections
  REJECTED_UNATTESTED_STRIPPING = "REJECTED_UNATTESTED_STRIPPING",
  REJECTED_MISSING_AUTH_RESULTS = "REJECTED_MISSING_AUTH_RESULTS",
  REJECTED_MULTIPLE_AUTHSERV_RESULTS = "REJECTED_MULTIPLE_AUTHSERV_RESULTS",
  REJECTED_MISSING_DMARC = "REJECTED_MISSING_DMARC",
  REJECTED_MULTIPLE_DMARC_RESULTS = "REJECTED_MULTIPLE_DMARC_RESULTS",
  REJECTED_DMARC_FAILED = "REJECTED_DMARC_FAILED",
  REJECTED_DMARC_ALIGNMENT_FAILED = "REJECTED_DMARC_ALIGNMENT_FAILED",
  REJECTED_MISSING_FROM_HEADER = "REJECTED_MISSING_FROM_HEADER",
  REJECTED_INVALID_FROM = "REJECTED_INVALID_FROM",
  REJECTED_SENDER_NOT_ALLOWED = "REJECTED_SENDER_NOT_ALLOWED",
}

/**
 * Verified sender structure bound upon successful admission.
 * Invariant: ordinary replies must target only `canonicalAddress` (replyDestination).
 */
export interface VerifiedSender {
  /** Canonical addr-spec `${localPart}@${normalizedDomain}` */
  canonicalAddress: string;
  /** Internal stable user ID `e_${sha256Hex(canonicalAddress)}` */
  userId: string;
  /** Trusted authserv-id that produced the authoritative DMARC result */
  authservId: string;
  /** Evaluated domain from DMARC passing statement aligned with From domain */
  alignedDomain: string;
  /** Provenance breakdown from incoming MIME parser */
  provenance: EmailProvenance;
  /** Immutable reply destination strictly equal to canonicalAddress (never Reply-To/Cc) */
  replyDestination: string;
  /**
   * Explicit security caveat: DMARC authenticates domain control, NOT mailbox-local exclusivity.
   */
  readonly domainControlLimitationAcknowledged: true;
}

/**
 * Result of inbound admission evaluation.
 */
export type AdmissionDecision =
  | {
    status: "admit";
    admitted: true;
    reason: AdmissionReason.ADMITTED;
    verifiedSender: VerifiedSender;
  }
  | {
    status: "ignore";
    admitted: false;
    reason:
      | AdmissionReason.IGNORED_SELF_ORIGINATED
      | AdmissionReason.IGNORED_AUTO_SUBMITTED
      | AdmissionReason.IGNORED_DELIVERY_FAILURE;
    detail?: string;
  }
  | {
    status: "reject";
    admitted: false;
    reason:
      | AdmissionReason.REJECTED_UNATTESTED_STRIPPING
      | AdmissionReason.REJECTED_MISSING_AUTH_RESULTS
      | AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS
      | AdmissionReason.REJECTED_MISSING_DMARC
      | AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS
      | AdmissionReason.REJECTED_DMARC_FAILED
      | AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED
      | AdmissionReason.REJECTED_MISSING_FROM_HEADER
      | AdmissionReason.REJECTED_INVALID_FROM
      | AdmissionReason.REJECTED_SENDER_NOT_ALLOWED;
    detail?: string;
  };

/**
 * Configuration options required for inbound authentication and admission.
 */
export interface InboundAuthReceiverConfig extends EmailReceivingAuthConfig {
  /**
   * Bot's own configured email address (`platforms.email.address`).
   * Required to detect and suppress self-originated loops.
   */
  ownAddress: string;
}

/**
 * Flexible input type for raw email headers.
 * Accepts:
 * - string: full RFC 2822 / 5322 header block (unfolded or folded)
 * - Iterable<[string, string]>: list of key-value tuples (preserves multiple headers)
 * - Record<string, string | string[]>: dictionary with single or array values
 */
export type RawHeadersInput =
  | string
  | Iterable<[string, string]>
  | Record<string, string | string[]>;

/**
 * Internal case-insensitive multimap for RFC 5322 headers.
 * Preserves header insertion order and multiple occurrences without concatenation.
 */
export class HeaderMultimap {
  private readonly entries: Array<{ key: string; value: string }> = [];

  constructor(input?: RawHeadersInput) {
    if (!input) return;

    if (typeof input === "string") {
      this.parseRawHeaderString(input);
    } else if (
      Symbol.iterator in Object(input) &&
      typeof (input as Iterable<[string, string]>)[Symbol.iterator] === "function"
    ) {
      for (const [k, v] of input as Iterable<[string, string]>) {
        if (typeof k === "string" && typeof v === "string") {
          this.entries.push({ key: k.trim().toLowerCase(), value: v.trim() });
        }
      }
    } else if (typeof input === "object" && input !== null) {
      for (const [k, v] of Object.entries(input as Record<string, string | string[]>)) {
        const lowerKey = k.trim().toLowerCase();
        if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === "string") {
              this.entries.push({ key: lowerKey, value: item.trim() });
            }
          }
        } else if (typeof v === "string") {
          this.entries.push({ key: lowerKey, value: v.trim() });
        }
      }
    }
  }

  /**
   * Parse an RFC 2822/5322 header block string, respecting line unfolding (RFC 5322 §2.2.3).
   */
  private parseRawHeaderString(raw: string): void {
    // Unfold folded lines: CRLF or LF followed by WSP (space or tab) is replaced by single space
    const lines = raw.split(/\r?\n/);
    let currentKey: string | null = null;
    let currentValue = "";

    for (const line of lines) {
      // Empty line indicates end of header block
      if (line === "" && currentKey !== null) {
        break;
      }

      if (/^[ \t]/.test(line)) {
        // Continuation line
        if (currentKey !== null) {
          currentValue += " " + line.trim();
        }
      } else {
        // New header line
        if (currentKey !== null) {
          this.entries.push({ key: currentKey.toLowerCase(), value: currentValue.trim() });
          currentKey = null;
          currentValue = "";
        }
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          currentKey = line.slice(0, colonIndex).trim();
          currentValue = line.slice(colonIndex + 1).trim();
        }
      }
    }

    if (currentKey !== null) {
      this.entries.push({ key: currentKey.toLowerCase(), value: currentValue.trim() });
    }
  }

  /**
   * Get all values for a header name (case-insensitive).
   */
  getAll(name: string): string[] {
    const target = name.trim().toLowerCase();
    const result: string[] = [];
    for (const entry of this.entries) {
      if (entry.key === target) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Get the first value for a header name, or undefined.
   */
  getFirst(name: string): string | undefined {
    const target = name.trim().toLowerCase();
    for (const entry of this.entries) {
      if (entry.key === target) {
        return entry.value;
      }
    }
    return undefined;
  }
}

/**
 * Remove RFC 5322 / RFC 8601 comments (parenthesized text, handling nested parentheses
 * and escaped characters), while preserving quoted strings and tokens outside comments.
 * Decodes/unwraps escaped characters within comments without altering outer structure.
 */
export function stripComments(input: string): string {
  let result = "";
  let inQuote = false;
  let commentDepth = 0;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      escaped = false;
      if (commentDepth === 0) {
        result += ch;
      }
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inQuote) {
      if (ch === '"') {
        inQuote = false;
      }
      result += ch;
      continue;
    }

    if (commentDepth > 0) {
      if (ch === "(") {
        commentDepth++;
      } else if (ch === ")") {
        commentDepth--;
      }
      continue;
    }

    // Outside quote and comments
    if (ch === '"') {
      inQuote = true;
      result += ch;
      continue;
    }

    if (ch === "(") {
      commentDepth++;
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Unquote an RFC 822/5322 quoted-string if present.
 * e.g. `"example.com"` -> `example.com`
 */
export function unquoteString(val: string): string {
  const trimmed = val.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1").trim();
  }
  return trimmed;
}

/**
 * Parsed DMARC statement from an Authentication-Results header.
 */
export interface ParsedDmarcResult {
  result: string; // e.g. "pass", "fail", "softfail", "none", etc.
  headerFromCount: number; // to detect ambiguous multiple header.from in a single clause
  headerFrom?: string; // domain specified in header.from property
}

/**
 * Parse an Authentication-Results header field (RFC 7601 / RFC 8601).
 * Header format:
 *   authserv-id [version] [authres-list]
 * where authres-list consists of semicolon-separated method/result/property clauses.
 */
export function parseAuthenticationResultsHeader(
  headerValue: string,
): { authservId: string; dmarcResults: ParsedDmarcResult[]; malformed?: boolean } | null {
  // Strip comments first so comments cannot masquerade as results or properties
  const stripped = stripComments(headerValue).trim();
  if (!stripped) return null;

  const firstSemicolon = stripped.indexOf(";");
  const authservPart = (firstSemicolon >= 0 ? stripped.slice(0, firstSemicolon) : stripped).trim();
  if (!authservPart) return null;

  // Parse authserv-id token, which may be quoted: e.g. "mx.example.com" or mx.example.com
  let authservId = "";
  if (authservPart.startsWith('"')) {
    const closeQuote = authservPart.indexOf('"', 1);
    if (closeQuote > 0) {
      const rawQuoted = authservPart.slice(0, closeQuote + 1);
      authservId = unquoteString(rawQuoted).toLowerCase();
    } else {
      authservId = unquoteString(authservPart).toLowerCase();
    }
  } else {
    const tokens = authservPart.split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) return null;
    authservId = tokens[0].trim().toLowerCase();
  }

  if (!authservId) return null;

  const dmarcResults: ParsedDmarcResult[] = [];

  if (firstSemicolon >= 0) {
    const clausesPart = stripped.slice(firstSemicolon + 1);
    const clauses = clausesPart.split(";");

    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      if (!clause) continue;

      // RFC 8601 §2.2: method/version=result, e.g. dmarc=pass or dmarc/1=pass
      const match = clause.match(/^dmarc(?:\/[0-9]+)?\s*=\s*([a-zA-Z0-9_\-]+)(.*)$/i);
      if (match) {
        const result = match[1].toLowerCase();
        const propsPart = match[2].trim();

        let headerFromCount = 0;
        let headerFrom: string | undefined = undefined;

        // Parse properties separated by whitespace
        // e.g. header.from=example.com or header.from="example.com"
        // Match all occurrences of header.from
        const propRegex = /\bheader\.from\s*=\s*("[^"]*"|[^\s;]+)/gi;
        let pMatch: RegExpExecArray | null;
        while ((pMatch = propRegex.exec(propsPart)) !== null) {
          headerFromCount++;
          const rawVal = pMatch[1];
          const unquoted = unquoteString(rawVal).toLowerCase();
          // Validate domain syntax (RFC 5321/5322 hostname: letters, numbers, hyphens, dots)
          // Must not have invalid trailing chars like /evil
          if (
            /^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)*$/.test(unquoted)
          ) {
            headerFrom = unquoted;
          } else {
            // Malformed domain token!
            headerFrom = undefined;
          }
        }

        dmarcResults.push({ result, headerFromCount, headerFrom });
      }
    }
  }

  return { authservId, dmarcResults };
}

/**
 * Check if the message is self-originated (From matches bot's own email address).
 */
export function isSelfOriginated(senderCanonical: string, ownAddress: string): boolean {
  try {
    const ownNorm = normalizeEmailMailbox(ownAddress);
    return ownNorm.canonicalAddress === senderCanonical;
  } catch {
    // If ownAddress is unparseable, compare trimmed lowercase
    return senderCanonical.toLowerCase() === ownAddress.trim().toLowerCase();
  }
}

/**
 * Check if the message carries an Auto-Submitted header indicating automated origin (RFC 3834).
 * RFC 3834 defines:
 *   Auto-Submitted = "auto-generated" / "auto-replied" / "auto-notified" / "no" / ...
 * If Auto-Submitted is present and its primary token is NOT "no", the message must be ignored.
 */
export function isAutoSubmitted(headers: HeaderMultimap): boolean {
  const autoSubmittedHeaders = headers.getAll("auto-submitted");
  for (const rawValue of autoSubmittedHeaders) {
    const stripped = stripComments(rawValue).trim().toLowerCase();
    if (!stripped) continue;
    // Extract primary token (before semicolon or whitespace)
    const primaryToken = stripped.split(/[;\s]/)[0];
    if (primaryToken && primaryToken !== "no") {
      return true;
    }
  }
  return false;
}

/**
 * Check if the message is a Delivery Status Notification (DSN) or delivery failure.
 * Indicators per RFC 3464, RFC 5321, and common MTAs:
 * - Return-Path: <> (null reverse path / bounce)
 * - Content-Type: multipart/report with report-type=delivery-status
 * - Subject indicates delivery failure or mailer daemon
 * - From indicates Mail Delivery Subsystem / MAILER-DAEMON
 * - Presence of X-Failed-Recipients
 */
export function isDeliveryFailure(
  headers: HeaderMultimap,
  subject?: string,
  from?: string,
): boolean {
  // 1. Return-Path: <>
  const returnPaths = headers.getAll("return-path");
  for (const rp of returnPaths) {
    const cleaned = rp.replace(/[<\s>]/g, "");
    if (cleaned === "") {
      return true;
    }
  }

  // 2. Content-Type: multipart/report with report-type=delivery-status
  const contentTypes = headers.getAll("content-type");
  for (const ct of contentTypes) {
    const lowerCt = ct.toLowerCase();
    if (lowerCt.includes("multipart/report") && lowerCt.includes("delivery-status")) {
      return true;
    }
  }

  // 3. X-Failed-Recipients header present
  if (headers.getAll("x-failed-recipients").length > 0) {
    return true;
  }

  // 4. Subject heuristics for standard bounces
  if (subject) {
    const subLower = subject.toLowerCase();
    if (
      subLower.startsWith("delivery status notification") ||
      subLower.startsWith("undelivered mail returned to sender") ||
      subLower.startsWith("mail delivery failed") ||
      subLower.startsWith("failure notice") ||
      subLower.includes("returned mail: see transcript for details")
    ) {
      return true;
    }
  }

  // 5. From headers identifying mailer daemon
  if (from) {
    const fromLower = from.toLowerCase();
    if (
      fromLower.includes("mailer-daemon@") ||
      fromLower.includes("postmaster@") ||
      fromLower.includes("mail delivery subsystem")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a normalized sender's userId is present in the enabled channels allowlist.
 * Channel format: `email/account/<userId>` where userId is `e_<sha256>`.
 * Must be explicitly enabled (`enabled !== false`).
 */
export function isSenderAllowed(userId: string, channels: ChannelConfig[]): boolean {
  const targetChannelId = `email/account/${userId}`;

  for (const ch of channels) {
    if (ch.enabled === false) continue;

    // Check direct string match
    if (ch.id === targetChannelId) {
      return true;
    }

    // Also parse channel ID in case format has trailing whitespace
    const parsed = parseChannelId(ch.id);
    if (parsed && parsed.platform === "email" && parsed.type === "account") {
      if (parsed.value === userId) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Inbound email authentication and allowlist admission decision function.
 *
 * Implements the security contract:
 * 1. Precondition: receivingAuth.attestedStripping MUST be true.
 * 2. Parse headers and check silent ignore conditions (self-originated, auto-submitted, delivery failure).
 * 3. Inspect Authentication-Results:
 *    - Trust ONLY headers matching receivingAuth.authservId.
 *    - If multiple headers match the configured authserv-id -> REJECT (MULTIPLE_AUTHSERV_RESULTS).
 *    - If no header matches or no DMARC result found -> REJECT (MISSING_AUTH_RESULTS / MISSING_DMARC).
 *    - Must have exactly one DMARC pass result.
 *    - header.from in DMARC result must match From domain exactly (case-insensitive).
 * 4. Sender allowlist: sender userId must be present and enabled in `channels`.
 *
 * Never replies to rejected or ignored mail.
 */
export function authenticateInbound(
  parsed: ParsedEmail,
  rawHeaders: RawHeadersInput,
  receiverConfig: InboundAuthReceiverConfig,
  channels: ChannelConfig[],
): AdmissionDecision {
  const headers = new HeaderMultimap(rawHeaders);

  // 1. Mandatory deployment attestation check
  // Without verified MTA stripping, an attacker could inject forged Authentication-Results.
  if (receiverConfig.attestedStripping !== true) {
    logger.warn("Inbound email rejected: MTA header stripping is not attested as true");
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_UNATTESTED_STRIPPING,
      detail: "MTA header stripping must be attested as true to trust authentication results",
    };
  }

  const configuredAuthservId = receiverConfig.authservId.trim().toLowerCase();
  if (!configuredAuthservId) {
    logger.warn("Inbound email rejected: configured authservId is empty");
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_UNATTESTED_STRIPPING,
      detail: "Configured authservId is empty",
    };
  }

  // 2. Validate and normalize From mailbox
  if (!parsed.from || parsed.from.trim() === "") {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MISSING_FROM_HEADER,
      detail: "From address is missing or empty",
    };
  }

  let normalizedFrom;
  try {
    normalizedFrom = normalizeEmailMailbox(parsed.from);
  } catch (err) {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_INVALID_FROM,
      detail: `From address is malformed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { canonicalAddress, userId } = normalizedFrom;
  const atIndex = canonicalAddress.lastIndexOf("@");
  const fromDomain = atIndex >= 0 ? canonicalAddress.slice(atIndex + 1).toLowerCase() : "";

  // 3. Silent ignores: Loop & bot prevention (self-originated, auto-submitted, DSN)
  // Must be ignored SILENTLY with zero session and zero reply.

  // 3a. Self-originated check
  if (isSelfOriginated(canonicalAddress, receiverConfig.ownAddress)) {
    logger.info("Inbound email silently ignored: self-originated message", {
      from: canonicalAddress,
    });
    return {
      status: "ignore",
      admitted: false,
      reason: AdmissionReason.IGNORED_SELF_ORIGINATED,
      detail: "Self-originated message ignored to prevent response loops",
    };
  }

  // 3b. Auto-Submitted check (RFC 3834)
  if (isAutoSubmitted(headers)) {
    logger.info("Inbound email silently ignored: Auto-Submitted header present", {
      from: canonicalAddress,
    });
    return {
      status: "ignore",
      admitted: false,
      reason: AdmissionReason.IGNORED_AUTO_SUBMITTED,
      detail: "Automatically submitted mail ignored per RFC 3834",
    };
  }

  // 3c. Delivery failure / DSN check
  if (isDeliveryFailure(headers, parsed.subject, parsed.from)) {
    logger.info("Inbound email silently ignored: Delivery status notification / failure", {
      from: canonicalAddress,
    });
    return {
      status: "ignore",
      admitted: false,
      reason: AdmissionReason.IGNORED_DELIVERY_FAILURE,
      detail: "Delivery failure / bounce report ignored silently",
    };
  }

  // 4. Evaluate Authentication-Results headers
  const authResultsHeaders = headers.getAll("authentication-results");
  if (authResultsHeaders.length === 0) {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MISSING_AUTH_RESULTS,
      detail: "No Authentication-Results header present",
    };
  }

  // Parse all Authentication-Results headers and filter for configured authservId
  const matchingHeaders: Array<{ authservId: string; dmarcResults: ParsedDmarcResult[] }> = [];

  for (const rawAuth of authResultsHeaders) {
    const parsedAuth = parseAuthenticationResultsHeader(rawAuth);
    if (!parsedAuth) continue;

    if (parsedAuth.authservId === configuredAuthservId) {
      matchingHeaders.push(parsedAuth);
    }
  }

  // Multiple headers claiming the configured trusted authservId must fail closed!
  if (matchingHeaders.length > 1) {
    logger.warn("Inbound email rejected: multiple Authentication-Results for trusted authservId", {
      authservId: configuredAuthservId,
      count: matchingHeaders.length,
    });
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS,
      detail: "Multiple Authentication-Results headers claiming trusted authserv-id",
    };
  }

  if (matchingHeaders.length === 0) {
    logger.warn("Inbound email rejected: no Authentication-Results matching trusted authservId", {
      configuredAuthservId,
    });
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MISSING_AUTH_RESULTS,
      detail: `No Authentication-Results header from trusted authserv-id ${configuredAuthservId}`,
    };
  }

  const trustedAuth = matchingHeaders[0];
  const dmarcResults = trustedAuth.dmarcResults;

  if (dmarcResults.length === 0) {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MISSING_DMARC,
      detail: "No DMARC result found in trusted Authentication-Results header",
    };
  }

  if (dmarcResults.length > 1) {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS,
      detail: "Ambiguous Authentication-Results: multiple DMARC clauses in trusted header",
    };
  }

  const dmarc = dmarcResults[0];

  // If multiple header.from properties appeared in this single DMARC clause, fail closed!
  if (dmarc.headerFromCount > 1) {
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS,
      detail: "Ambiguous DMARC clause contains multiple header.from properties",
    };
  }

  // DMARC outcome must be "pass"
  if (dmarc.result !== "pass") {
    logger.warn("Inbound email rejected: DMARC did not pass", {
      result: dmarc.result,
    });
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_DMARC_FAILED,
      detail: `Authoritative DMARC outcome is ${dmarc.result}, expected pass`,
    };
  }

  // Domain alignment: header.from domain must equal From domain
  // Note: if header.from property is missing from the DMARC clause, fail closed
  if (!dmarc.headerFrom) {
    logger.warn("Inbound email rejected: DMARC pass clause missing header.from property");
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED,
      detail: "DMARC pass clause does not declare evaluated header.from domain",
    };
  }

  const alignedDomain = dmarc.headerFrom.toLowerCase();
  if (alignedDomain !== fromDomain) {
    logger.warn("Inbound email rejected: DMARC header.from does not align with From domain", {
      dmarcDomain: alignedDomain,
      fromDomain,
    });
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED,
      detail: `DMARC domain ${alignedDomain} does not align with sender From domain ${fromDomain}`,
    };
  }

  // 5. Account allowlist check: sender must be in enabled channels
  // Evaluated independently of global replyPolicy per design L34-36
  if (!isSenderAllowed(userId, channels)) {
    logger.warn("Inbound email rejected: sender is not in channels allowlist", {
      userId,
      canonicalAddress,
    });
    return {
      status: "reject",
      admitted: false,
      reason: AdmissionReason.REJECTED_SENDER_NOT_ALLOWED,
      detail: `Sender ${canonicalAddress} (${userId}) is not in enabled channels allowlist`,
    };
  }

  // 6. Admission successful! Construct VerifiedSender
  const verifiedSender: VerifiedSender = {
    canonicalAddress,
    userId,
    authservId: trustedAuth.authservId,
    alignedDomain,
    provenance: parsed.provenance,
    replyDestination: canonicalAddress,
    domainControlLimitationAcknowledged: true,
  };

  logger.info("Inbound email admitted successfully", {
    sender: canonicalAddress,
    userId,
    alignedDomain,
  });

  return {
    status: "admit",
    admitted: true,
    reason: AdmissionReason.ADMITTED,
    verifiedSender,
  };
}
