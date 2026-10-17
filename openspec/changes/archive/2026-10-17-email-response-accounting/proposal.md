# Proposal

## Why

Email response and uncertainty accounting supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add explicit emailResponse={submittedToUser,submittedToThirdParty,unknown,operations}; do not overload replySent, fileSent or normal anchors for third-party sends. All retry gates and crash-recovery decisions consult durable operation evidence after draining in-flight effects. submitted counts as responded; unknown suppresses automatic retry and returns review-required rather than claiming success. Email-specific retry may correct pre-submission validation only; completed/unknown logical slots cannot be replaced by changed payload or another slot during missing-response recovery.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: add scoped email behavior and update conflicting existing requirements.

## Impact

Target files and existing consumers: `src/skill-api/server.ts`, `src/skill-api/session-registry.ts`, `src/core/session-orchestrator.ts`, `src/skills/reply-handler.ts`, `src/skills/file-handler.ts`, `tests/skill-api/server.test.ts`, `tests/core/session-orchestrator.test.ts`, `src/core/reply-dispatcher.ts`, `src/core/agent-core.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-forward-skill
- depends-on: email-submission-service
- depends-on: email-session-receipts
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts, tests/core/session-orchestrator.test.ts)
- code-conflict: email-session-receipts (src/core/agent-core.ts, src/core/session-orchestrator.ts)
- code-conflict: email-adapter (src/skills/file-handler.ts, src/skills/reply-handler.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts, src/skill-api/session-registry.ts)
- code-conflict: email-compose-skill (src/skill-api/server.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)
- code-conflict: email-private-observability (src/skill-api/server.ts, src/skills/file-handler.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)
- code-conflict: email-activation (src/core/agent-core.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
