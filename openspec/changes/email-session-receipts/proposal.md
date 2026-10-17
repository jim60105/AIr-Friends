# Proposal

## Why

Durable email session start and completion receipts supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add an internal typed email work receipt in event metadata, bound to an accepted record. AgentCore explicitly reports admission denial/queue/start/outcome to mailbox store. Persist started immediately before any agent prompt or dry-run mock side effect. Work accepted but waiting on the agent lease remains unstarted; startup may requeue it. After started, any crash/teardown uncertainty requires review. Mark completed only after lifecycle result and all in-flight email side effects have settled.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-lifecycle`: add scoped email behavior.

## Impact

Target files and existing consumers: `src/core/agent-core.ts`, `src/core/session-orchestrator.ts`, `src/platforms/email/session-receipts.ts`, `tests/core/email-session-receipts.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.5 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-mailbox-journal
- depends-on: email-poll-recovery
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts)
- code-conflict: email-response-accounting (src/core/agent-core.ts, src/core/session-orchestrator.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)
- code-conflict: email-activation (src/core/agent-core.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
