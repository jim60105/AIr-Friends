# Design

## Context

No SMTP client or SMTP protocol test service exists. A library exception alone cannot distinguish rejection from lost acknowledgement.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Use npm:nodemailer@^7 SMTP transport with secure direct TLS or requireTLS mandatory STARTTLS, rejectUnauthorized=true, no library debug/logger and one explicit envelope recipient. Set connection/greeting/socket timeouts to 30s. Disable application retries and record conservative unknown when a connection fails once DATA submission may have begun. Explicit final 5xx/4xx rejection is failed; accepted requires positive final DATA response.

### Owned interfaces and callsites

Own EmailSmtpClient.submit(constructedBytes,envelope)->{phase:submitted|failed|unknown,safeCode}; optional transient failure before any submission remains failed and requires a new explicitly authorized logical action, never hidden retry. Deno local SMTP fixture supports EHLO, STARTTLS, AUTH, MAIL, RCPT, DATA, QUIT plus scripted disconnect/final-response modes. Test CA injection cannot turn off production certificate validation.

Affected implementation/tests: `src/platforms/email/smtp-client.ts`, `deno.json`, `deno.lock`, `tests/platforms/email/smtp-client.test.ts`, `tests/helpers/email-smtp-service.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-config-identity

Own EmailConfig, normalizeEmailMailbox(address)->{canonicalAddress,userId}; email channel normalization; Platform union/VALID_PLATFORMS. EmailConfig is optional at the TypeScript boundary and materialized disabled in loaded config so existing fixtures and consumers remain valid. Enabled email is rejected as activation-unavailable until the final activation change replaces that production guard, including email-only startup. No adapter or scheduler registration here. Update generic platform iteration with an absent-email guard in the same change; expanding the union must remain type-correct without rewriting existing config fixtures.

| platforms.email field                     | Environment override                          | Default / validation               |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------- |
| `enabled`                                 | `EMAIL_ENABLED`                               | false                              |
| `address`                                 | `EMAIL_ADDRESS`                               | required when enabled              |
| `imap.host`                               | `EMAIL_IMAP_HOST`                             | required                           |
| `imap.port`                               | `EMAIL_IMAP_PORT`                             | 993 (tls), 143 (starttls)          |
| `imap.tlsMode`                            | `EMAIL_IMAP_TLS_MODE`                         | tls; tls or starttls only          |
| `imap.username`                           | `EMAIL_IMAP_USERNAME`                         | required                           |
| `imap.password`                           | `EMAIL_IMAP_PASSWORD`                         | required secret reference          |
| `smtp.host`                               | `EMAIL_SMTP_HOST`                             | required                           |
| `smtp.port`                               | `EMAIL_SMTP_PORT`                             | 465 (tls), 587 (starttls)          |
| `smtp.tlsMode`                            | `EMAIL_SMTP_TLS_MODE`                         | tls; tls or starttls only          |
| `smtp.username`                           | `EMAIL_SMTP_USERNAME`                         | required                           |
| `smtp.password`                           | `EMAIL_SMTP_PASSWORD`                         | required distinct secret reference |
| `incomingFolder`                          | `EMAIL_INCOMING_FOLDER`                       | INBOX                              |
| `sentFolder`                              | `EMAIL_SENT_FOLDER`                           | Sent                               |
| `pollIntervalMs`                          | `EMAIL_POLL_INTERVAL_MS`                      | 300000; positive integer           |
| `receivingAuth.authservId`                | `EMAIL_AUTHSERV_ID`                           | required trusted receiver identity |
| `receivingAuth.attestedStripping`         | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED`        | false; required true when enabled  |
| `maxMessageBytes`                         | `EMAIL_MAX_MESSAGE_BYTES`                     | 26214400                           |
| `maxIncomingAttachments`                  | `EMAIL_MAX_INCOMING_ATTACHMENTS`              | 10                                 |
| `signature`                               | `EMAIL_SIGNATURE`                             | empty; literal multiline text      |
| `spontaneousPost.enabled`                 | `EMAIL_SPONTANEOUS_ENABLED`                   | false                              |
| `spontaneousPost.minIntervalMs`           | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS`           | 10800000                           |
| `spontaneousPost.maxIntervalMs`           | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS`           | 43200000                           |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | 0.5                                |

Only credential values use existing ${ENV_VAR} references. Signature is taken literally after YAML decoding; generic expansion MUST exclude this field. EMAIL_SIGNATURE supplies actual newlines, not a filename/template. Ports default by selected mode. Outbound attachments additionally use existing sendFile limits; no new credential/global allowlist is introduced.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Run real nodemailer submissions against controlled local services, using unique test ports and bounded shutdown; assert one DATA transaction per submit call.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document accepted versus delivered wording, provider size rejection and unknown outcomes. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
