# Proposal

## Why

Sender-scoped message and thread history supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Use internal UUID record/thread/attachment IDs. Channel is mail:<userId>:<threadId> and both components are validated. Keep source.eml, parsed.json, attachments/<internalId> and thread journal under workspace/email. Index wire Message-ID only inside the owner namespace; retain unresolved references as metadata, never fabricated content. Multiple matching threads or conflicting IDs yield review-required instead of merging.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-history`: Sender-scoped message and thread history behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/message-store.ts`, `tests/platforms/email/message-store.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **7 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-config-identity
- depends-on: email-durable-files
- code-conflict: none

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
