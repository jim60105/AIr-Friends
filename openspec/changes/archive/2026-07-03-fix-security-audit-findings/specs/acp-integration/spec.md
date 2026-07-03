## MODIFIED Requirements

### Requirement: AgentConnector Subprocess Management

The system SHALL manage external ACP agent lifecycle through the `AgentConnector` class, spawning agents as subprocesses with `dumb-init` for proper signal forwarding and communicating via stdio JSON-RPC. The subprocess SHALL be spawned with a cleared parent environment (`clearEnv: true`) so it receives ONLY the explicitly-built agent environment and inherits no parent secrets.

#### Scenario: Agent connection
- **GIVEN** a valid `AgentConfig` with command, args, cwd, and env
- **WHEN** `connect()` is called
- **THEN** it SHALL spawn the agent subprocess wrapped with `dumb-init`, establish a `ClientSideConnection` over stdin/stdout JSON-RPC, and pipe stderr for logging

#### Scenario: Parent environment cleared on spawn
- **GIVEN** the parent bot process holds secrets (bot tokens, provider API keys, git credentials) not present in `AgentConfig.env`
- **WHEN** `connect()` spawns the subprocess
- **THEN** the `Deno.Command` SHALL be configured with `clearEnv: true`
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
- **THEN** it SHALL attempt graceful shutdown with a 2-second SIGTERM timeout before force-killing the subprocess, and clear any cached session `configOptions`

#### Scenario: Subprocess exit monitoring
- **GIVEN** a running agent subprocess
- **WHEN** the subprocess exits unexpectedly
- **THEN** the system SHALL log the exit status and code asynchronously

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and all path boundary checks SHALL be boundary-safe (equal-or-separator-prefixed).

#### Scenario: Registered skill auto-approval
- **GIVEN** a permission request for a registered skill
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request

#### Scenario: Skill directory read access
- **GIVEN** a permission request to read files in the skills directory
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request

#### Scenario: Skill command whitelist approval by entrypoint
- **GIVEN** a permission request to execute a command matching the auto-approve list
- **WHEN** the whitelisted script path is the actual invocation entrypoint (interpreter as first token, script path as the entrypoint positional) or a command prefix is the exact first token with no out-of-workspace path arguments
- **THEN** it SHALL auto-approve the request

#### Scenario: Command laundering via trailing whitelisted path rejected
- **GIVEN** a permission request whose first token is an arbitrary binary and whose trailing argument is a whitelisted script path
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL NOT auto-approve the request

#### Scenario: Shell operator rejection
- **GIVEN** a command containing shell operators (`;`, `|`, `&`, `` ` ``, `(`, `)`, `>`, `<`, `#`, newlines)
- **WHEN** `containsShellOperators()` checks the command
- **THEN** it SHALL flag the command as containing shell operators (note: `$` is allowed for variable expansion)

#### Scenario: Edit/write permission with path extraction
- **GIVEN** an edit/write permission request with empty `locations`
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL attempt to extract file paths from `rawInput` by checking fields: `path`, `file_path`, `filePath`, `filepath`, `file`, `filename`, `paths`, `files`

#### Scenario: Edit/write within agent workspace requires write permission
- **GIVEN** an edit/write permission request for a path within the agent workspace
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request ONLY if the session's `canWriteAgentWorkspace` flag is `true`; otherwise it SHALL reject the request with logging

#### Scenario: Edit/write within TMPDIR
- **GIVEN** an edit/write permission request for a path within the session TMPDIR
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request regardless of `canWriteAgentWorkspace`

#### Scenario: Boundary-safe path checks reject sibling prefixes
- **GIVEN** a path that shares a string prefix with an allowed base directory but is a sibling (e.g. `/data/workspaces/discord/1234` versus base `/data/workspaces/discord/123`)
- **WHEN** a path boundary check evaluates the path
- **THEN** it SHALL reject the path as outside the base

#### Scenario: readTextFile extension check
- **GIVEN** a read request for a path inside an allowed directory whose extension is not in the read allowlist (`.jsonl`, `.md`, `.txt`)
- **WHEN** `readTextFile()` evaluates the request
- **THEN** it SHALL reject the read

#### Scenario: readTextFile allows workspace memory reads
- **GIVEN** a read request for `memory.public.jsonl` inside the workspace
- **WHEN** `readTextFile()` evaluates the request
- **THEN** it SHALL allow the read

#### Scenario: Edit/write rejection
- **GIVEN** an edit/write permission request that cannot be resolved to a valid workspace path
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL reject the request with logging

#### Scenario: Default denial
- **GIVEN** a permission request not matching any approval rule
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL deny the request
