# Design

## Context

ReplyResult and SendFileResult expose success/messageId/error only; the API one-second cache is insufficient for durable mail deduplication.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Persist operations in data/email/submissions.jsonl and constructed .eml files under the initiating workspace email/sent area. The journal stores opaque IDs, owner and content digest, never duplicates body text into operational diagnostics. Pre-allocate logical operation keys outside model parameters; repeated same key with changed content returns conflict.

### Owned interfaces and callsites

Own EmailOperationKey={workId,actionSlot}; actionSlot=reply|files|third-party:<grantId>|reminder:<id>|spontaneous:<tickId>. Lifecycle=prepared|submitting|submitted|failed|unknown; sentCopy=pending|appended|failed. prepare(key,digest,emlRef), markSubmitting(), recordOutcome(), lookup(). Add optional emailSubmission={operationId,phase,targetKind,sentCopy,safeCode} to reply/file/skill results. SMTP-accepted means submitted only. New model-supplied keys cannot evade deduplication.

Affected implementation/tests: `src/platforms/email/submission-store.ts`, `src/types/platform.ts`, `src/skills/types.ts`, `tests/platforms/email/submission-store.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-durable-files

Own appendDurable(record), replaceSnapshot(value), readJournal()->{records,integrity}. Integrity is clean|torn-tail|corrupt; readers get byte offset and safe code, never raw line in diagnostic. Torn tails remain on disk until explicit safe repair; subsequent append is prohibited on a damaged journal. No automatic trim that could erase a send intent.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Exercise real file replay at prepare, submitting and result boundaries and assert every uncertain path makes zero further SMTP attempts through a counting test seam.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document operation phases, safe inspection fields and the lack of automatic unknown-operation retry. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
