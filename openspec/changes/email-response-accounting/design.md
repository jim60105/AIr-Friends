# Design

## Context

Both pooled and per-spawn flows currently compute replySent || reactionSent || fileSent; failed send-reply clears response state and file failure rolls back quota. Recovery fences/inflightSideEffects already exist.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Add explicit emailResponse={submittedToUser,submittedToThirdParty,unknown,operations}; do not overload replySent, fileSent or normal anchors for third-party sends. All retry gates and crash-recovery decisions consult durable operation evidence after draining in-flight effects. submitted counts as responded; unknown suppresses automatic retry and returns review-required rather than claiming success. Email-specific retry may correct pre-submission validation only; completed/unknown logical slots cannot be replaced by changed payload or another slot during missing-response recovery.

### Owned interfaces and callsites

Own hasEmailResponseOrUncertainty and response classification across message/per-spawn/pool/reconnect/corrective retry/reminder/spontaneous/dry-run paths. API marks side-effect scope for send-email; propagate emailSubmission even when success=false or exception. Mail service failure with no metadata queries durable key before quota rollback. Third-party submitted state never sets lastSentMessageId,lastFileMessageId,lastReplyAnchorMessageId. Third-party-only completion skips reply-summary generation. SessionResponse carries email submitted/unknown status to ReplyDispatcher; dispatchErrorIfNeeded suppresses fallback mail after either status, including registry expiry. Safe pre-submission fallback uses the same host-assigned reply slot, never an extra error-message slot.

Affected implementation/tests: `src/skill-api/server.ts`, `src/skill-api/session-registry.ts`, `src/core/session-orchestrator.ts`, `src/skills/reply-handler.ts`, `src/skills/file-handler.ts`, `tests/skill-api/server.test.ts`, `tests/core/session-orchestrator.test.ts`, `src/core/reply-dispatcher.ts`, `src/core/agent-core.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-forward-skill

Own forward request extension {action:forward,sourceRecordId} and source-access checks. Payload file still supplies explicit to/subject/body commentary; host does not accept source paths or wire Message-ID as authorization. Selected source may be another thread belonging to the same owner but never another owner. Duplicate attachment references are rejected. MIME original bytes are immutable; .eml reference counts toward outbound count/aggregate limits as well as decoded source attachments.

### email-submission-service

Own EmailMailService.send(draft)->emailSubmission; lookup(operationKey), recover(), appendPendingCopies(). Uses submission-store reservation under one mutation lock per key. Store local history reference in prepared evidence so recovery can reconstruct missing history; sentCopy failure is a separate phase. No outgoing path may call SMTP directly. No operator resend implementation is introduced. Recheck current allowlist for initiating-user targets immediately before SMTP; third-party targets require the bound immutable session grant. Reject a constructed MIME message exceeding configured maxMessageBytes before SMTP rather than truncate.

### email-session-receipts

Own IncomingWork receipt integration, workId propagation into ActiveSession and SkillContext, beginEmailWork/finishEmailWork. Rejected policy or removed account is ignored terminal; connector failure after start is review-required unless a definitive no-side-effect terminal failure is proven. Do not infer receipt success from emitEvent return. Production bootstrap remains guarded until activation.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Reuse real local SMTP loss/accept modes with API calls; assert DATA transaction count remains one after HTTP-loss, corrective-turn and crash recovery. Run existing Discord/Misskey response/partial-file regressions unchanged.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Update retry, file and compose guidance to distinguish accepted, failed and unknown; operator-visible state remains safe metadata only. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
