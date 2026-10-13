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

The system SHALL implement the ACP `Client` interface via `ChatbotClient`, handling callbacks from external agents for permissions, session updates, and file operations. File-operation callbacks SHALL resolve the requesting session's authoritative context, decide authorization on canonical physical root/target observations, and perform content IO only through the protected filesystem access operations under the single authorized root role.

#### Scenario: Session update handling
- **GIVEN** an active ACP session
- **WHEN** the agent sends a `sessionUpdate` with message chunks or tool calls
- **THEN** the client SHALL log the activity, update the `lastActivityTimestamp`, and write audit entries if an audit writer is configured

#### Scenario: File read within an authorized physical root
- **GIVEN** a `readTextFile` request whose target is physically inside the session workspace, the shared Agent workspace, or the trusted read-only skills root
- **WHEN** the callback evaluates the request
- **THEN** the client SHALL read and return the file content through the protected access operation under that selected root role, subject to the applicable read rule
- **AND** a target that only lexically resembles an allowed root SHALL be denied

#### Scenario: File write with the shared-workspace extension check
- **GIVEN** a `writeTextFile` request for a shared Agent workspace path with an extension in the `allowedWriteExtensions` list (default: `.md`, `.txt`) and an authorized session
- **WHEN** the callback evaluates the request
- **THEN** the client SHALL write the content through the protected access operation under the shared root role

#### Scenario: File write with disallowed extension
- **GIVEN** a restricted `writeTextFile` request for a shared Agent workspace path whose extension is not in the allowed list
- **WHEN** the write is attempted
- **THEN** the client SHALL reject the write, record the existing extension rejection reason, log the denial, and perform no content IO

#### Scenario: Filesystem capability remains delegated
- **GIVEN** an agent connecting through the ACP client
- **WHEN** session capabilities are advertised
- **THEN** the client SHALL continue advertising filesystem read/write capability so native file operations are routed through these callbacks rather than agent-side IO

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

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation, so scoped path validation always runs for file-modifying tools instead of falling through to unknown-tool rejection.

#### Scenario: Registered skill auto-approval
- **GIVEN** a permission request for a registered skill
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request

#### Scenario: Skill directory read access
- **GIVEN** a permission request to read files inside the deployment-owned trusted skills root
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL auto-approve the request with the existing skill-directory audit reason
- **AND** a read anchored to an unowned HOME-discovered skills copy, a workspace skills directory, an escaping link or a stale resource generation SHALL NOT be auto-approved by this rule

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
- **WHEN** every path-like argument — read input and write/output target — canonically resolves to physical membership in an enumerated command-gate root role for the requesting session, and no code-execution / arbitrary-target flag is present
- **THEN** it SHALL auto-approve the request; and when any path-like argument (input or output) canonically resolves outside those roles — including through a parent-directory or final-file symlink escape, a sibling workspace, or another session's data area — or a tool with a file-reading argument DSL/indirection is used, or a flag such as `-exec`/`-delete`/`--pre` is present, it SHALL reject the request with logging

#### Scenario: Filesystem URI-scheme path argument rejected, network URL allowed
- **GIVEN** a permission request whose argument is a filesystem URI-scheme token such as `file:///etc/passwd` (for example `agent-browser open file:///etc/passwd`)
- **WHEN** `referencesOutOfWorkspacePath()` evaluates the argument
- **THEN** it SHALL classify the token as out-of-workspace and the request SHALL NOT be auto-approved; whereas a network URL argument (`agent-browser open https://example.com`) SHALL NOT be classified as a filesystem escape (its egress is mediated by F14)

#### Scenario: Command laundering via trailing whitelisted path rejected
- **GIVEN** a permission request whose first token is an arbitrary binary and whose trailing argument is a whitelisted script path
- **WHEN** `requestPermission()` evaluates the command tokens
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
- **THEN** it SHALL treat it as a scoped edit/write request and apply the session-root authorization checks instead of rejecting it as an unknown tool call
- **AND** a request of that shape carrying delete/move or multi-operation mutation semantics SHALL be routed through destructive normalization instead of the location-list approval

#### Scenario: Edit/write request with legacy title shape recognized
- **GIVEN** a permission request whose `toolCall` has `title: "edit"`, `title: "edit_file"`, `title: "write"`, or `title: "write_file"` (the shapes older OpenCode versions and other ACP agents may send)
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL treat it as a scoped edit/write request and apply the session-root authorization checks instead of rejecting it as an unknown tool call

#### Scenario: Edit/write within agent workspace requires write permission
- **GIVEN** an edit/write permission request whose target physically resolves under the shared Agent workspace
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request ONLY if the session's `canWriteAgentWorkspace` flag is `true`; otherwise it SHALL reject the request with the existing unauthorized reason and logging

#### Scenario: Edit/write within TMPDIR
- **GIVEN** an edit/write permission request whose target physically resolves under the requesting session's own canonical staging root
- **WHEN** the request is evaluated
- **THEN** it SHALL auto-approve the request regardless of `canWriteAgentWorkspace` and without an extension filter

#### Scenario: Edit/write to an ordinary user-workspace target is rejected in restricted mode
- **GIVEN** a restricted edit/write request whose only applicable physical role is the user workspace, outside the requesting session's staging root
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL reject the request with the specific restricted in-workspace reason
- **AND** the same target SHALL be rejected by the independent write sink even if the permission request were approved by another rule

#### Scenario: Destructive-shaped request is not approved from its location list
- **GIVEN** a restricted delete or move permission request whose locations name only an authorized staging path while the bound raw input also carries an outside-root operation
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL reject with the bounded incomplete-intent or disallowed-target reason and attempt no mutation
- **AND** the request SHALL NOT be decided by the ordinary edit/write location-list approval

#### Scenario: Destructive denial records one bounded reason
- **WHEN** each destructive denial path is exercised once
- **THEN** exactly one bounded, sanitized rejection record SHALL be produced through the existing rejection buffer and audit mirroring, with a static callback error message carrying no file content or raw platform error text
- **AND** the previously documented reasons SHALL retain their meanings

#### Scenario: Edit/write with $TMPDIR/$SESSION_ID tokens approved
- **GIVEN** a session with Skill API id `sess_own` whose staging root is `{session cwd}/tmp/sess_own`
- **WHEN** an edit/write permission request or `writeTextFile` call uses the literal path `$TMPDIR/$SESSION_ID/reply.md` or `${TMPDIR}/${SESSION_ID}/reply.md`
- **THEN** the tokens SHALL be expanded against the session's own context before the authorization check and SHALL be approved
- **AND** a literal path `$TMPDIR2/reply.md` or `$OTHER/reply.md` SHALL remain unexpanded and SHALL NOT be approved

#### Scenario: writeTextFile writes the expanded path
- **GIVEN** a session whose staging root is `{session cwd}/tmp/sess_own`
- **WHEN** `writeTextFile` receives path `$TMPDIR/$SESSION_ID/reply.md` with content `定價 $0.435`
- **THEN** the content SHALL be written verbatim to `{session cwd}/tmp/sess_own/reply.md` through protected access under the staging root role (no literal `$TMPDIR` directory under the bot's cwd)
- **AND** `readTextFile` on the same expanded path SHALL return the verbatim content including the `$` characters

#### Scenario: Boundary-safe path checks reject sibling prefixes
- **GIVEN** a path that shares a string prefix with an allowed root as a sibling (e.g. `/data/workspaces/discord/1234` versus base `/data/workspaces/discord/123`), and a path inside a root that reaches a sibling workspace or external file through a parent or final symlink
- **WHEN** the filesystem authorization decision evaluates either path
- **THEN** it SHALL reject both as outside the authorized root with the mapped bounded reason
- **AND** lexical prefix containment SHALL NOT override the physical decision

#### Scenario: readTextFile extension check
- **GIVEN** a read request for a path physically inside an allowed writable root whose extension is not in the read allowlist (`.jsonl`, `.md`, `.txt`)
- **WHEN** `readTextFile()` evaluates the request
- **THEN** it SHALL reject the read
- **AND** the trusted read-only skills root exception SHALL NOT broaden this workspace rule

#### Scenario: readTextFile allows workspace memory reads
- **GIVEN** a read request for `memory.public.jsonl` physically inside the session workspace
- **WHEN** `readTextFile()` evaluates the request
- **THEN** it SHALL allow the read through the protected access operation under the workspace root role

#### Scenario: Edit/write rejection
- **GIVEN** an edit/write permission request whose target context or canonical observation cannot be resolved
- **WHEN** `requestPermission()` evaluates the request
- **THEN** it SHALL reject the request with logging and the mapped bounded reason, without performing content IO

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

#### Scenario: Destructive-shaped requests route before location-list approval
- **GIVEN** a destructive-shaped request (ACP `delete`/`move` kinds, native delete/move titles, or a multi-operation patch shape)
- **WHEN** the gate evaluates the request
- **THEN** it SHALL route the request through complete destructive-intent normalization and the all-target destructive decision BEFORE the ordinary edit/write location-list approval, and the ordinary location-list approval SHALL NOT be used to decide a destructive-shaped request: a request whose decoded operation set is incomplete or inconsistent with its locations SHALL be denied rather than approved from its first or partial target list

#### Scenario: Restricted gate anchors whitelist, workspace writes, and physical containment
- **WHEN** the restricted gate evaluates command whitelist matches, agent-workspace writes, and file-path containment for the filesystem sinks, the scoped edit/write approval and the destructive decision
- **THEN** command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and file-path containment decisions SHALL be made against canonical physical root membership for the requesting session rather than lexical string containment

#### Scenario: Command-argument canonical check is command policy unchanged by destructive normalization
- **WHEN** the gate's generic-command path-argument check evaluates a command because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`)
- **THEN** `requestPermission()` SHALL remain the authoritative decision point for those commands, and a generic allow-listed command SHALL be approved only when every path argument — input and output — holds canonical physical membership in an enumerated command-gate root role for the requesting session, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace
- **AND** network URL schemes (`http://`/`https://`) SHALL NOT be treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14)
- **AND** this command-argument decision is a command-policy decision of its own and its canonical observation SHALL NOT be represented as race-proof physical containment of the command's native execution; its argument policy is unchanged by destructive normalization

#### Scenario: Filesystem path checks expand session tokens before containment
- **GIVEN** a scoped edit/write approval, a destructive target decision, or a file callback whose path checks reference session-bound tokens
- **WHEN** the checks evaluate the path
- **THEN** they SHALL expand `$TMPDIR`, `${TMPDIR}`, `$SESSION_ID`, `${SESSION_ID}` and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` against the requesting session's own authoritative context — to the session TMPDIR (`{session cwd}/tmp`), the active Skill API session id, and the configured shared Agent workspace — through the shared contextual path-resolution contract before any containment decision, so a literal `$TMPDIR/$SESSION_ID/...` path resolves and is approved exactly like the expanded absolute path
- **AND** an unbraced token SHALL require a variable-name boundary, so `$TMPDIR2`, `$SESSION_ID2`, `$AGENT_WORKSPACE2`, `$OTHER` or `${OTHER}` remain unexpanded and fail
- **AND** relative paths SHALL be anchored to the session cwd, never the daemon cwd, and an unavailable referenced token value SHALL fail rather than expand to an empty string

#### Scenario: Canonical resolved target is the only path handed to protected file IO
- **GIVEN** a file callback approved by the restricted gate
- **WHEN** the content step runs
- **THEN** the canonical resolved target SHALL be the only path handed to protected file IO: `readTextFile()` and `writeTextFile()` SHALL operate on the observed canonical target under an authorized root role, not on the raw request path

#### Scenario: Skill command auto-approval rejects legacy free-text argument flags
- **GIVEN** a skill command matching the auto-approve list (whitelisted script-path or command-prefix match)
- **WHEN** the gate evaluates its whitespace-delimited tokens
- **THEN** the gate SHALL reject — instead of approve — any command whose tokens include a legacy free-text skill argument flag in either invocation form (`--message`, `--message=value`, `--content`, `--content=value`, `--query`, `--query=value`, `--caption`, `--caption=value`; distinct tokens such as `--message-id`, `--message-file`, `--content-file`, `--query-file`, `--caption-file` SHALL NOT trigger the rejection), so free-text content can never be smuggled through a shell command line that reaches the gate

#### Scenario: Edit/write requests recognized by tool kind or legacy title
- **GIVEN** a permission request for a file-modifying tool
- **WHEN** the gate classifies the request
- **THEN** it SHALL recognize it as an edit/write request by the ACP tool `kind` (`"edit"` — the kind OpenCode v1.17.13+ sends for its `write`, `edit`, `apply_patch`, and `patch` tools, whose `title` is the target file path) or by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`)

### Requirement: Permission Handling — YOLO Mode

In YOLO mode (global `--yolo` flag or per-channel `yolo: true`), the system SHALL auto-approve ALL permission requests, including destructive-shaped requests; destructive normalization SHALL NOT introduce a restricted tool, extension, staging-only or target-count clamp into YOLO approval.

#### Scenario: YOLO auto-approve
- **GIVEN** YOLO mode is enabled (globally or per-channel)
- **WHEN** any permission request is received, including a delete, move or multi-operation patch request
- **THEN** it SHALL be auto-approved with reason `"yolo_mode"`
- **AND** no restricted destructive completeness or target-scope denial SHALL be substituted for that approval

#### Scenario: YOLO filesystem callback keeps broad containment without restricted clamps
- **GIVEN** a YOLO session
- **WHEN** it writes any extension to any path physically inside its user workspace or the shared Agent workspace
- **THEN** the write SHALL be authorized through the protected access operation under that broad root role
- **AND** no restricted staging-only rule, extension allowlist or workspace-write authorization flag SHALL be applied

#### Scenario: YOLO does not relax escape or read-only-root denial
- **GIVEN** a YOLO session
- **WHEN** it requests a write, a deletion or a move whose source or destination is external or sibling-workspace, whose containment observation escapes, or which lies inside the trusted read-only skills root
- **THEN** the operation SHALL be denied with the mapped bounded reason and no content IO

#### Scenario: YOLO behavior is identical for both agents
- **GIVEN** an OpenCode and an OMP session in YOLO mode
- **WHEN** the same filesystem callback or destructive target is presented to each
- **THEN** both SHALL receive the same authorization outcome, with no restricted-mode policy copied into YOLO

#### Scenario: YOLO callback authorization is broad physical containment including destructive targets
- **WHEN** YOLO authorizes an ACP filesystem callback
- **THEN** it SHALL authorize by broad physical containment only: a target holding the requesting session's user-workspace or the shared Agent workspace role SHALL be authorized with no staging-only restriction, no write-extension filter, no `canWriteAgentWorkspace` requirement and no restricted tool/LSP/command clamp, while targets outside those roots, replaced or escaping paths, and the read-only trusted skills root SHALL still be denied — a rule that applies to destructive sources and destinations as well as ordinary writes

#### Scenario: YOLO boundary constrains only ACP-delegated file operations
- **GIVEN** a YOLO session
- **WHEN** the authorization boundary is documented or tested
- **THEN** it SHALL apply to ACP-delegated file operations only and SHALL NOT be documented or tested as constraining native execution paths that do not use ACP callbacks, nor as denying a state file already inside the permitted broad workspace

### Requirement: Permission Audit Logging

The system SHALL audit all permission decisions when an audit writer is configured.

#### Scenario: Permission audit entry
- **GIVEN** an audit writer attached to the client
- **WHEN** a permission request is approved or denied
- **THEN** it SHALL write a fire-and-forget audit entry with the phase (`permission_approved` or `permission_denied`), tool name, and reason

---

### Requirement: Skill Auto-Approve List Construction

Script inventory SHALL use the selected explicit root and canonical absolute contained files. OpenCode SHALL discover installed entries; OMP SHALL admit only deployment-cataloged bundled names. Configured names SHALL filter eligible entries. HOME scanning or missing-skill command grants SHALL NOT occur. Observed command skills with instruction files and no scripts directory MAY retain exact prefixes.

#### Scenario: Configured skills list
- **GIVEN** `autoApproveSkills` is provided in client config
- **WHEN** the skill inventory is constructed
- **THEN** it SHALL include only observed configured skills inside the selected explicit root
- **AND** a script's entry SHALL be its canonical absolute path
- **AND** configured OMP names SHALL NOT expand eligibility beyond the deployment-controlled bundled catalog

#### Scenario: Directory-scanned skills list
- **GIVEN** no `autoApproveSkills` configuration or an empty list
- **WHEN** the skill inventory is constructed with the resolved root
- **THEN** OpenCode SHALL scan that directory for installed skills, and OMP SHALL inspect only bundled catalog names within it
- **AND** it SHALL NOT supplement the inventory from a HOME-derived tree

#### Scenario: Shared development root does not grant external OMP execution
- **GIVEN** both agent types resolve to the repository skills tree and external publication adds a non-bundled script there
- **WHEN** inventories are constructed with empty approval lists or with that external name explicitly configured
- **THEN** OpenCode SHALL admit the contained installed script
- **AND** OMP SHALL deny it because root membership and a configured name cannot expand the bundled catalog

#### Scenario: Missing configured external skill yields no executable grant
- **GIVEN** a configured external script skill failed installation or its directory is absent when the connector is constructed
- **WHEN** the auto-approve inventory is built
- **THEN** it SHALL contain neither that skill's script path nor a bare command prefix inferred from its name
- **AND** unrelated installed skills SHALL remain available

#### Scenario: Explicit OpenCode install root includes external scripts
- **GIVEN** a configured external skill is published under the same explicit OpenCode install root as built-ins
- **WHEN** that skill is selected by the configured list or directory scan
- **THEN** its contained scripts SHALL receive canonical absolute inventory entries under that root
- **AND** no second trusted root SHALL be required

#### Scenario: Observed command skill remains available
- **GIVEN** the selected root contains a command-based skill with SKILL.md and no scripts directory
- **WHEN** that skill is selected by the configured list or directory scan
- **THEN** its exact command prefix SHALL remain eligible under the existing argument policy
- **AND** a scripts-directory observation error SHALL NOT be interpreted as a command-based skill

#### Scenario: Traversing name cannot select a foreign directory
- **WHEN** a configured skill name contains a separator, parent traversal or an absolute path
- **THEN** it SHALL contribute no script or command-prefix authority outside the resolved root

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

The transport contract SHALL identify supported adaptation reachability for native URL-read text/binary paths, web search, including redirects and secondary scraper/provider requests.

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

Owned settings SHALL retain the pinned reset mechanism's unresolved/incompatible evidence and faithfully model CLI-overlay aggregation deep-merged over lower layers. Its application disposition SHALL separately record decision 3 as `DECIDED (2026-10-09)`, selecting owned-only settings-discovery-path control with restricted default-deny as the second boundary. The native reset verdict SHALL NOT alone block that decided control, and no fixture SHALL certify the reset recipe or relabel its verdict.

#### Scenario: Surviving lower records are the expected test result
- **GIVEN** a lower layer with an unknown-tool grant and read denial, a null reset and a mode overlay supplying a read mapping
- **WHEN** the faithful pinned merge model aggregates the overlays and merges over the lower layer
- **THEN** the lower-only grant SHALL survive and configured null SHALL retain the recorded unset semantics
- **AND** tests SHALL NOT reorder layers or present the reset as record clearance

#### Scenario: Gate blocks security consumption, not data generation
- **WHEN** actual session setup verifies the owned-only discovery-source plan
- **THEN** the decision-3 deployment disposition SHALL permit that setup without requiring a supported native reset verdict or another user decision
- **AND** native reset evidence SHALL remain unchanged and restricted execution-time default-deny SHALL remain the second boundary

#### Scenario: Survivability consequence and gate boundary are documented
- **WHEN** documentation and tests describe the merge consequence
- **THEN** lower-layer grant, prompt and deny survivability SHALL remain recorded, with restricted runtime default-deny as the second boundary
- **AND** application SHALL depend on verified decision-3 settings-source control without requiring a native supported-reset verdict

#### Scenario: No reset certification and no layer reordering
- **WHEN** fixtures, mocks or tests exercise the reset recipe
- **THEN** no content or evidence SHALL certify the recipe as a working settings-layer reset
- **AND** tests SHALL NOT reorder merge layers to produce record clearance

#### Scenario: Passing mocks do not clear the native gate
- **WHEN** source-control unit/mock tests pass
- **THEN** native reset incompatibility and unresolved evidence SHALL remain recorded
- **AND** actual native precedence/reload behavior SHALL remain user-owned and unverified

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

Restricted-only pins SHALL appear exclusively in the restricted composition. The native-yolo composition SHALL select the pinned native YOLO approval mode and SHALL contain no per-tool approval records, approval-record resets or provider-disable clamp. Both compositions SHALL carry the shared deployment pin `lsp.enabled: false` required by decision 5, without imposing the restricted capability set on native YOLO.

#### Scenario: YOLO document carries no restricted clamp
- **WHEN** the deployment-owned native-yolo overlay and emitted settings composition are parsed and validated
- **THEN** both SHALL select native YOLO approval and require boolean `lsp.enabled: false`
- **AND** neither SHALL contain per-tool approval content, approval null-reset or a restricted provider-disable clamp

#### Scenario: Restricted document retains its pins
- **WHEN** the restricted overlay and composition are validated
- **THEN** their existing restricted pin set SHALL remain present
- **AND** the shared deployment LSP pin SHALL have the same false value as native-yolo

#### Scenario: Missing or invalid disable is rejected
- **WHEN** either mode document omits the LSP disable, enables it, supplies a non-boolean value or introduces an unregistered LSP key
- **THEN** owned-settings validation SHALL reject the document

#### Scenario: Factory and OpenCode carriers remain separately owned
- **GIVEN** disable-restricted-agent-lsp has landed before this follow-up
- **WHEN** the final carrier interface is inspected through repository tests
- **THEN** its factory flags SHALL disable LSP for both OMP launch modes and its OpenCode maps SHALL deny LSP per agent for build and yolo without a global clamp
- **AND** this follow-up SHALL own the native-YOLO asset/composition pin without modifying those flags/maps or asserting native implicit server suppression

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
- **THEN** the launch SHALL NOT load, reference, or inherit any restricted overlay content, restricted approval records, provider-disable content, or restricted-scoped LSP policy (the shared decision-5 `lsp.enabled: false` deployment disable is exempt)
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

OMP permission mode SHALL NOT alter egress posture. Both OMP modes SHALL receive the same existing proxy/sandbox decisions with no YOLO-only network rule. OMP child settings-discovery selectors SHALL be sanitized mandatorily even when general environment filtering is disabled, and only deployment-owned HOME and agent-directory assignments plus exact owned overlays SHALL establish its settings sources. OpenCode environment behavior and session/pool markers SHALL remain unchanged.

#### Scenario: Filtered OMP environment carries only approved categories
- **GIVEN** inherited HOME/XDG/profile/config/agent-directory selectors, setting-source overrides and operator passthrough attempts
- **WHEN** an OMP child environment is assembled with filterEnv enabled or disabled
- **THEN** inherited discovery selectors SHALL be absent or replaced with their exact deployment-owned values, with HOME explicitly assigned to avoid native homedir fallback
- **AND** allowedEnvVars SHALL NOT reintroduce excluded settings sources

#### Scenario: Approved category environment assembly passes through the existing pipeline
- **WHEN** an accepted OMP launch enters the sandbox pipeline
- **THEN** existing approved credential, mode-state namespace, shared-process marker and per-spawn session-ID semantics SHALL remain intact
- **AND** canonical payload staging SHALL remain independent of owned HOME and process state

#### Scenario: Egress posture is mode-independent
- **WHEN** restricted and native-yolo OMP launches use the same sandbox configuration
- **THEN** proxy variables, confinement and network isolation or explicit unrestricted egress decisions SHALL remain identical across modes
- **AND** no additional network denial or exemption SHALL be introduced

#### Scenario: OpenCode discovery environment is unchanged
- **WHEN** OpenCode launch/environment decisions are compared with the landed original batch baseline
- **THEN** its HOME, XDG_DATA_HOME, filtering and mode-switching behavior SHALL remain unchanged

### Requirement: OpenCode Launch Non-Regression

Introducing the OMP launch branch SHALL NOT change the OpenCode launch: command, arguments, environment assembly (including per-session and per-pool `XDG_DATA_HOME`, `TMPDIR`, session/pool markers, credential set, and browser detection), the OpenCode YOLO session-mode switching route, and the sandbox pass-through outcome SHALL remain behaviorally identical, protected by consumer-visible tests.

#### Scenario: OpenCode configuration is byte-stable across the change
- **WHEN** OpenCode restricted and YOLO launches are assembled before and after this change
- **THEN** the assembled command, arguments, environment, and working-directory decisions SHALL be identical
- **AND** the OpenCode YOLO route SHALL continue to rely on the session-mode override rather than launch arguments

### Requirement: Trusted-Module Pre-Import Discovery Exclusion Bootstrap

The integration SHALL combine the frozen trusted-module bootstrap decision with fresh metadata-only deployment observations before OMP spawn and native session new/load/recovery or repository-triggered rediscovery. Those observations SHALL cover authoritative workspace and reachable custom-tool/plugin/configured-module/dependency roots before unowned code can import. Native surface verdicts SHALL remain unchanged; decision 1 SHALL be consumed as a separate deployment-control disposition.

#### Scenario: Unowned candidate is excluded without import
- **GIVEN** an authoritative session workspace contains a loader-recognized custom-tool module or plugin entry point, including a linked package entry
- **WHEN** setup preflight inspects pinned discovery sources
- **THEN** it SHALL reject before invoking any native spawn/session/importer operation
- **AND** no candidate module SHALL be imported to inspect metadata, name or factory

#### Scenario: Importable module does not need executable permission bits
- **GIVEN** a custom-tool/plugin entry is importable at the pin but has no POSIX execute bit
- **WHEN** workspace preflight evaluates that entry
- **THEN** it SHALL still reject the executable discovery source

#### Scenario: Clean deployment admits without supported-mechanism relabeling
- **GIVEN** authoritative discovery roots contain no executable custom tools or plugin entries and owned identity/environment checks succeed
- **WHEN** decision-1 deployment admission is evaluated
- **THEN** the repository SHALL permit setup under the DECIDED disposition
- **AND** native custom-tool/plugin surfaces SHALL still report `no-supported-mechanism`, with no complete native exclusion support claim

#### Scenario: Ordinary workspace source does not imply custom-tool discovery
- **GIVEN** ordinary source/scripts or owned skill scripts are outside pinned executable discovery sources
- **WHEN** workspace preflight evaluates the deployment
- **THEN** those files SHALL NOT alone cause executable-source rejection

#### Scenario: Roots and observations cannot be omitted to permit setup
- **WHEN** an authoritative workspace/root observation is absent, unreadable, linked, replaced or has an unknown importable-entry shape
- **THEN** preflight SHALL reject without a lexical fallback or synthetic empty inventory

#### Scenario: Lifecycle changes receive fresh preflight
- **WHEN** a pooled/per-spawn session is created, loaded, recovered or explicitly refreshed in either mode with a new workspace or resource generation
- **THEN** a fresh deployment check SHALL precede the native protected request
- **AND** the frozen bootstrap's immutable identity/verdict data SHALL remain unchanged without reusing stale or foreign-session admission

#### Scenario: Production extension is image-owned only
- **WHEN** production OMP launch/setup resolves its trusted extension
- **THEN** it SHALL accept only the exact packaged image-owned module/closure path with ambient discovery disabled
- **AND** workspace/HOME/cache copies or development fallback SHALL NOT become trusted

#### Scenario: No import or host guard acts as an import boundary
- **WHEN** the pre-import disposition is documented or tested
- **THEN** extension flags SHALL NOT be generalized to independent custom tools/plugins
- **AND** host guards, preloaded paths, post-import tool-name filters and lifecycle callbacks SHALL NOT be described as supported native import barriers

#### Scenario: Extension flag is not claimed as complete exclusion
- **GIVEN** ambient extensions are disabled and the exact owned module is selected
- **WHEN** custom-tool/plugin routes are assessed at the pin
- **THEN** their native status SHALL remain `no-supported-mechanism`
- **AND** deployment-control admission SHALL NOT become a supported native complete-exclusion verdict

#### Scenario: Decision is frozen per process
- **WHEN** native registry or project-layer state changes after module load
- **THEN** immutable load-time identity and verdict data SHALL remain frozen and re-consulted
- **AND** fresh session/workspace deployment observations SHALL be checked before each native protected request

#### Scenario: Every pinned surface carries its mechanism and status
- **WHEN** the frozen bootstrap decision is produced
- **THEN** all audited discovery surfaces SHALL retain their pinned source route and `supported`, `candidate-to-verify` or `no-supported-mechanism` status
- **AND** applied deployment mechanisms SHALL be recorded separately without changing the status

#### Scenario: Extension-disability is not generalized to other discovery
- **WHEN** custom-tool/plugin surfaces are assessed with ambient extensions disabled
- **THEN** extension-disability SHALL NOT be generalized into a native guard for those independent routes

### Requirement: Fail-Closed Session Setup When Exclusion Cannot Be Established

When deployment preflight, executable workspace discovery, owned identity, link escapes, environment consistency or session freshness fail, setup SHALL reject restricted and native-yolo OMP spawn, new/load/recovery and repo-triggered refresh before the protected native operation, bounded fail-closed rejection as fallback. Native `no-supported-mechanism` alone SHALL NOT undo decision 1's deployment disposition, nor extension lifecycle failure establish authenticated client-observable readiness.

#### Scenario: Session creation fails visibly
- **GIVEN** preflight cannot establish the selected deployment controls
- **WHEN** session creation or load/recovery is attempted
- **THEN** the repository SHALL reject before sending the native request and registering guarded session state
- **AND** the bounded error SHALL name the failing surface/reason using existing verdict vocabulary without credentials or file content

#### Scenario: No silent downgrade path exists
- **WHEN** deployment observation or trusted identity validation fails
- **THEN** the integration SHALL NOT retry through an unguarded/extensionless launch or substitute another agent

#### Scenario: Recovery fails closed identically
- **WHEN** recovery cannot establish deployment controls or carries stale current-selection evidence
- **THEN** it SHALL reject with the same bounded named-surface error before native load/resumption
- **AND** a previously accepted guard claim SHALL NOT bypass the fresh check

#### Scenario: Failure message is bounded and credential-free
- **WHEN** session setup or recovery rejects a deployment preflight failure
- **THEN** its bounded error SHALL name the failing surface/status or deployment-control reason
- **AND** credentials and file contents SHALL be absent

#### Scenario: No degraded session shape is produced
- **WHEN** client/factory preflight cannot establish required deployment controls
- **THEN** setup SHALL NOT produce partially guarded registered state or an extensionless/unguarded/different-agent fallback

#### Scenario: Extension-load residual risk remains accepted and visible
- **GIVEN** client preflight succeeded but the synchronous restricted handler fails to install in the native runtime
- **WHEN** the fallback posture is documented or represented by mocks
- **THEN** native non-YOLO approval plus ACP client policy SHALL remain the accepted ACP-mediated boundary with client denials fail-closed
- **AND** missing restricted capabilities, runner.emit logging without startup failure, absence of readiness signal and incomplete default-deny/callback equivalence SHALL remain explicit

#### Scenario: Deployment controls do not add restricted YOLO tool policy
- **WHEN** native-yolo spawn, new/load/recovery or repository-triggered refresh finds an executable custom-tool/plugin source or cannot establish deployment ownership
- **THEN** it SHALL reject before the protected native operation under the same deployment source/ownership checks
- **AND** no restricted capability set or readiness handshake SHALL be added

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

Critical skill identifiers SHALL resolve only to exact canonical instruction paths under roots declared by deployment-owned settings, carrying read-only source/root identity, collision decision and current-session resource generation. Workspace-owned discovery SHALL be excluded before critical-name selection. Name-only critical-skill resolution SHALL remain denied, skills SHALL stay globally enabled and ordinary owned skills SHALL remain usable.

#### Scenario: Owned skill wins over same-name workspace content
- **GIVEN** an owned critical instruction and workspace/project candidates sharing its name or content, including provider/custom/managed candidates and aliases
- **WHEN** critical resolution evaluates its candidate set
- **THEN** it SHALL exclude workspace candidates before precedence/collision logic
- **AND** only the exact settings-declared canonical owned instruction SHALL supply authority

#### Scenario: Name-only request never supplies canonical authority
- **WHEN** a critical reference carries only a name or native alias without exact canonical source/root and current session/generation evidence
- **THEN** resolution SHALL deny it without workspace fallback

#### Scenario: Missing or escaping owned instruction rejects
- **WHEN** a declared critical instruction is missing, writable, linked outside its owned root, replaced or has a mismatched source identity
- **THEN** resolution SHALL reject without trusting a same-name alternative or disabling all skills

#### Scenario: Ownership survives load and refresh transitions
- **GIVEN** a session is created, loaded/recovered and its active resources refreshed
- **WHEN** critical resolution follows each event
- **THEN** it SHALL consume the same owned-settings declaration and current authoritative session/resource generation
- **AND** stale or foreign-session native snapshots SHALL be rejected

#### Scenario: Skills remain enabled while critical resolution is pinned
- **WHEN** non-critical skills under declared deployment-owned roots are discovered or their instruction files read
- **THEN** they SHALL remain usable under existing trusted-read and staging contracts
- **AND** no global skill disablement, payload staging move or new restricted native-YOLO tool policy SHALL be involved

#### Scenario: Escaping link cannot satisfy a critical identifier
- **GIVEN** a candidate is reachable through a link escaping its settings-declared owned root
- **WHEN** critical resolution evaluates the candidate
- **THEN** it SHALL NOT satisfy the critical identifier

#### Scenario: Native canonical-selection evidence is unchanged
- **WHEN** root declaration and selection unit/mock tests pass
- **THEN** decision 7 SHALL remain a DECIDED deployment disposition with the pinned name-only incompatibility and unresolved selection verdict unchanged
- **AND** real native skill resource selection on new/load/refresh SHALL remain user-owned and unverified

### Requirement: Discovery And Critical-Selection Compatibility Gates Remain Blocking

The two named discovery/critical-selection records SHALL preserve their native unresolved status and pinned verdicts verbatim. Their application dispositions SHALL separately record decisions 1 and 7 as `DECIDED (2026-10-09)`, selecting deployment-owned executable exclusion/startup checks and owned-settings canonical skill roots. Native incompatibility alone SHALL no longer block these decided controls; failed deployment controls SHALL remain fail-closed and no mock SHALL clear a native gate.

#### Scenario: Gate verdicts are recorded verbatim
- **WHEN** the two gate records are inspected
- **THEN** pre-import exclusion SHALL retain "extension flags alone incompatible and the supported full mechanism unresolved"
- **AND** critical-skill selection SHALL retain "name-only trust incompatible and canonical selection unresolved"

#### Scenario: Gate resolution requires a user decision
- **WHEN** gate dispositions are consumed after the recorded user decisions
- **THEN** they SHALL identify the decision number and DECIDED date with selected deployment controls and runtime-unverified limits
- **AND** they SHALL NOT require another user decision or a supported native mechanism as an unconditional application prerequisite

#### Scenario: Passing mocks cannot clear a gate
- **WHEN** repository exclusion/ownership tests pass
- **THEN** gate native status and verdicts SHALL remain unresolved/unchanged
- **AND** synthetic positive fixtures SHALL NOT be cited as native enforcement evidence

#### Scenario: Operative boundary while gated
- **WHEN** selected deployment controls fail or restricted execution is assessed
- **THEN** failed controls SHALL invoke the existing fail-closed boundary, while installed restricted runtime default-deny and filesystem authorization SHALL remain separate operative boundaries
- **AND** the accepted handler-installation fallback risk SHALL NOT be rewritten as authenticated readiness or equivalent full default-deny

#### Scenario: Automated evidence validates decision logic only
- **WHEN** automated unit/mock evidence is offered for these controls
- **THEN** it SHALL certify repository observation/admission/denial decisions only
- **AND** native pre-import enforcement and canonical resource selection SHALL remain user-owned and unverified

### Requirement: Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants

Per-spawn (non-pool) agent spawns SHALL pass the session's resolved effective permission mode into the agent configuration exactly as the pooled paths do, so that a restricted per-spawn OMP process and a native-YOLO per-spawn OMP process never share a process state root.

#### Scenario: Per-spawn OMP modes get distinct state roots
- **GIVEN** an OMP deployment in per-spawn mode where one session resolves restricted and another resolves native-YOLO
- **WHEN** each session's spawn configuration is built with its resolved mode
- **THEN** the two spawn configurations SHALL carry distinct mode-scoped process state roots and neither mode's state root SHALL be reused by the other

#### Scenario: Pooled OMP processes never freeze SESSION_ID
- **GIVEN** an OMP deployment running shared-process mode
- **WHEN** a restricted or native-YOLO pooled process is spawned
- **THEN** its environment SHALL contain the shared-process marker and SHALL NOT contain a process-wide `SESSION_ID` value, exactly as OpenCode pooled processes behave today

#### Scenario: Per-spawn mode threading matches pooled mode threading
- **GIVEN** the same session context (same resolved mode) executed once in shared-pool mode and once in per-spawn mode
- **WHEN** both runs build their agent configuration
- **THEN** both SHALL receive the same resolved permission mode, with no path defaulting, re-resolving differently, or reading a stale/global-only value where the entry point had a per-session decision available

#### Scenario: Shared-process marker invariants hold for every agent type
- **GIVEN** any shared (pooled) subprocess, regardless of agent type or permission mode
- **WHEN** its spawn environment is built
- **THEN** the environment SHALL keep exporting the shared-process marker (`SKILL_SHARED_PROCESS=1`) and SHALL NOT freeze a process-wide `SESSION_ID`, keeping the per-session pointer as the sole shared-mode skill identity source

#### Scenario: Invariants hold for both OMP modes and OpenCode
- **GIVEN** an OMP deployment in either permission mode or an OpenCode deployment exercising the spawn and skill-identity paths
- **WHEN** the per-spawn distinctness and shared-process identity invariants are checked
- **THEN** they SHALL hold identically, because later payload-portability work consumes them

### Requirement: Session Ownership Record Written At Acquisition

At the moment a session acquires or spawns its agent process — pooled or per-spawn — the system SHALL record the session's ORIGINAL resolved permission mode and the process/state namespace selected for that acquisition in the in-bot session-ownership bookkeeping.

#### Scenario: Ownership fields written at pooled acquisition
- **GIVEN** an OMP deployment pooled session whose resolved mode is native-YOLO
- **WHEN** the pool hands it the native-YOLO entry's connector under the lease
- **THEN** the session's ownership record SHALL carry the original mode `native-YOLO` and that entry's process/state namespace, recorded before the session's first ACP call

#### Scenario: Ownership fields written at per-spawn acquisition
- **GIVEN** an OMP deployment per-spawn session whose resolved mode is restricted
- **WHEN** its process is spawned for the session
- **THEN** the session's ownership record SHALL carry the original mode `restricted` and the per-spawn mode-scoped state namespace

#### Scenario: Recovery interface is read-only consumption
- **GIVEN** a session whose ownership record was written at acquisition
- **WHEN** crash recovery or session loading later consults the record (behavior owned by row 11)
- **THEN** the record's mode and namespace fields SHALL be exactly the acquisition-time values — no acquisition or normal session path SHALL overwrite them with a re-resolved or opposite mode

#### Scenario: OpenCode ownership record keeps existing identity
- **GIVEN** an OpenCode pooled session running with per-session YOLO switching
- **WHEN** its ownership record is written at acquisition
- **THEN** the record SHALL name the existing pool-key-scoped data-root identity and OpenCode reuse behavior SHALL be unchanged; no OpenCode session SHALL be split or rejected because of the new fields

#### Scenario: Bookkeeping spans registry record and audit event
- **GIVEN** a session acquiring or spawning its agent process, pooled or per-spawn
- **WHEN** the ownership values are recorded
- **THEN** the system SHALL write them to the registry's active-session record and emit a bounded audit event alongside the existing session-start/agent-connect events

#### Scenario: Record is durable and written from resolved values
- **GIVEN** an ownership record written from the same explicitly resolved values used to build the acquisition
- **WHEN** later per-session activity runs
- **THEN** the recorded values SHALL remain durable for the session's lifetime and SHALL NOT be mutated by that activity

#### Scenario: Restore owner consumes the record without redefining it
- **GIVEN** the write side of the ownership interface established here
- **WHEN** reconnect/`session/load` verification, gate-context restoration, or rejection of opposite-mode loads runs (owned by `restore-mode-owned-acp-sessions`, row 11)
- **THEN** that owner SHALL consume, never redefine, the recorded fields

### Requirement: Independent Restricted ACP Filesystem Write Authorization

The ACP file-write sink SHALL authorize an ordinary restricted-mode write from the requesting session's authoritative context and the target's canonical physical role, WITHOUT requiring any preceding permission request: it SHALL allow the session's own staging root and, with agent-workspace write authorization and an allowed extension, a shared Agent workspace target; it SHALL deny every other user-workspace target and any target whose only role is read-only trusted skills.

#### Scenario: Restricted staging write needs no preceding permission request
- **GIVEN** a restricted session whose Skill API staging directory is provisioned under its own canonical workspace
- **WHEN** the agent calls the file-write callback for a path under that staging root without any preceding permission request
- **THEN** the write SHALL be authorized and its content readable back under that staging root
- **AND** no staging-only, shared-extension or `canWriteAgentWorkspace` rule SHALL have been required for that target

#### Scenario: Ordinary restricted user-workspace write is denied
- **GIVEN** a restricted session and a target physically inside that user workspace that is not the session's staging root
- **WHEN** the agent calls the file-write callback, including for a `.md` file whose extension is otherwise allowed
- **THEN** the write SHALL be denied with the specific restricted in-workspace reason
- **AND** no content SHALL be created or modified at that target

#### Scenario: Shared workspace rules keep their distinct reasons
- **GIVEN** a restricted session without agent-workspace write authorization, and a second restricted session with it
- **WHEN** each attempts a shared Agent workspace write with an allowed and a disallowed extension
- **THEN** only the authorized session's allowed-extension write SHALL be authorized
- **AND** the unauthorized and wrong-extension denials SHALL preserve the existing shared-authorization and extension rejection reasons rather than collapsing into the generic in-workspace reason

#### Scenario: Direct callback matches the permission-request outcome
- **WHEN** the same restricted-mode target is evaluated through the scoped edit/write permission path and through a direct file-write callback
- **THEN** both SHALL report the same authorization outcome and reason for the same canonical target role
- **AND** neither outcome SHALL depend on the other having run first

#### Scenario: Staging grant is the session's own physical staging membership
- **GIVEN** a restricted session whose staging directory is provisioned under its own canonical workspace
- **WHEN** a write target is an alias or link reaching a sibling session's staging directory, an ordinary workspace directory, or a process/state location
- **THEN** the staging grant SHALL NOT be produced for that target
- **AND** the target SHALL be decided by its canonical physical role alone

#### Scenario: Preserved write reason codes keep their meanings
- **GIVEN** a write denial that matches a shared-authorization, shared-extension or outside-workspace condition
- **WHEN** the write sink records the denial
- **THEN** the preserved reason code for that condition SHALL be used with its existing meaning

### Requirement: Protected-IO-Only ACP Filesystem Callback Execution

Every ACP read and write callback decision SHALL be made on the requesting session's canonical root and target observations, and content IO SHALL occur only through the protected root-relative access operations under the single root role the authorization selected.

#### Scenario: No bypass remains on the callback path
- **WHEN** the read and write callbacks are exercised across authorized, denied and error cases
- **THEN** every attempted content read or write SHALL carry an explicitly selected authorized root role
- **AND** every denial SHALL have occurred before any content IO with no ordinary path-based operation performed

#### Scenario: Unprovisioned staging is surfaced, not repaired
- **GIVEN** a session whose staging directory was not provisioned by its lifecycle owner
- **WHEN** the agent writes to a path under that staging root
- **THEN** the callback SHALL deny with the mapped unavailable-root/parent-missing filesystem-access reason
- **AND** it SHALL NOT create any directory to make the write succeed

#### Scenario: Unregistered session context is denied, not defaulted
- **WHEN** a filesystem callback arrives for an ACP session with no registered authoritative context
- **THEN** the callback SHALL deny with the specific missing-filesystem-context reason
- **AND** it SHALL NOT fall back to a process-level, daemon-cwd or another session's workspace containment rule

#### Scenario: Escaping or replaced path never reaches content IO
- **WHEN** a target observation reports an outside-root, symlink-escape, dangling-link, loop, wrong-type or changed-path condition, or the protected operation reports its own containment/replacement failure
- **THEN** the callback SHALL deny with the mapped bounded reason and perform no content read or write
- **AND** sibling and external sentinel content SHALL remain unchanged

#### Scenario: Failed steps deny without broader-role retry
- **GIVEN** a failed context, expansion, root construction, target observation, authorization or access step
- **WHEN** a read or write callback would fall back
- **THEN** the callback SHALL deny the operation with one mapped bounded reason
- **AND** it SHALL NOT retry under a broader root role

#### Scenario: Lexical predicates and HOME-derived skills trust are removed from the callback path
- **WHEN** the read and write callback paths are evaluated
- **THEN** the callback path SHALL NOT include the lexical sink predicates or the environment/HOME-derived skills trust rule they replaced
- **AND** no callback path SHALL remain that reaches content IO without an authorization decision

### Requirement: Read-Only Trusted Skills Access In ACP Callbacks

ACP reading SHALL additionally admit a target whose canonical role is the deployment-owned read-only trusted skills root, subject to that root's ownership provenance and current resource-generation currency, and SHALL treat that admission as root-scoped rather than extension-allowlist-based.

#### Scenario: Owned skill instruction is readable through the callback
- **GIVEN** a deployment-owned read-only skills root with matching current-generation provenance
- **WHEN** the agent reads an owned instruction file inside that root, including one whose extension is not in the workspace read allowlist
- **THEN** the read SHALL be authorized and return the owned file's content
- **AND** no write to that root SHALL be authorized afterward, for a restricted or YOLO session

#### Scenario: Permission-path skill read uses the same classification
- **WHEN** a restricted read permission request's locations resolve to the trusted skills role
- **THEN** the request SHALL be approved with the existing skill-directory audit reason
- **AND** a request anchored to an unowned HOME-discovered or workspace skills copy, an escaping link, a stale generation or an unowned root SHALL NOT be approved by the trusted rule

#### Scenario: Trusted exception does not broaden workspace reads
- **GIVEN** a workspace target whose extension is outside the read allowlist
- **WHEN** it is read while a trusted skills root is configured
- **THEN** the read SHALL still be denied by the unchanged workspace read-extension rule
- **AND** the trusted root SHALL NOT authorize any arbitrary external file

#### Scenario: Trusted root confers read authority only
- **GIVEN** a deployment-owned read-only trusted skills root
- **WHEN** the callback classifies any target under it
- **THEN** the trust SHALL confer read authority only
- **AND** it SHALL NOT authorize any write in any mode, any file outside the owned root, or any change to unrelated workspace read-extension rules

#### Scenario: Name, link, and provenance failures deny the trusted role
- **GIVEN** a workspace or project file merely sharing a skill's name, a link leaving the owned root whose destination is otherwise readable, or a root with a stale generation, ownership mismatch or writable-root overlap
- **WHEN** the callback classifies the target
- **THEN** it SHALL NOT gain the trusted role
- **AND** a stale generation, ownership mismatch or writable-root overlap SHALL fail with the specific trusted-identity reason and no fallback to another readable role

#### Scenario: No trusted role without supplied provenance
- **WHEN** a skills root has no supplied ownership provenance
- **THEN** no trusted role SHALL exist for it
- **AND** the trusted classification SHALL NOT be applied

#### Scenario: HOME-derived auto-approval is replaced by canonical classification
- **WHEN** a skill read was previously auto-approved via the environment/HOME-derived rule
- **THEN** it SHALL be classified through the canonical trusted-skills rule instead
- **AND** a trusted skill read SHALL keep the existing approved audit reason

### Requirement: Bounded Specific ACP Filesystem Denial Diagnostics

Each filesystem-sink denial SHALL record exactly one bounded, machine-readable reason identifying the failed decision — restricted in-workspace target, read-only trusted-skills target, trusted-identity/provenance failure, canonical-observation failure, filesystem-access failure, or missing session context — using the existing bounded rejection buffer and audit mirroring.

#### Scenario: Every sink denial yields one specific bounded reason
- **WHEN** each filesystem denial path is exercised once
- **THEN** exactly one recorded rejection SHALL appear for that denial with its named reason and bounded path field
- **AND** the raised callback error SHALL carry a static reason message without file content or raw platform error text

#### Scenario: Existing retry diagnostics keep working
- **GIVEN** a session that experienced filesystem denials during a turn that produced no reply
- **WHEN** the missing-reply retry prompt is assembled
- **THEN** the recorded reasons SHALL appear in the existing bounded rejection section
- **AND** the previously documented reasons SHALL remain available for shared-authorization and extension denials

#### Scenario: Reason codes stay preserved, finite and non-contradictory
- **WHEN** a filesystem denial is recorded
- **THEN** preserved reason codes SHALL keep their meanings and added codes SHALL form a finite documented set
- **AND** a single denial SHALL NOT be recorded twice under contradictory reasons

#### Scenario: Recorded fields and error messages stay bounded
- **WHEN** a filesystem denial is recorded and its callback error is raised
- **THEN** recorded fields SHALL remain sanitized and length-bounded
- **AND** the callback error SHALL be a static message exposing no file content, secret, or unbounded agent- or platform-supplied text

### Requirement: Complete Destructive Operation Normalization

The permission gate SHALL normalize every destructive-shaped request (ACP `delete`/`move` tool kinds, native delete/move titles, and multi-operation patch shapes) into an ordered, complete operation set before any authorization decision, using the P0 destructive-intent contract's trustworthy operation input, parser/edit-syntax provenance, and binding to the input that will execute.

#### Scenario: Complete native-shaped delete and move decode every target
- **GIVEN** a restricted session and a supported-parser delete fixture with several targets and a complete move fixture
- **WHEN** the permission gate normalizes each request
- **THEN** it SHALL enumerate every delete target and both endpoints of the move as separately decisioned targets bound to the executing input
- **AND** it SHALL make no authorization decision from the request title alone

#### Scenario: First-target-only location list cannot authorize a larger patch
- **GIVEN** a destructive patch fixture whose permission-location list carries only the first operation while the raw input contains a later delete or move
- **WHEN** the gate normalizes the request
- **THEN** it SHALL reject the request as an incomplete intent rather than approving the decoded-superset operation set
- **AND** it SHALL attempt zero mutations

#### Scenario: Incomplete or unparseable intent fails closed
- **GIVEN** a fixture with a missing move destination, an unknown/incompatible edit syntax, unparseable patch content, or a raw-input/execution binding mismatch
- **WHEN** the gate normalizes the request
- **THEN** it SHALL return one bounded incomplete/intent failure with a named reason
- **AND** no target SHALL be authorized, no content IO or mutation SHALL be attempted, and the request SHALL NOT fall through to generic unknown-tool handling as though unclassified

#### Scenario: Location list disagreement is a mismatch, not a narrowing
- **GIVEN** a destructive request whose location list names a target absent from the decoded operations, or whose decoded operations name a target absent from the list
- **WHEN** the gate compares the two
- **THEN** it SHALL reject with the bounded intent-mismatch/incomplete reason
- **AND** it SHALL NOT approve the intersection of the two sets
#### Scenario: Title, location list or first operation cannot stand in for the decoded set
- **GIVEN** a destructive-shaped request whose title, permission-location list, or first operation is narrower than its decoded operation set
- **WHEN** the gate decides authorization
- **THEN** the title, the permission-location list, or the first operation SHALL NEVER stand in for the decoded set; an arbitrary title string SHALL NOT be approved as a destructive permission request

#### Scenario: Normalization is a pure, parser-bounded decision
- **WHEN** the permission gate normalizes a destructive request
- **THEN** normalization SHALL be a pure decision that creates, modifies, deletes or moves nothing
- **AND** it SHALL NOT implement a speculative native edit syntax beyond the supported parsers established by the P0 destructive-intent contract

### Requirement: All-Target Destructive Authorization Under The Common Policy

For a normalized destructive request, the gate SHALL authorize each target through the same session-scoped filesystem decision used by the ordinary write sink — with no parallel destructive rule — and SHALL approve only when every target is authorized, so a single unauthorized target SHALL deny the whole request.

#### Scenario: Later escaping target denies the whole patch
- **GIVEN** a restricted session, and a patch fixture whose first delete is inside the session staging root and whose second delete resolves outside the authorized roots
- **WHEN** the gate evaluates every target
- **THEN** it SHALL deny the request with the bounded reason identifying the disallowed target
- **AND** it SHALL attempt no mutation of the permitted first target

#### Scenario: Move requires both endpoints
- **GIVEN** a restricted session whose staging root contains a source file and a second destination path outside the authorized roots
- **WHEN** the gate evaluates the move
- **THEN** it SHALL deny with the destination-specific bounded reason and move nothing
- **AND** the same move with a destination inside the requesting session's own staging root SHALL be approved

#### Scenario: Delete and move sources must exist
- **GIVEN** a destructive fixture naming a source or deletion target that is absent
- **WHEN** the target is observed
- **THEN** the decision SHALL be a denial with the mapped missing-object/filesystem reason rather than prospective new-file success
- **AND** no directory or parent SHALL be created to make it eligible

#### Scenario: Read-only trusted-skills targets are denied destructively
- **GIVEN** a destructive fixture whose source or destination resolves to the deployment-owned read-only skills role
- **WHEN** the gate evaluates that target
- **THEN** the target SHALL be denied with the read-only-target reason in restricted and YOLO modes alike
- **AND** no other target decision SHALL convert it into a writable role

#### Scenario: YOLO destructive callbacks keep broad containment without restricted clamps
- **GIVEN** a YOLO session
- **WHEN** a destructive target is physically inside its user workspace or the shared Agent workspace
- **THEN** the target SHALL be authorized by broad containment with no staging-only rule, no write-extension filter and no `canWriteAgentWorkspace` requirement
- **AND** escaping, sibling and read-only-skills targets SHALL still be denied, with the documented limitation that non-ACP native execution is unconstrained
#### Scenario: Delete and move sources require existence plus delete authority
- **GIVEN** a normalized destructive request naming a deletion target or a move source
- **WHEN** the gate decides that target
- **THEN** the target SHALL require an existing-target observation plus delete authority

#### Scenario: Destinations and patch mutation targets require create/overwrite authority
- **GIVEN** a normalized destructive request naming a move destination or a patch mutation target
- **WHEN** the gate decides that target
- **THEN** it SHALL require create/overwrite authority

#### Scenario: Target decisions use canonical physical observations
- **WHEN** the gate decides any destructive target
- **THEN** it SHALL use canonical physical observations, including token expansion and escaping-symlink rejection

#### Scenario: Ordinary write rules decide destructive targets without extra YOLO clamps
- **WHEN** an existing restricted staging/shared-write rule or a native YOLO broad-containment rule decides a destructive target
- **THEN** it SHALL decide the target exactly as it decides an ordinary write, with no additional restricted clamp applied to YOLO

### Requirement: Shared Client And Extension Destructive Decision Surface

The destructive normalization and all-target decision logic SHALL be one reusable module consumed by the ACP permission gate and, when its owner wires the handler, by the deployment-owned OMP restricted-tool adapter, so the extension path and the client path evaluate the identical operation set and completeness verdict.

#### Scenario: Both surfaces agree on one fixture
- **GIVEN** the client permission gate and a mock extension-side adapter invoking the same shared module on one destructive fixture
- **WHEN** both evaluate it
- **THEN** they SHALL return the same completeness verdict, the same enumerated target set and the same bounded outcome reason

#### Scenario: Extension-side incompleteness cannot be reconciled by the client
- **GIVEN** an adapter fixture reporting fewer operations than the bound execution input contains
- **WHEN** either surface evaluates it
- **THEN** both SHALL report the incomplete-intent denial and authorize zero mutation attempts
- **AND** no surface SHALL widen the decoded set from titles or presentation text

#### Scenario: Shared module performs no IO
- **WHEN** the shared normalization and decision logic is exercised across its fixtures
- **THEN** it SHALL consult only the observations and context supplied by its consumer
- **AND** it SHALL create, modify, delete or move nothing itself
#### Scenario: Neither surface keeps a private duplicate of decision logic
- **WHEN** the ACP permission gate or the OMP restricted-tool adapter evaluates a destructive request
- **THEN** neither surface SHALL maintain a private duplicate of the target-completeness rules, the reason vocabulary, or the authorization table

#### Scenario: Incomplete native location list never authorizes a larger patch
- **GIVEN** a client-side destructive request whose native location list names fewer operations than the bound input contains
- **WHEN** either surface evaluates it
- **THEN** the incomplete native location list SHALL NOT authorize a larger patch on either surface
- **AND** both surfaces SHALL report the incomplete-intent denial

### Requirement: Canonical Generic-Command Path Argument Decision

The generic-command gate SHALL decide every path argument of an allow-listed command — read input and write/output target — on the requesting session's canonical physical root membership rather than lexical string containment, and SHALL deny any argument whose canonical observation fails, never falling back to a lexical decision; it SHALL apply exactly where today's generic-command allow-list applies, restricted mode only, adding no clamp to native YOLO.

#### Scenario: Symlink escape inside the workspace is denied

- **GIVEN** a file inside the session workspace whose parent-directory or final-link traversal reaches an external file or another session's workspace
- **WHEN** the generic-command gate evaluates `cat` (or any allow-listed tool) on that path
- **THEN** it SHALL reject the command with the existing `path_outside_boundary` reason and record the predecessor observation failure as the logged cause
- **AND** the lexical spelling, which resolves inside the workspace, SHALL NOT grant approval

#### Scenario: Contained symlink is approved on its canonical destination

- **GIVEN** a link whose every observed traversal stays inside one granted command-gate root
- **WHEN** the gate evaluates a path argument through it
- **THEN** the decision SHALL use the canonical destination and approve when that destination holds the granted role
- **AND** the approval SHALL be documented as a decision-time containment proof, not race-proof protection of the command's own native IO

#### Scenario: Process-temp and tool-output roles admit only their enumerated roots

- **GIVEN** shared-process mode with a channel-scoped process temporary directory and a pool-key-scoped OpenCode tool-output directory, and per-spawn mode with a session-local tool-output directory under the session workspace
- **WHEN** path arguments target those directories or their children
- **THEN** the decisions SHALL match the current lexical gate exactly for these roots
- **AND** a tool-output resolution outside the session workspace/TMPDIR (per-spawn) or outside the pool-key data root (shared) — including the shared home-rooted OpenCode tool-output directory — SHALL receive no role and SHALL be denied fail-closed

#### Scenario: Cross-session data area denied on canonical identity

- **GIVEN** a sibling or previous session's data home, or the OpenCode data-area root listing itself, physically inside the same data root as the requesting session's own data home
- **WHEN** a path argument canonically resolves there
- **THEN** the gate SHALL deny it, and arguments inside the requesting session's own data home SHALL remain approved

#### Scenario: Canonical identity unavailable fails closed

- **WHEN** the requesting session's context, a required root, or a token expansion cannot produce a complete canonical decision
- **THEN** the gate SHALL deny the argument with the existing `path_outside_boundary` cause vocabulary
- **AND** it SHALL NOT approve on the basis of the raw or lexical spelling

#### Scenario: Enumerated root-role set scoped to the session

- **GIVEN** an allow-listed command whose path arguments target the requesting session's canonical workspace, the shared Agent workspace when configured, the shared-process-mode process temporary directory when set, the session's OpenCode tool-output directory, or the OpenCode data root
- **WHEN** the canonical gate decides each path argument
- **THEN** it SHALL grant roles only from its own enumerated root-role set, treating the OpenCode data root solely as a cross-session isolation boundary
- **AND** an argument that holds no granted role SHALL be denied

#### Scenario: Token expansion precedes canonical decision

- **GIVEN** a path argument containing a known session or harness token — `~`, `~/...`, `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}`, `$TMPDIR`, `${TMPDIR}`, `$AGENT_WORKSPACE`, `${AGENT_WORKSPACE}`, `$SESSION_ID`, `${SESSION_ID}`
- **WHEN** the canonical gate evaluates the argument
- **THEN** it SHALL expand the token against the requesting session's authoritative values before the canonical decision
- **AND** unexpandable home-anchored forms and known variables without a runtime value SHALL remain rejected without observation

#### Scenario: Broken or unstable canonical observation denied

- **GIVEN** a path argument whose canonical observation encounters a symlink loop, dangling link, unresolvable or unavailable root, or a path that changed between observation and decision
- **WHEN** the canonical gate evaluates the argument
- **THEN** it SHALL deny the argument with the existing `path_outside_boundary` cause vocabulary
- **AND** it SHALL NOT fall back to a lexical decision

### Requirement: Generic-Command Policy Parity Under Canonicalization

Canonicalizing the path-argument decision SHALL be a representation change only: the allow-listed tool set, dangerous-flag set, shell-operator and fd-redirect rules, per-segment chain evaluation rule, attached-option and URI-scheme rejections, unexpandable-token rejections, and every existing allow/deny case SHALL keep identical verdicts, so no OpenCode command routed to this gate gains or loses approval status incidentally.

#### Scenario: Inherited allow/deny cases keep their verdicts

- **GIVEN** the full existing generic-command allow/deny corpus (in-workspace and relative reads, output targets, `$HOME`/`~` expansions, attached option absolutes and traversals such as `-f../sibling/file` and `-o../x`, `~otheruser` and unexpandable forms, URI schemes, dangerous flags, shell operators, and `;`/`&&`/`||` chains evaluated per segment)
- **WHEN** the canonicalized gate evaluates each case
- **THEN** each verdict SHALL equal its pre-hardening verdict
- **AND** the allow-list and dangerous-flag sets SHALL be unchanged

#### Scenario: Restricted-only posture preserved

- **GIVEN** the same command evaluated under a YOLO session and a restricted session
- **WHEN** `requestPermission()` evaluates both
- **THEN** the YOLO session SHALL auto-approve before the generic-command gate as today
- **AND** only the restricted session SHALL receive the canonicalized decision, with no new clamp added to either mode's approval surface

#### Scenario: Restricted decisions re-expressed canonically

- **GIVEN** a restricted-mode OpenCode command routed to the canonicalized generic-command gate
- **WHEN** the gate evaluates the command
- **THEN** the decision SHALL be re-expressed canonically and SHALL preserve OpenCode regression behavior

#### Scenario: Non-verdict surfaces untouched

- **GIVEN** the canonicalized generic-command gate in a restricted OpenCode session
- **WHEN** the gate runs on an allow-listed command
- **THEN** it SHALL NOT modify the restricted tool inventory, provenance, and MCP admission decisions, nor the trusted-extension handler wiring

### Requirement: Connector Recovery Ownership Verification Before Teardown

For an agent type whose sessions carry ownership provenance, the connector SHALL verify the recovery context's recorded permission mode and namespace against its own recovery target (the mode-scoped namespace its spawn configuration carries) as the FIRST action, before disconnecting, respawning, or issuing `session/load`; a mismatch or missing provenance SHALL raise a distinct ownership-violation error and perform no disconnect, spawn, load, or gate-context mutation.

#### Scenario: Verification precedes any teardown or load
- **GIVEN** a recovery call supplying a recorded mode and namespace that match the connector's recovery target
- **WHEN** reconnect-and-resume runs
- **THEN** the ownership verification SHALL complete before the connection is disconnected, and the same-mode respawn and `session/load` SHALL then proceed

#### Scenario: Ownership violation produces zero connector side effects
- **GIVEN** a recovery call whose supplied ownership context does not match the connector's recovery target (opposite mode or different namespace)
- **WHEN** reconnect-and-resume is invoked
- **THEN** it SHALL reject with a distinct ownership-violation error
- **AND** no disconnect, process spawn, `session/load`, or gate-context mutation SHALL occur

#### Scenario: Missing provenance for a provenance-required agent fails closed
- **GIVEN** a recovery call for a session of an agent type that requires ownership provenance, with no recovery context or an incomplete one supplied
- **WHEN** reconnect-and-resume is invoked
- **THEN** it SHALL fail closed as an ownership violation rather than proceeding with today's unverified recovery

#### Scenario: Recovery context is consumed read-only
- **GIVEN** a completed same-mode recovery that read the session's recorded mode and process/state namespace
- **WHEN** the session continues or ends afterward
- **THEN** the recovery path SHALL NOT have written, mutated, or re-interpreted those recorded ownership fields

#### Scenario: Callers without recovery context keep existing behavior
- **GIVEN** a caller invoking reconnect-and-resume with only the pre-existing arguments (session, cwd, MCP servers) for an agent type without mode-split ownership
- **WHEN** the call runs
- **THEN** the operation SHALL behave exactly as before this change, including the capability-absence false return

#### Scenario: Recovery context is consumed as additive optional trailing options
- **GIVEN** a caller supplying a recovery context with the session's recorded mode, process/state namespace, and deployment agent type (read from the session-ownership record), the session's full gate context, and its optional resolved reasoning effort
- **WHEN** reconnect-and-resume is invoked
- **THEN** the context SHALL be consumed as additive, optional additions to the operation's existing trailing-options shape

#### Scenario: Ownership-violation error names the session and mismatch
- **GIVEN** a recovery whose supplied ownership context mismatches the connector's recovery target in either direction
- **WHEN** the verification rejects the recovery
- **THEN** the distinct ownership-violation error SHALL name the session and the mismatched mode and namespace, with bounded detail

#### Scenario: Recorded permission mode is never re-resolved
- **GIVEN** a recovery supplying a recorded permission mode
- **WHEN** the connector runs the recovery
- **THEN** it SHALL NOT re-resolve the permission mode from any other source

#### Scenario: Post-load configuration restoration reuses the shared logic
- **GIVEN** a successful same-mode load with a caller-supplied resolved reasoning value
- **WHEN** configuration restoration runs after the load
- **THEN** it SHALL reuse the shared model-configuration logic — load-cache restoration, stable-first model reapplication, best-effort reasoning from the supplied value
- **AND** it SHALL NOT reimplement the matching rules

#### Scenario: Fixed per-session mode-switch identity matches by construction
- **GIVEN** an agent type whose recovery provenance is a fixed per-session mode-switch identity
- **WHEN** the ownership verification runs
- **THEN** it SHALL match by construction
- **AND** the agent type's existing recovery behavior SHALL remain unchanged

### Requirement: Gate-Context Restoration And Recovery Hook In Connector Recovery

After a successful same-mode `session/load`, the connector SHALL re-register the recovered session id's OWN complete per-session gate context (cwd, owning skill session id, per-session permission flags), supplied by the caller and consistent with the recovery cwd, before reporting recovery success, and SHALL NOT substitute another session's cached gate context or the process-frozen client configuration when the session's own context cannot be established.

#### Scenario: Full gate context restored on a fresh client for the recovered id
- **GIVEN** a recovery on a connector whose gate-context cache is empty (freshly respawned client) with the caller supplying the recovered session's complete gate context
- **WHEN** `session/load` succeeds and restoration completes
- **THEN** the recovered session id's permission gate and filesystem callbacks SHALL resolve to that session's own cwd, owning skill session id, and per-session flags before the method reports success

#### Scenario: No fallback context for an unknown session
- **GIVEN** a recovery for a session id with no cached gate context and no caller-supplied context, while other sessions' contexts exist in the cache
- **WHEN** restoration is attempted
- **THEN** that session's recovery SHALL fail as a gate-context restore failure
- **AND** none of the other sessions' contexts SHALL be bound to or substituted for the recovered session id

#### Scenario: Supplied context must agree with the recovery cwd
- **GIVEN** a recovery whose supplied gate context names a cwd different from the recovery cwd passed to `session/load`
- **WHEN** restoration is attempted
- **THEN** it SHALL fail closed as a gate-context restore failure for that session rather than silently overwriting either value

#### Scenario: Recovery hook is a positioned no-op attach point
- **GIVEN** a successful same-mode recovery with no post-restore hook supplied
- **WHEN** recovery completes
- **THEN** resumption SHALL proceed without any readiness assertion
- **AND** WHEN a stub hook is supplied it SHALL be invoked exactly once, after gate-context restoration and before success is reported
- **AND** a rejecting hook SHALL fail only that session's recovery

#### Scenario: Post-load model or reasoning restoration failure stays isolated
- **GIVEN** a same-mode load whose restored catalog no longer contains the session's previously set model
- **WHEN** the shared stable-first logic reports the catalog miss
- **THEN** the error SHALL propagate to the affected session's existing failure handling without an unstable second chance, and other sessions SHALL be unaffected

#### Scenario: Configuration restored through the shared model-configuration logic
- **GIVEN** a successful same-mode recovery whose caller supplied a resolved reasoning value
- **WHEN** the connector restores configuration after `session/load`
- **THEN** it SHALL restore through the shared model-configuration logic in the canonical order — config-options cache restoration, then model reapplication, then best-effort reasoning reapplication from the supplied value

#### Scenario: Other sessions' cached gate contexts replay unchanged
- **GIVEN** a recovery on a connector whose gate-context cache holds other sessions' contexts to replay to a fresh client
- **WHEN** the recovered session's own context is restored
- **THEN** the other sessions' cached gate contexts SHALL continue to be replayed to the fresh client
- **AND** they SHALL NOT be modified by the recovery

### Requirement: Recovery Context Threading And Failure Classification In Session Runs

The session runners' reconnect call sites SHALL build the recovery context from the session's OWN recorded values — the ownership record's permission mode and process/state namespace read read-only from the in-bot session registry, the session's own gate-context fields, its resolved reasoning effort, its own workspace cwd, and the operator MCP definitions — and pass it to the connector's reconnect-and-resume operation.

#### Scenario: Recorded acquisition values reach the connector
- **GIVEN** a pooled OMP session whose ownership record names mode `native-yolo` and that mode's state namespace, running with a resolved reasoning effort
- **WHEN** its prompt dies mid-flight and the call site invokes reconnect-and-resume
- **THEN** the recovery context SHALL carry exactly the recorded mode and namespace, the session's full gate context and own cwd, the operator MCP definitions, and the resolved reasoning effort — none re-resolved or inferred

#### Scenario: Ownership violation ends only the affected session run
- **GIVEN** a reconnect attempt that fails with an ownership violation while a sibling session runs on the same process
- **WHEN** the call site handles the failure
- **THEN** the affected session SHALL end in error with a bounded ownership-violation reason
- **AND** no prompt SHALL be re-issued for it, no process SHALL be disconnected by the recovery path, and the sibling session SHALL continue unaffected under the unchanged lease

#### Scenario: Fence semantics untouched by recovery outcomes
- **GIVEN** a recovery attempt reaching the connector from the controlled-recovery path with the session's recovery fence raised
- **WHEN** the recovery succeeds, fails as an ownership violation, or fails as a restore failure
- **THEN** the fence raise/settle/decision ordering around the recovery SHALL be exactly the pre-existing controlled-recovery ordering, with the ownership check inserted strictly before the connector's own teardown

#### Scenario: Restore failure ends the affected session as loss
- **GIVEN** a reconnect attempt that fails with a gate-context restore failure rather than an ownership violation
- **WHEN** the call site handles the failure
- **THEN** the affected session SHALL end in error classified as loss of that session, with the same bounded classification as an ownership violation

#### Scenario: Session loss is logged, audited, and kept out of re-prompt
- **GIVEN** a session lost because the connector returned or threw an ownership violation or gate-context restore failure
- **WHEN** the call site classifies the loss
- **THEN** it SHALL log and audit a bounded machine-readable failure reason distinct from capability-absence session loss and surface it through the session's existing error handling
- **AND** the lost session SHALL never continue into the respond-gated re-prompt path or disconnect a process it did not own

### Requirement: Restricted Tool-Inventory Default-Deny Decision

The integration SHALL provide a pure restricted-mode tool decision from tool name, recorded live provenance and decoded input shape. Allow outcomes SHALL name the operation's completing authority rather than authorize execution. Approved local native read/search SHALL use native approval and ambient OS permissions, not asserted ACP filesystem confinement. Every absent table entry SHALL default to deny with a bounded machine-readable reason.

#### Scenario: Unknown tool defaults to deny
- **GIVEN** a restricted OMP session invoking a tool with no inventory table row
- **WHEN** the decision is evaluated for any provenance or input shape
- **THEN** the decision SHALL be deny with the bounded inventory reason
- **AND** no allow path SHALL exist for that name regardless of recorded origin

#### Scenario: OMP-only execution surfaces are denied
- **WHEN** eval, task/subagent, computer, browser, async, launch, debug, AST-mutation, LSP or LSP-referenced config, SSH, an internal device URI scheme, or a configuration write is presented to the restricted decision
- **THEN** each SHALL deny with its bounded inventory reason
- **AND** the table row SHALL cite the approved capability matrix rather than a handoff tool list

#### Scenario: Gated allows delegate completion
- **WHEN** ordinary local read/list/glob/grep/search/find, bash or ordinary write/edit is presented with compliant provenance and decoded input shape
- **THEN** the decision SHALL report its gated or sink-routed outcome naming the native-local or predecessor completing authority
- **AND** the decision module SHALL NOT execute paths, command arguments or record content

#### Scenario: Network parity capabilities gated on pending adapters
- **WHEN** web fetch/URL-read or web search is presented before its completing adapter is available
- **THEN** the decision SHALL report a distinct allow-gated-pending-adapter outcome, never a plain allow and never a parity denial
- **AND** a test SHALL distinguish that outcome from completed adapter admission

#### Scenario: Decision modules are restricted-only
- **GIVEN** a native-YOLO OMP session and an OpenCode session in either permission mode
- **WHEN** their flows are exercised
- **THEN** no restricted tool decision SHALL be consulted for them and no decision denial SHALL be possible
- **AND** OpenCode behavior SHALL remain unchanged

#### Scenario: Allow-row gating inherits session, policy, and sink boundaries
- **GIVEN** an allow row for ordinary local read/list/glob/grep/search/find, bash or ordinary write/edit
- **WHEN** the declared completing authority executes the operation
- **THEN** authenticated local native read/search SHALL follow native activation/approval and the process's ambient OS permissions under the user's accepted native posture
- **AND** that native IO SHALL NOT be claimed confined to daemon session/shared/trusted-skills roots or protected by ACP read denial
- **AND** bash SHALL retain the common command policy and active native permission path
- **AND** ordinary local write/edit SHALL run under the pinned native approval path and the process's ambient OS permissions, with the restricted ACP sink retained as the route the pinned bridge applies where it routes the call, todo state in-session and no new pre-dispatch route gate

#### Scenario: Non-table capabilities route to completing decisions
- **WHEN** delete, move or multi-file patch is presented with compliant provenance
- **THEN** the row SHALL route to the shared complete destructive decision rather than gain a filesystem bypass
- **AND** operator client-owned MCP tools SHALL remain gated by provenance admission

#### Scenario: Inventory omission lands structurally in default-deny
- **GIVEN** a tool absent from the inventory table
- **WHEN** the decision is evaluated for any provenance or input shape
- **THEN** the omission SHALL land in default-deny structurally rather than by audit completeness
- **AND** denial SHALL carry one bounded machine-readable reason

#### Scenario: Surface covers the complete inventory, not handoff lists
- **GIVEN** the pinned OMP tool inventory and implicit side-effect surfaces
- **WHEN** the decision surface is constructed
- **THEN** it SHALL cover that complete inventory, not only historical handoff names
- **AND** nonexistent native list/search names SHALL NOT be synthesized as new tools

### Requirement: Live-Provenance Admission Decision

The restricted decision SHALL admit allow-table tools only from authenticated native-builtin origin, exact canonical owned-extension origin, or operator client-owned MCP origin. Every admission SHALL use an authoritative live registry observation at the current epoch and resource generation. SDK/RPC-host, workspace and unknown origins SHALL NOT gain builtin trust. A name match alone SHALL be insufficient; stale observations SHALL deny pending re-observation.

#### Scenario: Same name from wrong origin denies
- **GIVEN** a workspace- or host-origin tool carrying the name of an allowed inventory entry
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL deny with the bounded provenance reason
- **AND** the same name recorded from the owned extension origin SHALL admit provenance only

#### Scenario: Post-start operator MCP refresh admitted
- **GIVEN** an operator MCP tool registered or refreshed after process startup with client MCP ownership and a current-epoch registry observation
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL admit the tool gated by client ownership
- **AND** no human elicitation or interactive approval SHALL be required for the admission decision

#### Scenario: Stale registry observation re-observes
- **GIVEN** a tool whose recorded provenance predates the current registry epoch
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL deny admission pending a fresh observation rather than admit on the stale record

#### Scenario: Registry-refresh plumbing owned by the enforcement-wiring change
- **GIVEN** an operator MCP tool whose provenance and freshness hold for the live-origin check
- **WHEN** the live-origin check is satisfied by requiring the fresh provenance observation
- **THEN** the registry-refresh plumbing that feeds that observation SHALL be owned by the enforcement-wiring change, not this decision

#### Scenario: Genuine native builtin reaches its authority
- **WHEN** the live runtime registry uniquely identifies an authentic allow-table native builtin at the current epoch and generation
- **THEN** provenance SHALL admit native-builtin origin without relabelling it as owned extension or host
- **AND** execution SHALL still follow its operation's declared completing authority

#### Scenario: SDK injection is not a builtin
- **WHEN** an SDK/RPC-host tool uses the name or claimed builtin identity of an allowed tool
- **THEN** provenance SHALL deny its host origin
- **AND** absent, ambiguous or inconsistent authoritative metadata SHALL also deny

#### Scenario: Foreign replacement loses native authority
- **GIVEN** a previously authentic builtin is replaced by a same-name extension or SDK registration
- **WHEN** the next call is observed
- **THEN** the current origin SHALL replace the old observation
- **AND** cached builtin metadata SHALL NOT authorize the replacement

### Requirement: Alternate-Execution-Entrypoint Blocking Decision

For every capability with an allowed ordinary-tool route, the restricted decision SHALL deny that capability when reached through any different route — an internal device URI scheme, a configuration-write device, a debug device, an AST-mutation device, an SSH device, or an LSP-adjacent mutation route — keying the block on the capability-and-route pair from the decoded input shape, not the tool name alone, and SHALL deny with a bounded reason naming the capability and route pair.

#### Scenario: Allowed capability denied via internal scheme
- **GIVEN** an execution capability whose ordinary tool is allow-gated
- **WHEN** the same capability is presented through an internal device URI scheme route
- **THEN** the decision SHALL deny with the alternate-route reason naming the capability and route

#### Scenario: Config-write posture flip denied while writes are sink-routed
- **GIVEN** ordinary write/edit routed to the filesystem sinks
- **WHEN** an input shape classified as a configuration write targets approval posture or security-relevant settings
- **THEN** the decision SHALL deny the config-device route regardless of the write route's outcome

#### Scenario: Route block survives tool rename
- **WHEN** an alternate-route denial is presented under a different tool name carrying the same capability-and-route pair
- **THEN** the decision SHALL deny with the same capability-and-route pair reason

#### Scenario: Gate or sink status does not excuse an alternate route
- **GIVEN** a capability whose ordinary tool is allow-gated or sink-routed
- **WHEN** the capability is reached through a different route
- **THEN** the decision SHALL deny regardless of the ordinary route's gated or sink-routed status

#### Scenario: Hidden and device routes are fixture cases of the blocking
- **GIVEN** read or write otherwise allowed, or bash separately gated
- **WHEN** a hidden mutation, debug, or device route is reached, or execution proceeds through an internal scheme while bash is separately gated
- **THEN** each SHALL be a fixture case of this blocking, denied with the capability-and-route reason

### Requirement: Exact-Key Approval-Record Interpretation With No Inherited Grants

The restricted decision SHALL interpret native approval records by exact registered tool key only — never wildcard, prefix, or emulated default-deny — and SHALL treat every surviving lower-layer record as non-authoritative: a surviving `allow` record SHALL never yield an execution-time grant, a surviving `prompt` record SHALL never convert a restricted deny into generic elicitation.

#### Scenario: Surviving lower-layer grant does not grant
- **GIVEN** an effective approval map containing a lower-layer `allow` record that survived the folded overlay merge for a tool the restricted decision denies
- **WHEN** the record interpretation is evaluated
- **THEN** the decision SHALL deny and name the surviving-record reason
- **AND** no code path SHALL convert a record-layer `allow` into execution-time admission

#### Scenario: Surviving prompt record does not elicit
- **GIVEN** a lower-layer `prompt` record surviving for a tool the restricted decision denies
- **WHEN** the decision is evaluated
- **THEN** the outcome SHALL remain deny with its bounded reason
- **AND** no generic elicitation, form, or interactive approval SHALL be requested

#### Scenario: Exact-key lookup only
- **WHEN** an approval record exists only under a key that is not the exact registered tool key of the presented call
- **THEN** the interpretation SHALL find no record and the default-deny decision SHALL stand
- **AND** no wildcard or prefix match SHALL be consulted

#### Scenario: Surviving-record behavior modeled without relying on record reset
- **GIVEN** folded overlays letting lower-layer grant, prompt, and deny records persist into an OMP process, with the authoritative record reset recorded as incompatible at the pin
- **WHEN** the record interpretation is evaluated
- **THEN** it SHALL model the surviving-record behavior faithfully and consume the owned-settings change's record-authority verdict without softening it
- **AND** it SHALL NOT assert or depend on a working settings-layer record reset anywhere

#### Scenario: Surviving records are inputs only; default-deny is operative
- **GIVEN** a restricted execution-time decision with surviving lower-layer records
- **WHEN** the record interpretation is evaluated
- **THEN** surviving records SHALL be reported as inputs only
- **AND** the restricted execution-time default-deny SHALL remain the operative boundary

### Requirement: Destructive-Intent Decision Consumed From The Shared Conformance Table

The restricted decision SHALL expose a destructive-intent decision that, given a decoded complete destructive intent in the compatibility contract's shape, returns the shared destructive module's all-target verdict verbatim — normalization, per-target authorization, and completeness verdict delegated, with no second normalizer, no re-derived target logic, and zero side effect on the deny path.

#### Scenario: Conformance fixtures replay identically
- **WHEN** each shared destructive conformance fixture is replayed through the restricted destructive decision
- **THEN** the returned verdict SHALL equal the shared table's verdict for that fixture
- **AND** the module SHALL contain no independent path-authorization logic

#### Scenario: Incomplete intent fails closed with zero side effect
- **GIVEN** a destructive-shaped input whose decoded target set is incomplete or unparseable
- **WHEN** the restricted destructive decision is evaluated
- **THEN** the shared fail-closed reason SHALL be returned with zero mutation attempted

#### Scenario: Fixture families replay through the entry
- **WHEN** complete multi-target authorization, first-target-allowed-with-later-escape denial, incomplete-intent fail-closed, and binding-mismatch rejection fixtures are replayed through the restricted destructive decision
- **THEN** each SHALL return the shared table's verdict for that fixture

#### Scenario: No speculative decoder when native decoding is unavailable
- **GIVEN** the compatibility contract records complete native decoding as unavailable
- **WHEN** a destructive intent is presented to the restricted destructive decision
- **THEN** the honest outcome SHALL be the shared module's fail-closed reason
- **AND** no speculative decoder SHALL be introduced in this entry

### Requirement: MCP Admission Decision With Honest Mechanism Tiers

The restricted decision SHALL admit client-owned operator MCP tools purely on ownership plus registry freshness plus alternate-route screening, and SHALL export the mechanism status of the MCP admission basis as named data tiered from the pinned compatibility ledger: with no MCP boundary row present, the native-side MCP admission mechanism basis SHALL be labeled as needing a mechanism audit, candidate identity paths labeled candidate-to-verify, and no element labeled supported.

#### Scenario: Ledger gap is labeled, never inflated
- **WHEN** the MCP admission mechanism status is exported or inspected
- **THEN** it SHALL record the absence of an MCP boundary row in the pinned ledger
- **AND** no fixture, test pass, or local suite SHALL relabel the basis as supported

#### Scenario: Client-owned MCP tool admitted by decision
- **GIVEN** an operator MCP tool with client ownership, current-epoch observation, and no alternate-route surface
- **WHEN** the MCP admission decision is evaluated
- **THEN** the decision SHALL admit gated by client ownership without any human interaction

#### Scenario: Export cites the ledger gap for downstream consumers
- **GIVEN** the MCP admission mechanism status exported as named data tiered from the pinned compatibility ledger
- **WHEN** the ledger contains no MCP boundary row
- **THEN** the exported status table SHALL cite the ledger gap explicitly so downstream wiring and combined-regression consumers inherit the label
- **AND** the admission decision SHALL require no generic human elicitation

### Requirement: Restricted Tool Decision Verdicts Retain Decided Dispositions

The restricted tool decision modules SHALL preserve the inherited authoritative record-reset incompatible-as-stated and complete destructive-intent unresolved verdicts verbatim, independently from their DECIDED user dispositions. Settings-discovery-path control SHALL replace reset reliance, and the complete ACP-mediated destructive path SHALL remain the boundary with incomplete native shapes denied. No readiness gate or further pending decision SHALL be required.

#### Scenario: Passing decision tests cannot clear the gates
- **WHEN** every decision-table, provenance, record-interpretation, and destructive-consumption test passes
- **THEN** the exported gate SHALL still report record-reset incompatible and destructive-intent unresolved with pinned verdict text and their DECIDED dispositions
- **AND** no synthetic allow-fixture SHALL be citable as native support

#### Scenario: Decided dispositions do not assert native support
- **WHEN** an implementer proposes to treat the record reset or destructive decoding as solved
- **THEN** the DECIDED deployment dispositions SHALL govern application while the native verdicts remain unchanged; any new native-support claim SHALL require source-backed evidence
- **AND** these specifications SHALL NOT be rewritten to claim support in advance of that decision

#### Scenario: Unit and mock evidence validates decision logic only
- **GIVEN** automated unit and mock evidence for these decision modules
- **WHEN** the restricted decision logic is validated — deny-when-unlisted, deny-on-wrong-provenance, deny-on-alternate-route, deny-despite-surviving-grant, and destructive verdicts via the shared table
- **THEN** the evidence SHALL NOT demonstrate that the official binary enforces, resets records, or decodes complete destructive intent

### Requirement: Trusted-Extension Tool-Call Enforcement Wiring

The AIr-owned trusted extension SHALL attach the restricted `tool_call` enforcement handler body to the handler slot registered synchronously during trusted-module loading; that body SHALL decide every restricted tool call solely by composing the restricted tool decision modules — inventory allow/default-deny, live-provenance admit/deny, alternate-route blocking, destructive-intent consumption, and advisory approval-record interpretation — with no decision logic of its own.

#### Scenario: Denied-tool fixture reaches the fail-closed block
- **GIVEN** a restricted handler fixture presenting a tool the inventory decision denies
- **WHEN** the handler body is consulted for that call
- **THEN** the call SHALL be blocked with the bounded inventory reason
- **AND** the underlying tool operation SHALL NOT proceed

#### Scenario: Wrong-origin same-name call blocked live
- **GIVEN** a call whose tool name is on the allow table but whose CURRENT recorded origin is host, workspace, or unowned discovery
- **WHEN** the handler body composes the provenance decision for that call
- **THEN** the call SHALL be blocked with the bounded provenance reason
- **AND** the same name recorded from an owning origin SHALL proceed to its completing authority

#### Scenario: Alternate-route pair blocked beneath an allowed ordinary route
- **GIVEN** a capability whose ordinary tool route would reach an allow-gated or sink-routed outcome
- **WHEN** the same capability-and-route pair is presented through an internal device scheme, configuration device, debug, AST, SSH, or LSP-adjacent route
- **THEN** the handler SHALL block the call with the bounded alternate-route reason naming the pair

#### Scenario: Advisory record never short-circuits a denial
- **GIVEN** an effective approval map containing a surviving lower-layer `allow` record for a tool the inventory or provenance decision denies
- **WHEN** the handler composition runs for that call
- **THEN** the denial SHALL stand and the record SHALL appear only as an advisory input in the decision trace
- **AND** no composition ordering SHALL consult records before inventory, provenance, and alternate-route decisions

#### Scenario: Wiring changes land in decision tables
- **GIVEN** a behavior change requiring new decision logic, call ordering, freshness rules, or error-vocabulary entries
- **WHEN** the wiring is implemented
- **THEN** the change SHALL be made in the decision tables, which along with call ordering, freshness rules, and error vocabulary are the only wiring-owned data
- **AND** the handler body SHALL acquire no decision logic of its own

#### Scenario: Composition cannot be short-circuited
- **GIVEN** a call carrying an advisory approval record, a pending-adapter outcome, or a completion-delegation marker
- **WHEN** the handler body composes the steps in order
- **THEN** no such record, outcome, or marker SHALL short-circuit an inventory, provenance, or alternate-route denial

#### Scenario: Allowed outcomes name the completing authority
- **GIVEN** an allow-gated, sink-routed, or admitted-MCP outcome
- **WHEN** the handler body completes the decision
- **THEN** it SHALL name the completing predecessor authority
- **AND** the handler itself SHALL NOT assert authorization

### Requirement: Per-Call Consultation With Live Origin Observation

The enforcement handler SHALL be consulted on EVERY restricted tool call, including tools that first appear mid-session through dynamic registration or recovery re-discovery, and SHALL read, fresh on each call, the tool's current recorded origin, the current registry epoch, and the current resource generation; no decision, origin record, or registry snapshot SHALL be memoized across calls or trusted from startup.

#### Scenario: Mid-session tool is in scope automatically
- **GIVEN** a tool registered after trusted-module load
- **WHEN** its first restricted call arrives
- **THEN** the handler SHALL consult the decisions against the live registry state of that call
- **AND** no startup-time filter or snapshot SHALL be consulted

#### Scenario: Provenance consumed live, not cached
- **GIVEN** a test fixture whose recorded origin for a tool changes between two otherwise identical calls
- **WHEN** both calls are handled
- **THEN** the two decisions SHALL differ consistently with the current observation
- **AND** any implementation that cached the first decision SHALL fail this scenario

#### Scenario: Stale epoch re-observes instead of admitting
- **GIVEN** a call whose recorded origin observation predates the current registry epoch
- **WHEN** the handler composes the provenance decision
- **THEN** the call SHALL be blocked with the bounded stale-observation reason
- **AND** admission SHALL be possible only on a fresh observation

#### Scenario: Handler failure fails closed
- **GIVEN** a handler composition that throws or exceeds its execution bound
- **WHEN** the call is dispatched
- **THEN** the tool call SHALL be blocked fail-closed
- **AND** no code path SHALL continue the call after the failure

#### Scenario: Stale resource generation denies until refreshed
- **GIVEN** a call whose current resource generation is stale relative to the live tool-metadata observation
- **WHEN** the handler composes the decision
- **THEN** the call SHALL be denied with the re-observe denial rather than admitted

### Requirement: Bounded Fail-Closed Enforcement Errors

A blocked restricted call SHALL surface to the client as a fail-closed tool-call error carrying exactly one bounded machine-readable code from the finite union of the decision-module reason vocabulary and the wiring-level codes for seam blocks, stale observations, and pending-adapter blocks.

#### Scenario: Error shape is bounded and non-secret
- **WHEN** any block fixture's error is inspected
- **THEN** its fields SHALL all originate from the finite code/enumeration set
- **AND** no fixture error SHALL carry payload text, path content, secret material, or model-generated content

#### Scenario: Block is not an elicitation
- **GIVEN** a restricted call blocked by inventory, provenance, alternate-route, destructive, seam, or stale-observation reasons
- **WHEN** the block is surfaced
- **THEN** no permission request, form elicitation, or human-interaction surface SHALL be invoked
- **AND** the run SHALL observe an ordinary bounded failed-tool-call error

#### Scenario: Pending adapter blocks rather than silently allowing
- **GIVEN** a network-parity capability whose completing adapter has not landed
- **WHEN** the handler composes the inventory decision reporting the distinct pending-adapter outcome
- **THEN** the call SHALL be blocked with the bounded pending-adapter reason
- **AND** no unadapted native transport SHALL be reachable through that call

#### Scenario: Error names only enumerated fields
- **GIVEN** a blocked restricted call
- **WHEN** its fail-closed error is surfaced
- **THEN** the error SHALL name at most the capability identifier, route surface, origin category, and stale element, all from static enumerations
- **AND** the error SHALL NOT contain file or argument payloads, model or chat content, credentials, tokens, secrets, or raw tool output

#### Scenario: No retry-prompt echo of blocks
- **GIVEN** a restricted call blocked by any enforcement reason
- **WHEN** the failure is surfaced to the run
- **THEN** the block SHALL NOT be echoed into the retry prompt rejection buffer

### Requirement: Post-Start MCP Registry Refresh Re-Admission

When operator or client-owned MCP tools register or refresh AFTER startup, the wiring SHALL advance the registry epoch from the live tool-metadata observation, re-invoke the MCP admission decision for the fresh epoch, and decide each call from current data, with no generic human-elicitation or form UI anywhere in the path.

#### Scenario: Refreshed owned MCP tool re-admitted on fresh epoch
- **GIVEN** an operator MCP tool registered or refreshed after startup with client ownership and a current-epoch observation
- **WHEN** a restricted call to that tool is handled
- **THEN** the admission decision SHALL be re-invoked for the current epoch and the call SHALL proceed to its completing authority
- **AND** no human interaction SHALL occur in the admission path

#### Scenario: Refreshed untrusted tool stays denied
- **GIVEN** a post-start registration or refresh whose recorded origin is not client MCP ownership or which presents an alternate-route surface
- **WHEN** the refresh path and subsequent calls are handled
- **THEN** the tool SHALL remain denied with the bounded provenance or alternate-route reason
- **AND** the refresh event itself SHALL NOT grant or soften anything

#### Scenario: Refresh carries no one-shot acknowledgement
- **GIVEN** a refreshed MCP tool admitted on one call
- **WHEN** its origin observation or the epoch later goes stale
- **THEN** subsequent calls SHALL deny on staleness without honoring any earlier refresh-time admission

#### Scenario: Refresh freshness uses the registry epoch only
- **GIVEN** a registry refresh that advances the epoch during a session flow
- **WHEN** the next restricted tool call is evaluated
- **THEN** the current registry epoch SHALL be observed afresh and a stale observation SHALL deny
- **AND** no readiness signal, reset, channel or handshake SHALL be consumed

#### Scenario: Unowned-discovery refresh stays denied
- **GIVEN** a post-start MCP registration or refresh recorded under unowned discovery
- **WHEN** a restricted call to that tool is handled
- **THEN** the tool SHALL remain denied with its bounded reason

### Requirement: Restricted-Only Enforcement Registration

The enforcement handler SHALL be attached only in the restricted trusted-extension process, gated on the module's own restricted-mode launch identity, and the exemption SHALL be structural at the registration site — not a mode check inside the decision path.

#### Scenario: YOLO process registers no handler
- **GIVEN** a native-YOLO OMP process fixture built from the shared bootstrap's YOLO branch
- **WHEN** trusted-module loading completes
- **THEN** no restricted tool-call handler SHALL be registered
- **AND** no restricted decision, denial, or record load SHALL be reachable in that process

#### Scenario: OpenCode has no extension handler
- **GIVEN** an OpenCode session flow in either permission mode
- **WHEN** its flows are exercised
- **THEN** no OMP extension or enforcement handler SHALL be loaded
- **AND** behavior SHALL be unchanged from before this requirement

#### Scenario: Non-restricted identity fails closed at the entry
- **GIVEN** a handler entry invoked with an observed process identity that is not the restricted one
- **WHEN** the entry runs
- **THEN** it SHALL fail closed rather than dispatch any composition

### Requirement: Fail-Closed Behavior At Unresolved Inherited Seams

The wiring SHALL export a named enforcement-wiring gate enumerating every inherited unresolved seam with its source verdict reproduced verbatim and its DECIDED user disposition, together with the handler's fail-closed behavior at each seam.

#### Scenario: Seam fixtures fail closed carrying markers
- **WHEN** a fixture exercises each unresolved seam — record survival, destructive undecodability, pending adapter
- **THEN** the call SHALL be blocked fail-closed with its bounded code and the named seam marker
- **AND** no seam fixture SHALL produce an allow or grant contrary to policy

#### Scenario: Passing wiring tests cannot clear the gates
- **WHEN** every wiring, refresh, error-shape, and exemption test passes
- **THEN** the exported gate SHALL still report each inherited verdict verbatim with its DECIDED disposition where recorded
- **AND** no synthetic allow-fixture SHALL be citable as native support for any seam

#### Scenario: Gate resolution requires the source decision
- **WHEN** an implementer proposes to treat any listed seam as resolved
- **THEN** the recorded user dispositions SHALL govern application without changing the inherited verdict; only source-backed evidence may support a new native-mechanism claim
- **AND** these specifications SHALL NOT be rewritten to claim support in advance

#### Scenario: The gate enumerates every inherited seam's verdict
- **GIVEN** the inherited unresolved seams — MCP admission mechanism basis needing a mechanism audit with no boundary row in the pinned compatibility ledger, authoritative approval-record reset incompatible, complete destructive-intent decoding unresolved, network-parity adapters pending, and discovery-side gates consumed as shipped
- **WHEN** the named enforcement-wiring gate is read
- **THEN** each seam SHALL appear with its source verdict reproduced verbatim and its DECIDED user disposition

#### Scenario: No manufactured status completes a fixture or flow
- **GIVEN** any fixture or flow requiring an allow, grant, decoding, or mechanism status
- **WHEN** it runs against the wiring
- **THEN** the wiring SHALL NOT manufacture a passing admission, grant, decoding, or mechanism status to complete it
- **AND** allow-path fixtures SHALL be labeled synthetic, and no fixture or passing test SHALL relabel a status or clear a gate

#### Scenario: Docs state the absence-of-handler residual risk
- **GIVEN** the unresolved seams still standing
- **WHEN** documentation describes the wiring's runtime limits
- **THEN** it SHALL state that no readiness handshake is required and, when handler installation fails, the pinned non-YOLO native approval mode plus client ACP policy remain the ACP-mediated boundary, with fail-closed client policy denials
- **AND** the wiring's evidence SHALL be described as covering wiring decisions only

### Requirement: Enforcement Wiring Evidence Limited To Wiring Decisions

Automated unit and mock evidence SHALL validate the wiring decisions and shapes only — denied fixtures reaching fail-closed bounded errors, provenance consumed live rather than cached, refresh re-admission and rejection on epoch, restricted-only registration with YOLO and OpenCode exemption, seam fail-closed markers, and composition ordering.

#### Scenario: No native-enforcement claim in fixtures
- **WHEN** the wiring suites are reviewed and run
- **THEN** no assertion SHALL claim the native binary dispatched, honored, or enforced anything
- **AND** user-facing documentation SHALL keep the runtime checklist items explicitly unverified

#### Scenario: Predecessor suites prove read-only consumption
- **GIVEN** the decision-module, sink-policy, destructive-policy and discovery suites
- **WHEN** they run unchanged alongside this change
- **THEN** they SHALL pass without modification
- **AND** the wiring SHALL have imported their modules without editing them

#### Scenario: No fixture asserts native enforcement
- **GIVEN** the wiring unit and mock suites
- **WHEN** they assert, imply, or describe what the official OMP binary does
- **THEN** they SHALL NOT claim the binary invokes the enforcement handler, honors a block, enforces an inventory decision, performs an approval-record reset, decodes destructive intent, or otherwise enforces any boundary

#### Scenario: Real invocation stays user-owned runtime verification
- **WHEN** real handler invocation and block enforcement by the official OMP binary are considered
- **THEN** they SHALL remain user-owned runtime verification marked unverified until observed

#### Scenario: Lifecycle errors do not prove handler installation
- **GIVEN** an extension that fails to load
- **WHEN** pinned `runner.emit` logs a lifecycle-hook error without failing startup
- **THEN** the session may lack the restricted capability set and no client-observable readiness assertion SHALL be made
- **AND** the native approval/client ACP fallback SHALL NOT be described as equivalent execution-time default-deny or proof of native callback coverage

### Requirement: OMP Both Modes Carry The LSP Disable

OMP restricted and native-YOLO sessions SHALL both carry `--no-lsp` in their factory launch arguments. Restricted mode SHALL retain the existing `lsp.enabled: false` overlay pin. Row 17 SHALL land before row 25, which exclusively owns the native-YOLO overlay LSP pin and settings content/composition/validator cutover. No restricted tool policy SHALL be copied into YOLO.

#### Scenario: Restricted flag and settings pin compose
- **WHEN** a restricted OMP launch is assembled
- **THEN** --no-lsp SHALL appear exactly once and the ordered owned overlays SHALL retain the restricted lsp.enabled false pin
- **AND** native implicit-startup suppression SHALL remain unverified until user observation

#### Scenario: Native-YOLO carries its own disable
- **WHEN** a native-YOLO OMP launch and mode overlay are assembled
- **THEN** its launch arguments SHALL carry --no-lsp exactly once, independently of the later row-25 settings pin
- **AND** its native approval posture and mode-isolated state SHALL remain unchanged with no restricted handler or approval-record load

### Requirement: OpenCode Both Agents Explicitly Deny The LSP Tool

`agent-config/opencode.json` SHALL explicitly deny the lsp tool per agent for BOTH build and yolo. No top-level global LSP clamp SHALL be introduced; all unrelated permission entries SHALL retain the predecessor posture.

#### Scenario: Build and yolo explicit denies override defaults
- **WHEN** the OpenCode agent permission maps are parsed
- **THEN** build.permission.lsp and yolo.permission.lsp SHALL both be deny
- **AND** no global lsp false or equivalent clamp SHALL exist
- **AND** yolo's otherwise permissive policy SHALL remain unchanged

#### Scenario: Shared-file predecessors are preserved
- **GIVEN** numbered batch row 15 has landed before this change at row 17
- **WHEN** LSP denials are applied
- **THEN** unrelated predecessor build and yolo permissions SHALL remain unchanged
- **AND** later regression baselines SHALL use the config as landed after both rows rather than pre-batch yolo bytes

### Requirement: LSP Implicit Startup Coverage Retains Pinned Evidence Limits

The change SHALL audit pinned OMP v18.6.1 and OpenCode 1.18.21 implicit server startup and cold-start routes separately from explicit tool denial. Recorded incompatible/unresolved verdicts SHALL remain unchanged by DECIDED deployment dispositions or passing mocks. Incomplete coverage SHALL be named without claiming complete native suppression or inventing a global clamp, restricted YOLO handler or version bump.

#### Scenario: Consultable restricted residual route denies
- **GIVEN** a source-cited residual startup route reachable through a restricted tool call
- **WHEN** its LSP-adjacent decision is consulted
- **THEN** an additive default-deny row SHALL block it through existing restricted enforcement
- **AND** shipped inventory rows and handler semantics SHALL remain unchanged

#### Scenario: Native-internal or YOLO residual remains explicit
- **GIVEN** a startup route outside restricted handler coverage
- **WHEN** the source audit records coverage
- **THEN** the exact uncovered route and symbols SHALL be recorded
- **AND** no artifact SHALL claim the restricted handler prevents that route or native suppression is complete

#### Scenario: OpenCode explicit denial is not implicit-startup evidence
- **WHEN** build and yolo explicit lsp denial tests pass
- **THEN** they SHALL establish permission-map wiring only
- **AND** the pinned implicit-scoping incompatibility and automatic-startup coverage limits SHALL remain recorded
- **AND** OpenCode 1.18.21 SHALL remain pinned

### Requirement: Both-Agent LSP Evidence And Documentation Boundary

Documentation, CHANGELOG and handoff SHALL state decision 5's OMP restricted+YOLO and OpenCode build+yolo posture, separating source claims, unit/mock wiring evidence and user-owned native observations. Native implicit-startup suppression in all four agent/mode combinations SHALL remain unverified until observed.

#### Scenario: Wiring suite has no native claim
- **WHEN** config, launch and conditional-decision fixtures pass
- **THEN** evidence SHALL cover both OMP disable carriers, both OpenCode per-agent denies, no global clamp and preservation of unrelated permissions only
- **AND** no test SHALL certify native language-server suppression

#### Scenario: Permission docs and checklist match the decision
- **WHEN** permission docs, changelog and runtime checklist are written
- **THEN** both agents and both modes SHALL be named with their selected carriers and recorded coverage limits
- **AND** all native implicit-startup observations SHALL be explicitly unverified

### Requirement: Controlled URL-Fetch Transport Adapter Decision Core

The restricted OMP deployment SHALL provide a URL-fetch transport adapter decision core that, for every model-supplied URL read and scraper-derived secondary URL, decides `allow-direct`, `allow-via-proxy`, or `block` from the URL, the consumed egress posture, and an injectable DNS/transport boundary, reusing the existing SSRF rule set as the single classifier. The core SHALL NOT re-implement, fork, or soften that rule set.

#### Scenario: Public target admitted under either posture
- **GIVEN** a mocked DNS answer containing only public addresses for an `https` model-supplied URL
- **WHEN** the adapter decision core is consulted under the enforcing posture and again under the operator unrestricted-egress posture
- **THEN** both decisions SHALL permit the request
- **AND** the enforcing decision SHALL name the validating-proxy route

#### Scenario: Private and metadata targets blocked under enforcing posture
- **GIVEN** mocked DNS answers for loopback, RFC1918, link-local, unique-local, unspecified, multicast, and cloud-metadata addresses
- **WHEN** each is presented as a model-supplied URL read target under the enforcing posture
- **THEN** each decision SHALL be a block naming the rejected address class
- **AND** no transport request SHALL be issued for any of them

#### Scenario: Non-http scheme rejected at the decision
- **GIVEN** a URL read input with an internal or custom scheme (for example an internal device scheme)
- **WHEN** the adapter decision core is consulted
- **THEN** the decision SHALL be a block and the input SHALL NOT be proxied by the adapter

#### Scenario: Shared classifier details stay the single rule set
- **GIVEN** URL read inputs exercising scheme, resolution, and address-class rules
- **WHEN** the decision core classifies them under either posture
- **THEN** the scheme SHALL be restricted to `http`/`https`, the host SHALL resolve to a public address, and loopback, private (RFC1918), link-local, unique-local, unspecified, multicast, reserved, and cloud-metadata addresses SHALL be rejected
- **AND** the decision SHALL come only from the shared SSRF rule set

#### Scenario: HTTP_PROXY presence is non-enforcement
- **GIVEN** an environment where `HTTP_PROXY` is present
- **WHEN** the decision core classifies a URL read target
- **THEN** the decision SHALL treat `HTTP_PROXY` presence as non-enforcement
- **AND** the verdict SHALL be identical to one reached without `HTTP_PROXY`

### Requirement: Manual Per-Hop Redirect and Secondary-URL Re-Validation

The adapter SHALL treat every redirect hop and every scraper secondary URL as a fresh decision input: redirect responses SHALL be handled manually (never by automatic native hop following), and each hop target SHALL be re-validated through the same SSRF rules before the next request is issued, with the chain bounded by the existing five-hop maximum.

#### Scenario: Public-to-private redirect blocked at the hop
- **GIVEN** a synthetic redirect chain whose first hop is public and whose `Location` resolves, via mocked DNS, to a loopback address
- **WHEN** the adapter processes the chain
- **THEN** the request to the private hop SHALL NOT be issued
- **AND** the decision SHALL be a block naming the redirect-hop re-validation

#### Scenario: Six-hop chain blocked at the bound
- **GIVEN** a synthetic chain of six public redirect hops
- **WHEN** the adapter processes the chain
- **THEN** the decision SHALL be a block with the hop-limit reason after at most five followed hops

#### Scenario: Scraper secondary URL validated like the initial URL
- **GIVEN** a text fetch whose response advertises a secondary URL (for example a markdown or feed alternate) resolving to a private address under the enforcing posture
- **WHEN** the adapter decides the secondary request
- **THEN** the secondary request SHALL be blocked under the same rules as a model-supplied URL

#### Scenario: Hop to a restricted address class blocked at that hop
- **GIVEN** a redirect hop or scraper secondary URL whose target resolves to a link-local, unique-local, or metadata address after an initially public hop
- **WHEN** the adapter re-validates the hop
- **THEN** the decision SHALL be a block at that hop
- **AND** no request SHALL be issued to the restricted target

### Requirement: Egress-Policy-Selected Proxy Routing with Operator Posture Preserved

When the consumed egress configuration enables `egressProxy` and disables `unrestrictedEgress`, every adapter-allowed URL-read hop SHALL be routed through the running AIr validating egress proxy endpoint in addition to the adapter's own validation, with configuration values consumed unchanged.

#### Scenario: Enforcing posture selects the proxy route
- **GIVEN** the enforcing egress posture and a public validated target
- **WHEN** the adapter produces its transport plan
- **THEN** the plan SHALL route through the running validating-proxy endpoint
- **AND** the adapter SHALL still have performed its own SSRF validation for that hop

#### Scenario: Unrestricted posture adds no new denial
- **GIVEN** an operator-selected unrestricted-egress posture
- **WHEN** public targets (text or binary, within the hop bound) are fetched
- **THEN** the adapter SHALL allow them without proxy routing
- **AND** only the shared rule set (private/metadata targets, hop bound) may still block

#### Scenario: YOLO-only network denial is not introduced
- **WHEN** the adapter composes denials under the unrestricted-egress posture
- **THEN** the adapter SHALL introduce no additional denial beyond the shared SSRF rule set
- **AND** the adapter SHALL introduce no YOLO-only network denial

#### Scenario: Best-effort environment routing stays documented
- **WHEN** best-effort environment routing is relied on under the unrestricted-egress posture
- **THEN** it SHALL remain documented as not kernel-guaranteed

### Requirement: Text and Binary Fetch Paths with Credential-Free Decision Records

The adapter SHALL expose distinct text and binary decision/transport paths mirroring the native URL-read shapes: a bounded text route for page and markdown bodies, and a binary route carrying content-length pre-check, streaming size cap, and content-disposition/extension hints.

#### Scenario: Binary route preserves native-shaped limits
- **GIVEN** a mocked binary response with a declared content length above the configured maximum
- **WHEN** the adapter's binary route processes it
- **THEN** the fetch SHALL be refused with the size-limit reason before the full body is read
- **AND** a within-limit binary SHALL return bytes plus disposition/extension hints

#### Scenario: Decision records carry no credentials or payload
- **GIVEN** any allow or deny fixture whose URL includes userinfo and a query string and whose response includes header values
- **WHEN** the resulting decision records and adapter log lines are inspected
- **THEN** neither SHALL contain the userinfo, query string, headers, credentials, or payload bytes

#### Scenario: Records carry only the enumerated decision fields
- **GIVEN** any adapter decision record or log line
- **WHEN** its contents are inspected
- **THEN** it SHALL contain at most the target host, hop index, decision, and reason code

### Requirement: Source-Cited Supported-Route Enumeration with Honest Blocked Residuals

The change SHALL enumerate, as machine-readable route data with pinned-source citations, which native URL-read routes are interceptable by supported mechanisms versus the recorded bypasses, marking the `read` URL-branch routes (text, binary, secondary hops, and their materialization consumers) as completed via the trusted extension's controlled replacement of the `read` tool, and keeping every route the replacement does not cover blocked under the enforcing posture.

#### Scenario: Completed routes are exactly the replaced read URL branch
- **WHEN** the route table is read
- **THEN** `completed-by-adapter` SHALL cover the controlled `read` URL-branch text, binary, and secondary-hop routes and their materialization consumers, plus controlled search-provider routes exactly when their backend contract holds
- **AND** every search-provider route without a supported backend or controlled replacement SHALL carry a bounded blocked disposition

#### Scenario: Recorded bypass is not relabeled by mocks
- **GIVEN** the pinned-source record that the primary page load and binary fetch follow redirects automatically via global fetch
- **WHEN** this change's tests pass
- **THEN** the route table SHALL still mark those native functions' direct-use routes as blocked for any caller outside the replacement
- **AND** no mock result SHALL be cited as clearing that record or proving the native binary invokes the replacement

#### Scenario: Uncovered route keeps failing closed
- **GIVEN** a URL-reading call presented through a route absent from the completed set
- **WHEN** enforcement composes the decision under the enforcing posture
- **THEN** the call SHALL be blocked with the pending-adapter reason
- **AND** no unadapted native transport SHALL be reachable through it

#### Scenario: Replacement preserves non-URL delegation
- **GIVEN** the trusted extension's controlled replacement of the `read` tool overlaying the registry for the same tool name
- **WHEN** a non-URL input is routed to the tool
- **THEN** the input SHALL be delegated to the captured native implementation
- **AND** the replacement SHALL be the supported registration mechanism completing the URL branch

#### Scenario: Partial fetch-override seam recorded as not selected
- **GIVEN** the partial native fetch-override seam with enrichment-only reach
- **WHEN** the route data is compiled
- **THEN** the seam SHALL be recorded as existing but not selected
- **AND** its enrichment-only reach SHALL be cited

### Requirement: Pending-Adapter Seam Completion Is Additive and Route-Scoped

The restricted tool-inventory seam for network parity capabilities SHALL be updated additively: the web-fetch/URL-read row gains a completing-adapter marker naming this change and its completed-route table, while the web-search row retains its separate backend-gated completion contract. The completion marker SHALL be distinguishable from a plain allow, and completing a route SHALL change no table shape, composition order, or error vocabulary owned by the enforcement wiring.

#### Scenario: Only the URL-read row completes
- **WHEN** the updated seam data is inspected
- **THEN** the URL-read row SHALL name the completing adapter and route table
- **AND** the web-search row SHALL retain its separate backend-gated completion contract
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

#### Scenario: URL completion is consumed after provenance admission
- **GIVEN** a registered owned URL-read replacement and a completed controlled route
- **WHEN** restricted enforcement evaluates that URL call
- **THEN** it SHALL name the controlled replacement as the completing boundary and permit that replacement to execute
- **AND** it SHALL NOT block solely because the inventory verdict is network-adapter-gated

#### Scenario: A completion marker cannot admit another route
- **WHEN** a call uses foreign provenance, an unregistered replacement, or an uncovered native URL route
- **THEN** the marker SHALL NOT authorize execution and no network request SHALL be dispatched

### Requirement: Trusted Loopback and Provider Routing Remain Distinct from Model Fetch Targets

The adapter's target decision SHALL apply only to model-supplied or fetch-derived URLs. Trusted deployment transport facts — the Skill API loopback endpoint, operator-configured provider endpoints, and the validating-proxy endpoint itself — SHALL NOT participate in, widen, or bypass the model-target decision, and the presence of a trusted loopback call SHALL never authorize a model fetch to an arbitrary loopback or private target.

#### Scenario: Trusted loopback existence does not authorize model loopback fetch
- **GIVEN** an enforcing-posture deployment whose agent process legitimately reaches the Skill API over loopback
- **WHEN** a model-supplied URL read targets a loopback or private address
- **THEN** the adapter decision SHALL be a block
- **AND** the Skill API path SHALL remain reachable through its existing, separate transport

### Requirement: URL-Fetch Adapter Acceptance Is Deterministic Mock-Only

All adapter acceptance SHALL run against a mocked fetch transport, mocked DNS resolution, and synthetic redirect chains with zero network contact, certifying allow/deny decisions, proxy-route selection under both egress postures, per-hop re-validation, the hop bound, text/binary behavior, credential-free records, and route-table verdicts.

#### Scenario: Whole suite runs without network access
- **WHEN** the adapter test suites execute
- **THEN** every request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address or require a credential

#### Scenario: Native use stays user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real URL-read traffic through the adapter/proxy, including binary/text fetches, redirects, and private-target failures, marked unverified until user-observed

#### Scenario: No mock certifies native hook coverage
- **WHEN** the mocked acceptance suites pass
- **THEN** no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record

### Requirement: Controlled Web-Search Transport Routing Through the URL-Fetch Decision Core

The restricted OMP deployment SHALL route every adapter-served web-search provider request and every provider result-enrichment subrequest through the same controlled transport decision core, single SSRF rule set, and manual per-hop redirect revalidation with the existing hop bound established for URL reads, and SHALL treat environment proxy presence as non-enforcement exactly as the URL-read adapter does.

#### Scenario: Provider endpoint request follows the consumed egress posture
- **GIVEN** a mocked provider endpoint whose host resolves, via mocked DNS, to public addresses only
- **WHEN** the search adapter plans the request under the enforcing posture and again under the operator unrestricted-egress posture
- **THEN** both decisions SHALL permit the request
- **AND** the enforcing decision SHALL name the validating-proxy route while the unrestricted decision SHALL add no new denial beyond the shared rule set

#### Scenario: Private-target provider or enrichment request blocked
- **GIVEN** mocked DNS answers placing a provider endpoint or an enrichment-redirect target in loopback, RFC1918, link-local, unique-local, or cloud-metadata space under the enforcing posture
- **WHEN** the search adapter decides that hop
- **THEN** the decision SHALL be a block naming the rejected address class
- **AND** no transport request SHALL be issued for it

#### Scenario: No unguarded native retry outside the controlled path
- **GIVEN** a mocked provider response that the native transport would retry with automatic backoff
- **WHEN** the restricted adapter serves the same request
- **THEN** every issued attempt SHALL carry a prior controlled-transport decision
- **AND** the test fixture SHALL show no request issued without one
 
#### Scenario: Rule set is never reimplemented or softened
- **GIVEN** the controlled decision core and SSRF rule set established for URL reads
- **WHEN** the web-search adapter schedules provider or enrichment hops
- **THEN** the adapter SHALL NOT re-implement, fork, soften, or bypass that rule set

### Requirement: Web-Search Backend Tiering Restricted to the Supported Credential Set

The change SHALL enumerate every pinned web-search provider surface as machine-readable route data with pinned-source citations, tiered `supported`, `candidate-to-verify`, or `no-supported-mechanism` against the supported credential set (the Gemini and OpenRouter provider credentials passed by the agent-configuration change); only the Gemini and OpenRouter grounded backends reachable with those credentials SHALL be selected as supported.

#### Scenario: Supported tiering is credential-set-keyed with citations
- **WHEN** the search route table is read
- **THEN** exactly the grounded backends reachable through the two supported provider credentials SHALL carry the supported tier with source citations
- **AND** every backend needing a credential outside that set SHALL carry the no-supported-mechanism tier with a user-decision marker
- **AND** keyless scraping engines SHALL be marked candidate-to-verify and not selected

#### Scenario: No unrelated secret is ever required or configured
- **GIVEN** a deployment whose only search-relevant credentials are the two supported provider keys
- **WHEN** the adapter selects a backend
- **THEN** the selection SHALL come from the supported tier only
- **AND** no test, fixture, documentation page, or configuration surface introduced by this change SHALL require a credential outside the supported set
 
#### Scenario: No unrelated vendor secret is accepted
- **GIVEN** an operator attempting to configure an unrelated vendor secret or a general search-provider surface
- **WHEN** the web-search adapter is asked to adopt that configuration
- **THEN** the adapter SHALL NOT require, recommend, or accept the unrelated secret
- **AND** this change SHALL add no general search-provider configuration surface

### Requirement: Web-Search Native Interface, Citation, and Error Honesty

The completed web-search route SHALL preserve the agent's native search-tool interface — query parameter shape unchanged, result envelope with formatted output carrying titled, URL-attributed, cited excerpts matching the native formatter's structure, and the native empty-result-versus-error distinction — and SHALL surface provider authentication, rate-limit, HTTP, malformed-response, and no-sources failures as honest tool errors in the native failure-message shape.

#### Scenario: Grounded success keeps native citation layout
- **GIVEN** a mocked supported-provider response containing an answer with sources and citations
- **WHEN** the adapter renders the tool result
- **THEN** the output SHALL contain the native sources and citations sections with per-item title, URL, and excerpt attribution
- **AND** the result envelope SHALL match the native `{content, details.response}` shape

#### Scenario: Provider auth and rate failures are honest tool errors
- **GIVEN** mocked provider responses simulating an authentication rejection and a rate-limit rejection
- **WHEN** each is served to the restricted adapter
- **THEN** the tool result SHALL be an error in the native provider-failure message shape naming the provider
- **AND** no result content SHALL be fabricated and no agent switch or silent different-backend fallback SHALL occur

#### Scenario: Empty result stays distinct from error
- **GIVEN** a mocked provider response with a renderable answer but zero sources and no citations
- **WHEN** the adapter processes it
- **THEN** the outcome SHALL be the honest native no-sources failure, not a fabricated success
- **AND** a separately mocked genuinely empty candidate chain SHALL produce the native no-configured-search-model-shaped message distinct from provider errors

#### Scenario: Search decision records carry no credentials
- **GIVEN** a completed-search fixture whose request headers carry a provider key and whose enrichment URL carries a query string
- **WHEN** the resulting decision records and adapter log lines are inspected
- **THEN** neither SHALL contain the credential, header, userinfo, query string, or payload bytes
 
#### Scenario: HTTP and malformed responses fail honestly
- **GIVEN** mocked provider responses with an HTTP transport failure and a malformed response body
- **WHEN** each is served to the restricted adapter
- **THEN** each SHALL surface as an honest tool error in the native failure-message shape
- **AND** neither SHALL fabricate result content or switch agents

#### Scenario: Decision records carry the minimal allowed fields
- **WHEN** decision records and adapter log lines are produced for a completed search
- **THEN** each SHALL carry at most host, hop index, decision, and reason code

### Requirement: Credential-Absent Web Search Fails Closed With a Documented Capability Gap

When neither supported backend's credential exists for the restricted process, the web-search route SHALL remain blocked with the pending-adapter outcome and a user-decision marker rather than inventing a mechanism, selecting a scraping engine, or requesting a new secret; the capability gap SHALL be documented, and the block SHALL be observable without any network request.

#### Scenario: No supported credential yields a fail-closed block
- **GIVEN** a restricted-process fixture whose credential inputs contain neither supported provider key
- **WHEN** the web-search decision is consulted
- **THEN** the result SHALL be the blocked pending-adapter decision with the user-decision marker
- **AND** no mocked transport SHALL record any issued request

### Requirement: Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated

The restricted tool-inventory seam SHALL be updated additively and backend-gated: the web-search row gains a completing-adapter marker, active exactly where a supported-tier backend exists under the supported credential set and a controlled-transport contract is satisfied, while every credential-absent or unsupported-backend state retains the distinct pending-adapter outcome; the completion marker SHALL remain distinguishable from a plain allow.

#### Scenario: Only the web-search row completes where its contract holds
- **WHEN** the updated seam data is inspected with a supported credential present
- **THEN** the web-search row SHALL name the completing adapter and the search route table
- **AND** credential-absent and unsupported-backend states SHALL still report the pending-adapter outcome
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

#### Scenario: Credential-absent keeps the seam pending
- **WHEN** the same seam data is evaluated with no supported search credential
- **THEN** the web-search outcome SHALL be the pending-adapter block, not an allow

#### Scenario: Route tables agree
- **WHEN** both the search route table and the URL-fetch route registry are read
- **THEN** the URL-read completed routes SHALL be unchanged by this change
- **AND** the search-provider subrequest route SHALL never be recorded pending by one table while the other claims adapter completion for the same satisfied contract

#### Scenario: Completion never alters enforcement-owned wiring
- **WHEN** the completing-adapter seam update is applied
- **THEN** the update SHALL complete no table shape, composition order, or error vocabulary owned by the enforcement wiring
- **AND** the URL-read route set completed by the URL-fetch transport change SHALL retain the same authorization behavior

#### Scenario: Supported search completion reaches controlled execution
- **GIVEN** an owned registered search replacement, a supported configured backend, and a completed controlled route
- **WHEN** the native restricted callback evaluates a search call
- **THEN** it SHALL permit only the controlled replacement to complete execution
- **AND** the result SHALL preserve attribution and the current egress posture

#### Scenario: Absent backend cannot be bypassed by unrestricted egress
- **GIVEN** no supported configured search backend and explicit unrestricted egress
- **WHEN** the native restricted callback evaluates a search call
- **THEN** it SHALL return a bounded capability error with zero endpoint requests
- **AND** it SHALL NOT retry through native transport or fabricate results

#### Scenario: A private secondary hop remains rejected
- **GIVEN** enforcing egress and an admitted controlled search call
- **WHEN** a redirect or secondary request targets a prohibited private address
- **THEN** the existing transport SHALL reject that hop before dispatch
- **AND** admission SHALL NOT override per-hop authorization

### Requirement: Native YOLO Web Search Keeps Native Behavior

The web-search replacement SHALL register and apply in restricted sessions only; a native-YOLO OMP session SHALL execute the captured native `web_search` tool with no adapter clamp, no added denial, and no routing change introduced by this change, preserving the approved native-YOLO posture and the existing deployment egress configuration semantics.

#### Scenario: YOLO delegates to the captured native tool
- **GIVEN** a native-YOLO fixture invoking `web_search`
- **WHEN** the trusted-extension replacement handles the call
- **THEN** the call SHALL delegate verbatim to the captured native tool
- **AND** no restricted-mode decision SHALL appear in the delegation path

### Requirement: Web-Search Adapter Acceptance Is Deterministic Mock-Only

All web-search adapter acceptance SHALL run deterministically against mocked provider endpoints, mocked DNS resolution, and synthetic redirect/enrichment chains with zero network contact and no live or paid search; native-side behavior — the compiled agent actually invoking the replacement and adapter — SHALL remain on the user-owned runtime verification checklist.

#### Scenario: Whole suite runs without network access or paid providers
- **WHEN** the web-search adapter test suites execute
- **THEN** every provider request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address, require a real credential, or incur provider cost

#### Scenario: Native search-tool use stays user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real web-search traffic through the adapter/proxy — including enrichment redirects and private-target failures — marked unverified until user-observed
 
#### Scenario: Mock suite certifies the restricted-decision surface
- **WHEN** the mock-only acceptance suite executes
- **THEN** the suite SHALL certify backend-selection and credential-scope decisions, allow/deny/routing outcomes under both egress postures, enrichment-subrequest revalidation, error-shape honesty, interface/citation layout stability, the credential-absent fail-closed path, and the route-table and seam-data verdicts
- **AND** no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record

### Requirement: Combined Mock-ACP Lifecycle Integration Suite

The combined mock-ACP lifecycle integration suite SHALL drive the real `AgentConnector`, `AgentProcessPool`, and `SessionOrchestrator` wiring through mock ACP subprocess and in-process connection fixtures, covering happy path, crash recovery, cross-mode rejection, registry-refresh re-admission, lease serialization, LSP posture, and OpenCode flows. Every scenario SHALL exercise at least two shipped components and SHALL NOT restate a predecessor single-component unit assertion.

#### Scenario: Crash recovery restores config and ownership in one flow
- **GIVEN** a restricted OMP session established through real pool acquisition with a recorded ownership context
- **WHEN** the mock subprocess dies mid-prompt and recovery reconnects and loads the session
- **THEN** recovery SHALL re-enter the same mode's pool entry, verify ownership, restore the config-options cache from the load response, and reapply the session's model through the shipped stable-first code path
- **AND** the re-issued prompt SHALL execute with the recovered session's own gate context

#### Scenario: Cross-mode load is rejected in both directions without collateral effects
- **GIVEN** a live native-YOLO-owned session and a restricted recovery context (and the mirror pairing)
- **WHEN** either context attempts to load the opposite-mode-owned session
- **THEN** recovery SHALL report the ownership violation before any teardown
- **AND** the opposite mode's live process, lease, and sibling sessions SHALL be unaffected

#### Scenario: Registry-refresh re-admission composes through the shipped decision modules
- **GIVEN** a restricted composition fixture whose live tool-metadata observation gains or replaces an operator MCP tool after startup
- **WHEN** the registry epoch advances
- **THEN** provenance SHALL be re-observed on the fresh epoch, and admission or denial SHALL be produced by the shipped decision modules through the shipped wiring
- **AND** a denied call SHALL surface the bounded fail-closed error shape with no stale-epoch grant honored

#### Scenario: Dual-mode coexistence still serializes on the global lease
- **GIVEN** a restricted and a native-YOLO OMP session concurrently live in one channel under separate mode-keyed pool entries
- **WHEN** both request execution
- **THEN** at most one session SHALL hold the execution lease at any instant across both entries

#### Scenario: OpenCode regression flows remain byte-identical
- **GIVEN** an OpenCode session driving initialize/new/prompt/cancel/load and pool reuse through the same harness
- **WHEN** pool keys, spawn environment, and command strings are captured
- **THEN** they SHALL byte-match the current shipped OpenCode values
- **AND** no readiness verification or OMP trusted extension SHALL be involved, and the baseline SHALL retain build+yolo per-agent explicit lsp denies after numbered rows 15 and 17

#### Scenario: Happy path completes through real pool wiring
- **GIVEN** mock ACP subprocess and scripted in-process connection fixtures for a restricted session
- **WHEN** the suite drives initialize, new, prompt, cancel, and load through the combined harness
- **THEN** each step SHALL complete through the real `AgentConnector`, `AgentProcessPool`, and `SessionOrchestrator` wiring
- **AND** the scenario SHALL exercise at least two shipped components together

#### Scenario: LSP disablement posture survives crash-respawn and same-mode load
- **GIVEN** an OMP session in either restricted or native-YOLO mode with its selected LSP disable carrier
- **WHEN** the mock subprocess crashes, respawns, or the session is re-loaded in the same mode
- **THEN** the selected mode's LSP disable carrier SHALL be preserved across crash-respawn and same-mode load
- **AND** native-YOLO SHALL carry its LSP disable without loading restricted tool policy, and no fixture SHALL certify implicit startup suppression

### Requirement: Fail-Closed Honest Posture Assertions in the Lifecycle Suite

Every unresolved inherited seam exercised by the combined lifecycle suite SHALL be asserted on its deny or blocked outcome, and every allow-path fixture SHALL be carried as a labeled synthetic positive verified by a runtime suite guard. No test name, comment, or assertion SHALL claim or imply that the native OMP binary invokes a handler, honors a denial, rejects a cross-mode load, emits readiness, or suppresses a language server.

#### Scenario: Absent-handler sessions retain the native approval and ACP client boundary
- **GIVEN** a restricted OMP session whose extension handler is not installed
- **WHEN** an unauthorized ACP-mediated operation is requested through the real client policy
- **THEN** the operation SHALL fail closed with the client policy's bounded denial and zero side effects
- **AND** the pinned non-YOLO native approval launch posture SHALL remain unchanged with no readiness handshake, fallback spawn or mode promotion

#### Scenario: Synthetic allow fixtures are registered and labeled
- **GIVEN** any scenario in which a restricted call or prompt is allowed
- **WHEN** the suite-level fixture ledger is inspected at runtime
- **THEN** the enabling fixture SHALL be present as a labeled synthetic positive
- **AND** no result SHALL be presented as evidence of native emission or enforcement

#### Scenario: Undecodable destructive intent fails closed end to end
- **GIVEN** a restricted composition fixture presenting an incomplete or undecodable destructive intent through the shipped wiring
- **WHEN** the handler decision is evaluated
- **THEN** the shared fail-closed verdict SHALL be returned
- **AND** no filesystem side effect or grant SHALL occur

#### Scenario: MCP admission basis appears at honest audit status
- **GIVEN** a restricted composition fixture exercising the MCP admission basis
- **WHEN** its admission basis is asserted by the lifecycle suite
- **THEN** the basis SHALL appear at its `needs-mechanism-audit` / `candidate-to-verify` status
- **AND** it SHALL not be presented as an allow-path claim

#### Scenario: Surviving lower-layer approval records never grant
- **GIVEN** lower-layer approval records surviving in a restricted flow
- **WHEN** the suite inspects them while asserting a deny or blocked outcome
- **THEN** surviving lower-layer approval records SHALL never produce a grant
- **AND** the denied or blocked outcome SHALL be the sole asserted result

#### Scenario: No test wording claims native OMP behavior
- **GIVEN** the combined suite's test names, comments, and assertions
- **WHEN** they are reviewed for posture honesty
- **THEN** none SHALL claim or imply that the native OMP binary invokes a handler, honors a denial, rejects a cross-mode load, emits readiness, or suppresses a language server

### Requirement: Shared OMP Mock Session Builder Contract

The suite SHALL extract a shared mock-session builder exposing scenario composition for permission mode, recorded ownership context, config-option catalog shape, handler availability (default absent with non-YOLO native approval and ACP client fallback), registry epoch with live tool-observation fixtures, and destructive-input shape, with every synthetic positive wrapped in a labeled carrier and no default allow path.

#### Scenario: Default composition is fail-closed
- **WHEN** the builder is invoked without an explicit synthetic installed-handler or trusted-provenance override
- **THEN** the composed fixture SHALL carry an absent handler and untrusted-default tool observations, with ACP client denials still fail-closed
- **AND** any scenario allowing execution SHALL have explicitly supplied a labeled synthetic positive

#### Scenario: Follow-up suite consumes the builder without modification
- **GIVEN** the follow-up per-spawn/pool skill-handoff regression imports the builder
- **WHEN** it composes pooled OMP sessions
- **THEN** it SHALL add any needed fields additively in its own change
- **AND** the existing builder behavior for lifecycle scenarios SHALL remain unchanged

#### Scenario: Composition surface covers every scenario dimension
- **GIVEN** a scenario composing a mock OMP session through the shared builder
- **WHEN** it configures permission mode, recorded ownership context, config-option catalog shape (flat, grouped, catalog-miss, absent), handler availability, registry epoch with live tool-observation fixtures, or destructive-input shape
- **THEN** the builder SHALL expose each dimension's scenario composition
- **AND** handler availability SHALL default to absent without any readiness assertion; client policy denials and untrusted handler observations SHALL fail closed

### Requirement: Lifecycle Suite Determinism and Execution Boundaries

The combined lifecycle suite SHALL be deterministic: timer-driven paths SHALL use the repository's fake-time pattern, subprocess interactions SHALL be bounded on explicit recorded RPCs or the connector's crash signal, and no new test SHALL rely on wall-clock sleeps or delay-based kill races. The suite SHALL require no network access, real agent, official `omp` executable, provider or paid credentials, or container/bwrap execution.

#### Scenario: No sleep-dependent new tests
- **WHEN** the new suite's tests are examined for timing behavior
- **THEN** every time-sensitive assertion SHALL be driven by fake-time advancement or an explicit scripted message or crash signal
- **AND** no new test SHALL contain a wall-clock sleep used to await state

#### Scenario: Integration task stays live-acceptance-free
- **GIVEN** the repository's integration test task executes the new suite
- **WHEN** the suite runs
- **THEN** only in-process fixtures and `deno`-launched mock subprocesses SHALL be spawned
- **AND** no `omp --version`, container build, bwrap invocation, or external provider request SHALL occur

#### Scenario: No live external dependencies
- **GIVEN** the repository's integration test task executes the combined suite
- **WHEN** the suite runs
- **THEN** it SHALL require no network access to external hosts, no real agent, and no official `omp` executable
- **AND** no provider or paid credential SHALL be used, and the suite SHALL run under the existing integration task and coverage gates without silently invoking live-agent acceptance

### Requirement: Non-Duplication and Justified Deletion Rule for the Lifecycle Suite

The combined suite SHALL NOT duplicate single-component unit assertions already shipped by predecessor rows' suites. A redundant unit case MAY be deleted only when the combined suite fully supersedes its observable outcome, and each deletion SHALL be individually justified in the commit message naming the superseding scenario. Absent a true redundancy, deleting nothing is a conforming outcome; the rule SHALL NOT be satisfied by weakening or modifying existing unit assertions.

#### Scenario: Deletion requires a named superseding scenario
- **WHEN** a predecessor unit test case is deleted alongside this suite
- **THEN** the deletion commit SHALL name the case and the combined scenario whose real-code flow asserts the same observable outcome
- **AND** no unit assertion SHALL be weakened, only removed under this rule or left intact

#### Scenario: Missing handler is an accepted residual risk
- **GIVEN** pinned runner.emit logs extension lifecycle-hook errors without failing startup
- **WHEN** an extension fails to load
- **THEN** the session may run without the restricted capability set and no client-observable readiness assertion SHALL be made
- **AND** native non-YOLO approval plus client ACP policy SHALL NOT be claimed equivalent to installed-handler default-deny or proof of native callback coverage

### Requirement: Owned-Only OMP Settings Discovery Sources

Before OMP spawn and native session new/load/recovery or repository-triggered rediscovery, the system SHALL verify that only exact deployment-owned `--config` overlays can contribute persistent settings. Inherited HOME/XDG, native global/project, legacy and foreign-provider lower sources SHALL be excluded. Observation failure or unexpected sources SHALL reject before the native protected request without removing user files or relying on precedence to erase lower-only records.

#### Scenario: Hostile HOME or XDG settings cannot become a lower layer
- **GIVEN** hostile settings under daemon HOME or XDG roots and inherited selectors pointing there
- **WHEN** either OMP mode is prepared for spawn
- **THEN** the child SHALL receive the controlled discovery environment and owned paths only
- **AND** no inherited host source SHALL enter the repository's accepted settings-source plan

#### Scenario: Project settings cause pre-request rejection
- **GIVEN** the actual requested ACP workspace or relevant pinned foreign-provider project/ancestor root contains a settings source
- **WHEN** session new/load or recovery is attempted despite a neutral process launch cwd
- **THEN** setup SHALL reject before the native request with a bounded content/credential-free source reason
- **AND** the hostile file SHALL remain unchanged
- **AND** accepting that workspace SHALL require its deployment/workspace owner to remove the forbidden source; no native suppression of an existing project source SHALL be claimed

#### Scenario: Polluted reused state fails closed
- **GIVEN** the mode's global agent directory contains config.yml, config.yaml or legacy settings.json outside the owned overlays
- **WHEN** a new or recovered session is prepared
- **THEN** setup SHALL reject that lower source without migration, null-reset or silent merge

#### Scenario: Clean sources support both modes and lifecycle shapes
- **GIVEN** canonical controlled HOME/agent roots, absent lower settings sources and valid exact owned overlays
- **WHEN** restricted or native-yolo sessions use per-spawn, pooled new or same-mode load/recovery paths
- **THEN** their source checks SHALL accept the owned-only plan with mode overlay last
- **AND** restricted default-deny SHALL remain a separate second boundary without copying restricted tool policy into YOLO

#### Scenario: Observation failures cannot manufacture absence
- **WHEN** a forbidden-source check encounters unreadable metadata, missing authority, link escape or identity replacement
- **THEN** the operation SHALL reject rather than return an empty successful source inventory

#### Scenario: Runtime reload assurance remains bounded
- **WHEN** documentation or mock evidence describes source visibility
- **THEN** it SHALL distinguish repository preflight/rechecks from deployment responsibility to keep lower sources absent throughout process lifetime
- **AND** native autonomous reload and undetectable mutation timing SHALL remain user-owned/unverified rather than be certified by mocks

### Requirement: Deployment-Owned OMP Skill Root Settings

Both owned OMP mode compositions SHALL declare canonical deployment-owned absolute skill roots through pinned registered settings, exclude ambient/workspace sources where supported and keep skills globally enabled. Only declared owned roots SHALL supply critical-skill authority. Invalid or unowned declarations SHALL be rejected. Native verdicts and user-owned runtime acceptance SHALL remain unchanged.

#### Scenario: Both modes declare the same owned skill roots
- **WHEN** actual owned restricted/native-yolo overlays and composed settings are validated
- **THEN** they SHALL declare the same owned roots with skills enabled and registered source-toggle posture
- **AND** native-yolo SHALL retain native approval, LSP disabled and absence of restricted tool policy

#### Scenario: Invalid or ambient declarations fail closed
- **WHEN** a root declaration is missing/empty, relative, tilde-based, workspace-owned, writable, linked, extra-host-root or expressed by an unregistered/default-falling-back key
- **THEN** owned-settings validation or canonical ownership observation SHALL reject it

#### Scenario: Overlay arrays replace without inheriting hostile roots
- **WHEN** owned source-root settings are assembled in the final mode overlay
- **THEN** the complete owned root array SHALL use pinned replacement semantics
- **AND** no inherited HOME/XDG/project source or lower custom root SHALL supply critical-skill authority

### Requirement: Dedicated Public Code Search Is Outside OpenCode Parity

The integration SHALL preserve local text search, public URL reading, and general web search as the pinned OpenCode parity target. It SHALL NOT require or advertise a dedicated public-code-search adapter, credential gap, or completion slot. Unlisted dedicated search tools SHALL remain default-denied in restricted mode.

#### Scenario: Dedicated search is not an admission prerequisite
- **WHEN** restricted session capabilities are evaluated without a dedicated public-code-search adapter
- **THEN** URL read and web search SHALL be evaluated under their own retained contracts
- **AND** an unlisted dedicated search invocation SHALL be denied without executing a backend

### Requirement: Controlled Replacements Have Native Parameter Contracts

Each registered controlled read or web-search replacement SHALL supply the pinned native runtime's mandatory parameter schema and execute contract. Accepted inputs SHALL agree with its parser. Invalid native input SHALL be rejected before transport dispatch. Ordinary non-network read inputs SHALL retain same-tool native delegation without a second filesystem implementation.

#### Scenario: Native registration can consume the definition
- **WHEN** a native-compatible consumer registers the read and web-search replacements and submits valid inputs
- **THEN** their schemas SHALL be accepted and their executors SHALL receive the declared input shapes
- **AND** malformed paths or queries SHALL be rejected before any transport request

#### Scenario: Local read retains native semantics
- **WHEN** an authorized ordinary local read reaches the replacement
- **THEN** the same-tool native delegate SHALL execute once and its result SHALL be preserved
- **AND** a missing delegate SHALL yield an explicit error, not an unguarded local read

### Requirement: Controlled Read Results Use Native Content Representations

Controlled results SHALL use native content arrays and honest result/error metadata. Text SHALL remain text, supported images SHALL use the native encoded-image representation, and other binary data SHALL retain an explicit native-compatible binary representation with its MIME and retrieved data. Arbitrary binary bytes SHALL NOT be labelled as an image. Attribution and cancellation/error semantics SHALL be preserved.

#### Scenario: Supported image and non-image binary remain distinct
- **WHEN** controlled read retrieves an image fixture and a non-image binary fixture
- **THEN** the native consumer SHALL receive a valid encoded image only for the supported image
- **AND** the non-image result SHALL retain its MIME and exact retrieved data without an image content label

#### Scenario: Text and failure are not fabricated successes
- **WHEN** controlled read retrieves attributed text or encounters a transport failure
- **THEN** the native consumer SHALL receive the attributed text or the explicit native error respectively
- **AND** failure SHALL NOT produce empty successful content, invented attribution, or native fallback traffic

### Requirement: Controlled Transport DNS Runs in the Native Runtime

Controlled URL-read and web-search DNS SHALL execute through a resolver available in the pinned native runtime. It SHALL retain literal-IP handling, collect available IPv4/IPv6 answers, and fail closed on an empty or unresolvable address set. Every resulting request, redirect, and secondary hop SHALL use the existing shared SSRF classifier and selected egress posture. A missing Deno global SHALL NOT disable otherwise supported public-host resolution.

#### Scenario: One address family has no records
- **WHEN** a public hostname has valid answers in one family and a no-record response in the other
- **THEN** its available answers SHALL reach the existing address-policy decision
- **AND** the no-record response SHALL NOT discard the valid family

#### Scenario: Empty or private resolution remains denied
- **WHEN** resolution yields no usable addresses or prohibited private addresses under enforcing egress
- **THEN** the existing transport SHALL deny before endpoint dispatch
- **AND** no unvalidated DNS fallback SHALL execute

#### Scenario: Native URL read and search share resolution policy
- **WHEN** the two controlled tools resolve fixture hosts without a Deno runtime global
- **THEN** both SHALL use the supported resolver and the same existing address-policy decisions
- **AND** neither SHALL fabricate an empty successful result on resolution failure

### Requirement: Restricted Enforcement Registers Through the Native Extension Contract

The restricted extension SHALL install its tool-call handler and controlled replacement tools through the pinned native extension API during factory evaluation. Native runtime callbacks SHALL execute the existing enforcement decisions before tool execution. Returning a factory value or attaching a private handler slot SHALL NOT substitute for native registration. Native-YOLO sessions SHALL remain outside this registration.

#### Scenario: Native callback reaches the enforcing boundary
- **WHEN** the default factory is evaluated with the pinned API contract and a restricted native tool-call event is delivered
- **THEN** the registered callback SHALL evaluate the existing inventory and completing policy before execution
- **AND** a denied call SHALL produce the native bounded block response with zero dispatch

#### Scenario: Native YOLO remains independent
- **WHEN** the factory observes native-YOLO mode
- **THEN** it SHALL NOT register the restricted enforcement or controlled replacement tools
- **AND** the existing both-mode LSP decision SHALL remain unchanged

### Requirement: Native Events Use Trusted Session and Origin Context

Each native call SHALL obtain fresh configured-tool source metadata and trusted acquired-session context. Origin, ownership, approvals, and adapter completion SHALL NOT be accepted from model input. Missing, ambiguous, foreign, stale, or unrepresentable required context SHALL deny before execution. Owned replacement tools SHALL be admitted by their actual extension provenance, not relabelled as builtins.

#### Scenario: Registry changes after the first call
- **GIVEN** an initially owned tool is replaced by a foreign same-name registration
- **WHEN** the next native call is evaluated
- **THEN** the new source observation SHALL be used and the call SHALL be denied
- **AND** a cached startup origin SHALL NOT authorize it

#### Scenario: Model input cannot forge admission
- **WHEN** input supplies an owned-origin claim, shared-write permission, or adapter-complete flag absent from trusted context
- **THEN** those claims SHALL NOT grant authority
- **AND** missing required trusted context SHALL produce a bounded denial

#### Scenario: All execution targets are decoded
- **WHEN** a native destructive or command call contains an incomplete or escaping target set
- **THEN** its real decoded inputs SHALL reach the shared completing policy
- **AND** the operation SHALL be denied before any target is mutated

#### Scenario: Valid owned replacement retains its identity
- **WHEN** fresh native metadata identifies a replacement under the declared canonical owned extension root
- **THEN** its actual owned-extension origin SHALL reach provenance admission
- **AND** admission SHALL still require the operation's separate completing boundary

### Requirement: Owned Skill URIs Remain Readable Through Native Read

The registered read replacement SHALL expose the pinned native skill-reading capability. A skill URI SHALL resolve only against the declared canonical deployment-owned skill source and pass current ownership, generation, and read-target checks before same-tool native delegation. Foreign, shadowed, traversing, stale, or unresolvable skills and other unsupported URI schemes SHALL remain denied. Network completion SHALL NOT grant skill authority.

#### Scenario: Declared owned skill is readable
- **WHEN** a current skill URI resolves to an instruction file under the canonical owned source
- **THEN** the read replacement SHALL admit the authorized target and delegate once to native skill reading
- **AND** the native instruction result SHALL be preserved without network dispatch

#### Scenario: Skill name alone cannot authorize a shadow
- **WHEN** a same-name skill comes from a foreign root, a replaced identity, or a stale generation
- **THEN** it SHALL be denied before native delegation
- **AND** name matching or network-adapter completion SHALL NOT override the denial

#### Scenario: Traversal and other devices remain blocked
- **WHEN** a skill URI escapes its owned source or an unsupported device URI is read
- **THEN** it SHALL be denied with a bounded reason
- **AND** no generic URI pass-through or fallback root SHALL be used

### Requirement: Root-Exact Script Entrypoint Approval

Restricted script approval SHALL require the invocation entrypoint to match an enumerated canonical absolute file inside the selected deployment root. Relative paths SHALL use registered session cwd. Failed observations or changed root identity SHALL deny. Suffix, HOME and daemon-cwd fallback SHALL NOT grant approval. Existing shell/argument policies and native-YOLO posture SHALL remain unchanged.

#### Scenario: Literal trusted recipe is approved
- **GIVEN** an observed script under the selected root and an otherwise valid restricted invocation
- **WHEN** the script is invoked directly or as the entrypoint after `deno run`
- **THEN** it SHALL be approved by exact canonical script membership
- **AND** quoting the absolute script path or adding a tolerated fd redirect SHALL preserve the result

#### Scenario: Planted workspace copy is rejected
- **GIVEN** the trusted script is `/opt/air/skills/send-reply/scripts/send-reply.ts`
- **AND** a session workspace contains a different file at `skills/send-reply/scripts/send-reply.ts`
- **WHEN** either the planted absolute path or that session-relative path is invoked
- **THEN** the permission gate SHALL deny execution even though the trailing path components match

#### Scenario: Ambient and other-agent copies are rejected
- **GIVEN** OMP's selected root is `/opt/air/skills`
- **WHEN** an invocation names a same-suffix copy in a daemon-HOME directory, a personal external install tree or a sibling-prefix directory
- **THEN** the script whitelist SHALL NOT approve it
- **AND** an OpenCode session SHALL likewise reject a copy under a root it did not select

#### Scenario: Relative path names the actual trusted script
- **GIVEN** the requesting session cwd and a relative entrypoint resolve to the exact enumerated script in the selected root
- **WHEN** the registered session's permission request is evaluated
- **THEN** relative spelling SHALL preserve script approval
- **AND** a different session cwd producing a planted copy SHALL be denied

#### Scenario: Symlink escape and replaced root are denied
- **GIVEN** an inventory accepted a root and its contained script
- **WHEN** the script resolves outside that root through a link, canonical observation fails, the script is missing, or the accepted root is replaced at the same pathname
- **THEN** execution SHALL be denied without suffix matching or automatic acceptance of the replacement root

#### Scenario: Whitelisted path used as an argument grants nothing
- **WHEN** an arbitrary executable receives an approved script path as a trailing argument
- **THEN** the request SHALL NOT gain script approval
- **AND** chained requests SHALL still require every segment to independently pass the existing gate

#### Scenario: Constructor cannot discover its own root
- **WHEN** a client or connector is prepared without the mandatory selected-agent root/inventory input
- **THEN** preparation SHALL fail explicitly
- **AND** it SHALL NOT scan the process cwd or HOME to repair the missing input

### Requirement: Native Local Read and Search Remain Usable Under Supported Approval

Authentic local native read and built-in search SHALL remain usable under the supported owned settings and native approval posture. Activation, ignore/hidden rules, cwd and output controls SHALL NOT be described as filesystem ACLs. The current runtime pin SHALL remain unchanged when latest official-source investigation supplies no required boundary fix.

#### Scenario: Local builtin search is available
- **WHEN** restricted owned settings are composed
- **THEN** native grep/glob SHALL remain enabled and read-tier calls SHALL retain supported approval without human elicitation
- **AND** find SHALL preserve its existing model-dependent auto activation without new judge/model/backend configuration

#### Scenario: Accepted ambient readability remains explicit
- **WHEN** native local read/search can access a path allowed by process OS permissions but outside daemon session roots
- **THEN** documentation and decision traces SHALL identify native-local IO, not claim protected ACP root confinement
- **AND** client callback protected-read guarantees SHALL remain scoped to callbacks that actually execute

#### Scenario: Newest official version lacks the seam fix
- **WHEN** source inspection of official v18.10.3 finds native direct IO and ACP-denial disk fallback still present
- **THEN** the decision record SHALL distinguish that investigated version from deployment v18.6.1
- **AND** no automatic runtime pin bump, fork or custom IO broker SHALL be introduced

### Requirement: Native Local Admission Does Not Admit Remote or Device Search Routes

Every native read/search root constituent SHALL be screened for alternate, remote and internal-device routes before local admission. A valid local constituent SHALL NOT authorize a mixed unsafe root list. URL reads SHALL remain owned-adapter operations; native fetch materialization SHALL be disabled as defense in depth without disabling controlled adapter transport.

#### Scenario: All roots in a native search request are screened
- **WHEN** a local search contains multiple path/glob roots or selectors with any HTTP(S), SSH, internal/xd/device or alternate-execution target
- **THEN** the whole call SHALL deny before native scanning or materialization
- **AND** checking only its first root SHALL NOT suffice

#### Scenario: Ordinary local path and pattern are not shell execution
- **WHEN** native grep/glob/available-find receives a valid local path/root list and literal search pattern
- **THEN** the native local operation SHALL remain usable
- **AND** pattern text alone SHALL NOT be confused with a path URI or shell command

#### Scenario: Controlled URL adapter remains available
- **WHEN** restricted settings disable native fetch materialization and a genuine owned read adapter receives an authorized HTTP(S) URL
- **THEN** its existing controlled per-hop transport SHALL remain available
- **AND** native grep URL materialization or native read transport fallback SHALL remain blocked

#### Scenario: Mutation authority remains unchanged
- **WHEN** authentic native bash, ordinary write/edit or destructive input is evaluated
- **THEN** the common-command authority, the pinned native approval path and the complete-destructive fail-closed decision SHALL remain in force
- **AND** ordinary write/edit SHALL run under that native approval and the process's ambient OS permissions without a pre-dispatch sink-route evidence gate
- **AND** uncertain targets, device/config writes or alternate bypass shapes SHALL remain fail-closed

### Requirement: Authorized Ambient Native Mutation

Ordinary local native write/edit SHALL run under the pinned native approval path and the process's ambient OS permissions, with no pre-dispatch sink-route evidence gate. Where the pinned bridge routes a call, the ACP sink decision and denial propagation stay in force; absolute native sandbox/plan targets and an unavailable client bridge do not reach it and SHALL be documented as the authorized residual risk. Destructive mutation SHALL keep the shared complete fail-closed decision.

#### Scenario: Ordinary native write and edit are authorized ambient mutation
- **WHEN** an ordinary local native write/edit is evaluated under the pinned native approval path
- **THEN** it SHALL execute under the process's ambient OS permissions exactly as the accepted native local read/search posture does, with the ACP sink retained for the calls the pinned bridge actually routes
- **AND** the artifacts SHALL record the user's explicit authorization of the ambient native mutation risk without a fabricated sink guarantee or a still-pending prerequisite

#### Scenario: Absolute sandbox and plan targets take the authorized ambient path
- **WHEN** an ordinary-looking absolute path resolves to a native session sandbox/plan exemption, or the native client bridge/capability is unavailable
- **THEN** the pinned native dispatch path SHALL execute the write/edit under the user's authorized ambient native posture instead of denying it behind a pre-dispatch route gate
- **AND** documentation and decision traces SHALL record that this path does not reach the ACP sink rather than claiming sink protection for it

### Requirement: Native Registry Observation Uses the Supported Runtime Surface

Native enforcement SHALL obtain live configured-tool metadata from the pinned extension API's supported direct registry method after runtime initialization. It SHALL NOT depend on an undeclared nested context API, evaluate unavailable action methods during load or treat model-provided source metadata as authority.

#### Scenario: Factory registers before runtime actions are available
- **WHEN** the factory loads before runtime action methods can be called
- **THEN** handlers and replacements SHALL register without reading the live roster
- **AND** later calls SHALL obtain the initialized direct runtime roster

#### Scenario: Runtime roster cannot be observed
- **WHEN** the direct registry method is absent, throws or returns ambiguous invoked-name metadata
- **THEN** restricted dispatch SHALL deny with a bounded observation reason
- **AND** model claims or startup-name caches SHALL NOT substitute

#### Scenario: Unrestricted registration remains empty
- **WHEN** the factory observes native-YOLO
- **THEN** it SHALL register no restricted handler or controlled replacement
- **AND** OpenCode, both-agent/both-mode LSP, sandbox/egress and cancelled readiness SHALL remain unchanged
