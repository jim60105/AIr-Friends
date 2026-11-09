# Proposal

## Why

`src/acp/agent-connector.ts` spawns OpenCode and OMP with `new Deno.Command(DUMB_INIT_PATH, { clearEnv: true, env, stdin/stdout/stderr: "piped" })`. Source design section 4.3 makes `createAgentProcess` the single spawn boundary, built on `node:child_process`, and the Go record proved that boundary under Bun 1.4.2 with one finding: `Writable.toWeb` does not propagate backpressure (a 16 MiB write to a sleeping child resolved in 6 ms), so stdin must forward through `child.stdin.write`'s callback. The Go record also leaves the production variable set of P0-1 (skill token directory, provider keys) to step 5.

## What Changes

- Add `src/acp/agent-process.ts` with `createAgentProcess` and `terminateAgentProcess`, based on `migration/bun/poc/process/agent-process.ts` without its PoC observation hooks.
- `AgentConnector` spawns through `createAgentProcess`; `.status` becomes `.exited`; the SIGTERM, 2-second grace and SIGKILL sequence, crash signal and process monitor keep their behavior.
- Remove `DENO_DIR` from both agent environment builders in `src/acp/agent-factory.ts`; Bun needs no cache directory (design section 4.4).
- Rewrite the env-isolation tests to read the real child environment through the boundary, including the production variable sets built by `agent-factory.ts` for OpenCode and OMP.
- Convert the five `tests/acp/agent-connector*.test.ts` files and add `tests/acp/agent-process.test.ts`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sandbox-hardening`: `Agent Subprocess Environment Isolation` states the boundary rule instead of `clearEnv`, and drops `DENO_DIR`.
- `acp-integration`: `AgentConnector Subprocess Management` and `Agent Common Environment` drop `Deno.Command`/`clearEnv` and `DENO_DIR`; adds `Agent Stdin Backpressure` and `Agent Exit Report`.

## Impact

- New: `src/acp/agent-process.ts`, `tests/acp/agent-process.test.ts`. Edited: `src/acp/agent-connector.ts`, `src/acp/agent-factory.ts` (environment builders only), five `tests/acp/agent-connector*.test.ts` files, `tests/acp/agent-factory.test.ts` and `tests/acp/agent-factory-omp.test.ts` only where they assert `DENO_DIR`.
- P0 ownership: **P0-1** (complete: parent secrets absent and the production variable sets present in the real child environment for both agent builders); **P0-2** unit level (backpressure, EOF, stderr consumption, abrupt exit through the boundary); **P0-3** partial (SIGKILL 2 seconds after SIGTERM). Pool cleanup and orphans are `port-process-lifecycle-and-pool-to-bun`; integration-level ACP and container stop are `convert-agent-integration-suites-to-bun` and `drill-bun-cutover-and-rollback`.
- No human review document.

## Batch:

depends-on: convert-acp-client-and-factory-to-bun
depends-on: convert-utils-platforms-and-test-support-to-bun

Conflict note: edits `src/acp/agent-factory.ts` (environment builders only) after `convert-acp-client-and-factory-to-bun`. `rename-deno-runtime-identifiers` later edits other parts of `agent-factory.ts`. Every other step 5 change that touches the connector or pool depends on this one.
