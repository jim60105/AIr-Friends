# Proposal

## Why

Isolated email intent interpretation runtime supplies a bounded part of the approved email platform without enabling incomplete ingress. Existing Discord/Misskey contracts must remain intact.

## What Changes

- Add an intent-only execution profile for OMP and OpenCode with fresh isolated temporary workspace/HOME, no user mounts, no Skill API token/pointer/JWT, no external MCP, empty script inventory and deny-all-tools at native availability and permission sink. Capture final agent text through a bounded callback, never logs. Deadline 30 seconds; output at most 8 KiB. Tool attempt, timeout, overflow or incomplete output returns unavailable. Teardown obeys existing producer-safe tmp lifecycle.
- Deliver executable acceptance scenarios, deterministic regression tests, controlled smoke verification and operator documentation within this change.
- Keep production email unavailable until `email-activation`; dependencies are completed implementation prerequisites, not deferred work.

## Capabilities

### New Capabilities

- `email-intent-runtime`: Isolated email intent interpretation runtime behavior.

### Modified Capabilities

None.

## Impact

Target files and existing consumers: `src/core/email-intent-runtime.ts`, `src/acp/client.ts`, `src/acp/agent-connector.ts`, `src/acp/types.ts`, `tests/acp/email-intent-runtime.test.ts`. Dependency additions are owned only where named in design.md.

## Estimate

Total: **6.75 engineering hours**, strictly below 8 hours. See tasks.md for itemized implementation, tests, smoke, documentation and contingency. The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Batch:

- depends-on: email-session-receipts
- code-conflict: email-private-observability (src/acp/client.ts)

Apply in the topological order in `../email-config-identity/batch-index.md`; serialize overlapping files even without semantic dependency. All affected callers belong to this slice or named predecessors/successors and are listed in the shared contract index.
