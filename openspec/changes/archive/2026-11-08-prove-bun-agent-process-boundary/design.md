# Design

## Context

See `proposal.md` for motivation. Observed code facts:

- `AgentConnector.connect()` spawns `dumb-init -- <command> <args>` by `PATH` lookup, with an explicit environment and `clearEnv: true`.
- `AgentConnector.disconnect()` sends SIGTERM to the wrapper, waits `DISCONNECT_TIMEOUT_MS` (2000), then sends SIGKILL to the wrapper only. It never signals the child or a process group.
- The source design section 3 smoke test passed on `node:child_process`, but its own text says it satisfies no blocker.
- Scratch measurements on Bun 1.4.2 (feasibility only): `Writable.toWeb(child.stdin).write(16 MiB)` to a child that sleeps resolved after 6 ms, so that adapter gives no stdin backpressure. `child.stdin.write(buffer, callback)` returned `false` and its callback fired after 2000 ms, when the child began reading, so the Node stream itself does apply backpressure. Stdout through `Readable.toWeb` stalled correctly.

Consequence of the second fact: after SIGKILL, `dumb-init` cannot forward anything, so a child that ignores SIGTERM survives. That is existing behavior, and P0-3 ("leave no orphan processes") is not satisfied by it in that corner. This change does not alter the behavior; it records the survivor count as an observation, and that corner stays open for design section 8 step 5.

## Goals / Non-Goals

**Goals:** implement the section 4.3 contract and prove criteria PROC-01 to PROC-09.

**Non-Goals:**

- No edit to `src/acp/agent-connector.ts` or any product file.
- No new kill semantics such as process-group kill; PoC teardown mirrors production.
- No pool, session or recovery logic.
- No use of `Bun.spawn` unless task 3.1 triggers it.
- No change to `gate/`, `Containerfile` or `run-suite.sh`.

## Decisions

### D1. Boundary

`migration/bun/poc/process/agent-process.ts`:

```ts
export interface AgentProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}
export interface AgentProcessHandle {
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<{ code: number | null; signal: string | null; success: boolean }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}
export function createAgentProcess(options: AgentProcessOptions): AgentProcessHandle;
export function terminateAgentProcess(
  handle: AgentProcessHandle,
  graceMs?: number, // default 2000
): Promise<{ escalated: boolean; elapsedMs: number }>;
```

`createAgentProcess` reads `process.env.POC_SPAWN_BACKEND` (`node` by default, `bun` only after task 3.1), reports it once with `observe("spawnBackend", value)`, and for `node` does:

```ts
const child = spawn("dumb-init", ["--", options.command, ...options.args], {
  cwd: options.cwd,
  env: options.env,
  stdio: ["pipe", "pipe", "pipe"],
});
```

`stdout` and `stderr` use `Readable.toWeb`. `stdin` does not use `Writable.toWeb`, because of the measurement above. It is this adapter, verbatim:

```ts
const stdin = new WritableStream<Uint8Array>({
  write: (chunk) => new Promise<void>((resolve, reject) => {
    child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
  }),
  close: () => new Promise<void>((resolve) => { child.stdin.end(() => resolve()); }),
  abort: () => { child.stdin.destroy(); },
}, new CountQueuingStrategy({ highWaterMark: 1 }));
```

`exited` resolves on the `exit` event with `success: code === 0`, and on the `error` event with `{ code: null, signal: null, success: false }`. Spreading `process.env` is forbidden, as design section 4.3 states.

`terminateAgentProcess` mirrors `disconnect()`: call `kill("SIGTERM")`, race `exited` against a `graceMs` timer and clear the timer, and when the timer wins call `kill("SIGKILL")` and await `exited`. Timing starts from `performance.now()` read after the SIGTERM call returns, and `elapsedMs` is taken when the SIGKILL call is made, or when `exited` wins the race. Both `kill` calls swallow an already-exited error.

Alternative rejected: reading `child.stdout` through `data` events into a `ReadableStream`. That is the unbounded buffering backpressure tests are meant to catch.

### D2. Observation helpers

`migration/bun/poc/process/proc-tree.ts`:

```ts
export function descendantsOf(pid: number): number[];   // scan /proc/<n>/stat, BFS on ppid
export function isAlive(pid: number): boolean;          // /proc/<pid>/stat exists and state is not Z or X
export function readEnviron(pid: number): Record<string, string>; // split on NUL, then first `=`
export function openFdCount(): number;                  // readdirSync("/proc/self/fd").length
export function waitForChild(pid: number, timeoutMs?: number): Promise<number>; // poll descendantsOf, default 2000 ms
```

`dumb-init` forks after `spawn` returns, so tests obtain the child with `waitForChild(handle.pid)`, never with `descendantsOf(...)[0]` directly. Parse `/proc/<n>/stat` after the last `)` so a process name with spaces cannot shift fields. The state is the first field after it and the parent PID the second.

### D3. Fixture children

`migration/bun/poc/fixtures/children/`, each run as `bun run --no-env-file <path>` with `PATH` and `HOME` in the explicit environment:

- `producer.ts <totalBytes> <progressFile>`: loop writing 64 KiB with `writeSync(1, chunk)`, and after each write store the cumulative count with `writeFileSync(progressFile, String(n))`.
- `dual-writer.ts <bytesEach>`: alternate 64 KiB `writeSync(2, ...)` and `writeSync(1, ...)`.

Shell one-liners cover the rest: `sh -c 'sleep 2; cat > /dev/null'`, and `sh -c 'trap "" TERM; sleep 60'`.

### D4. Suite method

`migration/bun/poc/suites/process.spec.ts`. Titles start with the criterion ID and a colon. `afterEach` kills any PID the test recorded as a survivor.

| ID | Method |
| --- | --- |
| PROC-01 | `producer.ts 268435456 <tmp>`. Read one chunk, stop reading. Take the progress value and `process.memoryUsage().rss` at 200 ms and at 1000 ms; the two progress values must be equal and RSS growth from before spawn under 32 MiB. Resume and read to done. Assert total bytes read, the final progress value and 268435456 are all equal, and that `exited` reports code 0, so a crashed producer cannot pass. |
| PROC-02 | `sh -c 'sleep 2; cat > /dev/null'`. `writer.write(new Uint8Array(16 MiB))`, race with a 500 ms timer and expect the timer to win. Then await the write with a 30 s limit. |
| PROC-03 | `cat` with 64 MiB in 1 MiB chunks of seeded content (a counter-filled buffer differing per chunk). Write and read concurrently; compare SHA-256. |
| PROC-04 | `dual-writer.ts 8388608`. Drain both streams concurrently; expect 8 MiB on each and `exited` within 30 s. |
| PROC-05 | `cat`; `writer.close()`; reader done; `exited` code 0. |
| PROC-06 | Set `process.env.AIR_POC_SECRET_TOKEN = "sentinel"`, spawn `sleep 30` with `{ PATH, HOME: "/tmp", AIR_POC_ALLOWED: "yes" }`, take the child from `waitForChild`, compare `Object.keys(readEnviron(pid))` to the passed keys as a set, and compare values. If `dumb-init` itself adds a key, that is a real difference; report it. |
| PROC-07 | `sleep 60`; collect the child PID; `terminateAgentProcess`; expect `escalated` false, `elapsedMs` under 2000, and `isAlive` false for wrapper and child. |
| PROC-08 | `sh -c 'trap "" TERM; sleep 60'`; collect descendants; `terminateAgentProcess`; expect `escalated` true, `elapsedMs` from 1990 to 2500, and `exited.signal` of `SIGKILL`. Call `observe("sigkillSurvivors", <alive descendant count>)`, then kill the survivors. |
| PROC-09 | Read `openFdCount()`, run 20 cycles of `sleep 60` plus teardown while collecting PIDs, then compare and check `isAlive`. |

### D5. Conditional `Bun.spawn` backend

Used only after task 3.1 triggers it. Same exports as the `node` branch:

```ts
const proc = Bun.spawn(["dumb-init", "--", options.command, ...options.args], {
  cwd: options.cwd, env: options.env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
});
const stdin = new WritableStream<Uint8Array>({
  async write(chunk) { await proc.stdin.write(chunk); await proc.stdin.flush(); },
  async close() { await proc.stdin.end(); },
  abort() { proc.stdin.end(); },
}, new CountQueuingStrategy({ highWaterMark: 1 }));
const exited = proc.exited.then((code) => ({
  code: proc.signalCode ? null : code,
  signal: proc.signalCode ?? null,
  success: code === 0 && !proc.signalCode,
}));
```

`pid` is `proc.pid`, `stdout` and `stderr` are `proc.stdout` and `proc.stderr`, and `kill(signal)` is `proc.kill(signal)`.

## Risks / Trade-offs

- [Bun's stream adapters do not propagate backpressure] → PROC-01 and PROC-02 detect this. Task 3.1 tries the fallback before the result stands.
- [Timer granularity at the 2000 ms boundary] → The lower bound of 1990 ms is set here, before any run, so it is not a later loosening.
- [The SIGKILL corner leaves a survivor] → It matches production today; recorded through `sigkillSurvivors` and reported in the outcome record rather than gated. PROC-08 checks timing and wrapper exit only.
- [`dumb-init` waits for its child, so `exited` may lag] → PROC-07 uses a cooperative child, which exits immediately.
