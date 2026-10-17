# Design

## Context

Compose predecessor owns the common endpoint, payload shape and grant enforcement; forwarding adds source selection without a second arbitrary send path.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Add action forward and required sourceRecordId bound by grant. Fetch immutable source only through EmailMessageStore owner scope, include full designated original body plus all original attachments, and preserve raw source as message/rfc822 to retain original headers/signatures/encoding. Build commentary/signature then original reference section using shared builder. Preflight source raw size, all source attachments and added attachments together before loading/sending. Limit failure rejects the whole operation instead of truncating.

### Owned interfaces and callsites

Own forward request extension {action:forward,sourceRecordId} and source-access checks. Payload file still supplies explicit to/subject/body commentary; host does not accept source paths or wire Message-ID as authorization. Selected source may be another thread belonging to the same owner but never another owner. Duplicate attachment references are rejected. MIME original bytes are immutable; .eml reference counts toward outbound count/aggregate limits as well as decoded source attachments.

Affected implementation/tests: `skills/send-email/SKILL.md`, `skills/send-email/scripts/send-email.ts`, `src/skills/email-handler.ts`, `tests/skills/email-forward.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-compose-skill

Own send-email compose endpoint and parameters {grantId,request:{to,subject,body,attachments?}}. Validate request file with resolvePayloadPath/readPayloadArg and authenticated pointer semantics; server validates all fields again. Host obtains operation key third-party:<grantId>, reserves side effect under recovery fence and returns emailSubmission metadata; no model-chosen operation ID, Cc/Bcc or arbitrary headers. Attachments preflight through current-session realpath containment plus existing send-file count/per-file/aggregate/extension limits. No auto-attachment of memory/history.

### email-message-history

Own EmailMessageStore.putSource(owner,boundedSource,parsed)->recordId; resolveThread(owner,messageIdentifiers); get(owner,thread,record); history(owner,thread,limit); attachment(owner,record,id); putSent(owner,constructedMessage,operation). Incoming records carry wire identifiers and separate authored/quoted/forwarded provenance. Outbound third-party conversation data is not inserted into the initiating-user reply thread.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Use actual parsed MIME fixtures with original signatures, attachment-only source and hostile filenames; compare SMTP-captured original source and decoded attachments byte-for-byte.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document designated-source behavior, attachment accounting and clarification for ambiguous source selection. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
