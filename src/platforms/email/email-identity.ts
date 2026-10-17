// src/platforms/email/email-identity.ts

import { createHash } from "node:crypto";

/** Channel whitelist pattern for email account channels */
export const EMAIL_WHITELIST_PATTERN = /^email\/account\/.+$/;

export interface NormalizedEmailMailbox {
  canonicalAddress: string;
  userId: string;
}

/**
 * Normalize an email mailbox address per RFC 5322 addr-spec and design rules:
 * - Accepts single mailbox only (rejects multiple addresses, commas, semicolons, newlines)
 * - Parses angle-addr format if present (e.g. "Name <user@example.com>")
 * - Local part: preserves case, plus tags (+tag), dots, and aliases exactly
 * - Domain: converted to lowercase IDNA/punycode format
 * - Returns canonicalAddress (`${localPart}@${normalizedDomain}`) and
 *   userId (`e_${sha256Hex(canonicalAddress)}`)
 * - Rejects parsing ambiguity, path characters, or invalid addresses
 */
export function normalizeEmailMailbox(address: string): NormalizedEmailMailbox {
  if (typeof address !== "string") {
    throw new Error("Email address must be a string");
  }

  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("Email address cannot be empty");
  }

  // Reject multiple addresses or control characters
  if (
    trimmed.includes(",") ||
    trimmed.includes(";") ||
    trimmed.includes("\n") ||
    trimmed.includes("\r") ||
    trimmed.includes("\0")
  ) {
    throw new Error("Multiple or multiline email addresses not permitted");
  }

  // Extract addr-spec if wrapped in angle brackets
  let rawAddr = trimmed;
  if (trimmed.includes("<") || trimmed.includes(">")) {
    const strictAngle = trimmed.match(/^([^<>]*)<([^<>\s]+)>$/);
    if (!strictAngle) {
      throw new Error(`Malformed angle-addr mailbox: "${address}"`);
    }
    rawAddr = strictAngle[2].trim();
  } else if (trimmed.includes(" ")) {
    throw new Error(`Invalid whitespace in email address: "${address}"`);
  }

  // Reject multiple '@' characters
  const atMatches = rawAddr.match(/@/g);
  if (!atMatches || atMatches.length !== 1) {
    throw new Error(`Invalid email address format (must contain exactly one '@'): "${address}"`);
  }

  const atIndex = rawAddr.indexOf("@");
  const localPart = rawAddr.slice(0, atIndex);
  const domainPart = rawAddr.slice(atIndex + 1);

  // Disallow URL component characters, ports, queries, or fragments in domainPart
  if (
    domainPart.includes(":") ||
    domainPart.includes("?") ||
    domainPart.includes("#") ||
    domainPart.includes("/") ||
    domainPart.includes("\\")
  ) {
    throw new Error(`Invalid characters in email domain: "${domainPart}"`);
  }

  // Validate localPart: no path traversal or control characters
  if (
    localPart.includes("/") ||
    localPart.includes("\\") ||
    localPart.startsWith(".") ||
    localPart.endsWith(".")
  ) {
    throw new Error(`Invalid characters in email local-part: "${localPart}"`);
  }

  // Domain normalization via URL / IDNA Punycode lowercasing
  let normalizedDomain: string;
  try {
    // URL hostname parser handles IDNA Punycode conversion and lowercasing
    const dummyUrl = new URL(`http://${domainPart}`);
    if (!dummyUrl.hostname || dummyUrl.pathname !== "/") {
      throw new Error("Invalid domain structure");
    }
    normalizedDomain = dummyUrl.hostname.toLowerCase();
  } catch (err) {
    throw new Error(
      `Invalid email domain "${domainPart}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (
    normalizedDomain.includes("/") ||
    normalizedDomain.includes("\\") ||
    normalizedDomain.includes("..") ||
    !normalizedDomain.includes(".")
  ) {
    throw new Error(`Invalid normalized domain: "${normalizedDomain}"`);
  }

  const canonicalAddress = `${localPart}@${normalizedDomain}`;
  const hash = createHash("sha256").update(canonicalAddress, "utf8").digest("hex");
  const userId = `e_${hash}`;

  return {
    canonicalAddress,
    userId,
  };
}
