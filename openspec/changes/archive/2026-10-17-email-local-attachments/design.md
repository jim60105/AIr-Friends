# Design

## Context

Attachment.url is required and buildPromptContent always safe-fetches att.url. ContextAssembler renders URLs and FileHandler already checks lexical and real path containment.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Add a distinct local-email attachment variant carrying opaque owner/record/attachment references, never file:// URLs or arbitrary local paths. Keep existing network attachment shape intact. Resolve via EmailMessageStore only for the registered owner, copy bounded bytes to workspace/tmp/<sessionId>/attachments/<internalId> with retained display metadata, then make those files available through existing ACP session filesystem roots. All referenced files in current history may be staged as requested context; only trigger images become image ContentBlocks.

### Owned interfaces and callsites

Own Attachment discriminated local variant and materializeEmailAttachment(owner,sessionId,ref)->sessionPath. Network URL branch still uses safeFetch and all existing SSRF checks. Local images obey 20 MiB/capability/conversion limits, non-images receive session-path descriptions. Permanent archive is reference-only to the model; arbitrary source paths cannot be supplied.

Affected implementation/tests: `src/types/events.ts`, `src/core/context-assembler.ts`, `src/core/session-orchestrator.ts`, `src/platforms/email/attachment-materializer.ts`, `tests/core/session-orchestrator.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-message-history

Own EmailMessageStore.putSource(owner,boundedSource,parsed)->recordId; resolveThread(owner,messageIdentifiers); get(owner,thread,record); history(owner,thread,limit); attachment(owner,record,id); putSent(owner,constructedMessage,operation). Incoming records carry wire identifiers and separate authored/quoted/forwarded provenance. Outbound third-party conversation data is not inserted into the initiating-user reply thread.

### email-incoming-mime

Own ParsedEmail={from,subject,wireIds,plainBody,provenance:{authoredText,quotedText,forwardedText,status},attachments:[{id,displayName,mimeType,size}],sourceRef}. Header parse rejects multiple From mailboxes and malformed routing headers; no auth decision occurs here. Apply raw bytes 25 MiB default and incoming attachment count 10 before materialization; inline binary MIME parts count too.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Extend multimedia/context and workspace-tmp tests; add positive non-image local file read through current-session filesystem policy and negative cross-session/symlink cases.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Update attachment contract and prompt guidance with literal session file paths, with no SSRF exceptions. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
