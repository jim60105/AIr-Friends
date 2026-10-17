# Design

## Context

Current API may audit un-hashed parameters and prompt text when hashContent=false, ACP client logs generated text/tool inputs, and FileHandler logs filenames. Email requires privacy across these paths.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

For email context enforce metadata-only operational/audit serialization regardless of general hashContent setting. Add contextual sensitivity propagation to ACP client and session logger; suppress raw headers, prompt/body chunks, tool parameters/output, credentials, file names and exception strings from email execution, including preflight. Map protocol/provider errors to safe enum codes. Preserve actual full private sent/source content only in archive/backup with private permissions.

### Owned interfaces and callsites

Own email_operation audit phase and sanitizer allowlist {operationId,workId,phase,targetKind,sentCopy,safeCode}; operator can inspect existing logs/audit for submitted/failed/unknown/copy outcomes without content. IDs are opaque safe strings; no address/subject in labels. Include stream/failure paths and dry-run output permissions; dry-run deliberately written prompts are private artifacts and must not be operational logs. No new dashboard UI workflow.

Affected implementation/tests: `src/types/audit.ts`, `src/core/audit-logger.ts`, `src/utils/logger.ts`, `src/acp/client.ts`, `src/skill-api/server.ts`, `src/skills/file-handler.ts`, `tests/types/audit.test.ts`, `tests/core/email-privacy.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-response-accounting

Own hasEmailResponseOrUncertainty and response classification across message/per-spawn/pool/reconnect/corrective retry/reminder/spontaneous/dry-run paths. API marks side-effect scope for send-email; propagate emailSubmission even when success=false or exception. Mail service failure with no metadata queries durable key before quota rollback. Third-party submitted state never sets lastSentMessageId,lastFileMessageId,lastReplyAnchorMessageId. Third-party-only completion skips reply-summary generation. SessionResponse carries email submitted/unknown status to ReplyDispatcher; dispatchErrorIfNeeded suppresses fallback mail after either status, including registry expiry. Safe pre-submission fallback uses the same host-assigned reply slot, never an extra error-message slot.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Capture structured logger and audit output using sentinel address, subject, password, quoted body and filename. Assert absence in success and every failure branch and maintain non-email audit regressions.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document private archive versus metadata-only audit, file access/backup sensitivity and manual review using operation IDs. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
