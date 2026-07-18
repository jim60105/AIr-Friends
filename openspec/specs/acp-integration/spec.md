# ACP Client Integration

## Purpose

Defines how AIr-Friends acts as an ACP (Agent Client Protocol) Client, spawning the external OpenCode agent subprocess, managing bidirectional JSON-RPC communication, handling permission requests, sandboxing agent processes, and supporting retry, idle timeout, and external MCP server registration.
## Requirements
### Requirement: AgentConnector Subprocess Management

The system SHALL manage the external OpenCode ACP agent lifecycle through the `AgentConnector` class, spawning the agent as a subprocess with `dumb-init` for proper signal forwarding and communicating via stdio JSON-RPC. The subprocess SHALL be spawned with a cleared parent environment (`clearEnv: true`) so it receives ONLY the explicitly-built agent environment and inherits no parent secrets.

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

### Requirement: Session Config Option Update Handling

The `ChatbotClient` SHALL handle the `config_option_update` session notification and propagate the updated configuration options to the `AgentConnector` so that the connector's cached `configOptions` reflect the agent's current session configuration state.

#### Scenario: Config option update refreshes connector cache
- **GIVEN** an active ACP session
- **WHEN** the agent sends a `sessionUpdate` with `sessionUpdate: "config_option_update"` carrying the complete updated `configOptions`
- **THEN** the client SHALL update the `lastActivityTimestamp` and refresh the connector's cached `configOptions` with the provided complete list

#### Scenario: Unrelated session updates do not alter the cache
- **GIVEN** an active ACP session with cached `configOptions`
- **WHEN** the agent sends a non-`config_option_update` session update (e.g., `agent_message_chunk`)
- **THEN** the cached `configOptions` SHALL remain unchanged

---

### Requirement: ChatbotClient ACP Client Interface

The system SHALL implement the ACP `Client` interface via `ChatbotClient`, handling callbacks from external agents for permissions, session updates, and file operations.

#### Scenario: Session update handling
- **GIVEN** an active ACP session
- **WHEN** the agent sends a `sessionUpdate` with message chunks or tool calls
- **THEN** the client SHALL log the activity, update the `lastActivityTimestamp`, and write audit entries if an audit writer is configured

### Requirement: Agent Thought Chunk Buffering

The `ChatbotClient` SHALL accumulate text from `agent_thought_chunk` session updates into an internal `thoughtBuffer` and flush them as a single complete thought log entry when a non-thought-chunk session update arrives or when the prompt turn completes.

#### Scenario: Thought chunk accumulation during agent reasoning
- **GIVEN** the agent is generating a thought process
- **WHEN** multiple `agent_thought_chunk` session updates with text content are received
- **THEN** the system SHALL extract the text and append it to `thoughtBuffer` while also emitting the per-chunk DEBUG log

#### Scenario: Flush thought buffer on non-thought-chunk session update
- **GIVEN** the `thoughtBuffer` contains one or more accumulated thought chunks
- **WHEN** a non-thought-chunk session update is received (e.g., `agent_message_chunk`, `tool_call`, `tool_call_update`, `plan`, `usage_update`, `config_option_update`, or any other type)
- **THEN** the system SHALL call `flushThoughtBuffer()`, joining all buffered thought chunks into a single string, logging `"Agent complete thought ({chunkCount} chunks, {length} chars): {thought}"` at INFO level, writing an `agent_complete_thought` audit entry if an audit writer is present, and clearing `thoughtBuffer`

#### Scenario: Flush thought buffer on prompt completion
- **GIVEN** the `thoughtBuffer` contains accumulated thought chunks
- **WHEN** the `prompt()` call completes (whether successfully or via error/idle timeout)
- **THEN** `AgentConnector` SHALL ensure `flushThoughtBuffer()` is called in its `finally` block so no buffered thought content is lost

#### Scenario: Flush thought buffer on client reset
- **GIVEN** the `thoughtBuffer` contains accumulated thought chunks
- **WHEN** `ChatbotClient.reset()` is called
- **THEN** the system SHALL call `flushThoughtBuffer()` and clear the buffer

#### Scenario: Empty thought buffer flush is a no-op
- **GIVEN** the `thoughtBuffer` is empty
- **WHEN** `flushThoughtBuffer()` is called
- **THEN** the system SHALL return immediately without logging or writing an audit entry

#### Scenario: Strict buffer isolation between thought and message buffers
- **GIVEN** thought chunks and message chunks are received during a session
- **WHEN** buffers are flushed (`flushThoughtBuffer()` / `flushMessageBuffer()`)
- **THEN** `thoughtBuffer` and `messageBuffer` SHALL remain strictly separated and cleared independently immediately upon flush (`this.thoughtBuffer = []` / `this.messageBuffer = []`), preventing thought content and message content from ever mixing together

#### Scenario: Non-blocking fire-and-forget audit logging with exact synchronous timestamps
- **GIVEN** an audit writer is configured on `ChatbotClient`
- **WHEN** `flushThoughtBuffer()` or `flushMessageBuffer()` is called
- **THEN** the exact current timestamp SHALL be captured synchronously (`new Date().toISOString()`) and passed to `SessionAuditWriter.write()`, and the write operation SHALL be strictly non-blocking (`fire-and-forget`) without obstructing main program execution

#### Scenario: File read from workspace
- **GIVEN** a `readTextFile` request
- **WHEN** the requested path is within the workspace or agent workspace boundary
- **THEN** the client SHALL read and return the file content

#### Scenario: File write with extension check
- **GIVEN** a `writeTextFile` request
- **WHEN** the file extension is in the `allowedWriteExtensions` list (default: `.md`, `.txt`) and the path is within workspace boundaries
- **THEN** the client SHALL write the file content

#### Scenario: File write with disallowed extension
- **GIVEN** a `writeTextFile` request with an extension not in the allowed list
- **WHEN** the write is attempted
- **THEN** the client SHALL reject the write and log the denial

---

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and all path boundary checks SHALL be boundary-safe (equal-or-separator-prefixed). Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` is the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14).

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

#### Scenario: Generic command approved only when all path args are in-workspace
- **GIVEN** a permission request to execute a generic command whose first token is on the allow-list (the safe path-arg readers, e.g. `head`, `cat`, `rg`, `jq`, `pdftotext`)
- **WHEN** every path-like argument — read input and write/output target — resolves inside the session workspace or TMPDIR, and no code-execution / arbitrary-target flag is present
- **THEN** it SHALL auto-approve the request; and when any path-like argument (input or output) resolves outside those boundaries — or a tool with a file-reading argument DSL/indirection is used, or a flag such as `-exec`/`-delete`/`--pre` is present — it SHALL reject the request with logging

#### Scenario: Filesystem URI-scheme path argument rejected, network URL allowed
- **GIVEN** a permission request whose argument is a filesystem URI-scheme token such as `file:///etc/passwd` (for example `agent-browser open file:///etc/passwd`)
- **WHEN** `referencesOutOfWorkspacePath()` evaluates the argument
- **THEN** it SHALL classify the token as out-of-workspace and the request SHALL NOT be auto-approved; whereas a network URL argument (`agent-browser open https://example.com`) SHALL NOT be classified as a filesystem escape (its egress is mediated by F14)

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

### Requirement: Permission Handling — YOLO Mode

In YOLO mode (global `--yolo` flag or per-channel `yolo: true`), the system SHALL auto-approve ALL permission requests.

#### Scenario: YOLO auto-approve
- **GIVEN** YOLO mode is enabled (globally or per-channel)
- **WHEN** any permission request is received
- **THEN** it SHALL be auto-approved with reason `"yolo_mode"`

### Requirement: Permission Audit Logging

The system SHALL audit all permission decisions when an audit writer is configured.

#### Scenario: Permission audit entry
- **GIVEN** an audit writer attached to the client
- **WHEN** a permission request is approved or denied
- **THEN** it SHALL write a fire-and-forget audit entry with the phase (`permission_approved` or `permission_denied`), tool name, and reason

---

### Requirement: Skill Auto-Approve List Construction

The system SHALL build a skill auto-approve list from configuration or by scanning the skills directory.

#### Scenario: Configured skills list
- **GIVEN** `autoApproveSkills` is provided in client config
- **WHEN** `buildSkillAutoApproveList()` is called
- **THEN** it SHALL use the configured list directly

#### Scenario: Directory-scanned skills list
- **GIVEN** no `autoApproveSkills` configuration
- **WHEN** `buildSkillAutoApproveList()` is called with a skills directory path
- **THEN** it SHALL scan the directory for skill scripts and build the list from discovered paths

---

### Requirement: Supported Agent Types

The system SHALL support a single agent type: `"opencode"`.

#### Scenario: OpenCode agent configuration
- **GIVEN** agent type `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `opencode acp` with permissions defined in `opencode.json`, passing `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` env vars

#### Scenario: Unknown agent type
- **GIVEN** an agent type other than `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL throw an error indicating the agent type is unknown

#### Scenario: Default agent selection
- **GIVEN** no explicit agent type configured
- **WHEN** `getDefaultAgentType()` is called
- **THEN** it SHALL return `"opencode"` as the default

### Requirement: Agent Common Environment

All agent subprocesses SHALL receive common environment variables regardless of agent type.

#### Scenario: Common env vars
- **GIVEN** any agent type
- **WHEN** the subprocess is spawned
- **THEN** the environment SHALL include `TMPDIR` (set to `{workingDir}/tmp`), `AGENT_WORKSPACE` (if provided), `PATH`, `HOME`, `DENO_DIR`, `LANG`, `LC_ALL`, and `USER`

#### Scenario: SESSION_ID env var provided to agent
- **GIVEN** a session has been created via ACP `createSession()`
- **WHEN** the agent subprocess spawns child processes (e.g., skill scripts)
- **THEN** the `SESSION_ID` environment variable SHALL be set to the active session ID so that skill scripts can resolve `$SESSION_ID` in their shell environment

#### Scenario: Per-session Skill API caller token provided to agent
- **GIVEN** a session has been created and assigned a caller token
- **WHEN** the agent subprocess is spawned
- **THEN** the per-session Skill API caller token SHALL be set in that subprocess's environment (e.g. `SKILL_API_TOKEN`) so its skill scripts can present it as an `Authorization` header
- **AND** the token value SHALL be unique per session and distinct from the session ID

---

### Requirement: OpenCode YOLO Mode Switching

The system SHALL switch OpenCode to its YOLO agent via ACP `setSessionMode()` rather than CLI flags.

#### Scenario: OpenCode YOLO activation
- **GIVEN** agent type `"opencode"` with YOLO enabled
- **WHEN** `getSessionModeOverride()` is called
- **THEN** it SHALL return `"yolo"` to switch to the yolo agent defined in `opencode.json` (which has `"*": "allow"` permissions)

#### Scenario: OpenCode restricted mode
- **GIVEN** agent type `"opencode"` with YOLO disabled
- **WHEN** `getSessionModeOverride()` is called
- **THEN** it SHALL return `null` (the default restricted `build` agent is used)

---

### Requirement: SandboxManager Environment Filtering

The `SandboxManager` SHALL filter subprocess environment variables to a base allowlist plus agent-type-specific variables when `filterEnv` is enabled.

#### Scenario: Filtered environment
- **GIVEN** `sandbox.filterEnv` is `true`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL include only base allowed vars (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID`, `SKILL_API_TOKEN`, `AGENT_WORKSPACE`, `TMPDIR`) plus agent-type-specific vars plus any configured `allowedEnvVars`

#### Scenario: Unfiltered environment
- **GIVEN** `sandbox.filterEnv` is `false`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL pass the agent configuration environment variables without additional sandbox filtering

#### Scenario: Agent-specific environment variables
- **GIVEN** agent type `"opencode"`
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`

### Requirement: SandboxManager Network Isolation

The `SandboxManager` SHALL mediate the agent subprocess's network egress so that the default posture never grants the agent unmediated access to host-private networks. It SHALL support two egress-control modes: (a) full network-namespace isolation via the userns-first `unshare --user --map-root --net`, and (b) a validating-proxy mode in which the agent's outbound requests are routed through a local proxy that applies SSRF validation (scheme allow-list; reject loopback, private RFC1918, link-local, unique-local, unspecified, and multicast addresses) so that `webfetch`, `websearch`, and `agent-browser` all inherit the validation. The validating-proxy mode is the default because full network-namespace isolation gives the agent an empty network namespace that also severs its loopback access to the Skill API; the proxy mode keeps the Skill API reachable (via `NO_PROXY`) while blocking internal targets. When neither a validating egress path nor an explicit operator opt-in to unrestricted egress is configured, the agent SHALL fail closed rather than be given open egress.

#### Scenario: Network isolation uses the userns-first incantation
- **GIVEN** full isolation is selected and a functional probe (not merely a binary-exists check) confirms a network namespace can actually be established at runtime
- **WHEN** `buildSpawnOptions()` wraps the command
- **THEN** it SHALL prepend `unshare --user --map-root --net` (not a bare `unshare --net`, which fails in a non-root container) to the agent command

#### Scenario: Isolation availability is functionally probed, not assumed
- **GIVEN** the `unshare` binary exists but a network namespace cannot be created at runtime (e.g. unprivileged user namespaces disabled on the node)
- **WHEN** the system determines the egress posture
- **THEN** it SHALL detect this via a functional probe rather than a binary-existence check, and SHALL fail closed rather than fall back to unmediated open egress

#### Scenario: Validating-proxy egress preserves public research while blocking internal targets
- **GIVEN** a validating egress proxy is configured
- **WHEN** the agent issues a `webfetch`, `websearch`, or `agent-browser` request
- **THEN** the request SHALL be routed through the proxy, which SHALL allow public destinations and reject loopback/private/link-local/unique-local/metadata addresses before forwarding

#### Scenario: Internal target rejected across all agent network paths
- **GIVEN** the mediated egress path is active
- **WHEN** the agent attempts to fetch `http://169.254.169.254/…` or `http://127.0.0.1:8090/` via any tool (including `agent-browser` post-launch navigation)
- **THEN** the request SHALL be rejected and its body SHALL NOT be returned to the agent

#### Scenario: Default posture is not open egress
- **GIVEN** the default configuration (validating egress proxy enabled)
- **WHEN** the agent subprocess is spawned
- **THEN** the agent's egress SHALL be routed through the validating proxy (internal targets blocked, public allowed) rather than granted open egress

#### Scenario: No posture configured fails closed
- **GIVEN** no validating egress proxy, no full network isolation, and no explicit unrestricted-egress opt-in are configured
- **WHEN** the agent subprocess is spawned
- **THEN** `buildSpawnOptions()` SHALL throw (fail closed) rather than granting the agent unmediated open egress

#### Scenario: Graceful degradation without silent open egress
- **GIVEN** full isolation is required but the network-namespace mechanism is unavailable (e.g. unprivileged user namespaces disabled, or not on Linux)
- **WHEN** `buildSpawnOptions()` is called in a posture that expects mediation
- **THEN** it SHALL fail closed with an actionable error and SHALL NOT silently fall through to unmediated open egress; unrestricted egress SHALL require the explicit opt-in

### Requirement: Sandbox Configuration

Sandbox settings SHALL be configurable via `config.yaml` and environment variable overrides.

#### Scenario: Environment variable overrides
- **GIVEN** `AGENT_SANDBOX_FILTER_ENV`, `AGENT_SANDBOX_NETWORK_ISOLATION`, `AGENT_SANDBOX_ALLOWED_ENV_VARS`, or `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `agent.sandbox.*` config values

---

### Requirement: Git Credential Store Setup

The system SHALL configure git credential store for agent subprocesses when `agent.gitCredential.enabled` is `true`.

#### Scenario: Credential file creation
- **GIVEN** `agent.gitCredential.enabled` is `true` and a password is available
- **WHEN** `setupGitCredentials()` runs
- **THEN** it SHALL write `~/.git-credentials` with URL-encoded credentials, set file permissions to `0o600`, and run `git config --global credential.helper store`

#### Scenario: Host resolution order
- **GIVEN** git credential setup
- **WHEN** resolving the credential host
- **THEN** it SHALL check `agent.gitCredential.host` first, then parse from `gitBackup.remoteUrl`, then default to `"github.com"`

#### Scenario: Username resolution order
- **GIVEN** git credential setup
- **WHEN** resolving the credential username
- **THEN** it SHALL check `gitBackup.authUser` first, then `gitBackup.authorEmail`, then default to `"x-access-token"`

#### Scenario: Password resolution order
- **GIVEN** git credential setup
- **WHEN** resolving the credential password
- **THEN** it SHALL check `gitBackup.authPassword` first, then `GITHUB_TOKEN` env var, then return empty string

#### Scenario: Setup failure graceful degradation
- **GIVEN** git credential setup encounters an error
- **WHEN** any step fails
- **THEN** it SHALL log a warning (not error) and SHALL NOT block application startup

---

### Requirement: Idle Timeout Detection

The system SHALL detect silently unresponsive agent connections via periodic idle checks during prompt execution.

#### Scenario: Activity tracking
- **GIVEN** an active ACP session
- **WHEN** any agent callback fires (sessionUpdate, requestPermission, readTextFile, writeTextFile)
- **THEN** the client SHALL update the `lastActivityTimestamp`

#### Scenario: Idle check interval
- **GIVEN** idle timeout is enabled (default: `true`)
- **WHEN** `prompt()` is executing
- **THEN** it SHALL run a periodic check every `checkIntervalMs` (default: 30 seconds)

#### Scenario: Timeout with liveness check
- **GIVEN** no activity for `timeoutMs` (default: 5 minutes)
- **WHEN** the idle check fires
- **THEN** it SHALL verify if the subprocess is alive via `process.status`, attempt `connection.cancel()` as a connectivity probe, reset the timer if alive, or throw an error if dead

#### Scenario: Idle timeout configuration
- **GIVEN** environment variables `AGENT_IDLE_TIMEOUT_ENABLED`, `AGENT_IDLE_TIMEOUT_MS`, or `AGENT_IDLE_TIMEOUT_CHECK_INTERVAL_MS`
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `agent.idleTimeout.*` config values

---

### Requirement: Retry on Missing Reply

The system SHALL retry when an ACP agent completes without calling the `send-reply` skill.

#### Scenario: Retry on end_turn without reply
- **GIVEN** the agent completes a prompt turn (`stopReason === "end_turn"`) without sending a reply
- **WHEN** the retry threshold has not been reached
- **THEN** it SHALL clear reply state, send a retry prompt on the same ACP session, and check for a reply again

#### Scenario: Retry strategy for OpenCode
- **GIVEN** agent type `"opencode"`
- **WHEN** `getRetryPromptStrategy()` is called
- **THEN** it SHALL return `maxRetries: 1`

#### Scenario: Final retry failure
- **GIVEN** the retry also fails to produce a reply
- **WHEN** the max retry count is exceeded
- **THEN** it SHALL return a failure response without further retries

---

### Requirement: External MCP Server Registration

The system SHALL support registering external MCP servers with agent sessions.

#### Scenario: MCP server configuration
- **GIVEN** `agent.mcpServers` configured in config or `AGENT_MCP_SERVERS` env var (JSON string)
- **WHEN** a session is created
- **THEN** it SHALL register supported MCP servers with the session, filtering by agent transport capabilities

#### Scenario: Environment variable expansion
- **GIVEN** MCP server config with `${ENV_VAR}` patterns in `env`, `headers`, or `url` fields
- **WHEN** the config is processed
- **THEN** it SHALL expand `${ENV_VAR}` references to their runtime values

#### Scenario: Transport filtering
- **GIVEN** an agent that only supports stdio transport
- **WHEN** MCP servers include HTTP or SSE transport configs
- **THEN** it SHALL filter out unsupported transports and only register stdio-based servers

---

### Requirement: Agent Capabilities Negotiation

The system SHALL track agent capabilities reported via ACP for feature gating.

#### Scenario: Image prompt capability
- **GIVEN** an agent reports `promptCapabilities.image === true`
- **WHEN** a trigger message contains image attachments
- **THEN** the system SHALL download and include image content blocks in the prompt

#### Scenario: No image capability
- **GIVEN** an agent does not report image prompt capability
- **WHEN** a trigger message contains image attachments
- **THEN** the system SHALL include only text descriptions of the attachments (URLs and metadata)

#### Scenario: MCP transport capabilities
- **GIVEN** an agent reports `mcpCapabilities` with supported transports
- **WHEN** filtering MCP servers for session registration
- **THEN** it SHALL only register servers whose transport type is supported by the agent

#### Scenario: Load session capability
- **GIVEN** an agent reports `loadSession` capability
- **WHEN** session reconnection is attempted
- **THEN** it MAY attempt to reload the session (currently no agents support this)

---

### Requirement: Agent Message Chunk Buffering

The `ChatbotClient` SHALL accumulate `agent_message_chunk` session updates into an internal `messageBuffer` and flush them as a single complete message log entry when a non-chunk session update arrives or when the prompt turn completes.

#### Scenario: Chunk accumulation during agent response
- **GIVEN** the agent is generating a response
- **WHEN** multiple `agent_message_chunk` session updates with `content.type === "text"` are received
- **THEN** the system SHALL append each chunk's `content.text` to the `messageBuffer` without emitting per-chunk info-level logs

#### Scenario: Flush on non-chunk session update
- **GIVEN** the `messageBuffer` contains one or more accumulated chunks
- **WHEN** a non-chunk session update is received (e.g., `tool_call`, `tool_call_update`, `plan`, `agent_thought_chunk`, `usage_update`, or any other type)
- **THEN** the system SHALL call `flushMessageBuffer()`, joining all buffered chunks into a single string and logging the complete assembled message with chunk count and character length at INFO level, then clear the buffer

#### Scenario: Flush on prompt completion
- **GIVEN** the `messageBuffer` contains accumulated chunks
- **WHEN** the `prompt()` call completes (whether successfully or via error/idle timeout)
- **THEN** `AgentConnector` SHALL call `flushMessageBuffer()` in its `finally` block to ensure no buffered content is lost

#### Scenario: Empty buffer flush is a no-op
- **GIVEN** the `messageBuffer` is empty
- **WHEN** `flushMessageBuffer()` is called
- **THEN** the system SHALL return immediately without logging

---

### Requirement: Agent Thought Chunk Logging with Dual-Format Text Extraction

The `ChatbotClient` SHALL extract thought text from `agent_thought_chunk` session updates by
checking both the `update.content` envelope format and the `update.text` direct string format, and
SHALL include the extracted text in the log message template so it appears in the top-level
`log_processed_message` field.

#### Scenario: Thought chunk with content envelope format (old)
- **WHEN** an `agent_thought_chunk` session update is received with `update.content.type === "text"`
  and `update.content.text` containing the thought text
- **THEN** the system SHALL extract the text from `update.content.text`, truncate it to 100
  characters, and log it at DEBUG level with the message template `"Agent thought: {text}"` so that
  `log_processed_message` contains the thought text directly

#### Scenario: Thought chunk with direct text format (new)
- **WHEN** an `agent_thought_chunk` session update is received with `update.text` as a string (and
  `update.content` is absent or not of type `"text"`)
- **THEN** the system SHALL extract the text from `update.text`, truncate it to 100 characters, and
  log it at DEBUG level with the message template `"Agent thought: {text}"`

#### Scenario: Content envelope format takes precedence over direct text
- **WHEN** an `agent_thought_chunk` session update contains both `update.content.text` and
  `update.text`
- **THEN** the system SHALL prefer `update.content.text` as the source of truth

#### Scenario: Thought chunk with no extractable text
- **WHEN** an `agent_thought_chunk` session update is received with neither `update.content.text`
  nor `update.text` containing valid text
- **THEN** the system SHALL log at DEBUG level with `"Agent thought: {text}"` where `text` is an
  empty string
