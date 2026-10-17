# Design

## Context

No predecessor registers email in production. email-config-identity deliberately rejects enabled email until this cutover; runtime tests instantiate complete components directly through real constructors.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Remove only the explicit activation-unavailable guard after composing the complete real store/parser/auth/poller/mail-service/adapter. Recover all durable journals before connection or session admission. Await workspace reclamation before exposing ingress as existing bootstrap does. Revalidate trust attestation/TLS/settings before any connection. Register adapter with registry and AgentCore, then connect and schedule. Shutdown first stops poll admission/schedulers, drains in-flight work and journals, then disconnects SMTP/IMAP. Do not leave feature scaffolds, no-ops or partially enabled paths.

### Owned interfaces and callsites

Own production composition root, service injection and guard removal. Enabled email with corrupted unknown-owner submission evidence remains blocked even if other platforms continue safely; config trust/TLS omissions fail startup explicitly. Register connection status using existing registry. Changes are pre-release additions with no database, migrations, OAuth, separate service, reply-all, multi-account or new dashboard workflow.

Affected implementation/tests: `src/bootstrap.ts`, `src/core/config-loader.ts`, `src/core/agent-core.ts`, `src/platforms/platform-registry.ts`, `tests/core/email-bootstrap.test.ts`, `tests/integration/email-platform.integration.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-poll-recovery

Own EmailMailboxPoller.start/stop/poll and IncomingWork={workId,mailboxKey,owner,threadId,recordId,verifiedSender,provenance}. emit callback takes accepted work; start/finish receipt is owned by email-session-receipts. Poller may only resume accepted/unstarted work; started/unknown needs review. stop awaits round completion/cancellation without accepting new work. Timer reconnect is IMAP-only, never SMTP retry.

### email-submission-service

Own EmailMailService.send(draft)->emailSubmission; lookup(operationKey), recover(), appendPendingCopies(). Uses submission-store reservation under one mutation lock per key. Store local history reference in prepared evidence so recovery can reconstruct missing history; sentCopy failure is a separate phase. No outgoing path may call SMTP directly. No operator resend implementation is introduced. Recheck current allowlist for initiating-user targets immediately before SMTP; third-party targets require the bound immutable session grant. Reject a constructed MIME message exceeding configured maxMessageBytes before SMTP rather than truncate.

### email-adapter

Own EmailAdapter sends via EmailMailService, extracts verified sender from owner/thread context (not Reply-To), binds ordinary/file slots from host-provided operation context, fetchRecentMessages/fetchMessage enforce owner-thread membership. getDmChannelId creates a new internal owner thread only for authorized scheduled/spontaneous use. Connect/stop delegate to poller; no bootstrap registration yet. Forward emailSubmission metadata through ReplyHandler/FileHandler without calling failed/unknown delivered. Add typed EmailSendContext={workId,actionSlot,owner} to ReplyOptions/SendFileOptions and SkillContext from host session/scheduler only. Update ReplyHandler, FileHandler and dispatcher/scheduler callsites to pass it; adapter refuses email sending without this context. Tool request platformSpecific data cannot set it.

### email-destination-grants

Own EmailIntentDecision=none|clarify|grant and DestinationGrant={grantId,sessionId,workId,owner,action:compose|forward,canonicalRecipient,sourceRecordId?,requestDigest}. Orchestrator records immutable grant in ActiveSession before sending agent starts; read-only in SkillContext, never grant mutation endpoint. One destination/action per grant; multiple explicit actions have separately host-assigned IDs/slots. Producer validates recipient occurs in authored text and source selection resolves only owner-accessible history. No grant for reminders/spontaneous/non-user sessions. Only authenticated email request sessions are a third-party entry point in this batch; no cross-platform account linking is added.

### email-compose-skill

Own send-email compose endpoint and parameters {grantId,request:{to,subject,body,attachments?}}. Validate request file with resolvePayloadPath/readPayloadArg and authenticated pointer semantics; server validates all fields again. Host obtains operation key third-party:<grantId>, reserves side effect under recovery fence and returns emailSubmission metadata; no model-chosen operation ID, Cc/Bcc or arbitrary headers. Attachments preflight through current-session realpath containment plus existing send-file count/per-file/aggregate/extension limits. No auto-attachment of memory/history.

### email-forward-skill

Own forward request extension {action:forward,sourceRecordId} and source-access checks. Payload file still supplies explicit to/subject/body commentary; host does not accept source paths or wire Message-ID as authorization. Selected source may be another thread belonging to the same owner but never another owner. Duplicate attachment references are rejected. MIME original bytes are immutable; .eml reference counts toward outbound count/aggregate limits as well as decoded source attachments.

### email-response-accounting

Own hasEmailResponseOrUncertainty and response classification across message/per-spawn/pool/reconnect/corrective retry/reminder/spontaneous/dry-run paths. API marks side-effect scope for send-email; propagate emailSubmission even when success=false or exception. Mail service failure with no metadata queries durable key before quota rollback. Third-party submitted state never sets lastSentMessageId,lastFileMessageId,lastReplyAnchorMessageId. Third-party-only completion skips reply-summary generation. SessionResponse carries email submitted/unknown status to ReplyDispatcher; dispatchErrorIfNeeded suppresses fallback mail after either status, including registry expiry. Safe pre-submission fallback uses the same host-assigned reply slot, never an extra error-message slot.

### email-reminder-threads

Own email reminder origin capture in SkillContext and ReminderStore; reminder logical key is reminder:<id> independent of restarted session ID. Unknown/submitted operation evidence suppresses subsequent scheduler sends even if disabling reminder record fails. Confirmed submitted may mark disabled; unknown remains review-required with no auto resubmit. No destination grant is carried into reminder session. Constructor optional fields preserve non-email records without shims.

### email-spontaneous-targets

Own EmailSpontaneousTarget={userId,channelId,newThreadId,tickId}, propagation into ActiveSession owner/workId and new-thread draft without reply headers. Current allowlist checked both at selection and submission. Missing optional email config does not break scheduler. Unknown/submitted tick is not retried on restart; next independently scheduled tick remains normal opt-in behavior.

### email-private-observability

Own email_operation audit phase and sanitizer allowlist {operationId,workId,phase,targetKind,sentCopy,safeCode}; operator can inspect existing logs/audit for submitted/failed/unknown/copy outcomes without content. IDs are opaque safe strings; no address/subject in labels. Include stream/failure paths and dry-run output permissions; dry-run deliberately written prompts are private artifacts and must not be operational logs. No new dashboard UI workflow.

### email-platform-surfaces

Own remaining non-transport platform consumer changes and regression inventory listed in batch index. Workspace archive email subtree is persistent and outside tmp cleanup; existing backup automatically includes data/email and workspace/email, with no exclusion of .eml/attachments. Existing dashboard data access/authentication remains unchanged and no unauthenticated email endpoint is created.

### email-tool-guidance

Own email availability policy in trusted inventory and prompt variables, for both OMP and OpenCode and per-spawn/pool. Retry guidance uses email operation evidence and does not demand a new send after third-party/file submission or uncertainty. Prompt-only changes cannot authorize delivery. Preserve all generic-platform prompts and mount override guidance; deployment requires updating operator-mounted prompt files.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Run one final implementation gate: deno fmt --check src/ tests/, deno lint src/ tests/, deno check src/main.ts and relevant email plus Discord/Misskey regressions. Integrated tests reuse predecessor fixtures and coverage; no new broad test framework or deferred safety implementation is hidden here.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Finalize deployment instructions, receiving trust checklist, 300s latency caveat, backup/privacy warning and CHANGELOG entry; document every acceptance row links to its already-owned test. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
