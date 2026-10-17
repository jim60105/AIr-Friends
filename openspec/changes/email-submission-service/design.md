# Design

## Context

SMTP, MIME and durable operation contracts exist independently after predecessors. They must become one path before any production email entry point is registered.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Prepare and fsync constructed content and intent, then durably mark submitting before invoking SMTP. Persist result before reporting it. If result persistence fails after SMTP acceptance expose unknown and suppress resend. Upon submitted persist local sent history then APPEND identical bytes to sentFolder. History/copy failures after known acceptance never downgrade submitted; a restart repairs history or append from stored MIME without SMTP.

### Owned interfaces and callsites

Own EmailMailService.send(draft)->emailSubmission; lookup(operationKey), recover(), appendPendingCopies(). Uses submission-store reservation under one mutation lock per key. Store local history reference in prepared evidence so recovery can reconstruct missing history; sentCopy failure is a separate phase. No outgoing path may call SMTP directly. No operator resend implementation is introduced. Recheck current allowlist for initiating-user targets immediately before SMTP. For third-party mail this host-only service trusts the authenticated compose/forward handler, which owns immutable-grant validation and must retain an active fenced session/in-flight side-effect lease through submission. The service is never directly model-callable and does not independently interpret or create grants. Reject a constructed MIME message exceeding configured maxMessageBytes before SMTP rather than truncate.

The handler checks grant/session validity immediately before calling `send`; an expired/fenced session cannot start a new call. Once admitted, its existing in-flight side-effect lease drains to a durable outcome even if idle expiry occurs. Recovery may reconstruct history or APPEND known submitted bytes without a live grant, but prepared third-party work from an ended session is never automatically submitted. A new session cannot revive that grant or choose a replacement logical slot.

Affected implementation/tests: `src/platforms/email/mail-service.ts`, `tests/platforms/email/mail-service.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-submission-journal

Own EmailOperationKey={workId,actionSlot}; actionSlot=reply|files|third-party:<grantId>|reminder:<id>|spontaneous:<tickId>. Lifecycle=prepared|submitting|submitted|failed|unknown; sentCopy=pending|appended|failed. prepare(key,digest,emlRef), markSubmitting(), recordOutcome(), lookup(). Add optional emailSubmission={operationId,phase,targetKind,sentCopy,safeCode} to reply/file/skill results. SMTP-accepted means submitted only. New model-supplied keys cannot evade deduplication.

### email-mime-signature

Own EmailDraft={owner,operationKey,targetKind,to,subject,authoredBody,thread?:{wireMessageId,references},forwardSource?,attachments}; construct(draft,signature)->{messageId,emlBytes,digest,historyBody}. Single construction per logical operation, persisted before SMTP; recoveries and sent copies consume the same .eml. Header values reject CR/LF injection. No arbitrary destination parameters on ordinary reply APIs.

### email-smtp-transport

Own EmailSmtpClient.submit(constructedBytes,envelope)->{phase:submitted|failed|unknown,safeCode}; optional transient failure before any submission remains failed and requires a new explicitly authorized logical action, never hidden retry. Deno local SMTP fixture supports EHLO, STARTTLS, AUTH, MAIL, RCPT, DATA, QUIT plus scripted disconnect/final-response modes. Test CA injection cannot turn off production certificate validation.

### email-imap-transport

Own EmailImapClient.connect/disconnect/status/position/listAfter/fetchHeaders/fetchSource/appendSent. position returns {uidValidity,uidNext}; fetchSource streams with a hard byte budget after RFC822.SIZE preflight. listAfter uses UIDs and ignores Seen flags. Provide fetch-by-UID bounded batches of 50 and fixed socket timeouts of 30s. SMTP credentials are not reused implicitly.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Reuse both local protocol fixtures for one real IMAP+SMTP smoke plus file-backed restart tests; assert bytes captured by SMTP, local history and APPEND are identical.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document safe operation inspection, separate sent-copy error and manual review of unknown state. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
