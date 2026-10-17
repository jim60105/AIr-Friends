# Design

## Context

Skills use Deno scripts and shared client/payload libraries. The API already verifies session JWT and fences in-flight side effects. Arbitrary email destinations must remain outside send-reply.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Add send-email action compose behind enabled email service and authenticated email user-triggered session. Script accepts --grant-id and --request-file only; request JSON carries to, subject, body and optional session-scoped attachment references, so recipient display strings, subject and body never occur as shell free text. Extend payload legacy rejection for --subject/--body/--to on this script without changing other script behavior. Handler compares canonical to/action/source with immutable host grant before any file read or MIME construction.

### Owned interfaces and callsites

Own send-email compose endpoint and parameters {grantId,request:{to,subject,body,attachments?}}. Validate request file with resolvePayloadPath/readPayloadArg and authenticated pointer semantics; server validates all fields again. Host obtains operation key third-party:<grantId>, reserves side effect under recovery fence and returns emailSubmission metadata; no model-chosen operation ID, Cc/Bcc or arbitrary headers. Attachments preflight through current-session realpath containment plus existing send-file count/per-file/aggregate/extension limits. No auto-attachment of memory/history.

Affected implementation/tests: `skills/send-email/SKILL.md`, `skills/send-email/scripts/send-email.ts`, `skills/lib/payload.ts`, `src/skills/email-handler.ts`, `src/skills/registry.ts`, `src/skill-api/server.ts`, `src/skills/types.ts`, `tests/skills/email-handler.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-destination-grants

Own EmailIntentDecision=none|clarify|grant and DestinationGrant={grantId,sessionId,workId,owner,action:compose|forward,canonicalRecipient,sourceRecordId?,requestDigest}. Orchestrator records immutable grant in ActiveSession before sending agent starts; read-only in SkillContext, never grant mutation endpoint. One destination/action per grant; multiple explicit actions have separately host-assigned IDs/slots. Producer validates recipient occurs in authored text and source selection resolves only owner-accessible history. No grant for reminders/spontaneous/non-user sessions. Only authenticated email request sessions are a third-party entry point in this batch; no cross-platform account linking is added.

### email-submission-service

Own EmailMailService.send(draft)->emailSubmission; lookup(operationKey), recover(), appendPendingCopies(). Uses submission-store reservation under one mutation lock per key. Store local history reference in prepared evidence so recovery can reconstruct missing history; sentCopy failure is a separate phase. No outgoing path may call SMTP directly. No operator resend implementation is introduced. Recheck current allowlist for initiating-user targets immediately before SMTP; third-party targets require the bound immutable session grant. Reject a constructed MIME message exceeding configured maxMessageBytes before SMTP rather than truncate.

### email-adapter

Own EmailAdapter sends via EmailMailService, extracts verified sender from owner/thread context (not Reply-To), binds ordinary/file slots from host-provided operation context, fetchRecentMessages/fetchMessage enforce owner-thread membership. getDmChannelId creates a new internal owner thread only for authorized scheduled/spontaneous use. Connect/stop delegate to poller; no bootstrap registration yet. Forward emailSubmission metadata through ReplyHandler/FileHandler without calling failed/unknown delivered. Add typed EmailSendContext={workId,actionSlot,owner} to ReplyOptions/SendFileOptions and SkillContext from host session/scheduler only. Update ReplyHandler, FileHandler and dispatcher/scheduler callsites to pass it; adapter refuses email sending without this context. Tool request platformSpecific data cannot set it.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Add script/API integration fixtures for pointer identity, expired JWT, missing grant, destination mutation, attachment preflight and one successful local SMTP compose; response-accounting activation remains gated.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document send-email compose recipes with literal staging paths and submitted/unknown results; generic send-reply remains destination-free. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
