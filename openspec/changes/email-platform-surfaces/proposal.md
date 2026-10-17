# Proposal

## Why

Email platform-aware workspace and administration surfaces supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Migrate platform union consumers to VALID_PLATFORMS/isValidPlatform and retain explicit platform-specific branches only where behavior truly differs. Cover workspace recognition/reclamation, memory maintenance enumeration, existing admin selectors/status/history, model routing by email/account canonical user, metric labels and data-directory backup inclusion. Do not make email a public posting surface or add a dashboard mail workflow. Changes that already work generically receive tests, not duplicate abstractions.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-platform-integration`: Email platform-aware workspace and administration surfaces behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/core/workspace-manager.ts`, `src/core/model-router.ts`, `src/core/memory-maintenance-scheduler.ts`, `src/utils/metrics.ts`, `src/dashboard`, `src/core/git-backup-service.ts`, `tests/core/workspace-tmp-lifecycle.test.ts`, `tests/dashboard/server.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-config-identity
- depends-on: email-message-history
- code-conflict: none

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
