# Proposal

## Why

The hardest ACP failures are the ones P0 blocker 2 names beyond the happy path: backpressure, timeout, cancellation, abrupt exit and end of stream (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 8 and 9). The connector's crash handling depends on them, so they need proof on real agents under a Bun parent.

## What Changes

- Add the `acp-failure` suite, implementing criteria ACP-04 to ACP-08 for both agents, on the provider, launch fixtures and driver from `prove-bun-acp-real-agents`.
- No product file changes.

## Capabilities

### New Capabilities

- `bun-poc-acp-resilience`: how real agents must behave over ACP with a Bun parent when the stream is slow, cancelled, stalled, killed or closed.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/suites/acp-failure.spec.ts`.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: prove-bun-acp-real-agents

Imports `acp/loopback-provider.ts`, `acp/agents.ts`, `acp/driver.ts` and `process/proc-tree.ts`. Conflict note: adds one new file only.

Deferred, not part of this batch: moving the connector to Bun is design section 8 step 5, planned only after a Go result.
