# Design

## Context

PlatformAdapter has abstract lifecycle/reply/file/history/emoji/reaction/edit/DM methods. Reply/FileHandler currently drop additional result metadata, and send-file success text requires another reply.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Implement every adapter method as real supported behavior or explicit unsupported result. Email supports owner-thread history and replies/files, private DMs, no guild/search/reactions/editing/typing. Add optional supportsEditing capability with existing platform adapters explicitly true and email false; editing/reaction handlers fail explicitly, never send replacement mail. sendTyping has inherited void contract, so supportsTypingIndicator=false and adapter method performs no network action with guidance describing unsupported status.

### Owned interfaces and callsites

Own EmailAdapter sends via EmailMailService, extracts verified sender from owner/thread context (not Reply-To), binds ordinary/file slots from host-provided operation context, fetchRecentMessages/fetchMessage enforce owner-thread membership. getDmChannelId creates a new internal owner thread only for authorized scheduled/spontaneous use. Connect/stop delegate to poller; no bootstrap registration yet. Forward emailSubmission metadata through ReplyHandler/FileHandler without calling failed/unknown delivered. Add typed EmailSendContext={workId,actionSlot,owner} to ReplyOptions/SendFileOptions and SkillContext from host session/scheduler only. Update ReplyHandler, FileHandler and dispatcher/scheduler callsites to pass it; adapter refuses email sending without this context. Tool request platformSpecific data cannot set it.

Affected implementation/tests: `src/platforms/email/email-adapter.ts`, `src/types/platform.ts`, `src/skills/reply-handler.ts`, `src/skills/file-handler.ts`, `tests/platforms/email/email-adapter.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-message-history

Own EmailMessageStore.putSource(owner,boundedSource,parsed)->recordId; resolveThread(owner,messageIdentifiers); get(owner,thread,record); history(owner,thread,limit); attachment(owner,record,id); putSent(owner,constructedMessage,operation). Incoming records carry wire identifiers and separate authored/quoted/forwarded provenance. Outbound third-party conversation data is not inserted into the initiating-user reply thread.

### email-local-attachments

Own Attachment discriminated local variant and materializeEmailAttachment(owner,sessionId,ref)->sessionPath. Network URL branch still uses safeFetch and all existing SSRF checks. Local images obey 20 MiB/capability/conversion limits, non-images receive session-path descriptions. Permanent archive is reference-only to the model; arbitrary source paths cannot be supplied.

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

Use predecessor local services for threaded reply/file smoke and signed sent history. Run existing Discord/Misskey reply/file fixtures to protect unchanged behavior.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document capability table and correct submitted/unknown/file response wording without changing non-email guidance. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
