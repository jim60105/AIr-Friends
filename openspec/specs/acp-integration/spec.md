# ACP Client Integration

## Purpose

Defines how AIr-Friends acts as an ACP (Agent Client Protocol) Client, spawning the external OpenCode agent subprocess, managing bidirectional JSON-RPC communication, handling permission requests, sandboxing agent processes, and supporting retry, idle timeout, and external MCP server registration.
## Requirements
### Requirement: AgentConnector Subprocess Management

The system SHALL manage the external OpenCode ACP agent lifecycle through the `AgentConnector` class. In per-session mode it SHALL spawn the agent as a subprocess with `dumb-init` for proper signal forwarding and communicate via stdio JSON-RPC. In shared-process mode the connector SHALL connect once per channel and create multiple ACP sessions over the same stdio connection. The subprocess SHALL be spawned with a cleared parent environment (`clearEnv: true`) so it receives ONLY the explicitly-built agent environment and inherits no parent secrets. Every outbound ACP call made through the connection (`initialize`, `createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`, `prompt`, `cancel`) SHALL be raced against a per-subprocess crash signal so that an unexpected subprocess exit rejects any currently pending call instead of leaving it pending forever, regardless of idle-timeout configuration. When a shared process dies while a prompt is in flight, the system SHALL restart the channel process and resume the in-flight session via the ACP `loadSession` method (session history is persisted in the channel-scoped OpenCode data directory and replayed on load), applying controlled recovery: the prompt is re-issued ONLY if no response (reply, reaction, or file send) has been recorded for the session; if a response was already sent, the session completes without re-prompting. When the prompt IS re-issued, the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends) so the resumed agent knows what has already happened and avoids re-doing side effects.

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

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Edit/write requests SHALL be recognized by the ACP tool `kind` (`"edit"` — the kind OpenCode v1.17.13+ sends for its `write`, `edit`, `apply_patch`, and `patch` tools, whose `title` is the target file path) or by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`), so scoped path validation always runs for file-modifying tools instead of falling through to unknown-tool rejection. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and all path boundary checks SHALL be boundary-safe (equal-or-separator-prefixed). Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` is the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14).

Path boundary checks (`isPathAllowed`, `isAgentWorkspacePath`, and the TMPDIR containment check used by the scoped edit/write approval and `writeTextFile`) SHALL expand the session-bound tokens `$TMPDIR`, `${TMPDIR}`, `$SESSION_ID`, and `${SESSION_ID}` — to the resolved session TMPDIR (`{workingDir}/tmp`) and the session id respectively — before the boundary-safe containment check, so a literal `$TMPDIR/$SESSION_ID/...` path (as the agent types it into its edit/write tool) resolves and is approved exactly like the expanded absolute path. Any other `$VAR`-style token SHALL remain unexpanded and SHALL fail containment. Every session flow SHALL set the client config's `sessionId` to the shell session id when a shell session exists (message, spontaneous, self-research, memory-maintenance, channel memory-maintenance, reminder), so the gate expands `$SESSION_ID` consistently with the script-side `--session-id`; flows without a shell session leave it unset (expansion yields an empty string, matching the script-side `{workspace}/tmp` fallback). The canonical expanded path SHALL be the path actually used for file I/O: `readTextFile()` and `writeTextFile()` SHALL read/write the expanded path, not the raw request path, so the path that passed validation is the path that is accessed. When auto-approving a skill command (whitelisted script-path or command-prefix match), the gate SHALL reject — instead of approve — any command whose whitespace-delimited tokens include a legacy free-text skill argument flag in either invocation form (`--message`, `--message=value`, `--content`, `--content=value`, `--query`, `--query=value`, `--caption`, `--caption=value`; distinct tokens such as `--message-id`, `--message-file`, `--content-file`, `--query-file`, `--caption-file` SHALL NOT trigger the rejection), so free-text content can never be smuggled through a shell command line that reaches the gate.

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

In validating-proxy mode, the operator MAY enumerate specific trusted destinations via `agent.sandbox.egressAllowHosts` (default empty). Each entry is a hostname or literal IP (no scheme, no port). The proxy SHALL exempt a destination from the disallowed-range rejection when its requested host matches an allowlist entry exactly (case-insensitive, after trimming and stripping IPv6 brackets), for both CONNECT tunneling and plain-HTTP forwarding; DNS resolution and connect-time address pinning SHALL still apply to allowlisted hostnames. The exemption SHALL NOT extend to the cloud-metadata address space: a resolved address of `169.254.169.254` or an IPv6 metadata equivalent (e.g. `fd00:ec2::254`) SHALL be rejected even when the requested host is allowlisted. Allowlisted hosts SHALL also be appended to the agent's `NO_PROXY`/`no_proxy` so env-honoring clients may connect to them directly. The allowlist SHALL be sourced exclusively from operator deployment configuration — the agent and chat users SHALL NOT be able to extend it at runtime. An empty allowlist SHALL produce behavior identical to the pre-allowlist posture.

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

### Requirement: Egress Proxy Transport Fidelity

The validating egress proxy (`src/utils/egress-proxy.ts`) SHALL relay bytes between the agent and the upstream origin without altering or losing them, and SHALL propagate connection lifecycle events in both directions, so that the mediation layer does not itself become a source of corrupted streams or zombie connections. Specifically: every byte handed to a socket SHALL be flushed even when the underlying `write` performs a short write; end-of-stream on one direction SHALL be forwarded to the peer as a half-close; a transport error SHALL tear down both connections; and forwarded plain-HTTP requests SHALL be rewritten to `Connection: close` semantics.

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

The system SHALL retry when an ACP agent completes without calling the `send-reply` skill. The retry prompt SHALL be enriched with the session's recent permission-rejection reasons (tool name, reason, and the command/path that was rejected) so the Agent can correct course instead of guessing why its actions were blocked. Rejection reasons are collected per session by the `ChatbotClient` on EVERY denial path in `requestPermission()` and `writeTextFile()` (legacy free-text flag, generic-command rejection, unauthorized shared-workspace write, disallowed extension, edit/write reject, unknown-tool reject, writeTextFile reject). The collected records SHALL NOT be cleared by `reset()` (which runs at the start of every prompt, including the retry) — they SHALL be cleared exactly once per logical session when a new ACP session is created, and the retry flow SHALL snapshot them before issuing the retry prompt, so the first turn's rejections are still available at retry time. The rejection section SHALL be bounded (at most 10 entries, per-field truncation, section character cap) and SHALL be framed as diagnostic data rather than instructions; when none were recorded, the section SHALL be omitted entirely. All agent-derived rejection fields (tool name, kind, command/path) SHALL be sanitized at record time — control characters stripped and each field bounded — so the diagnostic section cannot carry agent-influenced formatting into the prompt. Each denial SHALL record exactly one rejection entry with its specific cause (no generic duplicate for the same request).

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

### Requirement: Session-Scoped Connector State

In shared-process mode, `AgentConnector`'s mutable connection-level state (cached `configOptions`, current model ID, idle monitor) SHALL be indexed by ACP session ID, so that a later session's setup calls (`createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`) cannot clobber the in-flight session's state. The global execution lease SHALL cover the session's ENTIRE agent lifecycle — `newSession`, model/mode/config-option calls, prompt/retry, `session/cancel`, recovery, and cleanup — so that at most one session touches the shared connection at a time.

#### Scenario: Later session's config calls don't clobber in-flight session state
- **GIVEN** session A's prompt is in flight on a shared connection and session B is queued
- **WHEN** session B acquires the lease and calls `createSession` / `setSessionModel` / `setSessionConfigOption`
- **THEN** those calls SHALL update only session B's session-scoped state entries; session A's cached `configOptions` and model ID SHALL remain intact

#### Scenario: Lease covers full agent lifecycle
- **GIVEN** a shared connection with one in-flight session
- **WHEN** the in-flight session completes, is cancelled, or requires recovery
- **THEN** the lease SHALL be released only after cleanup (session removal from the pool's active set), and the queued session SHALL acquire it next

