# ACP Client Integration

## Purpose

Defines how AIr-Friends acts as an ACP (Agent Client Protocol) Client, spawning external agent subprocesses (Copilot, Gemini, OpenCode), managing bidirectional JSON-RPC communication, handling permission requests, sandboxing agent processes, and supporting retry, idle timeout, and external MCP server registration.

## Requirements

### Requirement: AgentConnector Subprocess Management

The system SHALL manage external ACP agent lifecycle through the `AgentConnector` class, spawning agents as subprocesses with `dumb-init` for proper signal forwarding and communicating via stdio JSON-RPC.

#### Scenario: Agent connection
- **GIVEN** a valid `AgentConfig` with command, args, cwd, and env
- **WHEN** `connect()` is called
- **THEN** it SHALL spawn the agent subprocess wrapped with `dumb-init`, establish a `ClientSideConnection` over stdin/stdout JSON-RPC, and pipe stderr for logging

#### Scenario: Session creation with MCP servers
- **GIVEN** a connected agent
- **WHEN** `createSession(mcpServers)` is called
- **THEN** it SHALL create a new ACP session, filter MCP servers to only those with transports supported by the agent's `mcpCapabilities`, and register supported servers with the session

#### Scenario: Model and mode setting
- **GIVEN** an active session
- **WHEN** `setSessionModel()` or `setSessionMode()` is called
- **THEN** it SHALL configure the session's model or mode via the ACP connection

#### Scenario: Graceful disconnect
- **GIVEN** a connected agent
- **WHEN** `disconnect()` is called
- **THEN** it SHALL attempt graceful shutdown with a 2-second SIGTERM timeout before force-killing the subprocess

#### Scenario: Subprocess exit monitoring
- **GIVEN** a running agent subprocess
- **WHEN** the subprocess exits unexpectedly
- **THEN** the system SHALL log the exit status and code asynchronously

---

### Requirement: ChatbotClient ACP Client Interface

The system SHALL implement the ACP `Client` interface via `ChatbotClient`, handling callbacks from external agents for permissions, session updates, and file operations.

#### Scenario: Session update handling
- **GIVEN** an active ACP session
- **WHEN** the agent sends a `sessionUpdate` with message chunks or tool calls
- **THEN** the client SHALL log the activity, update the `lastActivityTimestamp`, and write audit entries if an audit writer is configured

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

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation.

#### Scenario: Registered skill auto-approval
- **GIVEN** a permission request for a registered skill
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request

#### Scenario: Skill directory read access
- **GIVEN** a permission request to read files in the skills directory
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request

#### Scenario: Skill command whitelist approval
- **GIVEN** a permission request to execute a command matching the auto-approve list
- **WHEN** the command matches a script path as a complete whitespace-delimited token or a command prefix as the exact first token
- **THEN** it SHALL auto-approve the request

#### Scenario: Shell operator rejection
- **GIVEN** a command containing shell operators (`;`, `|`, `&`, `` ` ``, `(`, `)`, `>`, `<`, `#`, newlines)
- **WHEN** `containsShellOperators()` checks the command
- **THEN** it SHALL flag the command as containing shell operators (note: `$` is allowed for variable expansion)

#### Scenario: Edit/write permission with path extraction
- **GIVEN** an edit/write permission request with empty `locations`
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL attempt to extract file paths from `rawInput` by checking fields: `path`, `file_path`, `filePath`, `filepath`, `file`, `filename`, `paths`, `files`

#### Scenario: Edit/write within agent workspace
- **GIVEN** an edit/write permission request for a path within the agent workspace or TMPDIR
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request

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

The system SHALL support three agent types: `"copilot"`, `"gemini"`, and `"opencode"`.

#### Scenario: Copilot agent configuration
- **GIVEN** agent type `"copilot"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `copilot` with base flags (`--disable-builtin-mcps`, `--no-ask-user`, `--no-color`, `--no-auto-update`, `--experimental`, `--acp`), and in restricted mode add `--available-tools write_bash`, `--available-tools read_bash`, `--available-tools stop_bash`, `--available-tools bash`, and separate `--deny-tool` entries for `shell(git:*)`, `shell(echo:*)`, `shell(mkdir:*)`; or `--yolo` flag in YOLO mode, and pass `COPILOT_GITHUB_TOKEN` and `GITHUB_TOKEN` env vars

#### Scenario: Gemini agent configuration
- **GIVEN** agent type `"gemini"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `gemini` with `--experimental-acp` in restricted mode or `--yolo` in YOLO mode, and pass `GEMINI_API_KEY` and `GEMINI_SYSTEM_MD` env vars

#### Scenario: OpenCode agent configuration
- **GIVEN** agent type `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `opencode acp` with permissions defined in `opencode.json`, passing `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` env vars

#### Scenario: Default agent selection
- **GIVEN** no explicit agent type configured
- **WHEN** `getDefaultAgentType()` is called
- **THEN** it SHALL return `"copilot"` as the default

### Requirement: Agent Common Environment

All agent subprocesses SHALL receive common environment variables regardless of agent type.

#### Scenario: Common env vars
- **GIVEN** any agent type
- **WHEN** the subprocess is spawned
- **THEN** the environment SHALL include `TMPDIR` (set to `{workingDir}/tmp`), `AGENT_WORKSPACE` (if provided), `PATH`, `HOME`, `DENO_DIR`, `LANG`, `LC_ALL`, and `USER`

---

### Requirement: OpenCode YOLO Mode Switching

The system SHALL switch OpenCode to its YOLO agent via ACP `setSessionMode()` rather than CLI flags.

#### Scenario: OpenCode YOLO activation
- **GIVEN** agent type `"opencode"` with YOLO enabled
- **WHEN** `getSessionModeOverride()` is called
- **THEN** it SHALL return `"yolo"` to switch to the yolo agent defined in `opencode.json` (which has `"*": "allow"` permissions)

#### Scenario: Non-OpenCode YOLO
- **GIVEN** agent type `"copilot"` or `"gemini"` with YOLO enabled
- **WHEN** `getSessionModeOverride()` is called
- **THEN** it SHALL return `null` (YOLO is handled via CLI flags for these agents)

---

### Requirement: SandboxManager Environment Filtering

The `SandboxManager` SHALL filter subprocess environment variables to a base allowlist plus agent-type-specific variables when `filterEnv` is enabled.

#### Scenario: Filtered environment
- **GIVEN** `sandbox.filterEnv` is `true`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL include only base allowed vars (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID`, `AGENT_WORKSPACE`, `TMPDIR`) plus agent-type-specific vars plus any configured `allowedEnvVars`

#### Scenario: Unfiltered environment
- **GIVEN** `sandbox.filterEnv` is `false`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL pass the agent configuration environment variables without additional sandbox filtering

#### Scenario: Agent-specific environment variables
- **GIVEN** agent type `"copilot"`
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow `GITHUB_TOKEN` and `COPILOT_GITHUB_TOKEN`

### Requirement: SandboxManager Network Isolation

The `SandboxManager` SHALL support network namespace isolation via `unshare --net` when configured.

#### Scenario: Network isolation on Linux
- **GIVEN** `sandbox.networkIsolation` is `true` and running on Linux with `unshare` available
- **WHEN** `buildSpawnOptions()` wraps the command
- **THEN** it SHALL prepend `unshare --net` to the agent command

#### Scenario: Graceful degradation
- **GIVEN** `sandbox.networkIsolation` is `true` but `unshare` is unavailable or not on Linux
- **WHEN** `buildSpawnOptions()` is called
- **THEN** it SHALL log a warning and skip network isolation without blocking startup

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

#### Scenario: Retry strategy per agent type
- **GIVEN** any supported agent type
- **WHEN** `getRetryPromptStrategy()` is called
- **THEN** it SHALL return `maxRetries: 1` for all agent types (copilot, gemini, opencode)

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
