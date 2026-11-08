# Proposal

## Why

P0-3 requires that SIGTERM, SIGKILL after 2 seconds, pool cleanup and restart leave no orphan processes. The Go record leaves two gaps for step 5: children that outlive a wrapper SIGKILL (the PoC observed `sigkillSurvivors: 2`, because `dumb-init` cannot forward `SIGKILL`), and pool cleanup. Today `AgentProcessPool.stop()` only clears timers, so pooled agents are left to the container's signal forwarding. `src/utils/process-lifecycle.ts` also still spawns `kill` and `pgrep` with `Deno.Command`.

## What Changes

- Port `src/utils/process-lifecycle.ts` to `node:child_process` (`pgrep`) and `process.kill` (liveness and signals), keeping every verdict unchanged.
- Add `killProcessTree(rootPid, signal)` to `process-lifecycle.ts`: enumerate descendants with the existing `pgrep -P` walk, signal them deepest first, then the root.
- `AgentConnector.disconnect()` escalation sends `SIGKILL` through `killProcessTree` on the wrapper PID instead of to the wrapper alone.
- `AgentProcessPool.stop()` becomes `async`, disconnects every pooled connector in parallel after clearing timers, and `AgentCore` awaits it on shutdown.
- Convert `src/core/agent-process-pool.ts` and the pool and lifecycle tests; add real-process tests that count descendants.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: adds `Escalated Disconnect Reaps The Agent Process Tree`.
- `shared-acp-process-pool`: adds `Pool Stop Terminates Every Pooled Agent`.

## Impact

- Edited: `src/utils/process-lifecycle.ts`, `src/core/agent-process-pool.ts`, `src/acp/agent-connector.ts` (escalation call only), `src/core/agent-core.ts` (awaiting `stop()`), `tests/utils/process-lifecycle.test.ts`, `tests/core/agent-process-pool.test.ts`, `tests/core/omp-pool-modes.test.ts`, `tests/acp/agent-connector-process-monitor.test.ts` (two new tests).
- Shutdown now waits up to about 4 seconds (2-second grace plus escalation) for live pooled agents.
- P0 ownership: **P0-3** pool cleanup and children that outlive a wrapper SIGKILL (process level). Container stop and restart remain with `drill-bun-cutover-and-rollback`.
- No human review document.

## Batch:

depends-on: adopt-bun-agent-process-boundary
depends-on: convert-core-sessions-and-workspaces-to-bun
depends-on: convert-core-state-and-schedulers-to-bun

Conflict note: edits `src/acp/agent-connector.ts` after `adopt-bun-agent-process-boundary`, and `src/core/agent-core.ts` after `convert-core-sessions-and-workspaces-to-bun`. `port-signals-and-entrypoint-to-bun` relies on the awaited pool stop.
