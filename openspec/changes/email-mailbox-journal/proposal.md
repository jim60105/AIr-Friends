# Proposal

## Why

Durable mailbox processing evidence supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Persist mailbox fingerprint (host, account, folder), initialized boundary, UIDVALIDITY, scan cursor and per-entry states in data/email/mailbox.json and processing.jsonl. Cursor means durable discovery coverage, never agent completion. append accepted with immutable source identity before advancing discovery. A changed configured mailbox fingerprint fails closed instead of treating a different inbox as initialized.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-mailbox-state`: Durable mailbox processing evidence behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/mailbox-store.ts`, `tests/platforms/email/mailbox-store.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.5 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-durable-files
- code-conflict: none

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
