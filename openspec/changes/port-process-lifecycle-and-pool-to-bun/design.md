# Design

## Context

See `proposal.md`. Observed facts:

- `src/utils/process-lifecycle.ts` (322 lines): `processAlive(pid)` runs `kill -0 <pid>` and returns `code === 0` (any failure, including `EPERM`, is `false`); `listChildPids(pid)` runs `pgrep -P <pid>` (exit 0 → PIDs, exit 1 → empty and `ok: true`, other → `ok: false`); a frontier loop collects all descendants; `killPids(pids, "TERM" | "KILL")` runs `kill -<SIG> <pid>` per PID, best effort. `awaitChildQuiescence` (used by `session-orchestrator.ts` and the pool) drives these through an injectable `ChildDrainDeps`.
- `src/core/agent-process-pool.ts` (761 lines) has three `Deno.` uses (`mkdir`, `readTextFile`). `stop()` clears the queue sweeper and reclaim timers only. `AgentCore` (`src/core/agent-core.ts` line 499) calls `this.processPool?.stop()` synchronously.
- `AgentConnector.disconnect()` (after `adopt-bun-agent-process-boundary`) sends `SIGKILL` with `this.process.kill("SIGKILL")` when the 2-second race times out. `this.process.pid` is the `dumb-init` wrapper PID.
- Go record process evidence: `sigkillSurvivors: 2` for a child ignoring `SIGTERM` after a wrapper-only `SIGKILL`.

## Goals / Non-Goals

**Goals:** Bun-native lifecycle primitives with identical verdicts; no survivors after escalation; pool stop that terminates agents; process-count tests.

**Non-Goals:**

- No change to `awaitChildQuiescence` verdict logic, its windows (`CHILD_DRAIN_TIMEOUT_MS`, `CHILD_KILL_WINDOW_MS`) or its injection seam.
- No process-group (`detached`, negative PID) signalling: the wrapper shares the daemon's group, and killing a group would hit the daemon.
- No container-level checks (`drill-bun-cutover-and-rollback`).

## Decisions

### D1. Primitives

| Before | After |
| --- | --- |
| `kill -0 <pid>` command, `code === 0` | `try { process.kill(pid, 0); return true } catch { return false }` (`ESRCH` and `EPERM` both `false`, as the command's non-zero exit was) |
| `pgrep -P <pid>` via `Deno.Command(...).output()` | `execFile("pgrep", ["-P", String(pid)])` promisified; read `error.code` as the exit status: no error → parse stdout; exit 1 → `{ ok: true, pids: [] }`; anything else, including `ENOENT` for a missing `pgrep` → `{ ok: false, pids: [] }` |
| `kill -<SIG> <pid>` command | `process.kill(pid, "SIGTERM" | "SIGKILL")` in `try`/`catch` |

### D2. `killProcessTree`

```ts
export async function killProcessTree(rootPid: number, signal: "SIGTERM" | "SIGKILL"): Promise<{ ok: boolean; signalled: number[] }>;
```

Collect descendants with the existing frontier walk (on `ok: false`, still signal the root and return `ok: false`), reverse the list so the deepest come first, signal each, then signal the root. Export it for the connector and tests.

### D3. Connector escalation

In `disconnect()`, replace `this.process.kill("SIGKILL")` with `await killProcessTree(this.process.pid, "SIGKILL")`, keeping the surrounding `try`/`catch` and log line. The graceful path is unchanged. The descendant walk must run before the wrapper dies, so it runs before signalling the root (D2 order).

### D4. Pool stop

```ts
async stop(): Promise<void>  // clear sweeper and timers as before, then
await Promise.allSettled([...this.entries.values()].map((e) => e.connector.disconnect()));
this.entries.clear();
```

`AgentCore`'s shutdown awaits it. Update the pool tests' fakes and calls for the async signature.

### D5. Process-count tests

Shared helper inside each new test: `descendants(pid)` uses `killProcessTree`'s collection path through an exported `listDescendantPids(pid)` (export the existing walk). Fixtures are small Bun scripts written to a temp directory:

- `ignore-term-parent.ts`: spawns `sleep 600` with `trap '' TERM` through `sh -c` and itself ignores `SIGTERM` (`process.on("SIGTERM", () => {})`), then idles.
- For the connector scenarios, follow the existing pattern in `tests/acp/agent-connector-process-monitor.test.ts`: build a connector with `createConnector(logger)`, spawn the fixture with `createAgentProcess({ command: process.execPath, args: ["run", "--no-env-file", fixture], cwd: tmp, env: { PATH: process.env.PATH ?? "" } })`, assign it with `connector["process"] = handle`, then call `connector.disconnect()`. The graceful scenario uses a fixture that exits on `SIGTERM` and asserts no `warn` log `Agent process did not exit within SIGTERM timeout, sending SIGKILL`.
- The pool scenario uses the existing pool test harness with two entries whose connectors wrap such fixtures.

Assertions: before teardown, the descendant list is non-empty; after `disconnect()` or `stop()` resolves and 1 second passes, `processAlive` is false for the wrapper and for every PID collected before teardown.

## Risks / Trade-offs

- [PID reuse makes `processAlive` true for a new unrelated process] → The 1-second window and the low PID churn of a test host make this negligible; the assertion uses the PIDs collected before teardown.
- [Awaiting disconnects slows shutdown] → Bounded by the connector's own 2-second grace plus escalation, in parallel. The owner accepted up to about 4 s of added shutdown time on 2026-11-09.
