# Proposal

## Why

Serialized IMAP polling and reconciliation supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Poll every pollIntervalMs, default 300000, with a single in-flight round and bounded sequential UID batches. Initialize from UIDNEXT-1 while persisting UIDVALIDITY before scanning. Store source/accepted record before checkpointing. At UIDVALIDITY replacement compare persisted raw-source digest plus sender/wire-ID evidence; identical known sources are not new work. Unmatched pre-boundary or multiply matching entries become review-required; do not replay the mailbox.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-mailbox-polling`: Serialized IMAP polling and reconciliation behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/mailbox-poller.ts`, `tests/platforms/email/mailbox-poller.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-mailbox-journal
- depends-on: email-message-history
- depends-on: email-incoming-auth
- depends-on: email-imap-transport
- code-conflict: none

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
