# Design

## Context

ReminderEntry/ResolvedReminder contain platform/user but no origin channel or reply anchor. Current processReminder asks getDmChannelId and existing records are valid without new fields.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Add optional origin={channelId,replyAnchorRecordId} to reminder records, required and owner-validated on new email reminder creation. Resolve it through ReminderStore replay into ResolvedReminder. Email delivery uses origin thread/anchor, never getDmChannelId creating a new thread. Recheck current enabled allowed account before generating or submitting. Missing/corrupt email origin is review-required; existing Discord/Misskey records continue unchanged without migration.

### Owned interfaces and callsites

Own email reminder origin capture in SkillContext and ReminderStore; reminder logical key is reminder:<id> independent of restarted session ID. Unknown/submitted operation evidence suppresses subsequent scheduler sends even if disabling reminder record fails. Confirmed submitted may mark disabled; unknown remains review-required with no auto resubmit. No destination grant is carried into reminder session. Constructor optional fields preserve non-email records without shims.

Affected implementation/tests: `src/types/reminder.ts`, `src/core/reminder-store.ts`, `src/skills/reminder-handler.ts`, `src/core/session-orchestrator.ts`, `src/bootstrap.ts`, `tests/core/session-orchestrator.reminder.test.ts`, `tests/skills/reminder-handler.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-adapter

Own EmailAdapter sends via EmailMailService, extracts verified sender from owner/thread context (not Reply-To), binds ordinary/file slots from host-provided operation context, fetchRecentMessages/fetchMessage enforce owner-thread membership. getDmChannelId creates a new internal owner thread only for authorized scheduled/spontaneous use. Connect/stop delegate to poller; no bootstrap registration yet. Forward emailSubmission metadata through ReplyHandler/FileHandler without calling failed/unknown delivered. Add typed EmailSendContext={workId,actionSlot,owner} to ReplyOptions/SendFileOptions and SkillContext from host session/scheduler only. Update ReplyHandler, FileHandler and dispatcher/scheduler callsites to pass it; adapter refuses email sending without this context. Tool request platformSpecific data cannot set it.

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

Extend existing reminder fixtures and actual temporary ReminderStore replay; use controlled local service to inspect In-Reply-To/References after restart and prove no old grant inheritance.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document email origin fields, missing-origin review and removed-account behavior without a data migration. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
