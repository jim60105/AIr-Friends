# Proposal

## Why

Common durable email sending service supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Prepare and fsync constructed content and intent, then durably mark submitting before invoking SMTP. Persist result before reporting it. If result persistence fails after SMTP acceptance expose unknown and suppress resend. Upon submitted persist local sent history then APPEND identical bytes to sentFolder. History/copy failures after known acceptance never downgrade submitted; a restart repairs history or append from stored MIME without SMTP.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-submission`: Common durable email sending service behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/mail-service.ts`, `tests/platforms/email/mail-service.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-submission-journal
- depends-on: email-mime-signature
- depends-on: email-smtp-transport
- depends-on: email-imap-transport
- code-conflict: none

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
