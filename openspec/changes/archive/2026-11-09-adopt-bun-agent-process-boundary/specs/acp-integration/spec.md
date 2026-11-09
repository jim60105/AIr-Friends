# Spec Delta

## MODIFIED Requirements

### Requirement: AgentConnector Subprocess Management

The system SHALL manage the external OpenCode ACP agent lifecycle through the `AgentConnector` class: per-session mode spawns the agent subprocess with `dumb-init` and stdio JSON-RPC, while shared-process mode connects once per channel and creates multiple ACP sessions over the same stdio connection. Every outbound ACP call SHALL be raced against a per-subprocess crash signal so an unexpected subprocess exit rejects the pending call promptly.

#### Scenario: Agent connection
- **GIVEN** a valid `AgentConfig` with command, args, cwd, and env
- **WHEN** `connect()` is called
- **THEN** it SHALL spawn the agent subprocess wrapped with `dumb-init`, establish a `ClientSideConnection` over stdin/stdout JSON-RPC, and pipe stderr for logging

#### Scenario: Parent environment cleared on spawn
- **GIVEN** the parent bot process holds secrets (bot tokens, provider API keys, git credentials) not present in `AgentConfig.env`
- **WHEN** `connect()` spawns the subprocess
- **THEN** the spawn boundary SHALL receive `AgentConfig.env` as the complete child environment
- **AND** the subprocess environment SHALL contain only the variables in `AgentConfig.env`, with no inherited parent variables

#### Scenario: Session creation with MCP servers
- **GIVEN** a connected agent
- **WHEN** `createSession(mcpServers)` is called
- **THEN** it SHALL create a new ACP session, filter MCP servers to only those with transports supported by the agent's `mcpCapabilities`, register supported servers with the session, and capture any `configOptions` returned by the agent for the new session

#### Scenario: Model and mode setting
- **GIVEN** an active session
- **WHEN** `setSessionModel()` or `setSessionMode()` is called
- **THEN** it SHALL configure the session's model or mode via the ACP connection

#### Scenario: Reasoning effort setting
- **GIVEN** an active session whose latest cached `configOptions` include an option with `category: "thought_level"`
- **WHEN** the reasoning-effort application method is called with a value present among that option's available values
- **THEN** it SHALL call `setSessionConfigOption()` with that option's `id` and the requested value via the ACP connection, and SHALL refresh its cached `configOptions` from the response

#### Scenario: Reasoning effort setting when unsupported
- **GIVEN** an active session whose latest cached `configOptions` do NOT include an option with `category: "thought_level"`
- **WHEN** the reasoning-effort application method is called
- **THEN** it SHALL log that reasoning effort is unsupported and return without contacting the agent or raising an error

#### Scenario: Reasoning effort re-discovery uses latest cached options
- **GIVEN** the cached `configOptions` were updated after session creation (via a `config_option_update` notification or a `set_config_option` response)
- **WHEN** the reasoning-effort application method is called
- **THEN** it SHALL discover the `thought_level` option from the latest cached `configOptions`, not the creation-time snapshot

#### Scenario: Graceful disconnect
- **GIVEN** a connected agent
- **WHEN** `disconnect()` is called
- **THEN** it SHALL mark the shutdown as intentional before signaling the subprocess, attempt graceful shutdown with a 2-second SIGTERM timeout before force-killing the subprocess, and clear any cached session `configOptions`

#### Scenario: Subprocess exit monitoring
- **GIVEN** a running agent subprocess
- **WHEN** the subprocess exits
- **THEN** the system SHALL log the exit status and code asynchronously, distinguishing an intentional shutdown from an unexpected exit

#### Scenario: Pending call rejected on unexpected exit during connect
- **GIVEN** `connect()` is awaiting `connection.initialize()`
- **WHEN** the agent subprocess exits unexpectedly (non-zero code or signal) before a response arrives, without `disconnect()` having been called first
- **THEN** the pending `initialize()` call SHALL reject promptly with a descriptive error identifying the unexpected exit, instead of remaining pending indefinitely

#### Scenario: Pending call rejected on unexpected exit during an active prompt
- **GIVEN** `prompt()` is awaiting `connection.prompt()` for an active session, with or without idle-timeout enabled
- **WHEN** the agent subprocess exits unexpectedly before a response arrives, without `disconnect()` having been called first
- **THEN** the pending `prompt()` call SHALL reject promptly with a descriptive error identifying the unexpected exit, instead of waiting for the next idle-check interval or hanging indefinitely when idle-timeout is disabled

#### Scenario: Pending call rejected on unexpected exit during other ACP calls
- **GIVEN** any other outbound call is pending (`createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`, `cancel`)
- **WHEN** the agent subprocess exits unexpectedly before a response arrives
- **THEN** that pending call SHALL reject promptly with a descriptive error, consistent with `initialize()` and `prompt()`

#### Scenario: Disconnect-triggered exit rejects the crash signal without raising an unhandled rejection
- **GIVEN** `disconnect()` has been called after all prior pending calls already settled, and the subprocess subsequently exits as a result
- **WHEN** the crash signal rejects (it rejects on every exit, intentional or not)
- **THEN** no unhandled-promise-rejection SHALL be raised, because nothing is currently racing against the signal and a permanent no-op handler was attached to it at creation time

#### Scenario: Doom-loop disconnect while a prompt is in flight
- **GIVEN** a `prompt()` call is in flight and `disconnect()` is invoked concurrently (e.g. by doom-loop termination) before the agent responds
- **WHEN** the subprocess is killed as part of that `disconnect()`
- **THEN** the in-flight `prompt()` call SHALL still reject promptly rather than hang, since a response for it will never arrive

#### Scenario: Fresh crash signal on reconnect
- **GIVEN** `reconnectAndResumeSession()` calls `disconnect()` followed by `connect()` on the same `AgentConnector` instance
- **WHEN** the new subprocess is spawned
- **THEN** subsequent calls SHALL be raced against a crash signal tied to the new subprocess, not any stale signal from the previously disconnected subprocess

#### Scenario: Shared process connection
- **GIVEN** the shared process pool is enabled and a channel already has a live `opencode acp` process
- **WHEN** a new session for that channel starts
- **THEN** the connector SHALL reuse the live process and create a new ACP session on the existing stdio connection without spawning a new subprocess

#### Scenario: In-flight session resumed after process restart
- **GIVEN** a shared channel process dies while a session's prompt is in flight and no response has been sent yet
- **WHEN** the system restarts that channel's process
- **THEN** it SHALL resume the existing session via ACP `session/load` (history replayed) and re-issue the prompt on the resumed session
- **AND** the re-issued recovery prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the agent avoids re-doing side effects
- **AND** if a response had already been sent, the session SHALL complete without re-prompting, so no duplicate reply or memory event is produced

#### Scenario: Session history persisted in the channel-scoped data directory
- **GIVEN** a shared channel process dies while a session is in flight
- **WHEN** the system restarts that channel's process to resume the session
- **THEN** the session history replayed on load SHALL be the history persisted in the channel-scoped OpenCode data directory

### Requirement: Agent Common Environment

All agent subprocesses SHALL receive common environment variables regardless of agent type.

#### Scenario: Common env vars
- **GIVEN** any agent type
- **WHEN** the subprocess is spawned
- **THEN** the environment SHALL include `TMPDIR` (set to `{workingDir}/tmp`), `AGENT_WORKSPACE` (if provided), `PATH`, `HOME`, `LANG`, `LC_ALL`, and `USER`

#### Scenario: SESSION_ID env var provided to agent (per-spawn mode)
- **GIVEN** a per-spawn session has been created via ACP `createSession()`
- **WHEN** the agent subprocess spawns child processes (e.g., skill scripts)
- **THEN** the `SESSION_ID` environment variable SHALL be set to the active session ID so that skill scripts can resolve `$SESSION_ID` in their shell environment

#### Scenario: Shared-process environment omits SESSION_ID
- **GIVEN** a shared-process (pool) agent process serving any session
- **WHEN** the agent spawns child processes (skill scripts) or inspects its environment
- **THEN** `SESSION_ID` SHALL NOT be present in the environment (a spawn-time frozen value would misattribute every later session; the current-session pointer is the sole identity source in this mode)

#### Scenario: No per-session credential in the agent environment
- **GIVEN** any agent subprocess (per-spawn or shared-process)
- **WHEN** its environment is inspected
- **THEN** it SHALL NOT contain the deployment `SKILL_API_SECRET` or any raw per-session caller-token environment value (e.g. a legacy `SKILL_API_TOKEN`); skill scripts authenticate with the per-session JWT file addressed by `SKILL_JWT_DIR`

## ADDED Requirements

### Requirement: Agent Stdin Backpressure

A write to the agent subprocess's stdin stream SHALL settle only after the operating system accepted the bytes, so a child that stops reading holds back the writer.

#### Scenario: Sleeping child
- **GIVEN** an agent subprocess that sleeps for 2 seconds before reading stdin
- **WHEN** 16 MiB is written to its stdin stream
- **THEN** the write SHALL still be pending 500 ms after it started, and SHALL resolve after the child starts reading

#### Scenario: Data intact
- **GIVEN** an agent subprocess that echoes stdin to stdout
- **WHEN** 32 MiB of seeded bytes is written and stdin is closed
- **THEN** the SHA-256 of the bytes read from stdout SHALL equal the SHA-256 of the bytes written

### Requirement: Agent Exit Report

The spawn boundary SHALL report an exit as a code, a signal name and a success flag, where a signal exit has a null code and the signal name, and success is true only for exit code 0.

#### Scenario: Normal exit
- **WHEN** the agent subprocess exits with code 3
- **THEN** the report SHALL be code 3, signal null, success false

#### Scenario: Signal exit
- **WHEN** the agent wrapper is killed with `SIGKILL`
- **THEN** the report SHALL be code null, signal `SIGKILL`, success false

#### Scenario: Escalation after grace period
- **GIVEN** an agent subprocess that ignores `SIGTERM`
- **WHEN** the connector disconnects
- **THEN** it SHALL send `SIGKILL` 2 seconds after `SIGTERM` and the exit report SHALL show `SIGKILL`
