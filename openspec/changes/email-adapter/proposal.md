# Proposal

## Why

Email replies history and file adapter supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Implement every adapter method as real supported behavior or explicit unsupported result. Email supports owner-thread history and replies/files, private DMs, no guild/search/reactions/editing/typing. Add optional supportsEditing capability with existing platform adapters explicitly true and email false; editing/reaction handlers fail explicitly, never send replacement mail. sendTyping has inherited void contract, so supportsTypingIndicator=false and adapter method performs no network action with guidance describing unsupported status.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-abstraction`: add scoped email behavior.

## Impact

Target files and existing consumers: `src/platforms/email/email-adapter.ts`, `src/types/platform.ts`, `src/skills/reply-handler.ts`, `src/skills/file-handler.ts`, `tests/platforms/email/email-adapter.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-message-history
- depends-on: email-local-attachments
- depends-on: email-submission-service
- depends-on: email-session-receipts
- code-conflict: email-submission-journal (src/types/platform.ts)
- code-conflict: email-response-accounting (src/skills/file-handler.ts, src/skills/reply-handler.ts)
- code-conflict: email-spontaneous-targets (src/platforms/email/email-adapter.ts)
- code-conflict: email-private-observability (src/skills/file-handler.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
