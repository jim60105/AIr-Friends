# Proposal

## Why

Opt-in email spontaneous messages supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Email target selection requires both platform spontaneous enabled and enabled email/account entry with spontaneousPost=true. Pick one eligible target and allocate new thread for each durable scheduled tick. Persist tick identity before session start using email mailbox state facilities; do not reuse previous thread or grant. For email only use target user workspace so private memories remain owner-scoped; preserve other platforms bot-workspace semantics. One logical outgoing email per tick; repeated tool calls consult that slot.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spontaneous-posting`: add scoped email behavior and update conflicting existing requirements.

## Impact

Target files and existing consumers: `src/platforms/email/email-adapter.ts`, `src/core/spontaneous-scheduler.ts`, `src/core/spontaneous-target.ts`, `src/core/session-orchestrator.ts`, `tests/core/email-spontaneous.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.25 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- code-conflict: email-spontaneous-occurrences (src/core/spontaneous-scheduler.ts)
- depends-on: email-adapter
- depends-on: email-response-accounting
- depends-on: email-spontaneous-occurrences
- code-conflict: email-config-identity (src/core/spontaneous-scheduler.ts)
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts)
- code-conflict: email-session-receipts (src/core/session-orchestrator.ts)
- code-conflict: email-adapter (src/platforms/email/email-adapter.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts)
- code-conflict: email-response-accounting (src/core/session-orchestrator.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
