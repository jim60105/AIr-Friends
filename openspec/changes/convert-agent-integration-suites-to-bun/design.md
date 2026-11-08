# Design

## Context

See `proposal.md`. Observed facts:

- `tests/integration/shared-process.integration.test.ts` (23 KB) spawns `tests/mocks/mock-acp-agent.ts` as the agent (`["run", ...]` at line 242), finds binaries with `new Deno.Command("which")`, checks liveness with `kill -0`, enumerates children with `pgrep -P`, and kills with `pkill -9 -P` and `kill -9`; its `Deno.test` options set `sanitizeExit`, `sanitizeOps` and `sanitizeResources` to `false`.
- `tests/integration/omp-lifecycle/lifecycle.integration.test.ts` (37 KB) and `opencode-regression.integration.test.ts` (23 KB) drive the connector and pool with mocks (`opencode-regression` launches `tests/mocks/mock-acp-agent.ts`).
- `tests/integration/omp-native-runtime/native-runtime.integration.test.ts` (76 KB) spawns the official `omp acp` when it is installed and the native cache is prepared (it imports `prepareOmpNativeCache` from `scripts/omp/prepare-native-cache.ts`), and skips otherwise.
- The mock agent and drivers were converted by `convert-utils-platforms-and-test-support-to-bun`; the lifecycle primitives (`processAlive`, `listDescendantPids`, `killProcessTree`) by `port-process-lifecycle-and-pool-to-bun`.
- Go record finding 5: OMP 18.6.1 aborts periodic model output; fixtures that script model text must use non-periodic text.

## Goals / Non-Goals

**Goals:** the four suites on Bun, green; descriptor and process leak checks in place of sanitizers.

**Non-Goals:**

- No new ACP scenarios beyond the leak check; P0-2 cases already exist in these suites and in `adopt-bun-agent-process-boundary`.
- No change to production code. A failure caused by production code is fixed in a follow-up to the owning step 5 change, not here.
- No container run.

## Decisions

### D1. Launch and helpers

| Before | After |
| --- | --- |
| `new Deno.Command(Deno.execPath(), { args: ["run", <deno flags>, mockAgentScript, ...] })` or `agentConfig` `command: "deno", args: ["run", ...]` | `command: process.execPath, args: ["run", "--no-env-file", mockAgentScript, ...]` |
| `which <name>` | `Bun.which(name)` |
| `kill -0 <pid>` | `processAlive(pid)` |
| `pgrep -P <pid>` then `pkill -9 -P`/`kill -9` | `killProcessTree(pid, "SIGKILL")` |
| skip when `deno` is missing | skip only when `dumb-init` is missing |

### D2. Leak check

`tests/helpers/leak-check.ts`:

```ts
export interface LeakSnapshot { fds: number; descendants: number[] }
export async function snapshot(): Promise<LeakSnapshot>;          // readdirSync("/proc/self/fd").length, listDescendantPids(process.pid)
export async function assertNoLeak(before: LeakSnapshot, graceMs = 2000): Promise<void>;
```

`assertNoLeak` polls every 100 ms up to `graceMs` until `descendants` is empty and `fds <= before.fds`; on timeout it throws an `AssertionError` naming surviving PIDs and the descriptor delta. Each test in the four files takes a snapshot at its start and calls `assertNoLeak` at the end of its own teardown (`finally`). `tests/helpers/leak-check.test.ts` covers both spec scenarios with a `sleep 30` child.

### D3. Fixture text

Where these suites script model output for a real `omp`, use non-periodic text (for example a numbered sentence list), never a repeated phrase.

## Risks / Trade-offs

- [Bun keeps internal descriptors open (event loop, stdio) that change between snapshots] → The check is `<=` the starting count after teardown, not equality, and the starting snapshot is taken inside the test.
- [The real `omp` path is skipped on hosts without it] → `package-bun-container-image` runs the suite inside the image, where `omp` is present.
