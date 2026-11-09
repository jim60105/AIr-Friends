# Design

## Context

See `proposal.md`. Observed facts:

- `src/acp/agent-connector.ts` (1,825 lines): `private process: Deno.ChildProcess | null`; spawn at line 320 with `clearEnv: true`; uses `this.process.stdin` (web `WritableStream`) and `this.process.stdout` (web `ReadableStream`) for `acp.ndJsonStream(output, input)`; `readStderr(this.process.stderr, ...)`; `this.process.status` in `disconnect()` (SIGTERM, `DISCONNECT_TIMEOUT_MS` race, SIGKILL, extra observation for `EMAIL_INTENT_PROFILE`), `monitorProcessExit()` (logs `code`, `signal`, `success`), `buildCrashSignal()` (message `Agent process exited unexpectedly (code=…, signal=…) while awaiting a response`), and a liveness probe near line 1538; `this.process?.pid` in two getters.
- The PoC boundary `migration/bun/poc/process/agent-process.ts` (134 lines): `spawn("dumb-init", ["--", command, ...args], { cwd, env, stdio: ["pipe","pipe","pipe"] })`; `exited` from `exit` (and `error` → `{ code: null, signal: null, success: false }`); stdin as a `WritableStream` whose `write` resolves in the `child.stdin.write` callback with `CountQueuingStrategy({ highWaterMark: 1 })`; stdout and stderr via `Readable.toWeb`; `terminateAgentProcess` (SIGTERM, 2,000 ms grace, SIGKILL to the wrapper only). Its PROC-01 to PROC-09 and ACP-01 to ACP-10 criteria passed with `spawnBackend: "node"`.
- `src/acp/agent-factory.ts` builds the OpenCode env near line 130 (provider keys `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` plus `GOOGLE_GENERATIVE_AI_API_KEY`; `inheritVars = ["PATH","HOME","DENO_DIR","LANG","LC_ALL","USER","TMPDIR"]`; `SKILL_JWT_DIR`) and the OMP env near line 338 (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`; `inheritVars` without `TMPDIR`; `SKILL_JWT_DIR`). Line 1064 holds `DENO_DIR: true` in a separate key table.
- `tests/acp/agent-connector-env-isolation.test.ts` reproduces the spawn options with `deno eval` instead of using the boundary.
- The Go record (process evidence) observed `sigkillSurvivors: 2`: after the wrapper is SIGKILLed, children that ignored SIGTERM survive. Production already has the same wrapper-only SIGKILL; reaping descendants is `port-process-lifecycle-and-pool-to-bun`'s scope.

## Goals / Non-Goals

**Goals:** one production spawn boundary with design section 4.3's interface; the connector on it with unchanged lifecycle behavior; P0-1 proved on the real child environment.

**Non-Goals:**

- No `Bun.spawn` backend (the PoC proved `node:child_process`; design section 11 keeps `Bun.spawn` only as a fallback if the boundary fails).
- No change to timeouts, the crash-signal message text, idle-timeout handling or ACP calls. ACP timeouts stay client-side (`Promise.race` with a rejecting timer arm), Go record finding 5.
- No descendant reaping and no pool changes.
- No other `Deno.Command` site.

## Decisions

### D1. `src/acp/agent-process.ts`

Copy the PoC file and apply exactly:

- Delete `observe`, `reportedBackend` and the `POC_SPAWN_BACKEND` check.
- Export `AgentProcessOptions`, `AgentProcessExit`, `AgentProcessHandle`, `createAgentProcess`, `terminateAgentProcess` and `DEFAULT_GRACE_MS = 2000`.
- `createAgentProcess` takes an optional `wrapper` field defaulting to `DUMB_INIT_PATH` (move the existing constant from `agent-connector.ts` into this module and re-export it from the connector if other modules import it).
- `env` is required and passed as-is. Add a comment: never spread `process.env` here.
- Keep the stdin adapter and its comment about `Writable.toWeb` verbatim.

### D2. Connector

- `private process: AgentProcessHandle | null`.
- Spawn: `this.process = createAgentProcess({ command: agentConfig.command, args: agentConfig.args, cwd: agentConfig.cwd, env: agentConfig.env })`. Replace the security comment's `clearEnv`/`Deno.Command` wording with: the boundary passes exactly `agentConfig.env` and never merges the parent environment.
- Every `this.process.status` → `this.process.exited`. Log fields `code`, `signal`, `success` keep their names; the crash-signal message format is unchanged.
- `disconnect()` keeps its own race and the email-intent observation. Do not replace it with `terminateAgentProcess`, because the connector records `terminationConfirmed` and has the intent-profile branch.
- `this.process.kill("SIGTERM" | "SIGKILL")` already matches the handle.

### D3. Environment builders

Remove `"DENO_DIR"` from both `inheritVars` arrays and the `DENO_DIR: true` key-table entry in `src/acp/agent-factory.ts`. Update the two factory tests only where they assert `DENO_DIR` (assert its absence instead). No other variable changes.

### D4. Tests

- `tests/acp/agent-process.test.ts` (new): one test per `Agent Stdin Backpressure` and `Agent Exit Report` scenario, spawning `process.execPath` with small inline fixture scripts written to a temp dir. Skip the file with `describe.skipIf(!Bun.which("dumb-init"))` because CI installs `dumb-init` and the container has it.
- `tests/acp/agent-connector-env-isolation.test.ts`: keep every test name. `spawnAndReadChildEnv` calls `createAgentProcess` with a fixture command that prints `JSON.stringify(process.env)` and exits, and reads the handle's stdout. The control test keeps its name and documents the leak by passing `{ ...process.env, ...builtEnv }` deliberately.
- Add two tests to that file: `F1 - OpenCode production env reaches the child exactly` and `F1 - OMP production env reaches the child exactly`. Each sets parent `DISCORD_TOKEN`, `SKILL_API_SECRET` and the provider keys, builds the real config through the exported `agent-factory.ts` builder used by the connector for that agent type with a test `AppConfig`, spawns the fixture through the boundary with that env, and asserts the child env keys equal the built keys, include `PATH`, `HOME`, `LANG`, `SKILL_JWT_DIR` and the configured provider keys, and exclude `DISCORD_TOKEN`, `SKILL_API_SECRET` and `DENO_DIR`.
- `agent-connector*.test.ts` conversions follow `migration/bun/convert/README.md`, plus `status` → `exited` on any fake process objects the tests build.

## Risks / Trade-offs

- [A test fake implements the old `Deno.ChildProcess` shape] → Update fakes to `AgentProcessHandle` (`exited`, web streams, `kill`, `pid`).
- [Builder function names differ from what D4 assumes] → Use whichever exported function `AgentConnector`'s caller uses to build `AgentConfig` for each agent type; record the names in the task report.
- [`dumb-init` missing on a developer host] → Tests skip; CI and the image provide it.

## Design deviations (apply time)

| File | Change | Owner / authority |
| --- | --- | --- |
| `src/acp/agent-process.ts` | D1 says to keep the PoC stdin adapter verbatim; the adapter additionally attaches `child.stdin.on("error")` and rejects the pending write/close from it. Node's stream contract calls the write callback before emitting `error`, so a child that closes stdin (or dies mid-write) would otherwise raise an uncaught `EPIPE` and take the bot process down. The backpressure mechanism (write-callback resolution, `highWaterMark: 1`, no `Writable.toWeb`) is unchanged. | This change owns the file; regression case `Agent Exit Report - a write after the child closed stdin rejects instead of crashing`. |
| `src/acp/agent-connector.ts` | D2's literal `env: agentConfig.env` becomes `env: agentConfig.env ?? {}` because `AgentConfig.env` is optional. An omitted environment now means the empty environment (the same "no inherited parent variables" contract); production builders always supply one. | This change owns the edit. |
| `tests/acp/agent-factory.test.ts` (lines 938–983) | The two `createAgentConfig - NO_PROXY …` cases call `ensureEgressProxy`, which reaches `Deno.listen` at `src/utils/egress-proxy.ts:375` and raises `ReferenceError: Deno is not defined` before their assertions. They are registered with `test.skip` and recorded as `skipped` `parity-exceptions.json` entries naming the owner. The file is already in the proposal Impact list, so no new scope path is added. | `port-egress-proxy-and-gelf-to-node-net` owns `src/utils/egress-proxy.ts` and must restore the registrations and delete the two exceptions. |
