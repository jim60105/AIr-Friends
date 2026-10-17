# Proposal

## Why

Email configuration and mailbox identity supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Normalize a parsed single mailbox by lowercasing its IDNA domain only, preserving local-part case and aliases. Use e_ plus SHA-256 hex of its canonical UTF-8 addr-spec as userId. Store canonical address separately; reject parsing ambiguity rather than sanitize an address into a path. Channel entries accept email/account/<canonical-address> and loadChannels normalizes their value to the same userId. No raw address is a workspace component.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-identity`: Email configuration and mailbox identity behavior.

### Modified Capabilities

- `platform-abstraction`: add scoped email behavior and update conflicting existing requirements.
- `configuration-and-deployment`: add scoped email behavior and update conflicting existing requirements.

## Impact

Target files and existing consumers: `src/types/config.ts`, `src/types/events.ts`, `src/core/config-loader.ts`, `src/utils/env.ts`, `config.example.yaml`, `.env.example`, `helm/values.yaml`, `src/core/spontaneous-scheduler.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: none
- code-conflict: email-local-attachments (src/types/events.ts)
- code-conflict: email-spontaneous-targets (src/core/spontaneous-scheduler.ts)
- code-conflict: email-activation (src/core/config-loader.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
