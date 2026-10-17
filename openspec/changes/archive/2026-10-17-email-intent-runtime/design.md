# Design

## Context

ACP agent_message_chunk accumulates text for logging. A separate interpretation profile must not inherit normal sending-session tools, private workspace or history.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** deliver the requirements in this change's delta specifications using the existing Deno/ACP/Skill API/workspace architecture. The responsibility is limited to the concrete contract below; predecessor implementations are available before apply.

**Non-Goals:** no implementation during proposal creation; no new general email sending entry points, model-proof authorization, exactly-once promise, delivery guarantee, compatibility alias or data migration. Existing non-email behavior is retained.

## Decisions

Consume the complete native deny-all profiles from `email-opencode-intent-profile` and `email-omp-intent-profile`; this slice does not implement backend-native policy or packaging. Their factory contract supplies private HOME/cwd, provider-only model configuration, no user mounts, no mailbox credentials or Skill API material, and native pre-dispatch tool denial. Add deny-all ACP callback handling as defense in depth. Capture final agent text through a bounded callback, never logs. Deadline 30 seconds; output at most 8 KiB. Tool attempt, timeout, overflow or incomplete output returns unavailable. Teardown obeys existing producer-safe tmp lifecycle.

### Owned interfaces and callsites

Own EmailIntentRuntime.interpret({authoredText,model,backend})->{status:complete|unavailable,text?}. Internal host API only, never a skill endpoint. Runtime uses existing environment filtering with email credentials explicitly excluded and suppresses private stream/tool logs. No partially captured output on failure. The grant policy owns strict decision JSON validation, model request and session binding.

Affected implementation/tests: `src/core/email-intent-runtime.ts`, `src/acp/client.ts`, `src/acp/agent-connector.ts`, `src/acp/types.ts`, `tests/acp/email-intent-runtime.test.ts`. Update every affected caller in this responsibility when its shared interface changes; do not leave dual APIs, empty stubs or shims. New modules remain unregistered in production until final activation, while tests exercise their real implementations.

### Predecessor contracts

### Native intent profiles

`email-opencode-intent-profile` and `email-omp-intent-profile` own `createEmailIntentAgentConfig(backend,providerSelection,temporaryRoots)`, native denial, authored assets and real native-dispatch acceptance. See their designs for exact configuration, model provisioning and development/container paths. Required model-provider API authentication is allowed; mailbox and Skill API credentials remain excluded.

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

Use deterministic ACP fixtures for bounded capture, timeout and lifecycle behavior; native-dispatch enforcement and asset acceptance are completed predecessor evidence. Run one composed profile/capture smoke for each backend against the predecessor scripted provider. Preserve ordinary connector behavior.

The tasks' verification is planned implementation evidence, not exercised runtime evidence. Test doubles for ACP/model decisions are labeled separately from real IMAP/SMTP protocol-service exchanges. No production credentials or mailbox may be used by automated checks.

## Documentation

Document the intent-only profile, hard failure behavior and accepted model-judgment limitation. Implementation updates `docs/email-platform.md` in the section owned by this change and the appropriate existing skill/config docs. Each permanent behavior receives one scoped CHANGELOG Unreleased entry; activation may consolidate duplicate batch wording without omitting any behavior.

## Migration Plan

No migrations or compatibility layers. Apply named predecessors on the eventual feature integration line, then this complete responsibility; production stays disabled until activation. Rollback before activation leaves email unavailable. After activation disable email and stop its producers before reverting code, preserve all private journals/source files, and do not reactivate against unknown/corrupt evidence without review. Existing Discord/Misskey persisted reminder records remain readable.
