## Why

When the OpenCode agent subprocess exits unexpectedly (observed cause: OpenCode's own SQLite database corruption crashing `opencode acp` with exit code 1), the in-flight ACP request hangs forever instead of failing. Root-caused this session by reading `@agentclientprotocol/sdk@0.14.1` directly: when the subprocess's stdout closes, the SDK's internal `Connection#receive()` loop only aborts a signal — it never rejects the `#pendingResponses` entries backing `connection.initialize()` / `connection.prompt()`. `AgentConnector` adds no timeout or liveness check around `connect()`/`initialize()`, and `monitorProcessExit()` only logs the exit instead of unsticking the hung call. The hang is not self-healing: nothing short of a full process restart resolves it, because the stuck Promise lives inside the SDK's own closure state, unreachable once `AgentConnector.disconnect()` nulls out the connector's own references.

OpenCode's database corruption itself is out of scope (that's OpenCode's bug). What's in scope: this bot must never hang on a crashed agent subprocess. The current request should fail fast and clean up, and the next request should get a fresh subprocess attempt unaffected by the previous crash — since OpenCode's failure may be transient.

## What Changes

- `AgentConnector` tracks subprocess-exit as a first-class signal, independent of and always-on regardless of `idleTimeoutConfig.enabled`: `monitorProcessExit()` will reject any currently in-flight ACP call (`connect()`/`initialize()` or `prompt()`) immediately when the subprocess exits unexpectedly, instead of only logging.
- `connect()` gains a bounded timeout around `connection.initialize()` (new `CONNECT_TIMEOUT_MS`), so a subprocess that spawns but never completes the ACP handshake (hung, not crashed) also fails fast instead of hanging indefinitely — mirroring the timeout/liveness pattern that today only protects `prompt()` via idle timeout.
- No changes to `SessionOrchestrator` or `MessageHandler` cleanup logic are required: both already wrap agent execution in correct `try/finally` (typing indicator, `sessionRegistry` deregistration, workspace tmp cleanup, `activeEvents` dedup release, metrics). They simply never reach those blocks today because `connect()` never resolves or rejects. Making the `AgentConnector` fail fast is sufficient for the existing cleanup paths to run.
- No new retry/self-healing logic is needed at the orchestrator level: each request already builds an independent `AgentConnector` instance (confirmed in code), so once the failed one fails fast and cleans up, the next incoming request naturally spawns a fresh OpenCode subprocess and succeeds if OpenCode has recovered.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `acp-integration`: `AgentConnector` subprocess-exit handling changes from log-only to actively rejecting in-flight `connect()`/`initialize()` and `prompt()` calls; `connect()` gains a bounded connection-establishment timeout independent of the idle-timeout subsystem.

## Impact

- **Code**: primarily `src/acp/agent-connector.ts` (`connect()`, `disconnect()`, `monitorProcessExit()`, `prompt()`, plus every other SDK call site; new private crash-signal plumbing, `#intentionalShutdown` flag, `#raceAgainstCrash()` helper, and `CONNECT_TIMEOUT_MS` default). Also `src/types/config.ts` and `src/core/config-loader.ts` for a new `agent.connectTimeoutMs` config field with `AGENT_CONNECT_TIMEOUT_MS` env override, following the existing `agent.idleTimeout.*` convention. No changes needed in `src/core/session-orchestrator.ts` or `src/core/message-handler.ts` — verified their existing `finally` blocks already do the right thing once the hang is removed.
- **Tests**: New/updated unit tests for `AgentConnector` covering crash-during-connect, crash-during-prompt, crash-during-other-SDK-calls, hung-handshake-timeout, and doom-loop-disconnect-while-in-flight scenarios.
- **Behavior**: Internal reliability fix only — no API or persisted-data shape changes. One new optional config field with a sane default; no backward compatibility or migration concerns (early-stage project, no users in production).
- **Dependencies**: None added; no changes to `@agentclientprotocol/sdk` itself (its gap is worked around entirely on our side, since we don't control that package).
