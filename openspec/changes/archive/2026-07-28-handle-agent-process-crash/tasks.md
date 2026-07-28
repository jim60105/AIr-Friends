## 1. Config plumbing for connect-time timeout

- [x] 1.1 Add `connectTimeoutMs?: number` to `AgentConfig` in `src/types/config.ts` (mirroring where `idleTimeout?: IdleTimeoutConfig` lives)
- [x] 1.2 Add a `DEFAULT_CONNECT_TIMEOUT_MS = 30000` default and apply it in `src/core/config-loader.ts` alongside the existing `DEFAULT_IDLE_TIMEOUT` defaulting block, so `agentConfig.connectTimeoutMs` is always populated after config load
- [x] 1.3 Add `AGENT_CONNECT_TIMEOUT_MS: "agent.connectTimeoutMs"` to the env override table in `src/utils/env.ts`
- [x] 1.4 Add `connectTimeoutMs?: number` to `AgentConnectorOptions` in `src/acp/types.ts`
- [x] 1.5 Pass `connectTimeoutMs: this.config.agent.connectTimeoutMs` through every `createConnector({...})` call site in `src/core/session-orchestrator.ts` (same call sites that already pass `idleTimeoutConfig: this.config.agent.idleTimeout`)

## 2. AgentConnector crash-signal core

- [x] 2.1 Add private fields `#crashSignal: Promise<never> | null` and `#intentionalShutdown: boolean` to `AgentConnector`
- [x] 2.2 In `disconnect()`, set `#intentionalShutdown = true` as the very first statement, before sending `SIGTERM`. This flag affects ONLY the log severity chosen in `monitorProcessExit()` (task 2.5) — it must NOT gate whether `#crashSignal` rejects (see 2.3; a prior draft made this mistake and was caught in review because it re-hangs the doom-loop-disconnect-while-in-flight case)
- [x] 2.3 In `connect()`, immediately after `command.spawn()`, reset `#intentionalShutdown = false` and build a fresh `#crashSignal` from `this.process.status` that **unconditionally rejects** (regardless of `#intentionalShutdown`) with a descriptive `Error` once the process exits (include exit code/signal in the message). Word the message so it does NOT contain the substrings `"ACP connection dead"` or `"ACP agent process exited unexpectedly"` (see task 3.6 / Decision 5 — those substrings trigger `promptWithIdleTimeoutHandling()`'s reconnect-attempt path, which is currently always-futile and should be bypassed for this new error class). Do not log inside this builder (logging happens once, in `monitorProcessExit()`). Attach a no-op `.catch(() => {})` to the raw signal immediately at creation to prevent unhandled-rejection warnings when nothing races against it
- [x] 2.4 Add a private `#raceAgainstCrash<T>(operation: Promise<T>): Promise<T>` helper implementing `Promise.race([operation, this.#crashSignal])`, guarding for `#crashSignal` being `null` (not yet connected)
- [x] 2.5 Update `monitorProcessExit()` to consult `#intentionalShutdown` (instead of `!this.promptCompleted`) when deciding log severity, keeping its existing logging behavior otherwise — this remains the single place that logs the exit event

## 3. Wire the crash signal + connect timeout into every call site

- [x] 3.1 Wrap `connection.initialize(...)` in `connect()` with `#raceAgainstCrash()` AND a `CONNECT_TIMEOUT_MS`-bounded timeout promise (three-way race: SDK call, crash signal, timeout) using the resolved `connectTimeoutMs` option (fallback to a local default if the option is unset, e.g. in tests that construct `AgentConnector` directly). Log a `WARN` when elapsed time passes 80% of the timeout while still waiting. Clear the timeout's `setTimeout` handle as soon as the race settles via any arm, so a fast/successful connect doesn't leave a dangling timer
- [x] 3.2 Wrap `connection.createSession(...)` in `createSession()` with `#raceAgainstCrash()`
- [x] 3.3 Wrap `connection.unstable_setSessionModel(...)` in `setSessionModel()` with `#raceAgainstCrash()`
- [x] 3.4 Wrap `connection.setSessionMode(...)` in `setSessionMode()` with `#raceAgainstCrash()`
- [x] 3.5 Wrap `connection.setSessionConfigOption(...)` in `setReasoningEffort()` with `#raceAgainstCrash()` (still inside its existing try/catch so a rejection continues to surface as outcome `"failed"`, not an unhandled throw)
- [x] 3.6 Wrap `connection.prompt(...)` in `prompt()` with `#raceAgainstCrash()`, combined with the existing `monitorIdleTimeout()` race arm when idle timeout is enabled (crash-signal race arm applies unconditionally, independent of `idleTimeoutEnabled`). Add a one-line comment at the crash-signal message construction site (task 2.3) cross-referencing `promptWithIdleTimeoutHandling()` in `session-orchestrator.ts`, documenting that the wording is deliberately chosen to bypass its reconnect-attempt classification
- [x] 3.7 Wrap `connection.cancel(...)` in `cancel()` with `#raceAgainstCrash()`

## 4. Unit tests for AgentConnector

- [x] 4.1 Test: subprocess exits unexpectedly while `connect()` awaits `initialize()` → `connect()` rejects promptly with a descriptive error (not a hang)
- [x] 4.2 Test: subprocess exits unexpectedly while `prompt()` awaits a response, with idle timeout enabled → `prompt()` rejects promptly (not just at the next idle-check tick)
- [x] 4.3 Test: subprocess exits unexpectedly while `prompt()` awaits a response, with idle timeout **disabled** → `prompt()` still rejects promptly (regression test for the gap that exists today)
- [x] 4.4 Test: subprocess exits unexpectedly while `createSession()`/`setSessionModel()`/`setSessionMode()`/`cancel()` is pending → each rejects promptly
- [x] 4.5 Test: subprocess spawns and stays alive but never responds to `initialize()` within `connectTimeoutMs` → `connect()` rejects with a timeout error (not the crash-signal error), and a `WARN` was logged at the 80% mark
- [x] 4.6 Test: normal `disconnect()` after a successful `connect()`/`prompt()` cycle does not raise any unhandled rejection (verify no `unhandledrejection`/uncaught-exception event fires), even though `#crashSignal` rejects once the killed process's status resolves
- [x] 4.7 Test: `disconnect()` called while a `prompt()` is still in flight (doom-loop scenario) → the in-flight `prompt()` rejects promptly rather than hanging, DESPITE `#intentionalShutdown` being `true` at the time (this is the exact case the rubber-duck review flagged as broken in an earlier draft — must be tested explicitly, not just reasoned about)
- [x] 4.8 Test: `reconnectAndResumeSession()` (disconnect then connect on the same instance) after a prior crash → the new `connect()`/`initialize()` is governed by a fresh crash signal, not the previous (already-rejected) one
- [x] 4.9 Test: `AGENT_CONNECT_TIMEOUT_MS` env var overrides `agent.connectTimeoutMs`; config defaults to 30000 when unset
- [x] 4.10 Test: `disconnect()` called twice in a row for the same failed connection attempt (once from `connect()`'s own `catch` block, once from the orchestrator-level `finally`) does not throw or double-kill in a way that produces an error — asserts the existing `if (this.process)` guard makes the second call a safe no-op
- [x] 4.11 Test: a crash-signal rejection surfaced from `connector.prompt()` is passed into `promptWithIdleTimeoutHandling()` and asserted to propagate directly (NOT attempt `reconnectAndResumeSession()`), locking in Decision 5's deliberate message-wording choice against future accidental changes

## 5. Integration verification (no code changes expected)

- [x] 5.1 Write an integration-level test (or extend an existing `session-orchestrator` test) simulating a crash during `connector.connect()` inside `processMessageInternal()`, asserting: the typing-indicator interval is cleared, `connector.disconnect()` is called, the `shellSessionId` is removed from `sessionRegistry`, and the method returns `{ success: false, ... }` instead of hanging
- [x] 5.2 Write an integration-level test simulating the same crash and confirming `MessageHandler.handleEvent()`'s `activeEvents` dedup entry for that `messageId` is released afterward (not leaked)
- [ ] 5.3 Manually re-run against the original `tmp/log.clef` failure shape (crash ~1s into `connect()`) in a local/dev environment and confirm the request now fails fast with a logged error instead of producing no further log lines (requires a real OpenCode/dumb-init environment; not performed in this sandbox — automated coverage for this scenario is in `tests/acp/agent-connector-crash-signal.test.ts` and `tests/core/session-orchestrator.test.ts`)

## 6. Documentation

- [x] 6.1 Document `agent.connectTimeoutMs` / `AGENT_CONNECT_TIMEOUT_MS` in whatever existing config reference covers `agent.idleTimeout.*` (e.g. README or `openspec/specs/configuration-and-deployment`), so operators can find and tune it, noting the default is a convention-based starting point (not measured from production data) and that an 80%-elapsed `WARN` log is emitted as an early signal
