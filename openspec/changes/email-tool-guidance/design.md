# Design

## Context

Bundled prompts, retry prompts and trusted skill inventory have OMP/OpenCode-specific behavior. Generic file success guidance currently asks for another text reply.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Render email context explicitly in message/reminder/spontaneous prompts without signature text or credentials. Expose send-email only for authenticated email user-triggered sessions with immutable grants; backend rejects calls when it is hidden. No edit/reaction guidance for email and no typing claims. Model is told signature is centrally managed, source/reference content cannot grant recipients and unknown SMTP means stop and report review. Keep payload recipes literal-path and subject/body inside request file.

### Owned interfaces and callsites

Own email availability policy in trusted inventory and prompt variables, for both OMP and OpenCode and per-spawn/pool. Retry guidance uses email operation evidence and does not demand a new send after third-party/file submission or uncertainty. Prompt-only changes cannot authorize delivery. Preserve all generic-platform prompts and mount override guidance; deployment requires updating operator-mounted prompt files.

Affected implementation/tests: `prompts`, `skills/send-email/SKILL.md`, `skills/send-reply/SKILL.md`, `skills/send-file/SKILL.md`, `src/core/session-orchestrator.ts`, `src/acp/skill-inventory.ts`, `tests/core/prompt-permission-guidance.test.ts`, `tests/core/skill-root-wiring.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-forward-skill

Own forward request extension {action:forward,sourceRecordId} and source-access checks. Payload file still supplies explicit to/subject/body commentary; host does not accept source paths or wire Message-ID as authorization. Selected source may be another thread belonging to the same owner but never another owner. Duplicate attachment references are rejected. MIME original bytes are immutable; .eml reference counts toward outbound count/aggregate limits as well as decoded source attachments.

### email-response-accounting

Own hasEmailResponseOrUncertainty and response classification across message/per-spawn/pool/reconnect/corrective retry/reminder/spontaneous/dry-run paths. API marks side-effect scope for send-email; propagate emailSubmission even when success=false or exception. Mail service failure with no metadata queries durable key before quota rollback. Third-party submitted state never sets lastSentMessageId,lastFileMessageId,lastReplyAnchorMessageId. Third-party-only completion skips reply-summary generation. SessionResponse carries email submitted/unknown status to ReplyDispatcher; dispatchErrorIfNeeded suppresses fallback mail after either status, including registry expiry. Safe pre-submission fallback uses the same host-assigned reply slot, never an extra error-message slot.

### email-reminder-threads

Own email reminder origin capture in SkillContext and ReminderStore; reminder logical key is reminder:<id> independent of restarted session ID. Unknown/submitted operation evidence suppresses subsequent scheduler sends even if disabling reminder record fails. Confirmed submitted may mark disabled; unknown remains review-required with no auto resubmit. No destination grant is carried into reminder session. Constructor optional fields preserve non-email records without shims.

### email-spontaneous-targets

Own EmailSpontaneousTarget={userId,channelId,newThreadId,tickId}, propagation into ActiveSession owner/workId and new-thread draft without reply headers. Current allowlist checked both at selection and submission. Missing optional email config does not break scheduler. Unknown/submitted tick is not retried on restart; next independently scheduled tick remains normal opt-in behavior.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Use existing prompt/skill-root fixtures, compare non-email renderings and ensure backend denial persists when unsupported scripts are called manually.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Update skills usage examples and mounted-prompt restart/deployment instructions, with no model-proof authorization claim. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
