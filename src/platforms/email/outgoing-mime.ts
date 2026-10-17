/**
 * src/platforms/email/outgoing-mime.ts
 *
 * Outgoing RFC 5322 MIME construction and central literal signature for the
 * email platform, owned by `email-mime-signature`.
 *
 * Responsibilities:
 * 1. Build the complete wire message with nodemailer MailComposer: single
 *    authorized envelope recipient, no caller-controlled Cc/Bcc, RFC 2047
 *    encoded Subject, plain text preferred, multipart/mixed for attachments,
 *    and an `Auto-Submitted: auto-generated` loop marker.
 * 2. Apply the startup-loaded literal signature exactly once, after body cleanup
 *    and before MIME construction, using the standard `-- ` separator. A
 *    whitespace-only signature adds nothing. No heuristic de-duplication of
 *    model-written signature-like tails is performed.
 * 3. Provide forward quoting primitives: commentary plus signature first, then a
 *    labeled original-message reference section that preserves the original body
 *    text and attachment bytes.
 * 4. Emit deterministic `.eml` bytes plus the SHA-256 digest and metadata rows 04
 *    (submission evidence), 05 (sent history storage) and 12 (SMTP transport)
 *    consume. The same constructed bytes are reused across recovery and the
 *    sent-copy append; construction never appends a second signature.
 *
 * Header-bound caller values are rejected (CR/LF/NUL injection) before any bytes
 * are produced, so a failed draft cannot create a submission intent.
 */

import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { Buffer } from "node:buffer";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";
import { sanitizeAttachmentDisplayName } from "./incoming-mime.ts";
import type { EmailOperationKey } from "./submission-store.ts";
import type { EmailMessageIdentifiers } from "./message-store.ts";

/** Standard signature separator line: `--` followed by one ASCII space. */
export const SIGNATURE_SEPARATOR = "-- ";

/** Marker that opens the labeled original-message reference section of a forward. */
export const FORWARD_SECTION_MARKER = "---------- Forwarded message ---------";

/** Diagnostic error codes for outgoing MIME construction (safe, content-free). */
export enum OutgoingMimeDiagnosticCode {
  INVALID_MAILBOX = "INVALID_MAILBOX",
  INVALID_SUBJECT = "INVALID_SUBJECT",
  INVALID_THREAD_HEADER = "INVALID_THREAD_HEADER",
  INVALID_ATTACHMENT = "INVALID_ATTACHMENT",
  CONSTRUCTION_FAILED = "CONSTRUCTION_FAILED",
}

/** Custom error for outgoing MIME construction with privacy-safe diagnostics. */
export class OutgoingMimeError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: OutgoingMimeDiagnosticCode;

  constructor(
    diagnosticCode: OutgoingMimeDiagnosticCode,
    message: string,
    options?: { context?: Record<string, unknown> },
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...options?.context,
      diagnosticCode,
    });
    this.diagnosticCode = diagnosticCode;
  }
}

/** Attachment supplied by a caller; `content` bytes are never modified. */
export interface EmailOutgoingAttachment {
  /** Display-only filename; path components and control characters are stripped. */
  filename: string;
  /** Media type, e.g. `application/pdf`. */
  contentType: string;
  /** Raw attachment bytes. */
  content: Uint8Array;
}

/** Original message quoted by a forward, as resolved by the forwarding caller. */
export interface EmailForwardSource {
  /** Original From address (display metadata only). */
  from: string;
  /** Original To address, when known. */
  to?: string;
  /** Original Subject, when known. */
  subject?: string;
  /** Original Date, when known. */
  date?: Date;
  /** Original plain-text body; inserted verbatim (wire line endings normalized). */
  body: string;
  /** Original decoded attachments; bytes are preserved exactly. */
  attachments?: EmailOutgoingAttachment[];
}

/** Thread linkage for an outgoing reply. */
export interface EmailThreadReference {
  /** Wire Message-ID of the message being replied to (bracketed form). */
  wireMessageId?: string;
  /** Ancestor References chain in order (bracketed form). */
  references?: string[];
}

/**
 * Send-content shape for one logical outgoing message. It carries no Cc/Bcc or
 * arbitrary header surface; `to` is the single authorized envelope recipient.
 */
export interface EmailDraft {
  owner: string;
  operationKey: EmailOperationKey;
  targetKind: "user" | "third-party";
  to: string;
  subject: string;
  authoredBody: string;
  thread?: EmailThreadReference;
  /**
   * Internal owner-thread this message belongs to, when the host already
   * allocated one (row 25: a spontaneous message opens a NEW owner thread that
   * was durably bound to its schedule occurrence). Local-only metadata: it is
   * never serialized as a header, and `thread` stays absent so the message
   * carries no In-Reply-To/References.
   */
  internalThreadId?: string;
  forwardSource?: EmailForwardSource;
  attachments?: EmailOutgoingAttachment[];
}

/** Result of one construction, reused for submission, history, and sent copies. */
export interface ConstructedOutgoingEmail {
  /** Generated bracketed wire Message-ID. */
  messageId: string;
  /** Complete RFC 5322 wire bytes with CRLF line endings. */
  emlBytes: Uint8Array;
  /** SHA-256 hex digest of `emlBytes` (submission evidence). */
  digest: string;
  /** Final logical plain text (LF endings) including signature/forward section. */
  historyBody: string;
  /** Explicit single-recipient SMTP envelope. */
  envelope: { from: string; to: string[] };
  /** Exact wire size in bytes. */
  sizeBytes: number;
  /** Header identifiers for thread derivation/storage. */
  wireIds: EmailMessageIdentifiers;
  /** Canonical envelope recipient address. */
  to: string;
  /** Subject as provided by the caller. */
  subject: string;
}

/** Options for {@link OutgoingMimeBuilder}. */
export interface OutgoingMimeBuilderOptions {
  /** Configured bot address used as the From header and envelope sender. */
  fromAddress: string;
  /** Injected clock; defaults to `new Date()`. */
  now?: () => Date;
}

const MSG_ID_TOKEN_REGEX = /^<[^<>\s]+>$/;
const MEDIA_TYPE_REGEX = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
/**
 * Strict dot-atom addr-spec; rejects group/route/quoted syntax MailComposer
 * reinterprets, and requires every local-part atom to be non-empty so
 * consecutive dots are refused too.
 */
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const STRICT_ADDR_SPEC_REGEX = new RegExp(
  `^${ATEXT}+(\\.${ATEXT}+)*@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$`,
);
const CONTROL_CHARS_REGEX = /[\r\n\0]/;

/** Normalize CRLF/CR to LF without touching any other character. */
function normalizeWireNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function lengthPrefixed(hash: Hash, label: string, value: string): void {
  hash.update(`${label}:${new TextEncoder().encode(value).byteLength}:`);
  hash.update(value, "utf8");
}

/** Reject control characters in a raw header-bound value before normalization. */
function assertNoControlChars(
  value: string,
  field: string,
  code: OutgoingMimeDiagnosticCode,
): void {
  if (typeof value !== "string" || CONTROL_CHARS_REGEX.test(value)) {
    throw new OutgoingMimeError(
      code,
      `Header value rejected: ${field} contains control characters`,
    );
  }
}

/**
 * Apply the configured literal signature to a cleaned authored body exactly once.
 *
 * Line endings are normalized to LF (the composer emits CRLF on the wire). A
 * whitespace-only signature adds nothing at all. Trailing content is preserved
 * verbatim; no signature-like tail is detected or removed.
 */
export function applyOutgoingSignature(body: string, signature: string): string {
  const normalizedBody = normalizeWireNewlines(body);
  const normalizedSignature = normalizeWireNewlines(signature);
  if (normalizedSignature.trim() === "") {
    return normalizedBody;
  }
  if (normalizedBody.trim() === "") {
    return `${SIGNATURE_SEPARATOR}\n${normalizedSignature}`;
  }
  return `${normalizedBody}\n${SIGNATURE_SEPARATOR}\n${normalizedSignature}`;
}

/**
 * Build the labeled original-message reference section for a forward.
 *
 * The section starts with {@link FORWARD_SECTION_MARKER}, which the incoming
 * provenance parser classifies as forwarded text, followed by the original
 * metadata and the original body text inserted verbatim.
 */
export function buildForwardSection(source: EmailForwardSource): string {
  assertNoControlChars(source.from, "forward.from", OutgoingMimeDiagnosticCode.INVALID_MAILBOX);
  if (source.to !== undefined) {
    assertNoControlChars(source.to, "forward.to", OutgoingMimeDiagnosticCode.INVALID_MAILBOX);
  }
  if (source.subject !== undefined) {
    assertNoControlChars(
      source.subject,
      "forward.subject",
      OutgoingMimeDiagnosticCode.INVALID_SUBJECT,
    );
  }
  if (source.date !== undefined && isNaN(source.date.getTime())) {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.CONSTRUCTION_FAILED,
      "Header value rejected: forward.date is not a valid date",
    );
  }

  const lines = [FORWARD_SECTION_MARKER, `From: ${source.from}`];
  if (source.date) {
    lines.push(`Date: ${source.date.toUTCString()}`);
  }
  if (source.subject !== undefined) {
    lines.push(`Subject: ${source.subject}`);
  }
  if (source.to !== undefined) {
    lines.push(`To: ${source.to}`);
  }
  return `${lines.join("\n")}\n\n${normalizeWireNewlines(source.body)}`;
}

/** Validate and canonicalize one envelope mailbox. */
function canonicalMailbox(raw: string, field: string): string {
  assertNoControlChars(raw, field, OutgoingMimeDiagnosticCode.INVALID_MAILBOX);
  let canonical: string;
  try {
    canonical = normalizeEmailMailbox(raw).canonicalAddress;
  } catch {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_MAILBOX,
      `Mailbox rejected: ${field} is not a single valid address`,
      { context: { field } },
    );
  }
  if (!STRICT_ADDR_SPEC_REGEX.test(canonical)) {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_MAILBOX,
      `Mailbox rejected: ${field} uses syntax that would change on serialization`,
      { context: { field } },
    );
  }
  return canonical;
}

/** Validate a bracketed wire identifier and return it unchanged. */
function canonicalWireId(value: string, field: string): string {
  assertNoControlChars(value, field, OutgoingMimeDiagnosticCode.INVALID_THREAD_HEADER);
  const trimmed = value.trim();
  if (!MSG_ID_TOKEN_REGEX.test(trimmed)) {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_THREAD_HEADER,
      `Routing header rejected: ${field} is not a single bracketed identifier`,
      { context: { field } },
    );
  }
  return trimmed;
}

/** Validate, sanitize, and copy caller attachments into MIME parts. */
function toMimeAttachment(
  attachment: EmailOutgoingAttachment,
  index: number,
): { filename: string; contentType: string; content: Uint8Array } {
  if (!attachment || typeof attachment !== "object") {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
      "Attachment rejected: not an object",
    );
  }
  assertNoControlChars(
    attachment.filename ?? "",
    "attachment.filename",
    OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
  );
  if (
    typeof attachment.contentType !== "string" || !MEDIA_TYPE_REGEX.test(attachment.contentType)
  ) {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
      "Attachment rejected: contentType is not a bare media type",
    );
  }
  if (!(attachment.content instanceof Uint8Array)) {
    throw new OutgoingMimeError(
      OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
      "Attachment rejected: content must be bytes",
    );
  }
  // Attached messages are sent unencoded, so whole-message CRLF normalization
  // would rewrite bare LF bytes inside them. Refuse content that cannot be
  // preserved byte-for-byte instead of silently modifying the original.
  if (attachment.contentType.toLowerCase().startsWith("message/")) {
    const bytes = attachment.content;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a && (i === 0 || bytes[i - 1] !== 0x0d)) {
        throw new OutgoingMimeError(
          OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
          "Attachment rejected: message content contains bare line feeds that cannot be preserved",
        );
      }
    }
  }
  return {
    filename: sanitizeAttachmentDisplayName(attachment.filename, index),
    contentType: attachment.contentType,
    content: attachment.content,
  };
}

/** Collect a MailComposer read stream into exact wire bytes. */
async function collectMessage(
  message: { createReadStream(): AsyncIterable<Uint8Array | string> },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of message.createReadStream()) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Constructs outgoing RFC 5322 messages. One instance carries the configured
 * From address and clock; every call takes the literal signature so a
 * configuration reload cannot be observed mid-construction.
 */
export class OutgoingMimeBuilder {
  private readonly fromAddress: string;
  private readonly now: () => Date;

  constructor(options: OutgoingMimeBuilderOptions) {
    this.fromAddress = canonicalMailbox(options.fromAddress, "from");
    this.now = options.now ?? (() => new Date());
  }

  /** Canonical envelope sender derived from the configured bot address. */
  get sender(): string {
    return this.fromAddress;
  }

  /**
   * Build one logical outgoing message. The same inputs (including the injected
   * clock and attachment bytes) produce identical bytes, so a constructed
   * message can be persisted and reused without re-signing or rebuilding.
   */
  async construct(draft: EmailDraft, signature: string): Promise<ConstructedOutgoingEmail> {
    const to = canonicalMailbox(draft.to, "to");
    assertNoControlChars(draft.subject, "subject", OutgoingMimeDiagnosticCode.INVALID_SUBJECT);

    // Thread header chain: supplied ancestors in order, parent appended once.
    const wireIds: EmailMessageIdentifiers = {};
    let references: string[] = [];
    if (draft.thread?.wireMessageId !== undefined) {
      wireIds.inReplyTo = canonicalWireId(draft.thread.wireMessageId, "thread.wireMessageId");
    }
    if (draft.thread?.references !== undefined) {
      references = draft.thread.references.map((ref, i) =>
        canonicalWireId(ref, `thread.references[${i}]`)
      );
    }
    if (wireIds.inReplyTo && !references.includes(wireIds.inReplyTo)) {
      references.push(wireIds.inReplyTo);
    }
    if (references.length > 0) {
      wireIds.references = references;
    }

    const draftAttachments = (draft.attachments ?? []).map((att, i) => toMimeAttachment(att, i));
    const forwardAttachments = (draft.forwardSource?.attachments ?? []).map((att, i) =>
      toMimeAttachment(att, draftAttachments.length + i)
    );
    // One ordered list drives both identity hashing and serialization, so the
    // Message-ID cannot diverge from the wire bytes on attachment ordering.
    const attachments = [...forwardAttachments, ...draftAttachments];

    const signedBody = applyOutgoingSignature(draft.authoredBody, signature);
    const forwardSection = draft.forwardSource
      ? buildForwardSection(draft.forwardSource)
      : undefined;
    const historyBody = forwardSection === undefined
      ? signedBody
      : `${signedBody}\n\n${forwardSection}`;

    const date = this.now();
    if (isNaN(date.getTime())) {
      throw new OutgoingMimeError(
        OutgoingMimeDiagnosticCode.CONSTRUCTION_FAILED,
        "Construction rejected: clock returned an invalid date",
      );
    }

    // Deterministic Message-ID over every construction input, including
    // attachment bytes; anchors the digest/bytes identity of this message.
    const idHash = createHash("sha256");
    lengthPrefixed(idHash, "owner", draft.owner);
    lengthPrefixed(idHash, "workId", draft.operationKey.workId);
    lengthPrefixed(idHash, "actionSlot", draft.operationKey.actionSlot);
    lengthPrefixed(idHash, "targetKind", draft.targetKind);
    lengthPrefixed(idHash, "to", to);
    lengthPrefixed(idHash, "subject", draft.subject);
    lengthPrefixed(idHash, "body", historyBody);
    lengthPrefixed(idHash, "date", date.toISOString());
    lengthPrefixed(idHash, "parent", wireIds.inReplyTo ?? "");
    lengthPrefixed(idHash, "references", references.join(" "));
    for (const att of attachments) {
      lengthPrefixed(idHash, "attachmentName", att.filename);
      lengthPrefixed(idHash, "attachmentType", att.contentType);
      lengthPrefixed(idHash, "attachmentBytes", Buffer.from(att.content).toString("base64"));
    }
    const idHex = idHash.digest("hex");
    const domain = this.fromAddress.slice(this.fromAddress.indexOf("@") + 1);
    // 128 bits keeps typical headers short; long domains may still fold, which
    // stays within RFC 5322 limits and remains parseable.
    const messageId = `<${idHex.slice(0, 32)}@${domain}>`;

    const composer = new MailComposer({
      from: { address: this.fromAddress },
      to: { address: to },
      envelope: { from: this.fromAddress, to: [to] },
      subject: draft.subject,
      // An empty string would drop the text alternative entirely; a zero-length
      // buffer keeps the documented multipart/mixed + text/plain topology.
      text: historyBody.length === 0 ? Buffer.alloc(0) : historyBody,
      date,
      messageId,
      ...(wireIds.inReplyTo ? { inReplyTo: wireIds.inReplyTo } : {}),
      ...(references.length > 0 ? { references } : {}),
      headers: { "Auto-Submitted": "auto-generated" },
      newline: "windows",
      baseBoundary: `af${idHex.slice(0, 32)}`,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    let emlBytes: Uint8Array;
    try {
      emlBytes = await collectMessage(composer.compile());
    } catch {
      throw new OutgoingMimeError(
        OutgoingMimeDiagnosticCode.CONSTRUCTION_FAILED,
        "MIME composer failed to serialize the message",
      );
    }

    // Wire bytes must be pure CRLF; a bare LF would let SMTP rewrite the message
    // and invalidate the digest evidence.
    if (/[^\r]\n/.test(new TextDecoder().decode(emlBytes))) {
      throw new OutgoingMimeError(
        OutgoingMimeDiagnosticCode.CONSTRUCTION_FAILED,
        "MIME composer produced a bare line feed in wire bytes",
      );
    }

    const digest = createHash("sha256").update(emlBytes).digest("hex");

    return {
      messageId,
      emlBytes,
      digest,
      historyBody,
      envelope: { from: this.fromAddress, to: [to] },
      sizeBytes: emlBytes.byteLength,
      wireIds,
      to,
      subject: draft.subject,
    };
  }
}
