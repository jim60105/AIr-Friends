# Design

## Context

There is no destination-grant producer. ACP client currently logs agent_message_chunk text; a separate preflight needs bounded text capture without forwarding content into operational logs.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Before exposing third-party sending, orchestrator calls predecessor EmailIntentRuntime on only verified current authored text using the selected model/backend. Strict JSON describes none, clarify or requested action, recipient and source selection. Host validates against immutable provenance and exact authored-text address occurrence. Ambiguity, runtime unavailability or invalid output yields no grant; normal user reply asks clarification. No history/attachments/quotes are supplied to this producer and the sending agent cannot invoke it.

### Owned interfaces and callsites

Own EmailIntentDecision=none|clarify|grant and DestinationGrant={grantId,sessionId,workId,owner,action:compose|forward,canonicalRecipient,sourceRecordId?,requestDigest}. Orchestrator records immutable grant in ActiveSession before sending agent starts; read-only in SkillContext, never grant mutation endpoint. One destination/action per grant; multiple explicit actions have separately host-assigned IDs/slots. Producer validates recipient occurs in authored text and source selection resolves only owner-accessible history. No grant for reminders/spontaneous/non-user sessions. Only authenticated email request sessions are a third-party entry point in this batch; no cross-platform account linking is added.

Affected implementation/tests: `src/core/email-intent-preflight.ts`, `src/core/session-orchestrator.ts`, `src/skill-api/session-registry.ts`, `tests/core/email-intent-preflight.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### email-incoming-auth

Own authenticateInbound(parsed,rawHeaders,receiverConfig,channels)->verifiedSender|ignored|review-required with safe reason enum. verifiedSender binds canonicalAddress,userId,authservId,alignedDomain and provenance statement. Require allowed account even under replyPolicy all/public; reject self, Auto-Submitted other than no, null-envelope/DSN MIME and delivery-failure markers. Never reply to rejected mail; Reply-To/Cc/Bcc do not alter verified reply destination.

### email-session-receipts

Own IncomingWork receipt integration, workId propagation into ActiveSession and SkillContext, beginEmailWork/finishEmailWork. Rejected policy or removed account is ignored terminal; connector failure after start is review-required unless a definitive no-side-effect terminal failure is proven. Do not infer receipt success from emitEvent return. Production bootstrap remains guarded until activation.

### email-intent-runtime

Own EmailIntentRuntime.interpret({authoredText,model,backend})->{status:complete|unavailable,text?}. Internal host API only, never a skill endpoint. Runtime uses existing environment filtering with email credentials explicitly excluded and suppresses private stream/tool logs. No partially captured output on failure. The grant policy owns strict decision JSON validation, model request and session binding.

### Alternatives

Reuse the established platform/workspace/skill boundaries rather than a second service or arbitrary-recipient generic reply API. In-memory-only state and successful-boolean-only SMTP handling cannot preserve crash uncertainty; durable state and typed phases remain authoritative. Responsibilities without SMTP use those phases as downstream constraints, without reimplementing them.

## Risks / Trade-offs

- [Estimate uncertainty] Named predecessors reduce scope; the itemized budget includes local testing and smoke. If implementation invalidates the estimate, rescope before apply rather than hide work in activation.
- [Private source content] Use opaque identifiers and safe error enums; retain original private bytes only in owner archive/backup. No credential or body-bearing protocol debug logging.
- [Accepted limitations] DMARC authenticates aligned domain control, not mailbox-local identity. Intent interpretation relies on model judgment even with provenance and destination enforcement. SMTP acceptance does not prove delivery and unknown outcome needs manual review.
- [Concurrent edits] Serialize overlapping target files according to the batch index. The single process owns mailbox/workspace state; no cross-process lock service is added.

## Verification design

Use deterministic connector fixtures for both OMP/OpenCode spawn shapes; exercise actual host JSON/grant validation and prove send parameters cannot invoke or update the producer. Model-proof authorization is explicitly excluded.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document accepted model-judgment/prompt-injection residual risk and the preflight versus send-tool trust boundary. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
