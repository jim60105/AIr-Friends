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

### D4. Parity record for the environment-interpolated native-leg name

`native-runtime.integration.test.ts` builds its skipped native-leg name from the host's detected `omp` version. The parity baseline captured that name on a host reporting `18.18.0`; any host reporting another version (a CI host without `omp` emits `none`) produces a different name, so the baseline identity is not reproducible and no replacement name can be portable.

`migration/bun/baseline/parity-exceptions.json` therefore records one `removed` exception owned by this change: the baseline case name cannot re-appear, which is what that disposition already means for the other entries. The test keeps its authored name, its gate and its body unchanged, and its prerequisite contract is asserted by the suite's own prerequisite test. This is an edit outside the change's Impact list, and task 3.2's expected-path list names it.

### D5. The gate runs with Bun's per-file isolation

One Bun process runs every test file, so module state is shared between files: `tests/utils/metrics.test.ts` failed only in the multi-file run because earlier files' counters were already in the shared prom-client registry, and a file that leaks a child process made every later file's descendant measurement see it.

Deno's runner kept files independent, so the gate command uses `bun test --isolate` (`bun test --help`, 1.4.2: "Run each test file in a fresh global object. Leaked handles from one file cannot affect another"). It does not make the run parallel — files still execute one at a time, so the repository's env-mutation sequencing constraint is untouched.

### D6. Production defects the new leak checks surfaced, fixed here

The step-5 exit gate is where a real leaked process must surface, so the two defects the checks found were fixed rather than excused, and both fixes are named in task 3.2's expected-path list:

- `src/dashboard/server.ts` (`handleChatConnect`, owning change `convert-skills-dashboard-and-skill-api-support-to-bun`): a failed `connect()` after the agent process was spawned returned 500 without releasing the connector, so `tests/dashboard/server.test.ts`'s three "fails at connection" cases leaked a live `dumb-init -- opencode acp` + `opencode acp` pair (found by the descendant measurement, which reported those PIDs in every later file). The minimal fix releases the connector on the failure path, keeps the 500 and its message, and keeps the launch failure as the reported cause.
- `tests/acp/agent-process.test.ts` ("Agent Exit Report - the connector sends SIGKILL 2 s after SIGTERM when the child ignores it", owning change `adopt-bun-agent-process-boundary`): the connector's escalation is a whole-tree kill sent directly (`killProcessTree`, because a wrapper-only SIGKILL leaves `dumb-init`'s descendants running), so the test's `handle.kill` spy could never observe it and the assertion failed on the production-correct path. The wiring now records SIGTERM through the handle and observes the escalation where the OS reports it — the wrapper's own exit status — with the 2-second gap asserted between the recorded SIGTERM and that exit. Nothing was weakened: the handle receives SIGTERM only before the escalation, the wrapper exits BY SIGKILL, and the disconnect stays inside the grace window.

## Risks / Trade-offs

- [Bun keeps internal descriptors open (event loop, stdio) that change between snapshots] → The check is `<=` the starting count after teardown, not equality, and the starting snapshot is taken inside the test.
- [The real `omp` path is skipped on hosts without it] → `package-bun-container-image` runs the suite inside the image, where `omp` is present.
