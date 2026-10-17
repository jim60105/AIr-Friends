# Design

## Context

PlatformAdapter.emitEvent catches downstream errors, so the poller cannot infer processing outcome from successful emission. Mailbox journal owns explicit start/finish receipts.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Poll every pollIntervalMs, default 300000, with a single in-flight round and bounded sequential UID batches. Initialize from UIDNEXT-1 while persisting UIDVALIDITY before scanning. Store source/accepted record before checkpointing. At UIDVALIDITY replacement compare persisted raw-source digest plus sender/wire-ID evidence; identical known sources are not new work. Unmatched pre-boundary or multiply matching entries become review-required; do not replay the mailbox.

### Owned interfaces and callsites

Own EmailMailboxPoller.start/stop/poll and IncomingWork={workId,mailboxKey,owner,threadId,recordId,verifiedSender,provenance}. emit callback takes accepted work; start/finish receipt is owned by email-session-receipts. Poller may only resume accepted/unstarted work; started/unknown needs review. stop awaits round completion/cancellation without accepting new work. Timer reconnect is IMAP-only, never SMTP retry.

Affected implementation/tests: `src/platforms/email/mailbox-poller.ts`, `tests/platforms/email/mailbox-poller.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-mailbox-journal

Own MailboxKey={fingerprint,uidValidity,uid}; ProcessingState=discovered|accepted|started|completed|ignored|failed|review-required. discover(), accept(sourceRecordId), start(workId), finish(outcome), initialize(boundary), checkpoint(cursor), recover(). Only accepted/unstarted resumes automatically; started without terminal evidence becomes review-required. Terminal bad entries do not block later UIDs.

### email-message-history

Own EmailMessageStore.putSource(owner,boundedSource,parsed)->recordId; resolveThread(owner,messageIdentifiers); get(owner,thread,record); history(owner,thread,limit); attachment(owner,record,id); putSent(owner,constructedMessage,operation). Incoming records carry wire identifiers and separate authored/quoted/forwarded provenance. Outbound third-party conversation data is not inserted into the initiating-user reply thread.

### email-incoming-auth

Own authenticateInbound(parsed,rawHeaders,receiverConfig,channels)->verifiedSender|ignored|review-required with safe reason enum. verifiedSender binds canonicalAddress,userId,authservId,alignedDomain and provenance statement. Require allowed account even under replyPolicy all/public; reject self, Auto-Submitted other than no, null-envelope/DSN MIME and delivery-failure markers. Never reply to rejected mail; Reply-To/Cc/Bcc do not alter verified reply destination.

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

Reuse predecessor real IMAP fixture; deterministic injected clock and durable restart harness cover initialization/discovery/accept/checkpoint/start boundaries.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document 300-second interval excludes server/agent latency and manual review behavior after mailbox replacement. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
