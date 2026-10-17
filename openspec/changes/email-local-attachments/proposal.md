# Proposal

## Why

Session-bound local attachment delivery to agents supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add a distinct local-email attachment variant carrying opaque owner/record/attachment references, never file:// URLs or arbitrary local paths. Keep existing network attachment shape intact. Resolve via EmailMessageStore only for the registered owner, copy bounded bytes to workspace/tmp/<sessionId>/attachments/<internalId> with retained display metadata, then make those files available through existing ACP session filesystem roots. All referenced files in current history may be staged as requested context; only trigger images become image ContentBlocks.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multimedia-messages`: add scoped email behavior and update conflicting existing requirements.
- `platform-abstraction`: add scoped email behavior and update conflicting existing requirements.

## Impact

Target files and existing consumers: `src/types/events.ts`, `src/core/context-assembler.ts`, `src/core/session-orchestrator.ts`, `src/platforms/email/attachment-materializer.ts`, `tests/core/session-orchestrator.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-message-history
- depends-on: email-incoming-mime
- code-conflict: email-config-identity (src/types/events.ts)
- code-conflict: email-session-receipts (src/core/session-orchestrator.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts)
- code-conflict: email-response-accounting (src/core/session-orchestrator.ts, tests/core/session-orchestrator.test.ts)
- code-conflict: email-reminder-threads (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
