# ACP Client Integration

## Purpose

Defines how AIr-Friends acts as an ACP (Agent Client Protocol) Client, spawning the external OpenCode agent subprocess, managing bidirectional JSON-RPC communication, handling permission requests, sandboxing agent processes, and supporting retry, idle timeout, and external MCP server registration.

## Requirements

### Requirement: AgentConnector Subprocess Management

The system SHALL manage the external OpenCode ACP agent lifecycle through the `AgentConnector` class: per-session mode spawns the agent subprocess with `dumb-init` and stdio JSON-RPC, while shared-process mode connects once per channel and creates multiple ACP sessions over the same stdio connection. Every outbound ACP call SHALL be raced against a per-subprocess crash signal so an unexpected subprocess exit rejects the pending call promptly.

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

In restricted (non-YOLO) mode, `requestPermission()` SHALL selectively approve or deny permission requests based on whitelists and path validation. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and all path boundary checks SHALL be boundary-safe.

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

#### Scenario: Skill command with legacy free-text flag rejected
- **GIVEN** a permission request to execute a whitelisted skill command that carries a legacy free-text flag, e.g. `deno run .../send-reply.ts --session-id "$SESSION_ID" --message "定價 $0.435"` or `... --message=定價`
- **WHEN** `requestPermission()` evaluates the command tokens
- **THEN** it SHALL reject the request with a `permission_denied` audit entry
- **AND** a command using `--message-id "msg_x"` or `--message-file "$TMPDIR/$SESSION_ID/reply.md"` SHALL NOT be rejected on these grounds

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

#### Scenario: Edit/write request with OpenCode v1.17.13+ shape recognized
- **GIVEN** a permission request whose `toolCall` has `kind: "edit"` and `title` set to the target file path (the shape OpenCode v1.17.13+ sends for `write`/`edit`/`apply_patch`/`patch`), e.g. `title: "$TMPDIR/$SESSION_ID/reply.md"` with `rawInput: { filePath: "$TMPDIR/$SESSION_ID/reply.md", content: "..." }`
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL treat it as a scoped edit/write request and apply the workspace/TMPDIR boundary checks instead of rejecting it as an unknown tool call

#### Scenario: Edit/write request with legacy title shape recognized
- **GIVEN** a permission request whose `toolCall` has `title: "edit"`, `title: "edit_file"`, `title: "write"`, or `title: "write_file"` (the shapes older OpenCode versions and other ACP agents may send)
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL treat it as a scoped edit/write request and apply the workspace/TMPDIR boundary checks instead of rejecting it as an unknown tool call

#### Scenario: Edit/write within agent workspace requires write permission
- **GIVEN** an edit/write permission request for a path within the agent workspace
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request ONLY if the session's `canWriteAgentWorkspace` flag is `true`; otherwise it SHALL reject the request with logging

#### Scenario: Edit/write within TMPDIR
- **GIVEN** an edit/write permission request for a path within the session TMPDIR
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request regardless of `canWriteAgentWorkspace`

#### Scenario: Edit/write with $TMPDIR/$SESSION_ID tokens approved
- **GIVEN** a session with id `sess_own` whose TMPDIR resolves to `{workingDir}/tmp`
- **WHEN** an edit/write permission request or `writeTextFile` call uses the literal path `$TMPDIR/$SESSION_ID/reply.md` or `${TMPDIR}/${SESSION_ID}/reply.md`
- **THEN** the tokens SHALL be expanded against the session TMPDIR and session id before the boundary check and SHALL be approved
- **AND** a literal path `$TMPDIR2/reply.md` or `$OTHER/reply.md` SHALL remain unexpanded and SHALL NOT be approved

#### Scenario: writeTextFile writes the expanded path
- **GIVEN** a session whose TMPDIR is `{workingDir}/tmp`
- **WHEN** `writeTextFile` receives path `$TMPDIR/$SESSION_ID/reply.md` with content `定價 $0.435`
- **THEN** the content SHALL be written verbatim to `{workingDir}/tmp/{sessionId}/reply.md` (the expanded path — no literal `$TMPDIR` directory under the bot's cwd)
- **AND** `readTextFile` on the same expanded path SHALL return the verbatim content including the `$` characters

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

#### Scenario: Filesystem-touching bash tools gated by requestPermission
- **GIVEN** a filesystem-touching bash tool whose permission is configured `"ask"` rather than `"allow"`
- **WHEN** the tool invocation reaches the permission gate
- **THEN** `requestPermission()` SHALL be the authoritative decision point for the command

#### Scenario: Skill command with other legacy free-text flags rejected
- **GIVEN** a whitelisted skill command whose whitespace-delimited tokens include `--content`, `--content=value`, `--query`, `--query=value`, `--caption`, or `--caption=value`
- **WHEN** the gate evaluates the skill command for auto-approval
- **THEN** the gate SHALL reject the command instead of approving it
- **AND** distinct tokens `--content-file`, `--query-file`, `--caption-file` SHALL NOT trigger the rejection

#### Scenario: SESSION_ID expansion consistent with script-side --session-id
- **GIVEN** a shell session exists (message, spontaneous, self-research, memory-maintenance, channel memory-maintenance, reminder)
- **WHEN** the gate expands `$SESSION_ID` in a path argument
- **THEN** the client config's `sessionId` SHALL be set to the shell session id so expansion matches the script-side `--session-id`
- **AND** flows without a shell session SHALL leave `sessionId` unset, so expansion yields an empty string matching the script-side `{workspace}/tmp` fallback

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

The system SHALL support exactly two deployment-level agent types: `"opencode"` and `"omp"`, recognized through one shared supported-type set used by configuration validation, default selection, dashboard validation, and factory dispatch. Omitted type remains `"opencode"`. Accepting a type at the configuration/selection layer is distinct from launching it: launch mechanics are owned by later changes, and no component may claim an unimplemented launch path is available.

#### Scenario: OpenCode agent configuration
- **GIVEN** agent type `"opencode"`
- **WHEN** `createAgentConfig()` builds the config
- **THEN** it SHALL use command `opencode acp` with permissions defined in `opencode.json`, passing `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` env vars

#### Scenario: OMP type is accepted at every configuration surface
- **GIVEN** `agent.defaultAgentType` or `AGENT_DEFAULT_TYPE` is `"omp"`
- **WHEN** the configuration is loaded and `getDefaultAgentType()` is called
- **THEN** the load SHALL succeed without a validation error and `getDefaultAgentType()` SHALL return `"omp"`
- **AND** the dashboard chat agent-type validation SHALL accept `"omp"` rather than reject it

#### Scenario: Unknown agent type rejected at load
- **GIVEN** `agent.defaultAgentType` is set to a value outside `"opencode"` and `"omp"` (including a value differing only by case or surrounding whitespace)
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError` naming the field and the valid values, instead of deferring the failure to a later factory call

#### Scenario: Unknown agent type
- **GIVEN** an agent type outside the supported set reaches `createAgentConfig()` through a non-configuration caller
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

The `SandboxManager` SHALL filter agent subprocess environment variables, when `filterEnv` is enabled, to the base allowlist plus the selected agent type's supported credential set plus configured `agent.sandbox.allowedEnvVars` entries, and SHALL deny every never-pass name from all three sources.

#### Scenario: Base allowlist is closed
- **WHEN** the base allowlist is read
- **THEN** it SHALL contain only `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID`, `SKILL_JWT_DIR`, `SKILL_SHARED_PROCESS`, `AGENT_WORKSPACE`, `TMPDIR`, `XDG_DATA_HOME`, `AGENT_BROWSER_EXECUTABLE_PATH`, and the egress-proxy variables `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `http_proxy`, `https_proxy`, `no_proxy`
- **AND** no other name SHALL be admitted by the base set

#### Scenario: Never-pass categories are enumerated
- **WHEN** the never-pass rule set is read
- **THEN** it SHALL deny platform tokens (`DISCORD_TOKEN`, `MISSKEY_TOKEN`), dashboard credentials (`DASHBOARD_PASSPHRASE`), the raw Skill API server secret (`AGENT_SKILL_API_SECRET`), provider credentials outside the agent's supported set (including `OPENCODE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, and git-backup credentials), and profile/XDG state selectors that could redirect an agent's scoped state (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`, `PI_PROFILE`, `PI_CODING_AGENT_DIR`)
- **AND** neither the implicit base set nor an operator-configured `agent.sandbox.allowedEnvVars` entry SHALL admit any of them

#### Scenario: Filtered environment
- **GIVEN** `sandbox.filterEnv` is `true`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL include only base allowed vars plus agent-type-specific vars plus any configured `allowedEnvVars` entries that are not never-pass variables

#### Scenario: Unfiltered environment
- **GIVEN** `sandbox.filterEnv` is `false`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** it SHALL pass the agent configuration environment variables without additional sandbox filtering

#### Scenario: Agent-specific environment variables
- **GIVEN** agent type `"opencode"`
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`

#### Scenario: OMP agent-specific environment variables
- **GIVEN** agent type `"omp"` and a base environment containing every credential the deployment holds
- **WHEN** environment is filtered
- **THEN** it SHALL additionally allow only `GEMINI_API_KEY` and `OPENROUTER_API_KEY`
- **AND** it SHALL NOT pass `OPENCODE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`

#### Scenario: Platform and dashboard secrets never reach any agent subprocess
- **GIVEN** `sandbox.filterEnv` is `true`, agent type `omp` or `opencode`, and the base environment contains `DISCORD_TOKEN`, `MISSKEY_TOKEN`, `DASHBOARD_PASSPHRASE`, and `AGENT_SKILL_API_SECRET`
- **WHEN** `buildSpawnOptions()` constructs the subprocess environment
- **THEN** none of those four variables SHALL be present in the result

#### Scenario: Allowed env vars cannot widen credentials or selectors
- **GIVEN** `sandbox.allowedEnvVars` is configured with `OPENCODE_API_KEY`, `XDG_CONFIG_HOME`, and a benign name `MY_TOOL_FLAG`
- **WHEN** environment is filtered for agent type `omp`
- **THEN** the filtered environment SHALL contain `MY_TOOL_FLAG` but SHALL NOT contain `OPENCODE_API_KEY` or `XDG_CONFIG_HOME`
- **AND** one bounded warning SHALL record each excluded name

#### Scenario: Profile and XDG selectors are not inherited
- **GIVEN** the deployment environment sets `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`, `PI_PROFILE`, or `PI_CODING_AGENT_DIR`
- **WHEN** any agent subprocess environment is filtered
- **THEN** none of those variables SHALL appear in the result

### Requirement: SandboxManager Network Isolation

The `SandboxManager` SHALL mediate the agent subprocess's network egress so the default posture never grants the agent unmediated access to host-private networks, supporting two egress-control modes: full network-namespace isolation via the userns-first `unshare --user --map-root --net`, and the default validating-proxy mode. When neither a validating egress path nor an explicit operator opt-in to unrestricted egress is configured, the agent SHALL fail closed.

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

#### Scenario: Allowlisted internal host is reachable through the proxy
- **GIVEN** `agent.sandbox.egressAllowHosts` contains `192.168.1.10` and `internal-proxy`
- **WHEN** the agent requests `http://192.168.1.10:7860/sdapi/v1/progress` (plain-HTTP forward) or issues a CONNECT to `internal-proxy:18080` through the validating proxy
- **THEN** the proxy SHALL NOT reject the destination for being in a private range, SHALL resolve and pin the connection address as usual, and SHALL forward the request

#### Scenario: Allowlist match is exact per host, not a range grant
- **GIVEN** `agent.sandbox.egressAllowHosts` contains `192.168.1.10`
- **WHEN** the agent attempts to reach `192.168.10.11` (or any other non-listed private address) through the proxy
- **THEN** the request SHALL be rejected with the standard disallowed-range refusal

#### Scenario: Metadata address stays blocked even for an allowlisted host
- **GIVEN** `agent.sandbox.egressAllowHosts` contains a hostname entry whose DNS resolution has been changed (compromise or misconfiguration) to `169.254.169.254`
- **WHEN** the agent requests that host through the validating proxy
- **THEN** the proxy SHALL reject the request — the allowlist exemption SHALL NOT lift the metadata-address block

#### Scenario: IPv6 literal allowlist entry matches bracketed request forms
- **GIVEN** `agent.sandbox.egressAllowHosts` contains an IPv6 literal entry (e.g. `fd12:3456::10`)
- **WHEN** the agent requests that address in bracketed authority form (`[fd12:3456::10]:8080`) through the proxy
- **THEN** the normalized comparison SHALL match the entry and the request SHALL be exempted from the disallowed-range rejection

#### Scenario: Malformed or empty allowlist entries never match and are surfaced
- **GIVEN** `agent.sandbox.egressAllowHosts` contains an entry with a scheme, path, or port (e.g. `http://192.168.1.10:7860`) or an empty string
- **WHEN** the allowlist is configured at bootstrap
- **THEN** the system SHALL warn that the entry can never match a destination host, and the entry SHALL NOT grant any exemption

#### Scenario: Allowlisted hosts appended to NO_PROXY
- **GIVEN** the validating-proxy posture is active and `agent.sandbox.egressAllowHosts` is non-empty
- **WHEN** the agent subprocess environment is built
- **THEN** `NO_PROXY`/`no_proxy` SHALL contain the loopback entries plus every allowlisted host, so env-honoring clients connect to allowlisted hosts directly while all other traffic still routes through the proxy

#### Scenario: Loopback allowlist entry warns at startup
- **GIVEN** `agent.sandbox.egressAllowHosts` contains a loopback or unspecified entry (e.g. `127.0.0.1`, `localhost`, `::1`)
- **WHEN** the allowlist is configured at bootstrap
- **THEN** the system SHALL emit a prominent warning that daemon-local services become reachable to the agent, and SHALL still honor the operator's explicit choice

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

#### Scenario: Validating-proxy is the default egress posture
- **GIVEN** the default egress configuration
- **WHEN** the agent subprocess is spawned
- **THEN** the validating-proxy mode SHALL be used, because full network-namespace isolation would give the agent an empty namespace that also severs loopback access to the Skill API
- **AND** the proxy mode SHALL keep the Skill API reachable (via `NO_PROXY`) while blocking internal targets

#### Scenario: Allowlisted hostnames still resolved and pinned
- **GIVEN** an `agent.sandbox.egressAllowHosts` entry that is a hostname (not a literal IP)
- **WHEN** the agent connects to that host through the validating proxy
- **THEN** the disallowed-range rejection SHALL be exempted based on the exact requested-host match, and DNS resolution and connect-time address pinning SHALL still apply to the allowlisted hostname

#### Scenario: Allowlist is operator-configured only
- **GIVEN** a validating-proxy deployment with an `agent.sandbox.egressAllowHosts` allowlist
- **WHEN** an agent or chat user attempts to extend the trusted destinations
- **THEN** the allowlist SHALL be sourced exclusively from operator deployment configuration and SHALL NOT be extendable at runtime by the agent or chat users

#### Scenario: Empty allowlist keeps pre-allowlist posture
- **GIVEN** `agent.sandbox.egressAllowHosts` is empty (the default)
- **WHEN** the validating-proxy posture is active
- **THEN** egress SHALL behave identically to the pre-allowlist posture

### Requirement: Egress Proxy Transport Fidelity

The validating egress proxy (`src/utils/egress-proxy.ts`) SHALL relay bytes between the agent and the upstream origin without altering or losing them, and SHALL propagate connection lifecycle events in both directions, so the mediation layer does not itself become a source of corrupted streams or zombie connections.

#### Scenario: Short writes are fully flushed
- **GIVEN** a tunneled transfer large enough that the socket `write` returns fewer bytes than requested (TCP backpressure)
- **WHEN** the proxy relays a chunk to the peer, or writes a control response / rewritten request head
- **THEN** it SHALL loop until every byte has been written, and the payload SHALL arrive byte-exact (a dropped remainder would corrupt the tunneled TLS stream)

#### Scenario: Upstream close is propagated to the client
- **GIVEN** an established CONNECT tunnel whose upstream closes an idle keep-alive connection
- **WHEN** the proxy observes EOF on that direction
- **THEN** it SHALL forward the half-close to the client immediately rather than waiting for the opposite direction to drain, so the client's connection pool observes the closure instead of reusing a dead tunnel

#### Scenario: Transport error tears down both directions
- **GIVEN** an established tunnel
- **WHEN** either direction errors (e.g. connection reset)
- **THEN** the proxy SHALL close both connections so the opposite direction unblocks rather than hanging until the session idle timeout

#### Scenario: Forwarded plain-HTTP requests are forced to close semantics
- **GIVEN** a plain-HTTP request the client sent with `Connection: keep-alive` (or `Proxy-Connection`)
- **WHEN** the proxy rewrites the absolute-form request line to origin-form for forwarding
- **THEN** it SHALL drop the client's `Connection`/`Proxy-Connection` headers and emit `Connection: close`, and SHALL preserve any body bytes already read with the head
- **AND** the upstream SHALL therefore end the connection after one response, preventing a keep-alive client from smuggling a second, unvalidated request through the raw tunnel to the same upstream

### Requirement: Sandbox Configuration

Sandbox settings SHALL be configurable via `config.yaml` and environment variable overrides.

#### Scenario: Environment variable overrides
- **GIVEN** `AGENT_SANDBOX_FILTER_ENV`, `AGENT_SANDBOX_NETWORK_ISOLATION`, `AGENT_SANDBOX_ALLOWED_ENV_VARS`, or `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `agent.sandbox.*` config values

#### Scenario: Egress allowlist configurable via env override
- **GIVEN** the `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` env var set to a comma-separated list (e.g. `192.168.1.10,internal-proxy`)
- **WHEN** configuration is loaded
- **THEN** it SHALL override `agent.sandbox.egressAllowHosts` with the trimmed, non-empty entries

#### Scenario: Egress allowlist defaults to empty
- **GIVEN** neither `config.yaml` nor the environment configures `egressAllowHosts`
- **WHEN** configuration is loaded
- **THEN** `agent.sandbox.egressAllowHosts` SHALL default to an empty list and the egress posture SHALL be identical to the pre-allowlist behavior

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

The system SHALL detect silently unresponsive agent connections via periodic idle checks during prompt execution, and SHALL separately bound how long `connect()` may wait for the agent to complete its ACP handshake.

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

#### Scenario: Connect-time handshake timeout
- **GIVEN** the agent subprocess has spawned and is alive (has not exited)
- **WHEN** `connection.initialize()` does not complete within `connectTimeoutMs` (default: 30 seconds)
- **THEN** `connect()` SHALL reject with a descriptive timeout error rather than waiting indefinitely for a handshake that may never complete

#### Scenario: Connect timeout configuration
- **GIVEN** the `AGENT_CONNECT_TIMEOUT_MS` environment variable
- **WHEN** configuration is loaded
- **THEN** it SHALL override the corresponding `agent.connectTimeoutMs` config value

#### Scenario: Early warning before a connect-time timeout
- **GIVEN** `connect()` is awaiting `connection.initialize()`
- **WHEN** elapsed time passes 80% of `connectTimeoutMs` without the handshake completing
- **THEN** the system SHALL log a `WARN` indicating the connection is approaching its timeout, so operators get advance signal before a hard failure and before the default is tuned against real production latency data

#### Scenario: Connect timeout timer cleared on early settlement
- **GIVEN** `connection.initialize()` completes (successfully or via crash-signal rejection) before `connectTimeoutMs` elapses
- **WHEN** the race settles
- **THEN** the timeout's pending timer SHALL be cleared so it does not remain scheduled for the rest of its duration after the call has already settled

---

### Requirement: Retry on Missing Reply

The system SHALL retry when an ACP agent completes without calling the `send-reply` skill, enriching the retry prompt with the session's recent permission-rejection reasons (tool name, reason, and the rejected command/path) so the Agent can correct course instead of guessing why its actions were blocked.

#### Scenario: Retry on end_turn without reply
- **GIVEN** the agent completes a prompt turn (`stopReason === "end_turn"`) without sending a reply
- **WHEN** the retry threshold has not been reached
- **THEN** it SHALL clear reply state, send a retry prompt on the same ACP session, and check for a reply again

#### Scenario: Retry strategy for OpenCode
- **GIVEN** agent type `"opencode"`
- **WHEN** `getRetryPromptStrategy()` is called
- **THEN** it SHALL return `maxRetries: 1`

#### Scenario: Retry prompt includes recent permission rejections
- **GIVEN** the session recorded one or more permission rejections (e.g. a `write` of `$TMPDIR/$SESSION_ID/reply.md` rejected with reason `rejected_unknown`, or a `bash` command rejected with reason `rejected_generic_command_first_token_not_allowed`) before the agent ended its turn without replying
- **WHEN** the missing-reply retry prompt is assembled
- **THEN** the prompt SHALL include a section listing each recorded rejection with its tool name, reason, and the rejected command/path, so the agent can correct its behavior

#### Scenario: Rejection records survive across the retry boundary
- **GIVEN** the first prompt turn recorded permission rejections and the turn ended without a reply
- **WHEN** the retry prompt is assembled and the retry prompt is sent via `connector.prompt()` (whose `reset()` runs at prompt start)
- **THEN** the rejection records captured before the retry prompt call SHALL still be present in the retry prompt
- **AND** the records SHALL be cleared only when a new ACP session is created, not by the prompt-level `reset()`

#### Scenario: Every denial path records a rejection
- **GIVEN** a permission denial occurs through any path — legacy free-text flag, generic-command rejection, unauthorized shared-workspace write, disallowed extension, edit/write reject, unknown-tool reject, or `writeTextFile` reject
- **WHEN** the denial is decided
- **THEN** it SHALL record a rejection entry with tool name, kind, rejected command/path, and reason

#### Scenario: Rejection section is bounded and truncated
- **GIVEN** more than 10 rejections were recorded, or a recorded command/path string is very long
- **WHEN** the retry prompt section is assembled
- **THEN** the section SHALL include at most 10 entries, each field SHALL be truncated to a bounded length, and the whole section SHALL respect a character cap so the prompt cannot be inflated or re-injected verbatim with oversized content

#### Scenario: Rejection fields are sanitized against control characters
- **GIVEN** an agent-influenced rejection field (tool title, kind, or command/path) containing control characters (e.g. `\n`, `\r`, `\u0000`) or a very long value
- **WHEN** the rejection is recorded for retry-prompt feedback
- **THEN** the field SHALL be stored with control characters stripped and bounded to the per-field length (truncation marker included), so the diagnostic section cannot be re-injected with agent-influenced formatting or prompt-structure characters

#### Scenario: A single denial records a single rejection entry
- **GIVEN** a permission denial caused by a disallowed write extension
- **WHEN** the denial is decided
- **THEN** it SHALL record exactly one rejection entry with the specific cause (e.g. `rejected_write_extension`), and SHALL NOT also record the generic `rejected_edit_write` cause for the same request

#### Scenario: Retry prompt without rejections stays concise
- **GIVEN** no permission rejections were recorded for the session
- **WHEN** the missing-reply retry prompt is assembled
- **THEN** the prompt SHALL contain the standard guidance and SHALL NOT include an empty rejection-reason section

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

The `ChatbotClient` SHALL extract thought text from `agent_thought_chunk` session updates by checking both the `update.content` envelope format and the `update.text` direct string format, and SHALL include the extracted text in the log message template so it appears in the top-level `log_processed_message` field.

#### Scenario: Per-chunk logs suppressed by default
- **WHEN** an `agent_thought_chunk` session update is received and `logging.agentStreamChunks` is unset or false
- **THEN** the system SHALL NOT emit a per-chunk `Agent thought: {text}` DEBUG log
- **AND** the chunk SHALL still be appended to the thought buffer for the complete-thought summary

#### Scenario: Per-chunk logs enabled for debugging
- **WHEN** `logging.agentStreamChunks` is true and an `agent_thought_chunk` or `agent_message_chunk` update is received
- **THEN** the system SHALL emit the corresponding DEBUG log with the 100-character truncated text, as before

#### Scenario: Thought chunk with content envelope format (old)
- **WHEN** an `agent_thought_chunk` session update is received with `update.content.type === "text"`
  and `update.content.text` containing the thought text
- **THEN** the system SHALL extract the text from `update.content.text` and truncate it to 100
  characters for both the gated DEBUG log and the thought buffer

#### Scenario: Thought chunk with direct text format (new)
- **WHEN** an `agent_thought_chunk` session update is received with `update.text` as a string (and
  `update.content` is absent or not of type `"text"`)
- **THEN** the system SHALL extract the text from `update.text` and truncate it to 100 characters
  for the gated DEBUG log

#### Scenario: Content envelope format takes precedence over direct text
- **WHEN** an `agent_thought_chunk` session update contains both `update.content.text` and
  `update.text`
- **THEN** the system SHALL prefer `update.content.text` as the source of truth for both the gated
  DEBUG log and the thought buffer

#### Scenario: Thought chunk with no extractable text
- **WHEN** an `agent_thought_chunk` session update is received with neither `update.content.text`
  nor `update.text` containing valid text
- **THEN** with chunk logging enabled the system SHALL log `"Agent thought: {text}"` with an empty
  `text`, and the buffer SHALL receive nothing

#### Scenario: Stream-chunk logging flag configuration
- **GIVEN** no explicit `logging.agentStreamChunks` value is configured
- **WHEN** the client processes agent chunk updates
- **THEN** per-chunk DEBUG logging SHALL default to off (`false`) and SHALL be overridable via the `LOGGING_AGENT_STREAM_CHUNKS` environment variable
- **AND** when enabled, the same flag SHALL gate both the `Agent thought: {text}` and the `"Agent message chunk: {text}"` DEBUG logs, while buffering and the complete-thought/message INFO summaries remain unchanged

#### Scenario: Extracted text in the top-level log field
- **GIVEN** an `agent_thought_chunk` session update with extractable text (content envelope or direct `text` format)
- **WHEN** the client logs the processed update
- **THEN** the extracted text SHALL be included in the log message template so it appears in the top-level `log_processed_message` field

### Requirement: Session-Scoped Connector State

In shared-process mode, `AgentConnector`'s mutable connection-level state (cached `configOptions`, current model ID, idle monitor) SHALL be indexed by ACP session ID so a later session's setup calls cannot clobber the in-flight session's state. A global execution lease SHALL cover the session's entire lifecycle — `newSession`, model/mode/config-option setup, prompt/retry, `session/cancel`, recovery, and cleanup — so at most one session touches the shared connection at a time.

#### Scenario: Later session's config calls don't clobber in-flight session state
- **GIVEN** session A's prompt is in flight on a shared connection and session B is queued
- **WHEN** session B acquires the lease and calls `createSession` / `setSessionModel` / `setSessionConfigOption`
- **THEN** those calls SHALL update only session B's session-scoped state entries; session A's cached `configOptions` and model ID SHALL remain intact

#### Scenario: Lease covers full agent lifecycle
- **GIVEN** a shared connection with one in-flight session
- **WHEN** the in-flight session completes, is cancelled, or requires recovery
- **THEN** the lease SHALL be released only after cleanup (session removal from the pool's active set), and the queued session SHALL acquire it next

### Requirement: Pinned OMP Compatibility Evidence

The integration compatibility report SHALL declare, for each required boundary and relevant subcase, a supported, incompatible or unresolved status backed by exact pinned release/source revision, source mechanism reachability and deterministic fixture evidence.

#### Scenario: Complete supported contract is consumable
- **WHEN** all seven boundaries and subcases have matching pinned source evidence for supported official-executable or trusted-extension entry points
- **THEN** the compatibility assessment SHALL report a permitted source-contract verdict with the exact mechanisms and evidence limits
- **AND** it SHALL leave real-runtime verification unverified pending user observations

#### Scenario: Missing evidence blocks application
- **WHEN** a boundary is absent, unresolved, incompatible, uses a different pin, or claims support solely through an SDK-internal method or mock-defined API
- **THEN** the assessment SHALL return a blocked verdict naming the boundary, reason and evidence still required
- **AND** dependent implementation SHALL NOT proceed through a fallback, fork, pin change or silent scope reduction

#### Scenario: Disproved design requires user decision
- **WHEN** pinned source disproves a selected approved mechanism
- **THEN** the report SHALL record the concrete incompatibility and its counterexample
- **AND** downstream application SHALL remain blocked until an explicit user-approved decision and corresponding source-backed contract revision resolve the conflict

#### Scenario: Hypothetical positive fixtures do not certify native support
- **WHEN** a positive structural/admission fixture uses explicitly hypothetical test-only mechanisms because the actual pinned ledger is blocked
- **THEN** the check SHALL exercise the real contract validator while labeling its input and result synthetic and keeping them separate from source evidence
- **AND** the actual compatibility verdict SHALL remain blocked; complete named blocked fixtures SHALL satisfy P0 acceptance without requiring a passing real pinned ledger or an unsupported native decoder

#### Scenario: All seven boundaries are covered
- **WHEN** the compatibility report is produced for pre-import discovery exclusion, authenticated policy readiness, authoritative approval-record reset, complete destructive intent, restricted-only LSP in both agents, native transport adaptation and critical-skill ownership
- **THEN** each required boundary and its relevant subcases SHALL receive their own declared status and evidence set

#### Scenario: Per-boundary evidence is complete
- **WHEN** a boundary declares a status
- **THEN** the report SHALL state the exact release/source revision, source mechanism reachability, limitations, downstream owner, deterministic fixture evidence and user-owned runtime verification for that boundary and its subcases

#### Scenario: Pinned versions remain fixed
- **WHEN** the report pins the official OMP release
- **THEN** OMP SHALL remain `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode packaging SHALL remain `1.18.21`, and ACP SDK SHALL remain `0.14.1` with client terminal capability false

#### Scenario: Unresolved mechanism blocks application
- **WHEN** any mechanism stays unsupported or unresolved
- **THEN** the report SHALL block downstream application
- **AND** passing mocks SHALL NOT manufacture native support

### Requirement: OMP Pre-Import Discovery Compatibility Contract

The compatibility contract SHALL distinguish exact trusted-extension loading from independent executable custom-tool, plugin, factory, configured-root and dependency discovery. Supported exclusion SHALL occur before unowned module top-level code or factory execution, on initial creation and recovery, and SHALL account for canonical paths, symlinks and workspace-owned dependencies. A post-import lifecycle/tool-name filter SHALL NOT establish this boundary.

#### Scenario: Unowned executable path is excluded before import
- **WHEN** a discovery fixture supplies an unowned custom tool, plugin entry, configured module or dependency escape
- **THEN** the contract validator SHALL reject eligibility before the fixture importer or factory is invoked
- **AND** the ledger SHALL independently identify the native pre-import mechanism or report a blocker

#### Scenario: Extension discovery flag is incomplete
- **WHEN** evidence disables ambient extensions but independent custom-tool or plugin imports remain reachable
- **THEN** the assessment SHALL reject a supported complete-exclusion claim
- **AND** it SHALL preserve the source path showing the unguarded discovery route

### Requirement: OMP Policy Readiness Compatibility Contract

The readiness contract SHALL require an authenticated control result bound to the current process instance, ACP session identity, restricted mode, fresh challenge, policy revision and registry epoch.

#### Scenario: Current authenticated identity is accepted
- **WHEN** a source-backed control-channel fixture supplies a verified result matching all current readiness values after complete initialization
- **THEN** the contract validator SHALL accept readiness only for that matching process and session
- **AND** the fixture result SHALL be labeled adapter evidence rather than native runtime enforcement

#### Scenario: Stale or forged readiness is rejected
- **WHEN** readiness is asserted through chat, unverifiable authentication provenance, a stale challenge/process/session/registry epoch, or a failed or timed-out initialization
- **THEN** the contract validator SHALL reject readiness
- **AND** it SHALL require fresh establishment after new/load/recovery or registry transition without authorizing a prompt fixture

#### Scenario: No supported channel is established
- **WHEN** source inspection cannot establish authenticated channel reachability or exact ACP identity binding
- **THEN** the boundary SHALL remain blocked even if a mock handshake succeeds

#### Scenario: Channel and credential provenance is required
- **WHEN** the contract evaluates readiness support
- **THEN** it SHALL require a supported control channel, trusted credential origin and native-to-ACP identity mapping independent of chat or workspace assertions
- **AND** it SHALL NOT reuse raw platform or Skill API server secrets

#### Scenario: Initial or restarted state is unready
- **WHEN** the process is in an initial, new, load, restart or registry-transition state
- **THEN** readiness SHALL remain unready until all current prerequisites are satisfied
- **AND** a successful session creation or lifecycle completion alone SHALL NOT certify readiness

### Requirement: OMP Authoritative Record Compatibility Contract

The record contract SHALL evaluate effective full approval records using the pinned loader's actual lower-layer, CLI-overlay aggregation, runtime and environment precedence.

#### Scenario: Aggregated reset counterexample is retained
- **GIVEN** lower records contain an unknown-tool grant and reset plus mode CLI files supply null followed by a read mapping
- **WHEN** the source-faithful fixture aggregates CLI overlays before merging lower layers
- **THEN** it SHALL expose the surviving lower-only entry and classify that selected reset recipe as incompatible
- **AND** it SHALL NOT remodel the overlays as separate merge barriers merely to make the fixture pass

#### Scenario: Both modes require full authority
- **WHEN** a restricted fixture retains a lower grant or a YOLO fixture retains project prompt/deny entries
- **THEN** the contract validator SHALL reject authoritative-mode composition with the specific residual entries

#### Scenario: Restricted and YOLO modes keep no residue
- **WHEN** restricted or YOLO mode records are composed
- **THEN** they SHALL NOT retain unintended lower-layer grants, prompts or denials

#### Scenario: Default fallbacks are not authority
- **WHEN** evaluation encounters empty mappings, unknown setting keys or invalid values falling back to defaults
- **THEN** they SHALL NOT be treated as authority

#### Scenario: Null-reset requires preserved reset semantics
- **WHEN** a null-reset is followed by a mode mapping
- **THEN** certification SHALL occur only if source actually preserves reset semantics across the full merge sequence

### Requirement: OMP Complete Destructive Intent Compatibility Contract

The destructive contract SHALL carry trustworthy native operation input, parser/edit-syntax provenance, every operation and target, and a binding to the input that will execute. All deletion targets, move sources and destinations and patch mutation targets SHALL be represented. Native titles or an incomplete permission-location list SHALL NOT authorize a larger operation. Unknown syntax, missing endpoints, incomplete targets and input mismatch SHALL fail closed.

#### Scenario: Complete native-shaped operation is consumable
- **WHEN** a supported native-shaped delete, move or multi-operation patch fixture is completely decoded and bound to execution input
- **THEN** the contract output SHALL enumerate every target including every move endpoint for common policy consumers

#### Scenario: Later destructive target cannot be omitted
- **GIVEN** a native-shaped patch first targets an allowed location and later deletes or moves outside the boundary
- **WHEN** an established supported format/parser completely decodes the fixture for contract evaluation
- **THEN** it SHALL expose the later target and report denial with no mutation attempt
- **AND** first-operation-only native permission locations SHALL NOT be accepted as proof of completeness

#### Scenario: Missing supported decoder is a complete blocked outcome
- **WHEN** the bounded source audit cannot establish supported complete decoding for a native-shaped destructive fixture
- **THEN** the contract SHALL report the named incomplete/incompatible mechanism and authorize zero mutation attempts
- **AND** that blocked fixture SHALL satisfy P0 acceptance without implementing a speculative parser, while downstream normalization/application remains blocked

#### Scenario: Incomplete or mismatched operation is rejected
- **WHEN** a fixture contains a title-only request, missing move destination, unparseable patch or raw-input/execution mismatch
- **THEN** the contract validator SHALL return an incomplete/denied result without authorizing a side effect

### Requirement: Restricted-Only LSP Compatibility Contract

The LSP contract SHALL identify supported mode-scoped suppression of both explicit LSP tools and implicit server startup, including read/edit/write side effects, warmup and lazy cold-start, for OMP and OpenCode restricted execution. Native YOLO SHALL retain its native LSP/tool posture without additional restricted denials. A global OpenCode disable affecting YOLO SHALL NOT be an acceptable restricted-only mechanism.

#### Scenario: Separate native mode evidence is complete
- **WHEN** mode fixtures contain source-backed restricted explicit/implicit suppression and unchanged native YOLO behavior for each pinned agent
- **THEN** the contract validator SHALL accept the mode scope without introducing a YOLO LSP clamp

#### Scenario: Partial or global disable is incompatible
- **WHEN** the candidate hides only the LSP tool, leaves implicit startup reachable, or disables OpenCode YOLO through a global setting
- **THEN** the assessment SHALL reject compatibility and name the uncovered startup path or YOLO scope violation

### Requirement: OMP Native Transport Compatibility Contract

The transport contract SHALL identify supported adaptation reachability for native URL-read text/binary paths, web search and public code/documentation search, including redirects and secondary scraper/provider requests.

#### Scenario: Partial native transport override is rejected
- **WHEN** source-backed route fixtures cover enrichment fetches but binary, alternate-page, redirect or search routes bypass the controlled transport
- **THEN** the assessment SHALL report incomplete adaptation rather than a supported full-transport verdict

#### Scenario: Enforcing adapter decision preserves useful results
- **WHEN** established-route fixtures receive public text/binary/search results and enforcing-egress redirect or secondary requests to private targets
- **THEN** the adapter contract checks SHALL return the permitted public result with attribution while rejecting prohibited hops before their mocked dispatch
- **AND** proxy routing SHALL be explicit and provider failure SHALL remain a failure without fabricated results or unguarded retries

#### Scenario: Explicit unrestricted egress is not redefined
- **WHEN** the operator selects the existing unrestricted-egress posture
- **THEN** the fixture expectation SHALL follow that selected posture rather than impose a newly invented YOLO-only network denial

#### Scenario: Enforcing egress validates every hop
- **WHEN** enforcing egress is configured
- **THEN** every relevant hop SHALL be validated through existing egress rules and the explicitly controlled proxy or transport
- **AND** failures SHALL produce honest errors with no unguarded retry

#### Scenario: Selected egress postures stay distinct
- **WHEN** explicit unrestricted egress or approved provider routing is selected
- **THEN** it SHALL remain distinct from arbitrary tool targets

#### Scenario: Proxy presence is not coverage
- **WHEN** proxy environment variables are present or only a partial native fetch override exists
- **THEN** the contract SHALL NOT accept them as proof of complete native coverage

### Requirement: OMP Critical Skill Ownership Compatibility Contract

The critical-skill contract SHALL map critical identifiers to canonical deployment-owned instruction paths and read-only roots, with authoritative source/collision and current-session resource-generation evidence. Workspace/project same-name content and escaping symlinks SHALL NOT become authoritative. Owned skills SHALL remain discoverable and readable; globally disabling skills SHALL NOT satisfy ownership.

#### Scenario: Owned skill wins safely
- **WHEN** a fixture presents an owned critical skill and same-name workspace/project candidates
- **THEN** the contract output SHALL retain the canonical owned instruction path or report a blocker if native selection cannot enforce that ownership

#### Scenario: Escaping or stale skill source is rejected
- **WHEN** a critical-skill fixture resolves outside the owned root or uses another session's resource generation after new/load/refresh
- **THEN** the contract validator SHALL reject ownership without authorizing reads or replacing the critical skill by name alone

### Requirement: Stable-First Canonical Model Selection

When the session's latest cached configuration options advertise an option with `category: "model"`, setting the session model SHALL select that stable option and send the agent's canonical advertised value through the stable config-option mechanism. When no such option is advertised, the existing unstable model-setting mechanism SHALL be used unchanged.

#### Scenario: Flat advertised catalog selects the canonical value
- **GIVEN** the session's cached config options include a `category: "model"` option advertising values `["gpt-4o", "claude-sonnet-x"]`
- **WHEN** the session model is set to `"GPT-4O"`
- **THEN** the system SHALL set the model via the stable config-option mechanism with the advertised value `"gpt-4o"`
- **AND** it SHALL NOT call the unstable model-setting method
- **AND** the cached config options SHALL be refreshed from the response

#### Scenario: Grouped model catalog is flattened for matching
- **GIVEN** the `category: "model"` option advertises grouped entries whose nested options include `{ value: "provider/model-A" }`
- **WHEN** the session model is set to `"provider/MODEL-a"`
- **THEN** the match SHALL be found through the flattened group values and the canonical advertised value `"provider/model-A"` SHALL be sent

#### Scenario: Advertised catalog without the requested model is an explicit error
- **GIVEN** the session's cached config options advertise a `category: "model"` option whose flattened values do not contain the requested model ID under any casing
- **WHEN** the session model is set
- **THEN** the call SHALL fail with a descriptive error identifying the requested model and that it is absent from the advertised catalog
- **AND** the system SHALL NOT fall back to the unstable model-setting method
- **AND** the failure SHALL remain isolated to the affected session's error handling

#### Scenario: Stable option absence permits the unstable fallback
- **GIVEN** the session's cached config options contain no option with `category: "model"`
- **WHEN** the session model is set
- **THEN** the system SHALL configure the model via the existing unstable model-setting mechanism exactly as before this change
- **AND** the recorded current model ID SHALL be the requested value

#### Scenario: Selection uses latest cached options, not a creation-time snapshot
- **GIVEN** the config options were refreshed after session creation by a `config_option_update` notification or a config-option response
- **WHEN** the session model is set
- **THEN** model-option discovery and value matching SHALL use the latest cached options

#### Scenario: Canonical value is recorded as the current model
- **GIVEN** the session model was set through the stable config-option mechanism
- **WHEN** the session records the model selection
- **THEN** the recorded current model ID SHALL be the canonical advertised value actually sent

#### Scenario: No model IDs are invented outside the advertised catalog
- **GIVEN** the agent's catalog does not contain the requested model ID under any casing
- **WHEN** the session model is set
- **THEN** the system SHALL NOT rewrite or invent a model ID that the agent's catalog does not contain

### Requirement: Reasoning Value Canonicalization With None/Off Alias

Applying a reasoning effort value SHALL prefer the canonical case-insensitive exact match among the advertised `thought_level` values; when the requested value is `none` and no exact `none` exists, the advertised `off` value SHALL be sent when one is offered, otherwise the existing not-offered skip behavior SHALL apply unchanged. The alias SHALL NOT apply to any other requested value.

#### Scenario: None maps to advertised off
- **GIVEN** the advertised `thought_level` values are `["low", "Off"]` (no exact `none`)
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL send the canonical advertised value `"Off"` and report outcome `applied`

#### Scenario: Exact none wins when advertised
- **GIVEN** the advertised `thought_level` values include both `none` and `off` in any casing
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL send the exact canonical `none` match and SHALL NOT substitute `off`

#### Scenario: Neither none nor off advertised keeps the skip behavior
- **GIVEN** the advertised `thought_level` values are a non-empty list containing neither an exact `none` nor an `off`
- **WHEN** reasoning effort `"none"` is applied
- **THEN** the system SHALL report `skipped_unavailable` with the existing structured warning and SHALL NOT send any value

#### Scenario: Other tokens are never aliased
- **GIVEN** the advertised `thought_level` values include `off` but not `low`
- **WHEN** reasoning effort `"low"` is applied
- **THEN** the system SHALL NOT send `off` and SHALL follow the existing not-offered/passthrough rules unchanged

#### Scenario: Default or empty value is a no-op
- **GIVEN** the reasoning effort value is `default` or empty
- **WHEN** reasoning effort is applied
- **THEN** the value SHALL be a no-op evaluated before any catalog inspection

### Requirement: Load-Response Config Options Cache Restoration

The system SHALL consume the `session/load` response and refresh the session's cached configuration options from its `configOptions` field with the same complete-list replacement semantics as other refresh sources (a nullish list clears the cache). After a successful reconnect-and-resume, the previously set model SHALL be re-established through the same stable-first selection above.

#### Scenario: Load response restores the canonical cache
- **GIVEN** a reconnected agent's `session/load` response includes `configOptions` with a `category: "model"` option
- **WHEN** the session is resumed via session/load
- **THEN** the session's cached config options SHALL equal the load response's options
- **AND** subsequent config-option discovery SHALL use them

#### Scenario: Resumed session re-establishes its model stably
- **GIVEN** the session's previously set model is present in the load-restored `model` catalog
- **WHEN** reconnect-and-resume completes
- **THEN** the system SHALL re-send the canonical advertised model value via the stable config-option mechanism
- **AND** the cache SHALL be refreshed from that response

#### Scenario: Load without config options keeps the unstable path available
- **GIVEN** the `session/load` response carries no `configOptions`
- **WHEN** reconnect-and-resume re-establishes the previously set model
- **THEN** the selection SHALL follow the unstable fallback path, as a session with no advertised stable option

#### Scenario: Model gone from the post-load catalog fails the session in isolation
- **GIVEN** the previously set model is absent from the load-restored `model` catalog
- **WHEN** reconnect-and-resume re-applies the model
- **THEN** the resumption SHALL fail with the explicit catalog-miss error for that session only
- **AND** it SHALL NOT send the model through the unstable method as a second chance

#### Scenario: Reasoning reapplied best-effort after model on resume
- **GIVEN** the caller supplies an active resolved reasoning effort for the resumed session
- **WHEN** reconnect-and-resume completes the model re-establishment
- **THEN** the system SHALL attempt reasoning application through the existing best-effort path and SHALL log its outcome without failing the session

#### Scenario: Model-then-reasoning ordering is preserved on resume
- **GIVEN** reconnect-and-resume re-establishes the previously set model and the caller supplies an active resolved reasoning effort
- **WHEN** the resumed session proceeds to reasoning application
- **THEN** reasoning effort SHALL be applied after the model, because advertised reasoning values depend on the model

#### Scenario: Restoration failure stays isolated to the affected session
- **GIVEN** any step of the model or reasoning restoration fails during reconnect-and-resume
- **WHEN** the failure occurs
- **THEN** the restoration failure SHALL remain isolated to the affected session

### Requirement: Session Config Resolution Shared Surface

The catalog flattening, canonical value resolution, model selection verdict (stable / unstable-fallback / catalog-miss) and reasoning value resolution (including the `none`→`off` alias rule) SHALL exist as one pure module free of connection or IO state, consumed by the connector and available to later session-recovery and pool consumers, so no caller reimplements the matching rules.

#### Scenario: Recovery consumers reuse the same verdicts
- **GIVEN** a later session-recovery or pool path needs the model-selection verdict for a cached option list
- **WHEN** it evaluates the list through the shared resolution surface
- **THEN** it SHALL receive the same `stable` / `unstable-fallback` / `catalog-miss` verdict the connector would
- **AND** no private duplicate of the flattening or matching rules SHALL be introduced

#### Scenario: Resolution is connection-independent
- **WHEN** the resolution functions are called with an option list and a requested value
- **THEN** they SHALL return purely from the inputs without contacting any agent

### Requirement: Contextual ACP Filesystem Path Resolution

The common filesystem helpers SHALL require the requesting ACP session's explicit context and SHALL expand supported legacy session tokens using that context only: structured `$TMPDIR`/`${TMPDIR}` SHALL mean `{session cwd}/tmp`, `$SESSION_ID`/`${SESSION_ID}` SHALL mean the active Skill API session ID, and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` SHALL mean the explicitly configured shared workspace.

#### Scenario: Legacy and absolute staging paths agree
- **GIVEN** a session with cwd `/data/user`, Skill API ID `skill-a`, and staging `/data/user/tmp/skill-a`
- **WHEN** equivalent absolute, `$TMPDIR/$SESSION_ID/payload.md`, `${TMPDIR}/${SESSION_ID}/payload.md`, and `tmp/skill-a/payload.md` paths are resolved
- **THEN** they SHALL return the same normalized session path `/data/user/tmp/skill-a/payload.md`
- **AND** a process TMPDIR under another mode or pool SHALL NOT affect that result

#### Scenario: Unknown or absent context fails without fallback
- **WHEN** the requesting ACP ID lacks a matching context, a referenced token value is absent, or the path contains `$TMPDIR2`, `$SESSION_ID2`, `$OTHER` or `${OTHER}`
- **THEN** the helper SHALL return a specific failure without a successful target
- **AND** a literal directory matching an unresolved token SHALL NOT make the request eligible

#### Scenario: Relative path ignores daemon cwd
- **GIVEN** the daemon cwd differs from the session cwd
- **WHEN** `notes.md` is resolved for that session
- **THEN** the resulting normalized path SHALL be under the session cwd and SHALL NOT be derived from the daemon cwd

#### Scenario: Unbraced tokens respect variable-name boundaries
- **WHEN** a path contains a name such as `$TMPDIR2` or `$SESSION_ID2` that merely starts with a supported token
- **THEN** unbraced expansion SHALL respect variable-name boundaries and SHALL NOT treat that name as the supported token

#### Scenario: Unsafe path forms fail closed without shell or environment grants
- **WHEN** a path relies on shell expansion, another session's fallback context, process-environment grants, unresolved variable syntax, empty/NUL segments, or URI/device references
- **THEN** the helper SHALL fail closed with the applicable specific failure and no successful target
- **AND** it SHALL NOT execute shell expansion, consult that fallback context, or derive grants from the process environment

#### Scenario: Normalized context path is the downstream target
- **WHEN** a request path is resolved against the session context
- **THEN** the normalized contextual path SHALL be the downstream target, not a differently interpreted raw input

### Requirement: Canonical ACP Session Root Identity

The helpers SHALL expose the configured and canonical root identity for the requesting workspace: the exact canonical Skill API staging location, the optional shared Agent workspace, and the independently trusted read-only skills root.

#### Scenario: Lazy staging has a concrete physical anchor
- **GIVEN** the workspace exists but its own `tmp/skill-a` directory does not
- **WHEN** session roots are observed
- **THEN** the helper SHALL return prospective staging anchored to an existing canonical workspace directory with the ordered missing suffix
- **AND** it SHALL NOT create any directory or authorize a process temporary root instead

#### Scenario: Staging alias cannot change session ownership
- **WHEN** `tmp/skill-a` or its parent links to `tmp/skill-b`, an ordinary workspace directory, or a process-state root rather than the exact canonical session payload location
- **THEN** root construction SHALL fail with a specific identity/containment reason
- **AND** that alias SHALL NOT become a staging grant

#### Scenario: Canonical root alias preserves identity
- **GIVEN** a trusted caller supplies a host-provisioned workspace root alias resolving to an existing directory
- **WHEN** its root identity is constructed
- **THEN** the output SHALL include both configured and canonical paths and observed identity
- **AND** later request symlinks SHALL NOT establish additional roots

#### Scenario: Configured roots exist, optional roots grant nothing
- **GIVEN** workspace, shared or skills roots are configured for the requesting workspace
- **WHEN** session root identity is constructed
- **THEN** configured roots SHALL resolve to existing directories, absent optional roots SHALL grant nothing, and configured-but-invalid roots SHALL fail

#### Scenario: Staging identity is workspace-derived
- **WHEN** the canonical staging identity is exposed
- **THEN** it SHALL correspond to `{canonical workspace}/tmp/{active Skill API ID}`
- **AND** it SHALL NOT resolve to a sibling session, ordinary workspace alias or process-state directory

#### Scenario: Process and state roots grant no authorizing roles
- **WHEN** a process TMPDIR or state directory is observed during root construction
- **THEN** it SHALL NOT create an additional authorizing role

#### Scenario: Observations carry generation and available identity only
- **WHEN** session roots are observed
- **THEN** observations SHALL carry the session/context generation and available filesystem identities
- **AND** they SHALL NOT invent unavailable metadata

### Requirement: Canonical ACP Existing and Prospective Target Decisions

The helpers SHALL classify a target's physical membership with equal-or-separator containment against each applicable root and SHALL return the canonical destination, target type, root-relative destination and observed identity for existing members.

#### Scenario: Existing and nested new targets expose actionable observations
- **WHEN** an existing regular file and a new nested file under an applicable root are observed
- **THEN** the existing result SHALL expose its canonical root-relative target and identity
- **AND** the new result SHALL expose the nearest existing canonical directory ancestor and complete ordered missing suffix without performing protected IO

#### Scenario: Escaping parent and final symlinks are rejected
- **WHEN** a parent-directory or final-file link reaches an external path or sibling workspace, including a same-string-prefix sibling
- **THEN** it SHALL NOT receive workspace membership and SHALL return a specific escape failure if no independent applicable role succeeds
- **AND** lexical prefix containment SHALL NOT override the physical decision

#### Scenario: Narrow staging membership cannot be laundered
- **GIVEN** a valid session staging root contains a child link to another session's staging or an ordinary directory inside the same user workspace
- **WHEN** that target is classified
- **THEN** it SHALL NOT receive the requesting session's staging role
- **AND** any independently valid broad workspace role SHALL be returned separately rather than converted to restricted staging authorization

#### Scenario: In-root symlink resolves to canonical destination
- **WHEN** all observed links for a candidate role stay inside that same root
- **THEN** the result SHALL identify the canonical destination, applicable physical roles and observed symlinks
- **AND** it SHALL NOT imply that ordinary raw-path filesystem IO is safe

#### Scenario: Dangling link or metadata failure is not a prospective target
- **WHEN** lstat observes a link with a missing destination, a loop, a non-directory parent, a denied metadata operation or an inconsistent object that disappears before canonicalization
- **THEN** the helper SHALL return the applicable dangling-link, loop, type, canonicalization or path-changed failure
- **AND** it SHALL NOT downgrade the failure to new-file success

#### Scenario: Existing-only requests fail when absent
- **WHEN** an existing-only request targets an absent path
- **THEN** the helper SHALL fail rather than treat it as a prospective new-file target

#### Scenario: Special nodes and expectation mismatches fail
- **WHEN** a target is a special node or its type contradicts the requested file/directory expectation
- **THEN** the helper SHALL fail with a specific failure

#### Scenario: Escaping links gain no cross-root authority
- **WHEN** an observed parent or final symlink leaves a candidate root and reaches a different otherwise allowed root
- **THEN** the link SHALL NOT gain authority from that other root's allowance
- **AND** every observed parent or final symlink traversal SHALL remain within the same applicable root to receive that root role

#### Scenario: Raw link spelling is not proof of safe access
- **WHEN** contained links are recorded as canonical observations for a candidate role
- **THEN** their raw spelling SHALL NOT be reopened as proof of safe access

### Requirement: Trusted Read-Only ACP Skills Root Identity

The skills-root helper SHALL consume deployment-owned canonical source/root identity from the predecessor critical-skill compatibility contract and SHALL NOT trust a directory by name, by workspace contents or as an arbitrary model-supplied location.

#### Scenario: Owned skill instruction is readable as an observation
- **GIVEN** a deployment-owned read-only root and a matching canonical current-generation instruction reference
- **WHEN** the instruction target is observed within that root
- **THEN** the result SHALL include the trusted read-only role and canonical owned instruction identity
- **AND** no mutation authority SHALL be created

#### Scenario: Skill name collision or external link is not trusted
- **WHEN** a same-name workspace file, escaping owned-root link, stale resource generation, mismatching instruction path or writable-root overlap is supplied as a trusted reference
- **THEN** the helper SHALL return the specific ownership/containment/overlap failure
- **AND** it SHALL NOT substitute a same-name file or globally disable skills to claim success

#### Scenario: Critical references match contract path and generation
- **WHEN** an explicit critical reference is resolved against the skills root
- **THEN** it SHALL match the contract's canonical instruction path and the current session resource generation

#### Scenario: Skills root is disjoint, read-only and non-escaping
- **WHEN** the canonical skills root is established
- **THEN** it SHALL be disjoint from writable workspace/shared roots and SHALL grant only a read-only role
- **AND** a skills-root link leaving that owned root SHALL fail trusted membership even if its destination lies within another readable root

#### Scenario: Trust decisions certify no native support or policy change
- **WHEN** the helper reaches trusted read-only identity decisions
- **THEN** those decisions SHALL NOT certify native OMP selection/discovery support, change unrelated workspace read-extension policy, or introduce a skills write exception

### Requirement: Fail-Closed ACP Root Observation and Evidence Limits

All context/root/target helpers SHALL return either one complete successful observation or one finite specific failure, and SHALL NOT return a partial successful grant, an empty root or a lexical fallback.

#### Scenario: Canonicalization error fails closed
- **WHEN** an applicable root or target metadata operation raises an error other than confirmed absence permitted by new-file semantics
- **THEN** the helper SHALL return a named failure with no successful target or lexical authorization fallback
- **AND** it SHALL perform no protected read-content or mutation operation

#### Scenario: Replacement does not become a race-proof claim
- **WHEN** a deterministic test changes a root, ancestor or final target between metadata observations
- **THEN** detectable inconsistency SHALL produce path-changed failure or the newly observed containment decision
- **AND** successful prechecks SHALL remain operation-scoped observations requiring the dependent secure access layer to preserve containment through actual IO

#### Scenario: Native YOLO keeps broad containment observations
- **GIVEN** a target physically inside the user workspace or shared Agent workspace, including another state file already inside that broad workspace
- **WHEN** a native YOLO consumer requests physical membership
- **THEN** the helpers SHALL expose its broad role without imposing restricted staging-only, extension, LSP, command or tool clamps
- **AND** external escapes SHALL remain ineligible; no claim SHALL be made about native execution paths that do not use ACP callbacks

#### Scenario: Passing helper tests does not clear compatibility blockers
- **WHEN** temporary-filesystem or synthetic contract fixtures pass while the actual P0 source verdict remains incompatible or unresolved
- **THEN** the helper evidence SHALL remain local decision evidence only
- **AND** downstream application SHALL remain blocked under the predecessor compatibility contract without manufactured native support

#### Scenario: Failures carry one distinguished category
- **WHEN** an observation fails
- **THEN** the helper SHALL distinguish the category among invalid context/path/token, invalid/unavailable/overlapping root, outside-root/link escape, dangling/looping link, missing object, wrong type, canonicalization failure, changed path and trusted identity mismatch

#### Scenario: Observations are scoped and not reusable
- **WHEN** a successful observation is returned
- **THEN** it SHALL be scoped to the exact session/context generation
- **AND** it SHALL NOT be treated as a reusable permission or race-proof access guarantee

#### Scenario: Secure access remains a separate dependent change
- **WHEN** a successful observation is consumed by its caller
- **THEN** secure access through the actual operation and client sink adoption SHALL remain separate dependent changes

#### Scenario: Tests use real helper logic without native claims
- **WHEN** observation and failure behavior is tested
- **THEN** tests SHALL use real helper logic with temporary filesystems or deterministic metadata mocks only
- **AND** they SHALL NOT claim native OMP enforcement
- **AND** unsupported predecessor source boundaries SHALL remain blockers regardless of helper mocks

### Requirement: Scoped Agent State Selectors Are Not Granted By Configuration Acceptance

Passing `XDG_DATA_HOME` in the base allowlist SHALL be understood as the existing OpenCode tool-output scoping mechanism (the factory always sets the value it passes), not as an approval for an OMP process to inherit deployment state selectors. Scoped OMP process state (`PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent`, mode-distinct state roots) SHALL be established by the owned-settings and spawn changes, and no requirement in this delta SHALL be read as deciding it.

#### Scenario: Inherited selector is not an OMP state grant
- **GIVEN** agent type `omp` and a filtered environment that carries `XDG_DATA_HOME` from the factory-set value
- **WHEN** a reviewer or downstream change evaluates whether OMP scoped state is established
- **THEN** the presence of the variable SHALL NOT be treated as scoped OMP state
- **AND** the scoped-state requirement SHALL remain owned by the owned-settings and spawn changes

### Requirement: Secure ACP Canonical Observation Consumption

Protected filesystem access SHALL consume the requesting session's current canonical root and target observations and one explicitly selected applicable root role, requiring exact session/context generation, valid canonical root-relative components and usable exact filesystem identities; access through a trusted-skills root SHALL be read-only.

#### Scenario: Selected staging authority cannot broaden
- **GIVEN** a target observation has independent workspace and staging roles
- **WHEN** a caller selects staging for an operation
- **THEN** access SHALL be bounded by that exact staging root's identity
- **AND** failure SHALL NOT retry under the broader workspace role

#### Scenario: Stale or incomplete observation is denied
- **WHEN** the observation belongs to another session/generation, lacks the selected role, contains invalid relative components, or lacks an exact usable root/target identity
- **THEN** access SHALL return one specific context, containment or identity failure
- **AND** it SHALL NOT perform protected content IO with a partial or guessed observation

#### Scenario: Trusted instruction content remains read-only
- **GIVEN** current predecessor-owned canonical skill identity and a valid trusted-skills role
- **WHEN** a caller reads the instruction through protected access
- **THEN** the instruction text SHALL be eligible for the same secure read operation
- **AND** a write selecting that role SHALL fail without mutation, including for a caller otherwise using broad YOLO permissions

#### Scenario: Successful observation does not authorize reinterpretation
- **GIVEN** a caller holds a successful canonical observation
- **WHEN** access would re-expand the original raw path, consult process environment or substitute another session
- **THEN** access SHALL operate only on the consumed canonical root-relative components and exact identities
- **AND** a successful canonical observation SHALL NOT be interpreted as permission

#### Scenario: Callback adoption and authorization remain dependent sinks
- **WHEN** a caller expects client callback adoption or per-mode/extension authorization as part of secure access
- **THEN** those SHALL remain covered by the separate dependent authorization change
- **AND** this requirement SHALL NOT be described as covering that sink

### Requirement: Root-Relative No-Follow ACP Content Access

Protected reads and writes SHALL establish an identity-checked canonical root capability and resolve the actual file beneath the explicitly selected root through a supported no-follow/root-relative mechanism, and SHALL reject request-time directory and final-file symlinks, including contained links, at the initially supported backend.

#### Scenario: Existing regular file is read and overwritten securely
- **GIVEN** an existing regular file under the selected root with matching observed identity
- **WHEN** protected access reads its UTF-8 text or overwrites it with new text
- **THEN** the returned/readback bytes SHALL match the requested operation, including empty and multibyte text
- **AND** an existing overwrite SHALL retain the opened file's identity rather than introduce a temp-file replacement protocol

#### Scenario: Canonical root alias cannot redirect IO
- **GIVEN** an owned configured root alias was observed resolving to a canonical directory
- **WHEN** that alias changes before access but the observed canonical directory is unchanged
- **THEN** the operation SHALL address the observed canonical root identity, not the changed alias destination
- **AND** a replacement of the canonical directory itself SHALL fail its identity check

#### Scenario: Parent and final symlinks cannot redirect content
- **WHEN** an observed or raced-in parent/final link targets an external path, sibling staging/workspace, another allowed root or an internal destination
- **THEN** access SHALL return the specific unsafe-traversal/containment failure without reading or mutating through that link
- **AND** external and sibling sentinel content SHALL remain unchanged

#### Scenario: Broad role does not add restricted policy
- **GIVEN** a caller independently selects an applicable broad workspace or shared role for an in-root file
- **WHEN** secure access is requested
- **THEN** the access mechanism SHALL preserve that physical boundary without adding staging-only, extension, LSP, command or tool denials
- **AND** it SHALL NOT claim to constrain native execution that bypasses ACP callbacks

#### Scenario: Newly introduced symlinks cannot redirect opened content
- **WHEN** a symlink is introduced or changed after secure opening beneath the selected root
- **THEN** content reads, truncation and writes SHALL use the same validated regular-file object that was securely opened, never a later path-based reopen
- **AND** the newly introduced symlink SHALL NOT redirect actual IO

#### Scenario: Precheck and confinement shortcuts are not equivalent
- **WHEN** resolution is attempted with ordinary realPath/lstat prechecks, final-component no-follow alone or optional subprocess confinement
- **THEN** those SHALL NOT be considered equivalent guarantees to the supported no-follow/root-relative mechanism
- **AND** a host-provisioned root alias SHALL remain usable only through its observed canonical root identity

### Requirement: Secure ACP Existing and New File Mutation Semantics

An existing overwrite SHALL securely open without truncation or create fallback, verify regular-file type and observed identity, then truncate and write that same opened object.

#### Scenario: Replacement file is not truncated
- **GIVEN** a regular file was observed for an existing overwrite
- **WHEN** it is replaced with a different regular file before the actual open/identity check
- **THEN** access SHALL report path-changed failure before truncation or writing
- **AND** the replacement file's bytes SHALL remain unchanged

#### Scenario: Exclusive new file creation succeeds
- **GIVEN** a prospective final file has one missing filename beneath an existing observed directory path and an existing selected root
- **WHEN** secure creation writes the supplied text
- **THEN** exactly that new regular file SHALL contain the supplied UTF-8 text under the selected root
- **AND** no directory SHALL be created as a side effect

#### Scenario: Raced-in new-file entry is denied
- **GIVEN** a prospective final file was observed absent
- **WHEN** another actor installs a regular file or symlink before exclusive creation
- **THEN** access SHALL fail without overwriting the installed entry or following its destination
- **AND** it SHALL NOT downgrade to an existing-file overwrite

#### Scenario: Lazy directories are an explicit failure
- **WHEN** the selected root is prospective or a new target requires one or more missing parent directories
- **THEN** access SHALL return unavailable-root or parent-missing failure without mkdir or partial directory creation
- **AND** the predecessor observation SHALL remain prospective rather than being rewritten as an authorizing root

#### Scenario: Invalid target and partial mutation remain honest
- **WHEN** a target is a directory/special node or a descriptor content operation fails
- **THEN** access SHALL return a specific type or IO failure and release its operation resources
- **AND** it SHALL perform no content mutation for a type denial and SHALL NOT claim rollback of bytes already safely written before an IO failure

#### Scenario: Creation requires a complete existing path
- **GIVEN** a caller requests secure creation of a new file beneath the selected existing root
- **WHEN** the final filename is absent but its complete directory path already exists
- **THEN** creation SHALL be exclusive so that a raced-in entry cannot be overwritten
- **AND** creation SHALL NOT occur when the complete directory path is missing or the root is prospective

#### Scenario: Partial mutation is reported honestly
- **WHEN** a content-IO failure occurs after a safely opened mutation has begun
- **THEN** the operation SHALL report failure rather than fabricate success
- **AND** the primitives SHALL NOT promise atomic replacement or rollback, so partial in-root content may remain

### Requirement: ACP Filesystem Replacement and Resource Failure Behavior

Detectable root, observed ancestor or final-object identity mismatch before the relevant content step SHALL fail closed; resolution that cannot establish containment, stale observations, disappearance or unexpected existence SHALL produce one bounded failure without automatic retry or ordinary path-IO fallback.

#### Scenario: Escaping replacement before open fails without side effect
- **WHEN** a test replaces the root, an ancestor or final file with an escaping link between observation and the actual constrained open
- **THEN** access SHALL fail without protected content IO through the replacement
- **AND** outside/sibling sentinel bytes SHALL remain unchanged and all acquired descriptors SHALL be released

#### Scenario: Validated descriptor cannot be redirected by path replacement
- **GIVEN** a regular file has already been securely opened and its identity verified under the selected root
- **WHEN** another actor replaces the pathname before content IO
- **THEN** content IO SHALL stay bound to the original opened object and SHALL NOT read or overwrite the replacement object
- **AND** documentation/tests SHALL identify this as descriptor binding, not universal replacement detection or namespace freezing

#### Scenario: Resolver or identity failure does not authorize fallback
- **WHEN** containment resolution reports a race/escape or an observed identity differs from the opened object's exact identity
- **THEN** access SHALL return its named path/containment failure before protected content IO
- **AND** it SHALL NOT retry under another root, recreate a disappeared existing file or invoke ordinary path-based read/write

#### Scenario: Short IO and cleanup errors are not false success
- **WHEN** native IO returns a short read/write, zero-progress write or failure, or cleanup itself fails
- **THEN** the operation SHALL either complete the requested byte transfer or return an honest bounded IO failure
- **AND** it SHALL attempt cleanup of every acquired operation resource without changing the primary failure to success

#### Scenario: Guarantee is descriptor binding, not namespace freezing
- **GIVEN** a securely opened inode is later renamed, unlinked, concurrently edited or path-replaced
- **WHEN** the guarantee is characterized in documentation or tests
- **THEN** it SHALL NOT be described as freezing the filesystem namespace, rejecting every possible in-root rename, revoking the already opened inode after external rename/unlink, preventing concurrent same-inode content edits or providing transactional rollback
- **AND** successfully opened identity-checked root/file objects SHALL remain the operation authority through actual descriptor IO

#### Scenario: Resources are released and diagnostics stay non-sensitive
- **WHEN** protected access completes or fails
- **THEN** all acquired resources SHALL be released on success and failure
- **AND** raw exception content, secrets and file contents SHALL NOT be emitted as access diagnostics

### Requirement: Explicit Secure ACP Filesystem Platform Policy

The initially supported secure backend SHALL require Linux little-endian x86_64/aarch64, GNU glibc at an explicitly owned supported system location, Linux constrained-open and descriptor-metadata support, exact usable identities and Deno FFI permission.

#### Scenario: Supported local filesystem uses the actual backend
- **GIVEN** the supported system library, native ABI and constrained-open/metadata capability are actually available
- **WHEN** protected access operates on a local temporary regular file
- **THEN** actual content IO SHALL use the supported backend and yield consumer-visible content/results
- **AND** a mock result alone SHALL NOT establish native capability

#### Scenario: Unsupported or sandbox-denied mechanism fails closed
- **WHEN** the OS/architecture/libc location is unsupported, FFI permission is denied, or the required constrained syscall/metadata is missing or seccomp-denied
- **THEN** access SHALL return the specific platform/capability failure without protected content IO
- **AND** the same denial SHALL apply for OpenCode/OMP and restricted/YOLO callers without an unsafe fallback

#### Scenario: Unsupported platform and missing capability fail closed
- **WHEN** the OS/ABI/libc is unsupported, a required library/symbol/permission is missing, a required syscall is unavailable under seccomp or an identity is unrepresentable
- **THEN** access SHALL fail closed with a bounded supported-platform/capability reason
- **AND** platform/version identification alone SHALL NOT establish syscall availability or prove the filesystem supplies required metadata

#### Scenario: No dynamic module loading or weaker portable fallback
- **WHEN** the supported backend is requested but unavailable, or an agent/workspace-selected native module is offered
- **THEN** the adapter SHALL NOT load agent/workspace-selected native modules, introduce a compiled/downloaded dependency or fall back to weaker portable access
- **AND** these platform requirements SHALL remain identical regardless of agent type or authorization mode

### Requirement: Secure ACP Access Evidence and Consumer Handoff

Acceptance SHALL exercise the actual access primitives with real canonical-observation logic, temporary filesystem fixtures and deterministic native-boundary mocks, and tests SHALL assert content, unchanged outside/sibling files, specific failures and descriptor ownership rather than source-string or forwarding-only assertions.

#### Scenario: Mocked replacement evidence has a concrete consumer effect
- **WHEN** an instrumented native boundary schedules a real fixture root/ancestor/final swap at an explicit operation boundary
- **THEN** the actual primitive SHALL produce the specified content/failure outcome with unchanged unauthorized sentinel files
- **AND** the evidence SHALL distinguish rejection before IO from descriptor binding after validation

#### Scenario: Local access success does not clear native gates
- **WHEN** unit/temp/mock checks pass while the predecessor source verdict remains incompatible or unresolved
- **THEN** the proposal's access evidence SHALL remain local primitive evidence only
- **AND** downstream application SHALL remain gated; real agent/platform/container/bwrap observations SHALL remain user-owned and unverified

#### Scenario: Documentation declares limits and sink readiness honestly
- **WHEN** the proposal documents supported behavior and its limits
- **THEN** documentation SHALL identify unsupported traversal/platform cases, missing-parent behavior, system-libc/FFI authority and descriptor/partial-IO limits
- **AND** existing callbacks SHALL NOT be described as hardened before the dependent sink cutover

### Requirement: Mode-Separated Owned OMP Settings Content

The system SHALL provide, as pure data and assembly code, deployment-owned OMP settings content for exactly two modes — restricted and native-yolo — each mode's composition SHALL resolve to complete owned settings documents plus owned provider-model and system-prompt assets, and the content SHALL contain no subprocess launch, pool, tool-policy-record, LSP-implementation, or packaging logic.

#### Scenario: Both mode compositions assemble deterministically
- **WHEN** the composition is requested for `restricted` and for `native-yolo`
- **THEN** each SHALL return its complete owned overlay document, ordered overlay paths with the mode document last, owned provider-model asset content, the system-prompt asset mapping, and the supported provider environment key set
- **AND** repeated assembly SHALL produce identical content without reading workspace state

#### Scenario: Workspace layer cannot loosen the pins
- **WHEN** a fixture presents a workspace/project `.omp/config.yml` or a populated global config as hostile lower layers
- **THEN** the composition SHALL record the source-backed neutralization responsibilities (deployment-owned launch cwd preventing project-layer discovery, empty deployment-owned global agent directory, owned overlay paths outside agent-writable roots) as spawn/packaging contracts
- **AND** no requirement in this delta SHALL claim ordering alone removes keys present only in lower layers

#### Scenario: Overlay ordering and environment posture are spawn-change contracts
- **WHEN** a mode composition is produced
- **THEN** it SHALL include ordered `--config` overlay paths placing the mode document last among deployment overlays
- **AND** it SHALL record, as consumer contracts for the spawn change, the deployment-owned `PI_CODING_AGENT_DIR` under the selected process state root, no `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_FILES` inheritance, and the deployment-owned launch working directory

### Requirement: Source-Backed Security Schema Key Validation

Every security-relevant key the owned overlays may set SHALL be a setting registered at pinned official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, and assembly validation SHALL reject any key absent from that pinned schema and any value outside the registered type or enum; unknown keys or invalid values that would fall back to native schema defaults SHALL NOT be treated as protection.

#### Scenario: Unregistered key or invalid value is rejected at assembly
- **WHEN** a fixture overlay document contains an invented key, a case-mismatched enum value, or a key valid in another OMP release but unregistered at the pinned revision
- **THEN** assembly validation SHALL fail naming the key and the pinned-revision reason
- **AND** it SHALL NOT emit a document that relies on native default fallback for a security-relevant field

#### Scenario: Restricted pins are present with registered values
- **WHEN** the restricted overlay document is parsed
- **THEN** it SHALL select an explicit registered non-YOLO approval mode, carry the LSP-disabled pin, disable startup update checking and marketplace auto-update, pin the update channel, and contain a complete provider-disable array
- **AND** it SHALL NOT contain per-tool approval policy records

#### Scenario: Out-of-scope policy keys stay with their owning changes
- **WHEN** owned settings content defines security-policy keys
- **THEN** it SHALL NOT define per-tool approval-policy records, tool-inventory enablement, or MCP/project-disabling policy
- **AND** those keys SHALL remain owned by the restricted tool-policy and transport changes

### Requirement: Authoritative Record Reset Remains an Unresolved Application Gate

The owned-settings composition SHALL model the pinned settings loader's actual merge semantics — all CLI overlay files fold into one mapping before deep-merging over global and project layers, base-only entries survive, and a configured `null` counts as unset — and SHALL expose the record-reset status as unresolved without asserting that a null-reset overlay followed by a mode overlay clears lower-layer approval records.

#### Scenario: Surviving lower records are the expected test result
- **GIVEN** a lower layer with an unknown-tool grant and a read denial, a reset overlay setting the approval record to null, and a mode overlay supplying a read mapping
- **WHEN** the faithful merge model folds the CLI overlays and merges over the lower layer
- **THEN** the test SHALL observe the lower-only grant surviving and the null behaving as unset
- **AND** it SHALL classify the reset-then-mode recipe as not providing record clearance, without remodeling layer order to obtain a different result

#### Scenario: Gate blocks security consumption, not data generation
- **WHEN** the composition is requested while the reset boundary is unresolved
- **THEN** it SHALL return the settings content together with the unresolved gate record
- **AND** downstream security use SHALL require an explicit compatibility-verdict revision and user decision rather than passing unit tests

#### Scenario: Survivability consequence and gate boundary are documented
- **WHEN** documentation and tests describe the merge consequence
- **THEN** they SHALL state that lower-layer grant, prompt, or deny approval records can survive into an OMP process and that the restricted execution-time default-deny policy is the operative boundary while this gate stands
- **AND** they SHALL state that OMP security consumption of these overlays is blocked until the compatibility change records a supported reset mechanism and the user approves it

#### Scenario: No reset certification and no layer reordering
- **WHEN** fixtures, mocks, or tests exercise the reset recipe
- **THEN** no generated content, fixture, or mock SHALL certify a working settings-layer reset
- **AND** no test SHALL reorder merge layers to make a reset recipe pass

### Requirement: OMP Provider and Application Identity Translation

The owned provider assets SHALL express Gemini exclusively as the pinned provider id `google` credentialed by `GEMINI_API_KEY` and OpenRouter credentialed by `OPENROUTER_API_KEY`, SHALL carry the `X-Title: AIr-Friends` application header through the pinned custom-provider header mechanism, and SHALL record any pinned built-in identity header the supported mechanism cannot override as an explicit compatibility item naming its source symbols.

#### Scenario: Provider credentials and ids match the pinned scheme
- **WHEN** the owned provider asset content and environment posture are inspected
- **THEN** Gemini SHALL appear only as provider `google` with `GEMINI_API_KEY`, OpenRouter only with `OPENROUTER_API_KEY`
- **AND** no additional provider credential, profile selector, or platform secret SHALL be required or passed

#### Scenario: Application title preserved and referer divergence recorded
- **WHEN** the OpenRouter header translation is assembled against pinned header-application order
- **THEN** the owned `X-Title: AIr-Friends` value SHALL survive on OpenRouter requests
- **AND** the documentation SHALL record that the pinned built-in `HTTP-Referer` identity cannot be overridden through the supported content path, naming the source symbols, instead of claiming preservation

#### Scenario: No model identifier is baked into owned assets
- **WHEN** every owned overlay and provider asset is scanned for model identifiers
- **THEN** no OpenCode-format or fixed model id SHALL be present
- **AND** a requested model missing from the advertised agent catalog SHALL remain an explicit selection error owned by the session-config change

#### Scenario: Non-preserved identity is recorded, not invented or faked
- **WHEN** the translation encounters a built-in identity header the supported content mechanism cannot override
- **THEN** it SHALL record the exact non-preserved identity element and its source symbols as an explicit compatibility item
- **AND** it SHALL NOT invent a setting or fake preservation through mocks

### Requirement: Compaction, Update Posture, and Prompt Mapping Decisions

The owned content SHALL keep automatic conversation compaction enabled using the pinned native strategy and SHALL document the native pruning/summarization behavioral difference from the existing OpenCode compaction configuration instead of asserting equivalence or inventing an unavailable native field.

#### Scenario: Compaction stays enabled with documented native differences
- **WHEN** the shared deployment content is parsed and the mapping documentation is read
- **THEN** automatic compaction SHALL be enabled in both mode documents
- **AND** the documentation SHALL describe the native strategy's actual methods/triggers and state that the existing prune-style control has no native equivalent, without emitting any invented compaction key

#### Scenario: Update posture disables automatic surfaces honestly
- **WHEN** the update-posture keys are parsed
- **THEN** startup update checking and marketplace auto-update SHALL be disabled and the update channel pinned
- **AND** the documentation SHALL state that the explicit operator update command remains available and that version changes occur only through deliberate image updates

#### Scenario: Prompt override mapping asserts mechanism, not runtime effect
- **WHEN** the prompt mapping is assembled
- **THEN** it SHALL name the supported custom-prompt route, the owned file location under the deployment-owned agent directory, and the explicit-path contract for the spawn change
- **AND** neither the mapping nor any test SHALL claim the override is applied at runtime before the compatibility checklist item is user-verified

#### Scenario: No invented whole-updater kill switch
- **WHEN** the update posture is reviewed
- **THEN** the schema-supported automatic update surfaces SHALL be disabled and the documentation SHALL state that binary version changes remain deliberate deployment actions
- **AND** no key or documentation SHALL invent a nonexistent whole-updater kill switch

#### Scenario: Exact prompt path maps to the custom-prompt mechanism
- **WHEN** the system-prompt mapping is assembled
- **THEN** it SHALL route `/app/prompts/system_prompt_override.md` to the pinned supported custom-prompt mechanism, the owned agent-directory discovered file with the explicit launch-path contract for the spawn change
- **AND** it SHALL record that runtime application and behavioral adequacy under generated native surfaces remain user-verified compatibility items

#### Scenario: Legacy per-file payload prompt mounts need no translation
- **WHEN** the mapping documentation covers the existing pipeline's prompt mounts
- **THEN** per-file payload prompt mounts consumed by the existing pipeline SHALL be documented as requiring no agent-settings translation

### Requirement: Restricted and YOLO Overlay Non-Contamination

Restricted-only pins SHALL appear exclusively in the restricted composition, and the native-yolo composition SHALL select the pinned native YOLO approval mode while carrying only shared deployment content. The native-yolo document SHALL NOT contain per-tool approval records, approval-record resets, the provider-disable array, or any LSP key, so native YOLO remains maximally permissive and no restricted clamp crosses into it.

#### Scenario: YOLO document carries no restricted clamp
- **WHEN** the native-yolo overlay document is parsed
- **THEN** it SHALL contain the native YOLO approval mode and shared deployment pins only
- **AND** it SHALL contain no per-tool approval content, no approval null-reset, no provider-disable entry, and no LSP setting

#### Scenario: Restricted document retains its pins
- **WHEN** the restricted overlay document is parsed
- **THEN** the restricted pin set SHALL be present and the two documents SHALL share only the declared shared deployment key set

### Requirement: Mode-Scoped OMP Spawn Resolution

The agent factory SHALL resolve an OMP spawn mode from the effective permission mode available at spawn (`yolo` false => restricted, true => native-yolo) and SHALL build the launch from the owned-settings composition for exactly that mode. OMP mode selection SHALL occur only at spawn: the ACP session-mode override for agent type `omp` SHALL remain `null` for both YOLO and non-YOLO states.

#### Scenario: Mode resolves once at spawn
- **GIVEN** agent type `omp` and the effective permission mode supplied to the factory
- **WHEN** the base agent configuration is built
- **THEN** exactly one owned-settings mode composition SHALL be consumed for the assembled launch
- **AND** the assembled arguments SHALL carry no mode-selection mutation that could later change the process posture

#### Scenario: Session-mode override stays null for OMP
- **WHEN** `getSessionModeOverride("omp", true)` and `getSessionModeOverride("omp", false)` are evaluated
- **THEN** both SHALL return `null`
- **AND** `getSessionModeOverride("opencode", true)` SHALL continue to return the existing OpenCode YOLO override value

#### Scenario: Native YOLO stays per-mode, never process-wide
- **WHEN** a native-yolo OMP process would also serve restricted sessions
- **THEN** the factory SHALL NOT apply native YOLO as a process-wide toggle on that process
- **AND** the OpenCode session-mode switching behavior SHALL remain unchanged

### Requirement: Restricted OMP Launch Argument Assembly

For restricted mode the factory SHALL produce command `omp` with subcommand `acp`, the `--no-extensions` flag, the ordered owned `--config` overlay arguments (shared content first, restricted mode document last, owned provider-model overlay included), the exact `--trusted-extension` argument with the contracted owned module path, and the `--system-prompt` argument with the owned prompt path.

#### Scenario: Restricted arguments are complete and flag-clean
- **WHEN** the factory assembles a restricted `omp` launch
- **THEN** the arguments SHALL contain `acp`, `--no-extensions`, the restricted composition's ordered `--config` files with the restricted mode document last, one `--trusted-extension` argument with the contracted module path, and one `--system-prompt` argument with the owned prompt path
- **AND** no yolo/auto-approve flag SHALL appear in the arguments

#### Scenario: Approval mode is consumed, not re-derived
- **WHEN** the restricted composition pins the native non-YOLO approval mode
- **THEN** the factory SHALL pass the overlay file carrying that pin without re-deriving, overriding, or duplicating the approval mode anywhere else in the launch

#### Scenario: Approval mode is sourced from the restricted pin only
- **WHEN** the restricted launch is assembled
- **THEN** the non-YOLO native approval mode SHALL be carried solely by the restricted composition's pin
- **AND** the factory SHALL NOT pass any yolo or auto-approve flag, or rely on an implicit native default

### Requirement: Native-YOLO OMP Launch Assembly Without Restricted Clamps

For native-yolo mode the factory SHALL produce a separate `omp acp` launch whose configuration comes exclusively from the native-yolo composition (its own overlay files plus the shared provider-model and system-prompt assets), in native YOLO without restricted tool clamps. The assembled native-yolo `--config` file set SHALL be disjoint from the restricted overlay file set.

#### Scenario: YOLO launch carries only its own composition
- **WHEN** the factory assembles a native-yolo `omp` launch
- **THEN** every `--config` argument SHALL resolve to a file of the native-yolo composition or the shared owned assets
- **AND** no restricted mode document path SHALL appear

#### Scenario: Mode argument sets cannot intersect
- **WHEN** both mode launches are assembled from the same composition module
- **THEN** an assembly-time check SHALL reject any mode overlay file path appearing in both launches
- **AND** the check SHALL fail the spawn rather than silently merge the sets

#### Scenario: No restricted content is inherited
- **WHEN** the native-yolo launch is assembled
- **THEN** the launch SHALL NOT load, reference, or inherit any restricted overlay content, restricted approval records, provider-disable content, or LSP disablement
- **AND** no native-yolo `--config` file SHALL be a restricted mode document

### Requirement: Mode-Distinct OMP Process State Ownership

For OMP launches the factory SHALL set `PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent` with a mode-distinct final segment, SHALL give restricted and native-yolo processes distinct process temporary roots and distinct neutral launch working directories, and SHALL keep mode distinctness independent of pool-key composition. The launch working directory SHALL be a deployment-derived neutral directory, never a user workspace.

#### Scenario: State roots are mode-distinct under identical inputs
- **WHEN** restricted and native-yolo launches are assembled for the same pool key or the same per-spawn workspace
- **THEN** `PI_CODING_AGENT_DIR`, the process temporary root, and the launch working directory SHALL each differ by mode segment
- **AND** neither mode's `PI_CODING_AGENT_DIR` SHALL fall inside the other's

#### Scenario: No profile or XDG selector inheritance
- **GIVEN** the deployment environment defines `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, or `XDG_CACHE_HOME`
- **WHEN** an OMP launch environment is assembled and filtered
- **THEN** none of those variables SHALL be set by the factory or reach the subprocess through the base environment or the sandbox filter

#### Scenario: OMP XDG data home is process-scoped, OpenCode behavior preserved
- **WHEN** the factory sets `XDG_DATA_HOME` for an OMP launch
- **THEN** the value SHALL be under the mode-scoped OMP process state area, never the shared home-rooted default data directory
- **AND** OpenCode launches SHALL continue to receive the existing per-session or per-pool `XDG_DATA_HOME` values unchanged

#### Scenario: Per-spawn process never reuses a state root across modes
- **WHEN** a per-spawn OMP process is launched for one mode and the same spawn identity is reused for the other mode
- **THEN** the second launch SHALL NOT reuse the first mode's state root
- **AND** each launch SHALL receive its own fresh, mode-distinct state root

#### Scenario: Pool-key reuse cannot collapse mode distinctness
- **WHEN** a caller reuses the same pool key across restricted and native-yolo launches
- **THEN** mode distinctness SHALL NOT depend on pool-key composition
- **AND** the two launches SHALL still receive distinct temporary roots, state roots, and working directories

#### Scenario: Neutral working directory yields empty native discovery
- **WHEN** an OMP launch runs from its deployment-derived neutral launch working directory
- **THEN** native project discovery from the working directory's `.omp/` layer SHALL be empty by construction
- **AND** the working directory SHALL never be a user workspace, while per-session ACP working directories SHALL continue to carry user workspace paths

### Requirement: Canonical Payload Staging Independent of OMP Process State

Partitioning OMP process temporary/state roots SHALL NOT move, alias, or condition the canonical Skill API payload staging location. The session staging directory derived from the session workspace SHALL remain the payload-containment authority for OMP spawns exactly as for OpenCode spawns, and no OMP mode-scoped temporary root SHALL participate in payload path resolution or Skill API containment decisions.

#### Scenario: Staging survives state partitioning
- **WHEN** restricted and native-yolo OMP launches are assembled for the same session workspace
- **THEN** the canonical staging location derived from the workspace SHALL be identical for both modes
- **AND** neither launch's `TMPDIR`/`PI_CODING_AGENT_DIR` SHALL alter the staging path the permission gate and Skill API resolve

### Requirement: Immutable Trusted-Extension Path Wiring With Fail-Closed Launch

The factory SHALL reference the owned trusted extension solely through one exported path selector pointing at a deployment-owned, agent-non-writable root, passing that exact path as `--trusted-extension` with no workspace-derived, configuration-derived, or search-based component. If the contracted module path is absent at spawn, the factory SHALL fail the OMP launch and SHALL NOT fall back to an extensionless launch, an unguarded process, or a different agent type.

#### Scenario: Exactly the contracted path is passed
- **WHEN** either OMP mode launch is assembled
- **THEN** `--trusted-extension` SHALL carry the exported contracted path verbatim
- **AND** no argument or environment variable SHALL be able to redirect it

#### Scenario: Absent module fails closed
- **GIVEN** the contracted trusted-module path does not exist in the environment
- **WHEN** an OMP launch is assembled or spawned
- **THEN** the OMP spawn SHALL fail with an explicit error naming the missing trusted module
- **AND** no `omp` process configuration lacking the trusted-extension argument SHALL be returned

#### Scenario: Factory performs no trust decision on module content
- **WHEN** the exported trusted-extension path is passed to an OMP launch
- **THEN** the factory SHALL NOT inspect or make a trust decision on the module's content
- **AND** the module's pre-import exclusion logic, readiness, and packaged checksum SHALL be handled by other changes

### Requirement: OMP Environment and Egress Pass-Through Without New Rules

OMP mode SHALL NOT alter the egress posture: native-yolo and restricted OMP processes SHALL receive the same proxy/sandbox decisions, and no yolo-only network rule SHALL be introduced. The OMP launch environment SHALL be assembled from the approved credential and base categories and SHALL then pass through the existing sandbox pipeline unchanged.

#### Scenario: Filtered OMP environment carries only approved categories
- **GIVEN** environment filtering is enabled and the deployment holds every credential
- **WHEN** an OMP launch environment is filtered
- **THEN** only the approved OMP provider credentials, the base allowlist the factory populated, and permitted shared-process/passthrough variables SHALL remain
- **AND** platform tokens, dashboard credentials, the Skill API server secret, and OpenCode-only provider keys SHALL be absent

#### Scenario: Egress posture is mode-independent
- **WHEN** restricted and native-yolo OMP launches pass through the sandbox manager with the same sandbox configuration
- **THEN** their egress treatment (proxy variables, namespace isolation, or explicit unrestricted opt-in) SHALL be identical
- **AND** neither mode SHALL gain an additional network denial or exemption rule

#### Scenario: Approved category environment assembly passes through the existing pipeline
- **GIVEN** the OMP launch environment is assembled from the OMP supported provider set plus the shared base/passthrough categories
- **WHEN** the assembled environment enters the sandbox pipeline
- **THEN** environment filtering, egress posture resolution, validating-proxy variable composition, filesystem confinement, and network-isolation wrapping SHALL behave identically to existing agent launches
- **AND** per-spawn-only `SESSION_ID` and pool-mode shared-process marker semantics SHALL be preserved

### Requirement: OpenCode Launch Non-Regression

Introducing the OMP launch branch SHALL NOT change the OpenCode launch: command, arguments, environment assembly (including per-session and per-pool `XDG_DATA_HOME`, `TMPDIR`, session/pool markers, credential set, and browser detection), the OpenCode YOLO session-mode switching route, and the sandbox pass-through outcome SHALL remain behaviorally identical, protected by consumer-visible tests.

#### Scenario: OpenCode configuration is byte-stable across the change
- **WHEN** OpenCode restricted and YOLO launches are assembled before and after this change
- **THEN** the assembled command, arguments, environment, and working-directory decisions SHALL be identical
- **AND** the OpenCode YOLO route SHALL continue to rely on the session-mode override rather than launch arguments

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

The AIr-owned trusted extension module SHALL compute, at load time inside the trusted module and before any untrusted executable tool or plugin module can import, a single frozen pre-import exclusion decision covering every discovery/import surface recorded by the pinned compatibility contract.

#### Scenario: Unowned candidate is excluded without import
- **GIVEN** a discovery fixture supplies a workspace-owned custom tool root, a plugin entry, a configured module root, a workspace-owned dependency, or a linked root outside the owned root
- **WHEN** the bootstrap decision is computed
- **THEN** the candidate SHALL appear as an excluded root with its surface id and pinned status
- **AND** the fixture importer spy SHALL record zero import attempts for that candidate

#### Scenario: Extension flag is not claimed as complete exclusion
- **GIVEN** the launch carries the extension-disable flag and the exact owned trusted-module argument
- **WHEN** custom-tool or plugin discovery routes remain reachable at the pin with no supported mechanism
- **THEN** the decision SHALL report those surfaces as blocking with `no-supported-mechanism`
- **AND** the decision SHALL NOT report a complete-exclusion supported verdict

#### Scenario: Decision is frozen per process
- **WHEN** native state changes after module load, including registry or project-layer transitions
- **THEN** the pre-import decision SHALL remain the load-time frozen value and SHALL be re-consulted, not reopened, on subsequent session creation or recovery

#### Scenario: Every pinned surface carries its mechanism and status
- **GIVEN** the pinned compatibility contract records discovery surfaces including native custom-tool discovery roots, plugin entry points, configured module roots, workspace-owned dependencies, symlinked/linked roots, and load/refresh rediscovery
- **WHEN** the frozen pre-import decision is computed
- **THEN** each surface SHALL carry both the mechanism this integration applies and a status of exactly `supported`, `candidate-to-verify`, or `no-supported-mechanism` as recorded at the pinned source revision

#### Scenario: Extension-disability is not generalized to other discovery
- **GIVEN** the extension-disable flag is present in the launch
- **WHEN** custom-tool or plugin discovery surfaces are covered by the decision
- **THEN** the extension-disability surface SHALL NOT be generalized to custom-tool or plugin discovery

#### Scenario: No import or host guard acts as an import boundary
- **WHEN** the bootstrap excludes a candidate without inspecting it
- **THEN** the bootstrap SHALL NOT import the candidate module to inspect its factory, metadata, or name
- **AND** SHALL NOT treat a host guard, preloaded-path input, post-import tool-name filter, or lifecycle allowlist as an import boundary

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

When the required pre-import exclusion cannot be established — a surface with no supported mechanism, a violated owned-module or dependency-closure identity, an owned-root symlink escape, or a contradicted deployment environment posture — trusted-module initialization SHALL fail and the affected session creation or recovery SHALL fail as an ACP request error observable to the client.

#### Scenario: Session creation fails visibly
- **GIVEN** the bootstrap decision contains an unresolved exclusion blocker
- **WHEN** a new session is requested
- **THEN** session creation SHALL reject with an error naming the failing surface id and status
- **AND** no guarded-session state SHALL be registered for that session

#### Scenario: Recovery fails closed identically
- **WHEN** session recovery is requested on a process whose exclusion decision is blocked or whose current selection generation is stale
- **THEN** recovery SHALL fail with the same named-surface error
- **AND** the session SHALL NOT resume with a previously established guard claim

#### Scenario: No silent downgrade path exists
- **WHEN** trusted-module initialization fails
- **THEN** the integration SHALL NOT proceed to launch or reuse an agent process without the trusted module
- **AND** SHALL NOT substitute another agent type or an unguarded fallback

#### Scenario: Failure message is bounded and credential-free
- **WHEN** session creation or recovery fails as an ACP request error
- **THEN** the error SHALL name the failing surface and its status
- **AND** the message SHALL be bounded and free of credentials or file content

#### Scenario: No degraded session shape is produced
- **WHEN** session setup cannot complete under the trusted-module guard
- **THEN** setup SHALL NOT degrade to a partially guarded session, an extensionless or unguarded process, or a different agent type

### Requirement: Exact Owned-Module Trust Scope

Only the module at the contracted deployment-owned path imported from the owned path constants, together with its pinned image-owned dependency closure, SHALL be trusted.

#### Scenario: Identical module outside the owned root is untrusted
- **GIVEN** a workspace, home, or package-cache path holds a copy of the owned module content
- **WHEN** the ownership decision is evaluated
- **THEN** the copy SHALL be excluded with an untrusted-location reason
- **AND** no trusted-extension argument, read exception, or skill authority SHALL be granted to it

#### Scenario: Critical-name match alone confers nothing
- **GIVEN** a discovered candidate is named after a critical skill or critical tool
- **WHEN** trust and critical-name resolution are evaluated
- **THEN** the candidate SHALL remain untrusted and SHALL NOT resolve the critical name
- **AND** the decision SHALL record name-only trust as rejected

#### Scenario: Escaping link out of the owned root is untrusted
- **GIVEN** a symlink or linked package inside the owned root resolves outside its canonical identity
- **WHEN** the ownership decision is evaluated
- **THEN** the candidate SHALL be untrusted with the canonical symlink-escape or identity-mismatch reason
- **AND** ordinary skills and workspace content outside the owned root SHALL remain unaffected otherwise

#### Scenario: Owned-root trust reuses canonical root identity
- **GIVEN** an owned-root path is evaluated for trust
- **WHEN** the ownership decision is computed
- **THEN** trust SHALL reuse the canonical filesystem-root identity decisions
- **AND** SHALL NOT apply a second canonicalizer or a lexical prefix test

#### Scenario: Escape is untrusted despite a readable destination
- **GIVEN** a symlink or linked package inside the owned root leaves the owned canonical root
- **WHEN** the ownership decision is evaluated
- **THEN** the linked module SHALL be untrusted even when its destination is otherwise readable

#### Scenario: Permission mode is not part of owned-module identity
- **WHEN** owned-module identity is evaluated
- **THEN** identity SHALL NOT depend on permission mode

### Requirement: Canonical Critical-Skill Ownership Across New, Load, and Refresh

Critical skill identifiers SHALL resolve only to canonical instruction paths inside the pinned owned skills root, carrying the source identity, collision decision, and current resource generation from the compatibility contract.

#### Scenario: Owned skill wins over same-name workspace content
- **GIVEN** an owned critical skill and same-name project/workspace candidates are both discoverable
- **WHEN** the critical identifier is resolved
- **THEN** the canonical owned instruction path SHALL be selected with its owned read-only root identity
- **AND** the workspace/project candidate SHALL be recorded as excluded from critical-name resolution

#### Scenario: Skills remain enabled while critical resolution is pinned
- **WHEN** ordinary (non-critical) skill discovery is evaluated on the same process
- **THEN** ordinary skills SHALL remain discoverable and usable
- **AND** no global skills disablement or new configuration key SHALL be involved

#### Scenario: Ownership survives load and refresh transitions
- **GIVEN** a session is created, then recovered, then a skill-snapshot/registry refresh replaces the active skills
- **WHEN** the critical identifier is resolved after each event
- **THEN** each resolution SHALL consult the current canonical selection and current resource generation
- **AND** a stale-generation or foreign-session snapshot SHALL be rejected with the contract's stale-resource reason

#### Scenario: Escaping link cannot satisfy a critical identifier
- **GIVEN** a candidate is discoverable only through a link that escapes the pinned owned skills root
- **WHEN** the critical identifier is resolved
- **THEN** the candidate SHALL NOT satisfy the critical identifier

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

The integration SHALL record two named application gates carrying the pinned verdicts verbatim, and while either gate stands, full security consumption of OMP session setup SHALL remain blocked.

#### Scenario: Passing mocks cannot clear a gate
- **WHEN** the exclusion, ownership, and critical-skill decision tests all pass
- **THEN** both gates SHALL still report `unresolved` with their pinned verdict text and a required user decision
- **AND** no test result, fixture, or synthetic positive SHALL be cited as native support

#### Scenario: Gate resolution requires a user decision
- **WHEN** an implementer proposes to close either gate
- **THEN** the change SHALL be blocked until the compatibility contract records a source-backed supported mechanism at the pin and an explicit user decision adopts it
- **AND** the specification SHALL NOT be rewritten to claim support in advance of that decision

#### Scenario: Operative boundary while gated
- **GIVEN** either gate stands open
- **WHEN** restricted execution is assessed
- **THEN** the restricted execution-time default-deny and filesystem authorization boundaries owned by other changes SHALL be documented as operative
- **AND** discovery-side exclusion SHALL be documented as defense in depth rather than a substitute

#### Scenario: Gate verdicts are recorded verbatim
- **WHEN** the two application gates are recorded
- **THEN** the pre-import exclusion gate SHALL carry the pinned verdict "extension flags alone incompatible and the supported full mechanism unresolved"
- **AND** the critical skill ownership gate SHALL carry the pinned verdict "name-only trust incompatible and canonical selection unresolved"

#### Scenario: Automated evidence validates decision logic only
- **GIVEN** automated unit and mock evidence is produced for this change
- **WHEN** that evidence is offered in support of either gate
- **THEN** the evidence SHALL validate decision logic only — which roots, paths, and names would be excluded, and the fail-closed error shape
- **AND** SHALL NOT be presented as evidence that the official executable enforces the exclusion or canonical selection
