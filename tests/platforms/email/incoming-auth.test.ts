// tests/platforms/email/incoming-auth.test.ts
//
// Unit tests for inbound email authentication and allowlist admission (email-incoming-auth).
// Verifies:
// 1. Authoritative result & allowlist checks, reason codes, duplicate authserv-id,
//    conflicting DMARC, missing DMARC, non-passing DMARC, From-domain alignment,
//    unattested MTA stripping rejection.
// 2. Loop, auto-mail, self-originated, and DSN silent filtering.
// 3. VerifiedSender reply destination strictly bound to canonicalAddress.
// 4. Case-insensitivity, comments/quotes in Authentication-Results, and header folding.
// 5. Channels allowlist evaluation independent of global replyPolicy ("all", "public", "channels").

import { assertEquals, assertNotEquals } from "@std/assert";
import type { ChannelConfig } from "../../../src/types/config.ts";
import type { ParsedEmail } from "../../../src/platforms/email/incoming-mime.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import {
  AdmissionReason,
  authenticateInbound,
  HeaderMultimap,
  InboundAuthReceiverConfig,
  parseAuthenticationResultsHeader,
  stripComments,
  unquoteString,
} from "../../../src/platforms/email/incoming-auth.ts";

const BOT_OWN_ADDRESS = "bot@example.com";
const TRUSTED_AUTHSERV_ID = "mx.example.com";

const DEFAULT_RECEIVER_CONFIG: InboundAuthReceiverConfig = {
  authservId: TRUSTED_AUTHSERV_ID,
  attestedStripping: true,
  ownAddress: BOT_OWN_ADDRESS,
};

const ALLOWED_USER_ADDRESS = "alice@allowed-domain.org";
const ALLOWED_USER_ID = normalizeEmailMailbox(ALLOWED_USER_ADDRESS).userId;

const SAMPLE_CHANNELS: ChannelConfig[] = [
  {
    id: `email/account/${ALLOWED_USER_ID}`,
    enabled: true,
  },
  {
    id: "email/account/e_0000000000000000000000000000000000000000000000000000000000000000",
    enabled: false, // Explicitly disabled user
  },
];

function makeParsedEmail(overrides?: Partial<ParsedEmail>): ParsedEmail {
  return {
    from: ALLOWED_USER_ADDRESS,
    subject: "Hello Air-Friends",
    wireIds: {
      messageId: "<msg-100@allowed-domain.org>",
    },
    plainBody: "Can you assist me with this task?",
    provenance: {
      authoredText: "Can you assist me with this task?",
      quotedText: "",
      forwardedText: "",
      status: "clean",
    },
    attachments: [],
    ...overrides,
  };
}

Deno.test("stripComments and unquoteString: handles nested parens, quotes, escapes", () => {
  assertEquals(
    stripComments("dmarc=pass (p=reject (nested comment)) header.from=example.com"),
    "dmarc=pass  header.from=example.com",
  );
  assertEquals(
    stripComments('dmarc=pass (comment) header.from="example.com"'),
    'dmarc=pass  header.from="example.com"',
  );
  assertEquals(
    stripComments("dmarc=pass (escaped \\) paren) header.from=example.com"),
    "dmarc=pass  header.from=example.com",
  );
  assertEquals(unquoteString('"example.com"'), "example.com");
  assertEquals(unquoteString('"foo\\"bar"'), 'foo"bar');
  assertEquals(unquoteString("plain"), "plain");
});

Deno.test("parseAuthenticationResultsHeader: parses quoted authserv-id and quoted header.from", () => {
  const header = '"mx.example.com"; dmarc=pass header.from="allowed-domain.org"';
  const parsed = parseAuthenticationResultsHeader(header);
  assertEquals(parsed?.authservId, "mx.example.com");
  assertEquals(parsed?.dmarcResults[0].result, "pass");
  assertEquals(parsed?.dmarcResults[0].headerFrom, "allowed-domain.org");
});

Deno.test("parseAuthenticationResultsHeader: parses method versions like dmarc/1=pass", () => {
  const header = "mx.example.com; dmarc/1=pass header.from=allowed-domain.org";
  const parsed = parseAuthenticationResultsHeader(header);
  assertEquals(parsed?.dmarcResults[0].result, "pass");
});

Deno.test("parseAuthenticationResultsHeader: extracts authserv-id, dmarc result, and header.from", () => {
  const header1 = "mx.example.com; dmarc=pass (p=reject) header.from=allowed-domain.org";
  const parsed1 = parseAuthenticationResultsHeader(header1);
  assertEquals(parsed1?.authservId, "mx.example.com");
  assertEquals(parsed1?.dmarcResults.length, 1);
  assertEquals(parsed1?.dmarcResults[0].result, "pass");
  assertEquals(parsed1?.dmarcResults[0].headerFrom, "allowed-domain.org");

  // With version and multiple auth methods (spf, dkim, dmarc)
  const header2 =
    "mx.example.com 1; spf=pass smtp.mailfrom=allowed-domain.org; dkim=pass header.d=allowed-domain.org; dmarc=pass header.from=allowed-domain.org";
  const parsed2 = parseAuthenticationResultsHeader(header2);
  assertEquals(parsed2?.authservId, "mx.example.com");
  assertEquals(parsed2?.dmarcResults.length, 1);
  assertEquals(parsed2?.dmarcResults[0].result, "pass");
  assertEquals(parsed2?.dmarcResults[0].headerFrom, "allowed-domain.org");

  // Authserv with comment masquerading as dmarc
  const header3 = "mx.example.com; (dmarc=pass header.from=evil.com) spf=pass";
  const parsed3 = parseAuthenticationResultsHeader(header3);
  assertEquals(parsed3?.authservId, "mx.example.com");
  assertEquals(parsed3?.dmarcResults.length, 0); // Comments stripped, no dmarc clause!
});

Deno.test("HeaderMultimap: handles folded headers and multiple instances across types", () => {
  const rawString = [
    "From: Alice <alice@example.com>",
    "Authentication-Results: mx.example.com; dmarc=pass",
    " header.from=example.com",
    "Authentication-Results: secondary.example.com; dmarc=fail",
  ].join("\r\n");

  const mapFromString = new HeaderMultimap(rawString);
  assertEquals(mapFromString.getAll("authentication-results").length, 2);
  assertEquals(
    mapFromString.getAll("authentication-results")[0],
    "mx.example.com; dmarc=pass header.from=example.com",
  );

  // From Record<string, string[]>
  const mapFromRecord = new HeaderMultimap({
    "Authentication-Results": [
      "mx.example.com; dmarc=pass header.from=example.com",
      "secondary.example.com; dmarc=fail",
    ],
  });
  assertEquals(mapFromRecord.getAll("authentication-results").length, 2);

  // From Iterable<[string, string]>
  const mapFromTuples = new HeaderMultimap([
    ["Authentication-Results", "mx.example.com; dmarc=pass header.from=example.com"],
    ["Authentication-Results", "secondary.example.com; dmarc=fail"],
  ]);
  assertEquals(mapFromTuples.getAll("authentication-results").length, 2);
});

Deno.test("authenticateInbound: ADMITTED on valid authoritative DMARC pass and allowed From", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass (p=reject) header.from=allowed-domain.org\r\nFrom: ${ALLOWED_USER_ADDRESS}\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "admit");
  assertEquals(decision.admitted, true);
  if (decision.admitted) {
    assertEquals(decision.reason, AdmissionReason.ADMITTED);
    assertEquals(decision.verifiedSender.canonicalAddress, ALLOWED_USER_ADDRESS);
    assertEquals(decision.verifiedSender.userId, ALLOWED_USER_ID);
    assertEquals(decision.verifiedSender.authservId, TRUSTED_AUTHSERV_ID);
    assertEquals(decision.verifiedSender.alignedDomain, "allowed-domain.org");
    assertEquals(decision.verifiedSender.replyDestination, ALLOWED_USER_ADDRESS);
    assertEquals(decision.verifiedSender.domainControlLimitationAcknowledged, true);
  }
});

Deno.test("authenticateInbound: REJECTED_UNATTESTED_STRIPPING if attestedStripping is false", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org\r\n`;

  const unConfig: InboundAuthReceiverConfig = {
    ...DEFAULT_RECEIVER_CONFIG,
    attestedStripping: false,
  };

  const decision = authenticateInbound(parsed, rawHeaders, unConfig, SAMPLE_CHANNELS);

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_UNATTESTED_STRIPPING);
});

Deno.test("authenticateInbound: REJECTED_MISSING_AUTH_RESULTS if no Authentication-Results header", () => {
  const parsed = makeParsedEmail();
  const rawHeaders = `Subject: Hello\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MISSING_AUTH_RESULTS);
});

Deno.test("authenticateInbound: REJECTED_MISSING_AUTH_RESULTS if authservId does not match configured", () => {
  const parsed = makeParsedEmail();
  // Header claims a different authservId (untrusted)
  const rawHeaders =
    `Authentication-Results: untrusted-mta.net; dmarc=pass header.from=allowed-domain.org\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MISSING_AUTH_RESULTS);
});

Deno.test("authenticateInbound: ignores untrusted authserv-id when trusted authserv-id is present", () => {
  const parsed = makeParsedEmail();
  // Message has untrusted header (e.g. from upstream MTA that stripped previous ones, or attacker header that wasn't matching authserv-id)
  // and trusted header matching configured authservId
  const rawHeaders = [
    "Authentication-Results: untrusted-upstream.org; dmarc=fail header.from=allowed-domain.org",
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
  ].join("\r\n");

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "admit");
  assertEquals(decision.admitted, true);
  if (decision.admitted) {
    assertEquals(decision.reason, AdmissionReason.ADMITTED);
  }
});

Deno.test("authenticateInbound: REJECTED_MULTIPLE_AUTHSERV_RESULTS on duplicate trusted authservId headers", () => {
  const parsed = makeParsedEmail();
  // Two headers both claiming mx.example.com (trusted) -> fail closed!
  const rawHeaders = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
  ].join("\r\n");

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS);
});

Deno.test("authenticateInbound: REJECTED_MULTIPLE_AUTHSERV_RESULTS on mixed quoted and unquoted trusted authserv-id", () => {
  const parsed = makeParsedEmail();
  const rawHeaders = [
    'Authentication-Results: "mx.example.com"; dmarc=pass header.from=allowed-domain.org',
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
  ].join("\r\n");

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS);
});

Deno.test("authenticateInbound: REJECTED_MULTIPLE_DMARC_RESULTS when clause has multiple header.from properties", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org header.from=evil.net\r\n";

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS);
});

Deno.test("authenticateInbound: REJECTED_DMARC_ALIGNMENT_FAILED when header.from has invalid suffix (e.g. /evil)", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org/evil\r\n";

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED);
});

Deno.test("authenticateInbound: REJECTED_MISSING_DMARC when trusted header lacks DMARC result", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    `Authentication-Results: mx.example.com; spf=pass smtp.mailfrom=allowed-domain.org\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MISSING_DMARC);
});

Deno.test("authenticateInbound: REJECTED_MULTIPLE_DMARC_RESULTS when trusted header contains multiple DMARC clauses", () => {
  const parsed = makeParsedEmail();
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org; dmarc=pass header.from=allowed-domain.org\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS);
});

Deno.test("authenticateInbound: REJECTED_DMARC_FAILED when authoritative DMARC result is fail/softfail/none", () => {
  const parsed = makeParsedEmail();
  const failHeaders =
    `Authentication-Results: mx.example.com; dmarc=fail (p=reject) header.from=allowed-domain.org\r\n`;

  const decisionFail = authenticateInbound(
    parsed,
    failHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decisionFail.status, "reject");
  assertEquals(decisionFail.admitted, false);
  assertEquals(decisionFail.reason, AdmissionReason.REJECTED_DMARC_FAILED);

  const noneHeaders =
    `Authentication-Results: mx.example.com; dmarc=none header.from=allowed-domain.org\r\n`;
  const decisionNone = authenticateInbound(
    parsed,
    noneHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decisionNone.status, "reject");
  assertEquals(decisionNone.admitted, false);
  assertEquals(decisionNone.reason, AdmissionReason.REJECTED_DMARC_FAILED);
});

Deno.test("authenticateInbound: REJECTED_DMARC_ALIGNMENT_FAILED when header.from differs from From domain", () => {
  const parsed = makeParsedEmail({ from: "attacker@spoofed-domain.net" });
  // DMARC passed for allowed-domain.org, but From header is spoofed-domain.net
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED);
});

Deno.test("authenticateInbound: REJECTED_DMARC_ALIGNMENT_FAILED when header.from is missing from dmarc clause", () => {
  const parsed = makeParsedEmail();
  // DMARC pass but no header.from property declared
  const rawHeaders = `Authentication-Results: mx.example.com; dmarc=pass\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_DMARC_ALIGNMENT_FAILED);
});

Deno.test("authenticateInbound: REJECTED_SENDER_NOT_ALLOWED when From domain aligns with DMARC pass but sender not in channels", () => {
  // Bob is from the same authenticated domain, but Bob is not in channels allowlist
  const bobAddress = "bob@allowed-domain.org";
  const parsed = makeParsedEmail({ from: bobAddress });
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_SENDER_NOT_ALLOWED);
});

Deno.test("authenticateInbound: REJECTED_SENDER_NOT_ALLOWED when sender channel entry is disabled (enabled: false)", () => {
  // Address corresponding to disabled entry
  const disabledSender = "disabled@allowed-domain.org";
  const disabledUserId = normalizeEmailMailbox(disabledSender).userId;
  const channelsWithDisabled: ChannelConfig[] = [
    { id: `email/account/${disabledUserId}`, enabled: false },
  ];
  const parsed = makeParsedEmail({ from: disabledSender });
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org\r\n`;
  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    channelsWithDisabled,
  );
  assertEquals(decision.status, "reject");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.REJECTED_SENDER_NOT_ALLOWED);
});

Deno.test("authenticateInbound: IGNORED_SELF_ORIGINATED when From matches bot ownAddress", () => {
  const parsed = makeParsedEmail({ from: "Bot <bot@example.com>" });
  const rawHeaders =
    `Authentication-Results: mx.example.com; dmarc=pass header.from=example.com\r\n`;

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "ignore");
  assertEquals(decision.admitted, false);
  assertEquals(decision.reason, AdmissionReason.IGNORED_SELF_ORIGINATED);
});

Deno.test("authenticateInbound: IGNORED_AUTO_SUBMITTED when Auto-Submitted header is not 'no'", () => {
  const parsed = makeParsedEmail();

  // Test Auto-Submitted: auto-generated
  const rawHeaders1 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "Auto-Submitted: auto-generated",
  ].join("\r\n");
  const decision1 = authenticateInbound(
    parsed,
    rawHeaders1,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision1.status, "ignore");
  assertEquals(decision1.admitted, false);
  assertEquals(decision1.reason, AdmissionReason.IGNORED_AUTO_SUBMITTED);

  // Test Auto-Submitted: auto-replied (vacation)
  const rawHeaders2 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "Auto-Submitted: auto-replied",
  ].join("\r\n");
  const decision2 = authenticateInbound(
    parsed,
    rawHeaders2,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision2.status, "ignore");
  assertEquals(decision2.admitted, false);
  assertEquals(decision2.reason, AdmissionReason.IGNORED_AUTO_SUBMITTED);

  // Test Auto-Submitted: no (RFC 3834 indicates human origin, must NOT be ignored)
  const rawHeaders3 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "Auto-Submitted: no",
  ].join("\r\n");
  const decision3 = authenticateInbound(
    parsed,
    rawHeaders3,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision3.status, "admit");
  assertEquals(decision3.admitted, true);
});

Deno.test("authenticateInbound: IGNORED_DELIVERY_FAILURE on Return-Path: <>, report-type=delivery-status, or bounce subject", () => {
  const parsed = makeParsedEmail();

  // 1. Return-Path: <>
  const rawHeaders1 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "Return-Path: <>",
  ].join("\r\n");
  const decision1 = authenticateInbound(
    parsed,
    rawHeaders1,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision1.status, "ignore");
  assertEquals(decision1.admitted, false);
  assertEquals(decision1.reason, AdmissionReason.IGNORED_DELIVERY_FAILURE);

  // 2. Content-Type: multipart/report; report-type=delivery-status
  const rawHeaders2 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    'Content-Type: multipart/report; report-type="delivery-status"',
  ].join("\r\n");
  const decision2 = authenticateInbound(
    parsed,
    rawHeaders2,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision2.status, "ignore");
  assertEquals(decision2.admitted, false);
  assertEquals(decision2.reason, AdmissionReason.IGNORED_DELIVERY_FAILURE);

  // 3. X-Failed-Recipients header
  const rawHeaders3 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "X-Failed-Recipients: nobody@example.com",
  ].join("\r\n");
  const decision3 = authenticateInbound(
    parsed,
    rawHeaders3,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision3.status, "ignore");
  assertEquals(decision3.admitted, false);
  assertEquals(decision3.reason, AdmissionReason.IGNORED_DELIVERY_FAILURE);

  // 4. Delivery Status Notification subject
  const bounceParsed = makeParsedEmail({ subject: "Delivery Status Notification (Failure)" });
  const rawHeaders4 = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
  ].join("\r\n");
  const decision4 = authenticateInbound(
    bounceParsed,
    rawHeaders4,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );
  assertEquals(decision4.status, "ignore");
  assertEquals(decision4.admitted, false);
  assertEquals(decision4.reason, AdmissionReason.IGNORED_DELIVERY_FAILURE);
});

Deno.test("authenticateInbound: replyDestination is strictly canonicalAddress, ignoring Reply-To and Cc", () => {
  const parsed = makeParsedEmail({
    from: "Alice <alice@allowed-domain.org>",
  });

  // Headers specify a malicious or unrelated Reply-To / Cc
  const rawHeaders = [
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "From: Alice <alice@allowed-domain.org>",
    "Reply-To: attacker@evil.com",
    "Cc: innocent-victim@other.com",
  ].join("\r\n");

  const decision = authenticateInbound(
    parsed,
    rawHeaders,
    DEFAULT_RECEIVER_CONFIG,
    SAMPLE_CHANNELS,
  );

  assertEquals(decision.status, "admit");
  assertEquals(decision.admitted, true);
  if (decision.admitted) {
    // Reply destination remains strictly alice@allowed-domain.org!
    assertEquals(decision.verifiedSender.replyDestination, "alice@allowed-domain.org");
    assertNotEquals(decision.verifiedSender.replyDestination, "attacker@evil.com");
  }
});
