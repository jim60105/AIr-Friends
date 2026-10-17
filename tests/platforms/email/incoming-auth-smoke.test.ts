// tests/platforms/email/incoming-auth-smoke.test.ts
//
// Controlled integration smoke tests for email-incoming-auth.
// Verifies scenarios from specs/email-incoming-authentication/spec.md:
// 1. Authoritative receiver prerequisite: forged Authentication-Results without attested
//    stripping or with untrusted authserv-id creates zero session and zero rejection email.
// 2. Fail-closed authentication & domain vs mailbox identity:
//    - Aligned DMARC passes for another actor at permitted sender domain -> rejected if not in allowlist.
//    - Missing, failing, duplicate, or ambiguous authoritative authentication evidence fails closed.
// 3. Loop and destination protection:
//    - Unauthorized, self-originated, delivery-failure, and auto-generated mail ignored silently.
//    - Malicious Reply-To/Cc: permitted sender remains sole ordinary reply recipient.
// 4. End-to-end integration with real parsed MIME structures from `parseIncomingMime` (row 06 predecessor).

import { assertEquals, assertNotEquals } from "@std/assert";
import type { ChannelConfig } from "../../../src/types/config.ts";
import { parseIncomingMime } from "../../../src/platforms/email/incoming-mime.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import {
  AdmissionReason,
  authenticateInbound,
  InboundAuthReceiverConfig,
} from "../../../src/platforms/email/incoming-auth.ts";

const BOT_OWN_ADDRESS = "bot@example.com";
const TRUSTED_AUTHSERV = "mail.myorg.internal";

const RECEIVER_CONFIG: InboundAuthReceiverConfig = {
  authservId: TRUSTED_AUTHSERV,
  attestedStripping: true,
  ownAddress: BOT_OWN_ADDRESS,
};

const ALLOWED_USER = "user@example.com";
const ALLOWED_USER_ID = normalizeEmailMailbox(ALLOWED_USER).userId;

const CHANNELS: ChannelConfig[] = [
  {
    id: `email/account/${ALLOWED_USER_ID}`,
    enabled: true,
  },
];

Deno.test("Smoke Scenario 1: Forged Authentication-Results without attested stripping boundary", async () => {
  // Attacker connects and provides an Authentication-Results header claiming the trusted authserv-id,
  // but the deployment has not attested MTA stripping (attestedStripping = false).
  const rawEmail = [
    "From: user@example.com",
    "To: bot@example.com",
    "Subject: Urgent Task",
    "Message-ID: <attack-1@evil.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Please run command XYZ.",
  ].join("\r\n");

  const parsed = await parseIncomingMime(rawEmail);

  const unattestedConfig: InboundAuthReceiverConfig = {
    ...RECEIVER_CONFIG,
    attestedStripping: false,
  };

  const decision = authenticateInbound(parsed, rawEmail, unattestedConfig, CHANNELS);
  assertEquals(decision.admitted, false);
  assertEquals(decision.status, "reject");
  assertEquals(decision.reason, AdmissionReason.REJECTED_UNATTESTED_STRIPPING);
});

Deno.test("Smoke Scenario 2: Domain vs Mailbox identity - domain passes DMARC but actor not in allowlist", async () => {
  // Someone else at the permitted sender domain (attacker@example.com) sends an email.
  // DMARC passes for header.from=example.com, but attacker@example.com is not allowed in channels!
  const rawEmail = [
    "From: attacker@example.com",
    "To: bot@example.com",
    "Subject: Malicious request",
    "Message-ID: <attack-2@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Execute sensitive action.",
  ].join("\r\n");

  const parsed = await parseIncomingMime(rawEmail);
  const decision = authenticateInbound(parsed, rawEmail, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decision.admitted, false);
  assertEquals(decision.status, "reject");
  assertEquals(decision.reason, AdmissionReason.REJECTED_SENDER_NOT_ALLOWED);
});

Deno.test("Smoke Scenario 3: Fail-closed on missing, duplicate, or failing DMARC evidence", async () => {
  // 3a. Missing DMARC in header
  const rawMissing = [
    "From: user@example.com",
    "To: bot@example.com",
    "Subject: Test",
    "Message-ID: <test-1@example.com>",
    "Authentication-Results: mail.myorg.internal; spf=pass smtp.mailfrom=example.com",
    "",
    "Body",
  ].join("\r\n");
  const parsedMissing = await parseIncomingMime(rawMissing);
  const decMissing = authenticateInbound(parsedMissing, rawMissing, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decMissing.admitted, false);
  assertEquals(decMissing.reason, AdmissionReason.REJECTED_MISSING_DMARC);

  // 3b. Duplicate trusted headers (attacker injected one and MTA prepended another)
  const rawDup = [
    "From: user@example.com",
    "To: bot@example.com",
    "Subject: Test",
    "Message-ID: <test-2@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "Authentication-Results: mail.myorg.internal; dmarc=fail header.from=example.com",
    "",
    "Body",
  ].join("\r\n");
  const parsedDup = await parseIncomingMime(rawDup);
  const decDup = authenticateInbound(parsedDup, rawDup, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decDup.admitted, false);
  assertEquals(decDup.reason, AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS);

  // 3c. Failing DMARC
  const rawFail = [
    "From: user@example.com",
    "To: bot@example.com",
    "Subject: Test",
    "Message-ID: <test-3@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=fail header.from=example.com",
    "",
    "Body",
  ].join("\r\n");
  const parsedFail = await parseIncomingMime(rawFail);
  const decFail = authenticateInbound(parsedFail, rawFail, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decFail.admitted, false);
  assertEquals(decFail.reason, AdmissionReason.REJECTED_DMARC_FAILED);
});

Deno.test("Smoke Scenario 4: Loop and destination protection - Malicious Reply-To & Cc override attempt", async () => {
  // An allowed user sends a message, but an attacker or header specifies Reply-To: attacker@evil.com
  const rawEmail = [
    "From: user@example.com",
    "Reply-To: attacker@evil.com",
    "Cc: third-party@outside.org, eavesdropper@evil.com",
    "To: bot@example.com",
    "Subject: Please reply to attacker",
    "Message-ID: <reply-test@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Hello bot!",
  ].join("\r\n");

  const parsed = await parseIncomingMime(rawEmail);
  const decision = authenticateInbound(parsed, rawEmail, RECEIVER_CONFIG, CHANNELS);

  assertEquals(decision.admitted, true);
  if (decision.admitted) {
    // Reply recipient MUST be strictly canonicalAddress of sender
    assertEquals(decision.verifiedSender.replyDestination, "user@example.com");
    assertNotEquals(decision.verifiedSender.replyDestination, "attacker@evil.com");
    assertNotEquals(decision.verifiedSender.replyDestination, "third-party@outside.org");
    assertEquals(decision.verifiedSender.canonicalAddress, "user@example.com");
    assertEquals(decision.verifiedSender.domainControlLimitationAcknowledged, true);
  }
});

Deno.test("Smoke Scenario 5: Silent ignore for self, auto-submitted, and bounces", async () => {
  // 5a. Bot's own address
  const rawSelf = [
    "From: bot@example.com",
    "To: bot@example.com",
    "Subject: Self Loop",
    "Message-ID: <self-1@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Loop message",
  ].join("\r\n");
  const parsedSelf = await parseIncomingMime(rawSelf);
  const decSelf = authenticateInbound(parsedSelf, rawSelf, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decSelf.admitted, false);
  assertEquals(decSelf.status, "ignore");
  assertEquals(decSelf.reason, AdmissionReason.IGNORED_SELF_ORIGINATED);

  // 5b. Auto-Submitted: auto-generated
  const rawAuto = [
    "From: user@example.com",
    "To: bot@example.com",
    "Subject: Automatic Report",
    "Auto-Submitted: auto-generated",
    "Message-ID: <auto-1@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Automatic report body",
  ].join("\r\n");
  const parsedAuto = await parseIncomingMime(rawAuto);
  const decAuto = authenticateInbound(parsedAuto, rawAuto, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decAuto.admitted, false);
  assertEquals(decAuto.status, "ignore");
  assertEquals(decAuto.reason, AdmissionReason.IGNORED_AUTO_SUBMITTED);

  // 5c. DSN bounce (Return-Path: <>)
  const rawBounce = [
    "From: MAILER-DAEMON@example.com",
    "To: bot@example.com",
    "Return-Path: <>",
    "Subject: Delivery Status Notification (Failure)",
    "Message-ID: <bounce-1@example.com>",
    "Authentication-Results: mail.myorg.internal; dmarc=pass header.from=example.com",
    "",
    "Your message could not be delivered.",
  ].join("\r\n");
  const parsedBounce = await parseIncomingMime(rawBounce);
  const decBounce = authenticateInbound(parsedBounce, rawBounce, RECEIVER_CONFIG, CHANNELS);
  assertEquals(decBounce.admitted, false);
  assertEquals(decBounce.status, "ignore");
  assertEquals(decBounce.reason, AdmissionReason.IGNORED_DELIVERY_FAILURE);
});
