# Proposal

## Why

Durable SMTP operation identity supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Persist operations in data/email/submissions.jsonl and constructed .eml files under the initiating workspace email/sent area. The journal stores opaque IDs, owner and content digest, never duplicates body text into operational diagnostics. Pre-allocate logical operation keys outside model parameters; repeated same key with changed content returns conflict.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-submission-state`: Durable SMTP operation identity behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/submission-store.ts`, `src/types/platform.ts`, `src/skills/types.ts`, `tests/platforms/email/submission-store.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-durable-files
- code-conflict: email-adapter (src/types/platform.ts)
- code-conflict: email-compose-skill (src/skills/types.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
