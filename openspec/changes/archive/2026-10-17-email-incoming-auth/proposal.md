# Proposal

## Why

Receiving authentication and allowlist admission supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Only a receiving MTA deployment that removes attacker Authentication-Results claiming the configured authserv-id may set receivingAuth.attestedStripping=true. Document a controlled forged-header injection check and require its successful operator attestation. Parse exactly one authoritative DMARC result, with authenticated From-domain alignment; duplicates/conflicts fail closed. Do not trust textual authserv-id alone. DMARC proves aligned domain control, not authorization of a particular local-part.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-incoming-authentication`: Receiving authentication and allowlist admission behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/platforms/email/incoming-auth.ts`, `tests/platforms/email/incoming-auth.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.5 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-config-identity
- depends-on: email-incoming-mime
- code-conflict: none

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
