# Proposal

## Why

Guarded production email activation supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Remove only the explicit activation-unavailable guard after composing the complete real store/parser/auth/poller/mail-service/adapter. Recover all durable journals before connection or session admission. Await workspace reclamation before exposing ingress as existing bootstrap does. Revalidate trust attestation/TLS/settings before any connection. Register adapter with registry and AgentCore, then connect and schedule. Shutdown first stops poll admission/schedulers, drains in-flight work and journals, then disconnects SMTP/IMAP. Do not leave feature scaffolds, no-ops or partially enabled paths.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-platform-activation`: Guarded production email activation behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/bootstrap.ts`, `src/core/config-loader.ts`, `src/core/agent-core.ts`, `src/platforms/platform-registry.ts`, `tests/core/email-bootstrap.test.ts`, `tests/integration/email-platform.integration.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- code-conflict: email-spontaneous-occurrences (src/bootstrap.ts)
- depends-on: email-poll-recovery
- depends-on: email-submission-service
- depends-on: email-adapter
- depends-on: email-destination-grants
- depends-on: email-compose-skill
- depends-on: email-forward-skill
- depends-on: email-response-accounting
- depends-on: email-reminder-threads
- depends-on: email-spontaneous-targets
- depends-on: email-private-observability
- depends-on: email-platform-surfaces
- depends-on: email-tool-guidance
- code-conflict: email-config-identity (src/core/config-loader.ts)
- code-conflict: email-session-receipts (src/core/agent-core.ts)
- code-conflict: email-response-accounting (src/core/agent-core.ts)
- code-conflict: email-reminder-threads (src/bootstrap.ts)

Apply in the topological order in [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index); serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
