# Proposal

## Why

Restart-safe thread-preserving email reminders supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add optional origin={channelId,replyAnchorRecordId} to reminder records, required and owner-validated on new email reminder creation. Resolve it through ReminderStore replay into ResolvedReminder. Email delivery uses origin thread/anchor, never getDmChannelId creating a new thread. Recheck current enabled allowed account before generating or submitting. Missing/corrupt email origin is review-required; existing Discord/Misskey records continue unchanged without migration.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scheduled-reminders`: add scoped email behavior.

## Impact

Target files and existing consumers: `src/types/reminder.ts`, `src/core/reminder-store.ts`, `src/skills/reminder-handler.ts`, `src/core/session-orchestrator.ts`, `src/bootstrap.ts`, `tests/core/session-orchestrator.reminder.test.ts`, `tests/skills/reminder-handler.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- code-conflict: email-private-observability (src/core/reminder-store.ts)
- code-conflict: email-spontaneous-occurrences (src/bootstrap.ts)
- depends-on: email-adapter
- depends-on: email-response-accounting
- code-conflict: email-local-attachments (src/core/session-orchestrator.ts)
- code-conflict: email-session-receipts (src/core/session-orchestrator.ts)
- code-conflict: email-destination-grants (src/core/session-orchestrator.ts)
- code-conflict: email-response-accounting (src/core/session-orchestrator.ts)
- code-conflict: email-spontaneous-targets (src/core/session-orchestrator.ts)
- code-conflict: email-tool-guidance (src/core/session-orchestrator.ts)
- code-conflict: email-activation (src/bootstrap.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
