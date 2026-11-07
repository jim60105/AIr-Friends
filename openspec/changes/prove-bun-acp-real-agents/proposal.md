# Proposal

## Why

Deterministic children cannot show that real agents survive a Bun parent. OpenCode and OMP use the same stdio ACP transport as production, and design section 8 step 2 requires ACP with both real agents, including backpressure (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`). P0 blockers 1, 2 and 3 name these real-child behaviors.

## What Changes

- Add a loopback scripted provider and per-agent launch fixtures that run the pinned `opencode` and `omp` executables with no external network and no credentials.
- Add a minimal ACP driver over the proof-of-concept spawn boundary, using the same `@agentclientprotocol/sdk` version as production.
- Add the `acp` suite, implementing criteria ACP-01 to ACP-10 for both agents: handshake, large traffic, slow consumer, cancellation, timeout, abrupt exit, end of stream, real child environment and teardown.
- No product file changes. `AgentConnector` and `ChatbotClient` stay on Deno.

## Capabilities

### New Capabilities

- `bun-poc-acp-transport`: behavior real OpenCode and OMP must show over ACP with a Bun parent before the migration may proceed.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/acp/`, `migration/bun/poc/suites/acp.spec.ts`.
- No model provider is contacted; the provider is a test fixture on loopback.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: define-bun-go-no-go-gate
depends-on: prove-bun-agent-process-boundary

Uses the image and catalog from the gate, and imports `process/agent-process.ts` and `process/proc-tree.ts`. Conflict note: touches only its own new files. If `prove-bun-agent-process-boundary` selected the `Bun.spawn` fallback, run this suite with the same `POC_SPAWN_BACKEND`.

Deferred, not part of this batch: moving the connector to Bun is design section 8 step 5, planned only after a Go result.
