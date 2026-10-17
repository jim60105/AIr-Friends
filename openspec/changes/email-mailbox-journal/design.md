# Design

## Context

There is no mailbox store. Base adapter emission swallows handler failures, so a high-water UID alone cannot represent completion.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Persist mailbox fingerprint (host, account, folder), initialized boundary, UIDVALIDITY, scan cursor and per-entry states in data/email/mailbox.json and processing.jsonl. Cursor means durable discovery coverage, never agent completion. append accepted with immutable source identity before advancing discovery. A changed configured mailbox fingerprint fails closed instead of treating a different inbox as initialized.

### Owned interfaces and callsites

Own MailboxKey={fingerprint,uidValidity,uid}; ProcessingState=discovered|accepted|started|completed|ignored|failed|review-required. discover(), accept(sourceRecordId), start(workId), finish(outcome), initialize(boundary), checkpoint(cursor), recover(). Only accepted/unstarted resumes automatically; started without terminal evidence becomes review-required. Terminal bad entries do not block later UIDs.

Affected implementation/tests: `src/platforms/email/mailbox-store.ts`, `tests/platforms/email/mailbox-store.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

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

Add restart/reopen state-machine tests on real temporary files, including discovery-before-checkpoint and accepted-before-start failures.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document cursor meaning and operator review-required records without adding an automatic replay command. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
