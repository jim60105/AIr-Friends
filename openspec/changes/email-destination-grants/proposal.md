# Proposal

## Why

Pre-send natural-language destination grants supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Before exposing third-party sending, orchestrator calls predecessor EmailIntentRuntime on only verified current authored text using the selected model/backend. Strict JSON describes none, clarify or requested action, recipient and source selection. Host validates against immutable provenance and exact authored-text address occurrence. Ambiguity, runtime unavailability or invalid output yields no grant; normal user reply asks clarification. No history/attachments/quotes are supplied to this producer and the sending agent cannot invoke it.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-destination-authorization`: Pre-send natural-language destination grants behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/core/email-intent-preflight.ts`, `src/core/session-orchestrator.ts`, `src/skill-api/session-registry.ts`, `tests/core/email-intent-preflight.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-incoming-auth
- depends-on: email-session-receipts
- depends-on: email-intent-runtime
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts)
- code-conflict: email-session-receipts (src/core/session-orchestrator.ts)
- code-conflict: email-response-accounting (src/core/session-orchestrator.ts, src/skill-api/session-registry.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
