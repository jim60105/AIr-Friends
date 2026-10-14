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

### Requirement: Canonical Payload Staging Independent of OMP Process State

Partitioning OMP process temporary/state roots SHALL NOT move, alias, or condition the canonical Skill API payload staging location. The session staging directory derived from the session workspace SHALL remain the payload-containment authority for OMP spawns exactly as for OpenCode spawns, and no OMP mode-scoped temporary root SHALL participate in payload path resolution or Skill API containment decisions.

#### Scenario: Staging survives state partitioning
- **WHEN** restricted and native-yolo OMP launches are assembled for the same session workspace
- **THEN** the canonical staging location derived from the workspace SHALL be identical for both modes
- **AND** neither launch's `TMPDIR`/`PI_CODING_AGENT_DIR` SHALL alter the staging path the permission gate and Skill API resolve

### Requirement: OpenCode Launch Non-Regression

Introducing the OMP launch branch SHALL NOT change the OpenCode launch: command, arguments, environment assembly (including per-session and per-pool `XDG_DATA_HOME`, `TMPDIR`, session/pool markers, credential set, and browser detection), the OpenCode YOLO session-mode switching route, and the sandbox pass-through outcome SHALL remain behaviorally identical, protected by consumer-visible tests.

#### Scenario: OpenCode configuration is byte-stable across the change
- **WHEN** OpenCode restricted and YOLO launches are assembled before and after this change
- **THEN** the assembled command, arguments, environment, and working-directory decisions SHALL be identical
- **AND** the OpenCode YOLO route SHALL continue to rely on the session-mode override rather than launch arguments

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

### Requirement: OpenCode Acquisition Ownership Bookkeeping

OpenCode SHALL retain its existing acquisition ownership record and read-only recovery consumption. OMP acquisition SHALL retain its resolved process mode and audit observation without requiring an ownership record for recovery.

#### Scenario: OpenCode acquisition
- **WHEN** OpenCode acquires a pooled or per-spawn process
- **THEN** its existing permission-mode/namespace record SHALL remain available to the optional recovery checks

#### Scenario: OMP acquisition
- **WHEN** OMP acquires either mode’s process
- **THEN** the resolved mode SHALL still select that mode’s pool/process and audit observation, independent of recovery ownership metadata

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

ACP reading SHALL additionally admit a target whose canonical role is the deployment-declared read-only trusted skills root, subject to that root's canonical identity, containment, current resource-generation currency and disjointness from writable roots, and SHALL treat that admission as root-scoped rather than extension-allowlist-based.

#### Scenario: Owned skill instruction is readable through the callback

- **GIVEN** a deployment-declared read-only skills root with matching current-generation provenance
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

- **GIVEN** a deployment-declared read-only trusted skills root
- **WHEN** the callback classifies any target under it
- **THEN** the trust SHALL confer read authority only
- **AND** it SHALL NOT authorize any write in any mode, any file outside the owned root, or any change to unrelated workspace read-extension rules

#### Scenario: Name, link, and provenance failures deny the trusted role

- **GIVEN** a workspace or project file merely sharing a skill's name, a link leaving the owned root whose destination is otherwise readable, or a root with a stale generation, a replaced identity, a canonical-path mismatch, an absent supplied identity or a writable-root overlap
- **WHEN** the callback classifies the target
- **THEN** it SHALL NOT gain the trusted role
- **AND** a stale generation, an identity mismatch or a writable-root overlap SHALL fail with the specific trusted-identity reason and no fallback to another readable role

#### Scenario: No trusted role without supplied provenance

- **WHEN** a skills root has no supplied ownership provenance
- **THEN** no trusted role SHALL exist for it
- **AND** the trusted classification SHALL NOT be applied

#### Scenario: HOME-derived auto-approval is replaced by canonical classification

- **WHEN** a skill read was previously auto-approved via the environment/HOME-derived rule
- **THEN** it SHALL be classified through the canonical trusted-skills rule instead
- **AND** a trusted skill read SHALL keep the existing approved audit reason

#### Scenario: Agent-writable declared root is admissible at the callback

- **GIVEN** the deployment-declared trusted skills root is writable by the runtime agent user, as the packaged personal tree is
- **WHEN** a canonical target inside it is classified with a matching supplied device/inode identity and current generation
- **THEN** the trusted-skills role SHALL be granted without an ownership or permission-bit test
- **AND** the root SHALL still fail classification when it overlaps a writable root, is reached through a linked root, or its supplied identity or generation no longer matches

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

### Requirement: Shared Agent Recovery With OpenCode Context Checks

OpenCode recovery with supplied ownership or gate context SHALL preserve its existing pre-teardown and post-connect ownership checks and bounded failures. OMP SHALL recover from the connector options through the shared load-capability path without a separate ownership prerequisite.

#### Scenario: Optional OpenCode context absent
- **WHEN** OpenCode recovers without trailing context
- **THEN** the existing cwd-only restore and capability-absence false result SHALL remain unchanged.

#### Scenario: OpenCode mismatched supplied record
- **WHEN** OpenCode recovery supplies a foreign-agent, mode or namespace mismatch
- **THEN** the existing bounded ownership failure SHALL occur before disconnect, spawn, load or context mutation.

#### Scenario: Read-only supplied record
- **WHEN** OpenCode successfully recovers with matching ownership
- **THEN** the record SHALL remain unmodified and existing cache/model/reasoning restoration ordering SHALL be preserved.

#### Scenario: OMP normal recovery
- **WHEN** OMP reconnects with configured options and no ownership record
- **THEN** it SHALL reconnect and load if supported, return false with existing cleanup if unsupported, and retain session-isolated native error reporting.

### Requirement: Shared Session Gate Restoration After Native Load

Successful recovery SHALL preserve the requesting session’s context and sibling contexts, restore supplied gate context consistently with load cwd, and invoke an optional post-restore hook before success. Existing OpenCode optional-context ordering SHALL remain unchanged.

#### Scenario: Supplied session context
- **WHEN** load succeeds with the recovered session’s gate context
- **THEN** callbacks SHALL use its cwd, skill session ID and permission flags, with no sibling-context substitution.

#### Scenario: Cwd mismatch
- **WHEN** supplied gate context disagrees with load cwd
- **THEN** the existing post-load gate-context failure SHALL apply to that session only.

#### Scenario: No extra context
- **WHEN** recovery has no supplied extra context
- **THEN** the existing cwd-only restore SHALL be available; absence of a hook SHALL add no readiness gate.

#### Scenario: Sibling replay
- **WHEN** one session recovers while sibling contexts are cached
- **THEN** siblings SHALL replay unchanged and the recovered ID SHALL retain its own policy context.

#### Scenario: Hook and configuration ordering
- **WHEN** supported load returns config options and the caller supplies model/reasoning and a hook
- **THEN** cache refresh, stable-first model selection, best-effort reasoning, gate restore and optional hook SHALL run in existing order; catalog or hook failure SHALL stay session-isolated.

### Requirement: Session Runner Recovery Context And Response Fences

Existing reconnect-capable OMP runners SHALL pass their own cwd, MCP definitions, current gate context and resolved effort through shared recovery. OpenCode’s existing optional context behavior and all existing recovery triggers, response fences and duplicate-response prevention SHALL remain unchanged.

#### Scenario: All owning runners
- **WHEN** pooled/per-spawn message, lurk, spontaneous, research/correction, maintenance or reminder enters an existing recovery path
- **THEN** its own session context and resolved effort SHALL reach recovery without an OMP ownership prerequisite.

#### Scenario: Response already delivered
- **WHEN** reply, file or reaction was recorded before a crash
- **THEN** the existing fence SHALL prevent re-prompting and duplicate delivery.

#### Scenario: Restore or hook failure
- **WHEN** shared restore/configuration/hook recovery fails
- **THEN** the affected session SHALL follow existing bounded loss/error reporting while sibling sessions and lease release remain correct.

#### Scenario: Nonqualifying crash
- **WHEN** per-spawn crash does not match an existing recovery trigger
- **THEN** existing fail-fast behavior SHALL remain and no new retry trigger SHALL be introduced.

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

### Requirement: Root-Exact Script Entrypoint Approval

Restricted script approval SHALL require the invocation entrypoint to match an enumerated canonical absolute file inside the single deployment-resolved root of the selected agent. Relative paths SHALL use registered session cwd. Failed observations or changed root identity SHALL deny. Suffix, HOME and daemon-cwd fallback SHALL NOT grant approval. Existing shell/argument policies and native-YOLO posture SHALL remain unchanged.

#### Scenario: Literal trusted recipe is approved

- **GIVEN** an observed script under the resolved root and an otherwise valid restricted invocation
- **WHEN** the script is invoked directly or as the entrypoint after `deno run`
- **THEN** it SHALL be approved by exact canonical script membership
- **AND** quoting the absolute script path or adding a tolerated fd redirect SHALL preserve the result

#### Scenario: Planted workspace copy is rejected

- **GIVEN** the trusted script is `<resolved root>/send-reply/scripts/send-reply.ts`
- **AND** a session workspace contains a different file at `skills/send-reply/scripts/send-reply.ts`
- **WHEN** either the planted absolute path or that session-relative path is invoked
- **THEN** the permission gate SHALL deny execution even though the trailing path components match

#### Scenario: Ambient and other-agent copies are rejected

- **GIVEN** the selected agent's resolved root is the shared configured skill root
- **WHEN** an invocation names a same-suffix copy in a daemon-HOME directory, a separately installed skill tree, or a sibling-prefix directory
- **THEN** the script whitelist SHALL NOT approve it
- **AND** an agent of either type SHALL likewise reject a copy under a root it did not resolve

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

### Requirement: Skill Auto-Approve List Construction Over the Single Resolved Root

Script inventory SHALL use the single explicit resolved root and canonical absolute contained files for BOTH agent types. Neither agent type SHALL restrict eligibility to an authored name catalog. Configured names SHALL filter eligible entries without expanding them. HOME scanning or missing-skill command grants SHALL NOT occur. Observed command skills with instruction files and no scripts directory MAY retain exact prefixes.

#### Scenario: Configured skills list

- **GIVEN** `autoApproveSkills` is provided in client config
- **WHEN** the skill inventory is constructed for either agent type
- **THEN** it SHALL include only observed configured skills inside the resolved root
- **AND** a script's entry SHALL be its canonical absolute path
- **AND** a configured name SHALL NOT expand eligibility beyond the observed root's contents

#### Scenario: Directory-scanned skills list

- **GIVEN** no `autoApproveSkills` configuration or an empty list
- **WHEN** the skill inventory is constructed with the resolved root
- **THEN** both agent types SHALL scan that directory for installed skills
- **AND** it SHALL NOT supplement the inventory from a HOME-derived tree or a separately installed skill tree

#### Scenario: Shared root grants either agent the installed script

- **GIVEN** both agent types resolve the same root and external publication adds a non-bundled script there
- **WHEN** inventories are constructed with empty approval lists or with that external name explicitly configured
- **THEN** both agent types SHALL admit the contained installed script
- **AND** neither agent type SHALL require a catalog entry for it

#### Scenario: Missing configured external skill yields no executable grant

- **GIVEN** a configured external script skill failed installation or its directory is absent when the connector is constructed
- **WHEN** the auto-approve inventory is built
- **THEN** it SHALL contain neither that skill's script path nor a bare command prefix inferred from its name
- **AND** unrelated installed skills SHALL remain available

#### Scenario: Explicit shared install root includes external scripts

- **GIVEN** a configured external skill is published under the same resolved root as built-ins
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

#### Scenario: Non-TypeScript script remains non-executable on either agent type

- **GIVEN** the resolved root contains a skill whose scripts directory holds only a non-`.ts` executable (for example a `.py` or shell script)
- **WHEN** the auto-approve inventory is constructed for either agent type and that script is invoked
- **THEN** no inventory entry and no grant SHALL be created for it
- **AND** enumeration SHALL remain limited to `scripts/*.ts` with the `deno` interpreter as the sole allowlisted entrypoint

### Requirement: Inventory Denial Invariants Survive The Ownership Relaxation

The relaxed shared-root posture SHALL NOT weaken the script inventory's denial behavior. A script that appears after the inventory was constructed SHALL NOT be approved by that inventory, and an enumerated script whose identity changed in place SHALL be denied at decision time.

#### Scenario: Script planted after inventory construction is not approved

- **GIVEN** an inventory was constructed once for a connector or session from the resolved root
- **WHEN** a new script appears under that root later in that connector's or session's lifetime and is invoked
- **THEN** the permission gate SHALL deny it because it was never enumerated by that inventory
- **AND** no re-scan of the root SHALL occur per decision

#### Scenario: In-place modification of an enumerated script is denied

- **GIVEN** an enumerated script was accepted with its `(dev, ino, ctime, size)` identity
- **WHEN** its content is modified in place, or it is replaced at the same pathname, before the decision
- **THEN** the decision-time re-observation of the root and the script SHALL deny execution
- **AND** script authority SHALL NOT be re-established from the changed metadata alone

### Requirement: OMP Destructive Permission Input Normalization

OMP destructive permission inputs SHALL be selected by the configured connector agent type and normalized into the existing shared authorization representation. OpenCode requests and clients without OMP selection SHALL retain their existing outcomes.

#### Scenario: Configured type selects ingress
- **WHEN** a request claims an OMP type or parser provenance but its connector is OpenCode
- **THEN** the OpenCode decoder SHALL remain selected and caller metadata SHALL grant no normalization authority.

#### Scenario: Single native delete
- **WHEN** configured OMP requests Delete with complete rawInput.path and matching locations
- **THEN** the actual path SHALL receive the existing shared delete authorization outcome.

#### Scenario: Move aliases
- **WHEN** configured OMP requests Move with native aliases
- **THEN** source SHALL use oldPath then path then from, destination SHALL use newPath then to then destination, and both endpoints SHALL receive shared authorization.

#### Scenario: Missing or conflicting locations
- **WHEN** an OMP destructive request has missing endpoints, absent/partial locations or locations inconsistent with its decoded targets
- **THEN** the existing completeness/binding denial SHALL apply with no inferred endpoint or partial grant.

### Requirement: OMP Destructive Binding And Diagnostic Integrity

OMP normalization SHALL retain the original request for diagnostics and use one canonical input representation for shared decode and execution binding. Request-supplied operation lists SHALL confer no authority.

#### Scenario: Canonical binding
- **WHEN** native move aliases are normalized
- **THEN** the decoded operation and its execution binding SHALL refer to identical canonical source/destination data while diagnostics retain original arguments.

#### Scenario: Embedded destructive edit
- **WHEN** a native edit or patch contains deletion or rename operations, even with a Delete or Move title
- **THEN** the existing unsupported-syntax outcome SHALL remain and the first displayed operation SHALL NOT stand for the complete request.

#### Scenario: YOLO and OpenCode unchanged
- **WHEN** YOLO or OpenCode receives a destructive-shaped request
- **THEN** the existing YOLO early approval or OpenCode decoder outcome SHALL remain unchanged.

### Requirement: Shared Deployment Skills Root In ACP Callbacks

The skills-root helper SHALL consume the existing shared deployment skill-root observation and SHALL NOT trust a directory by name, by workspace contents or as an arbitrary model-supplied location. An agent-writable skill tree SHALL NOT by itself disqualify an otherwise canonical root. Canonical identity, link-free components, containment and current-generation evidence SHALL remain mandatory.

#### Scenario: Owned skill instruction is readable as an observation

- **GIVEN** a deployment-declared read-only root and a matching canonical root observation for the requesting session
- **WHEN** the instruction target is observed within that root
- **THEN** the result SHALL include the trusted read-only role and canonical owned instruction identity
- **AND** no mutation authority SHALL be created

#### Scenario: Skill name collision or external link is not trusted

- **WHEN** a workspace file outside the declared root, a link leaving the root, mismatching root identity, or a root overlapping a writable root is supplied as a trusted target
- **THEN** the helper SHALL return the specific ownership/containment/overlap failure
- **AND** it SHALL NOT substitute a same-name file or globally disable skills to claim success

#### Scenario: Skills root is disjoint, read-only and non-escaping

- **WHEN** the canonical skills root is established
- **THEN** it SHALL be disjoint from writable workspace/shared roots and SHALL be granted only the read-only role
- **AND** a skills-root link leaving that root SHALL fail trusted membership even if its destination lies within another readable root

#### Scenario: Trust decisions certify no native support or policy change

- **WHEN** the helper reaches trusted read-only identity decisions
- **THEN** those decisions SHALL NOT certify native OMP selection/discovery support, change unrelated workspace read-extension policy, or introduce a skills write exception

#### Scenario: Agent-writable shared root is admitted under identity checks

- **GIVEN** the deployment-declared shared skill root is writable by the runtime agent user
- **WHEN** an owned skill instruction inside it is observed
- **THEN** ownership SHALL be decided by canonical identity, link-free components, realpath containment and current-generation evidence alone
- **AND** a linked component, an escaping target, a replaced identity or a stale generation SHALL still deny

### Requirement: Shared ACP Canonical Observation And Evidence Scope

Shared context/root/target helpers SHALL return one complete observation or one specific failure, never a partial grant, empty root or lexical fallback. Observations SHALL remain operation- and shared-context-generation-scoped and SHALL not imply native OMP enforcement on paths that do not consume ACP callbacks.

#### Scenario: Canonicalization failure
- **WHEN** metadata observation fails other than confirmed absence permitted by existing new-file semantics
- **THEN** the helper SHALL return a distinguished failure, no lexical grant and no protected content IO or mutation.

#### Scenario: Detectable replacement
- **WHEN** deterministic metadata observations detect a changed root, ancestor or final target
- **THEN** the existing path-changed failure or newly observed containment decision SHALL apply, and the actual secure access consumer SHALL preserve containment through IO.

#### Scenario: Broad YOLO observation
- **WHEN** a YOLO consumer observes a target physically inside its broad user/shared Agent workspace
- **THEN** it SHALL retain the broad role without restricted staging, command, extension or tool clamps; external escapes SHALL remain ineligible.

#### Scenario: Distinguished shared failure categories
- **WHEN** an observation fails
- **THEN** invalid context/path/token, invalid/unavailable/overlapping root, outside-root/link escape, dangling/looping link, missing object, wrong type, canonicalization failure, changed path and shared trusted-root identity mismatch SHALL remain distinguished.

#### Scenario: Observation lifetime
- **WHEN** successful helper metadata is consumed
- **THEN** it SHALL remain scoped to the exact shared session/context generation and SHALL not become a reusable permission or race-proof guarantee.

#### Scenario: Consumer evidence limits
- **WHEN** real helper logic with temporary filesystems or deterministic metadata mocks passes
- **THEN** that evidence SHALL certify only the exercised helper/access behavior, not native parser/tool/proxy enforcement; real native claims SHALL require separately exercised native consumers.

### Requirement: Native OMP Assets And Data Reachability Under Shared Confinement

Configured filesystem confinement SHALL retain the existing shared mount mechanism and expose the selected authored OMP files read-only and selected native mode data child read-write. It SHALL not grant the parent deployment/pool/HOME tree or sibling data roots; the shared read-only skill mount and overlap refusal SHALL remain.

#### Scenario: Confined native model and data
- **WHEN** OMP starts with filesystemConfinement enabled
- **THEN** native OMP SHALL consume the selected authored model/config assets and persist/load its own selected XDG data inside the confined view.

#### Scenario: Selected roots only
- **WHEN** the confined process attempts to read a sibling mode/pool marker or mutate the skill root
- **THEN** filesystem access SHALL fail and the shared mount policy SHALL not be widened by the additional OMP runtime inputs.

#### Scenario: OpenCode mounts unchanged
- **WHEN** OpenCode is spawned with the same sandbox configuration
- **THEN** its existing runtime mounts and observable access outcomes SHALL remain unchanged.

### Requirement: Shared Agent Environment Filtering With Native OMP Discovery

When environment filtering is enabled, agent processes SHALL retain the existing base allowlist, supported credential sets and operator allowed variables, with platform/dashboard/raw Skill API secrets denied. OpenCode SHALL preserve its existing selector denials. OMP SHALL use shared filtering without a separate settings-discovery sanitization or selector-identity gate.

#### Scenario: Supported credentials and shared secrets
- **WHEN** either agent is launched with filtered environment and deployment credentials
- **THEN** its existing supported credential set SHALL be retained and platform, dashboard and raw Skill API secrets SHALL remain excluded.

#### Scenario: OpenCode selectors unchanged
- **WHEN** OpenCode launch filtering receives an operator allowance for a selector previously denied
- **THEN** its existing exclusion and warning outcome SHALL remain unchanged.

#### Scenario: Ordinary OMP operator environment
- **WHEN** OMP uses shared filtering or unfiltered configuration
- **THEN** the existing operator allowance/filter choice SHALL apply without an additional OMP discovery-source consistency prerequisite.

### Requirement: Parser-Bounded Shared Destructive Operation Normalization

The shared permission gate SHALL decode destructive operation inputs into complete ordered targets and bind them to the input represented for execution before restricted authorization. Titles and location lists SHALL not supply missing operations. Supported single delete/move shapes SHALL use the existing shared decoder; unsupported native edit/patch syntax SHALL retain its current denial.

#### Scenario: Complete targets and execution binding
- **WHEN** a supported destructive request is decoded with complete matching locations
- **THEN** every deletion target and both move endpoints SHALL receive the existing shared all-target decision, using the same bound input.

#### Scenario: Partial or inconsistent locations
- **WHEN** a destructive request omits an endpoint or its location list differs from decoded targets
- **THEN** it SHALL retain the bounded incomplete/binding denial and authorize no partial target subset.

#### Scenario: Unsupported or malformed syntax
- **WHEN** a native edit/patch uses unsupported syntax or its input cannot be decoded or bound
- **THEN** the existing named destructive denial SHALL apply with no mutation and no fallback into generic unknown-tool approval.

#### Scenario: Pure normalization
- **WHEN** destructive normalization runs
- **THEN** it SHALL perform no content IO or mutation and SHALL not infer operation targets from titles or a first displayed operation.

### Requirement: Shared Native-Shaped OMP Mock Session Composition

Lifecycle and skill-handoff suites SHALL share the existing mock ACP session builder for permission mode, native-shaped configuration catalogs, scripted connection/subprocess behavior and destructive request fixtures. Mock evidence SHALL be identified as mock evidence without mandatory governance-origin, epoch or synthetic-approval records.

#### Scenario: Shared consumers
- **WHEN** lifecycle and handoff scenarios create mock ACP sessions
- **THEN** they SHALL exercise the same shipped factory/connector/pool consumers while selecting their own session context and scripted catalog behavior.

#### Scenario: Catalog and permission outcomes
- **WHEN** flat, grouped, absent or missing-model catalogs and destructive permission inputs are supplied
- **THEN** actual consumer selection, restore and authorization outcomes SHALL be tested without fabricated governance readiness claims.

### Requirement: Authored Native OMP Provider Configuration And Identity

Authored native model configuration SHALL retain Gemini provider `google` with `GEMINI_API_KEY` and OpenRouter with `OPENROUTER_API_KEY`, using supported native provider headers for `X-Title: AIr-Friends`. Native non-overridable identity headers SHALL be documented from pinned source. Model selection SHALL remain catalog-based without a project-generated provider blacklist.

#### Scenario: Native provider configuration is consumed
- **WHEN** a configured OMP session loads its authored native model file
- **THEN** supported credentials and native provider header configuration SHALL reach the selected native provider mechanism.

#### Scenario: Catalog miss
- **WHEN** a requested model is missing from an advertised native catalog
- **THEN** the existing explicit session-scoped selection error SHALL remain without an invented model ID.

#### Scenario: Native identity limitations
- **WHEN** documentation describes a built-in identity header that native configuration cannot override
- **THEN** it SHALL name the pinned source mechanism and SHALL not claim preservation from configuration inspection or mocks.

### Requirement: Authored Native OMP Compaction Update And Prompt Behavior

Authored mode settings SHALL preserve enabled native conversation compaction and the current supported update-posture settings. The system SHALL retain the explicit native custom-prompt route and existing operator prompt mounts. Native compaction differences and unexercised prompt effects SHALL be documented without invented schema keys or runtime-equivalence claims.

#### Scenario: Native compaction and updates
- **WHEN** either mode consumes its authored settings
- **THEN** current native compaction, disabled automatic update checks/marketplace updates and stable update channel SHALL remain configured without a schema mirror.

#### Scenario: Prompt override
- **WHEN** OMP starts with the existing explicit system-prompt asset or operator-mounted prompt
- **THEN** the native custom-prompt route SHALL consume that selected path and existing per-file payload prompt mounts SHALL remain untranslated.

#### Scenario: Evidence limits
- **WHEN** compaction or prompt behavior is documented
- **THEN** actual native strategy differences and unexercised runtime behavior SHALL be distinguished from source/configuration observations.

### Requirement: Native OMP Approval Mode Selection At Process Launch

OMP SHALL select restricted or native-YOLO policy at process launch from the existing effective permission mode. OMP SHALL retain separate processes and no ACP session-mode override; OpenCode SHALL retain its per-session mode switching.

#### Scenario: Native mode selection
- **WHEN** restricted and YOLO OMP sessions are acquired
- **THEN** each SHALL launch with its authored native mode settings and the existing mode-separated pool key.

#### Scenario: Protocol distinction
- **WHEN** OMP and OpenCode session overrides are requested
- **THEN** OMP SHALL return no approval-mode session override and OpenCode’s existing YOLO override SHALL remain.

### Requirement: Restricted Native OMP ACP Launch

Restricted OMP SHALL launch ACP with its authored mode configuration, the required native-loadable capability extension and the existing system-prompt asset. The launch SHALL delegate configuration parsing to native OMP.

#### Scenario: Restricted launch
- **WHEN** a restricted OMP session starts
- **THEN** native OMP SHALL consume the authored restricted YAML and attach the capability handler; missing required bundle SHALL report the existing build remedy.

#### Scenario: Native settings error
- **WHEN** an authored configuration is invalid
- **THEN** the native parser/startup error SHALL flow through the existing session error reporting.

### Requirement: Permissive Native OMP ACP Launch With Explicit LSP Denial

Native-YOLO OMP SHALL launch a separate ACP process with authored native YOLO approval and explicit LSP tool denial, without the restricted capability extension.

#### Scenario: Native permissive session
- **WHEN** OMP YOLO starts
- **THEN** known and unmatched non-LSP tools SHALL retain native permissive policy while the explicit LSP tool policy remains deny.

### Requirement: Native OMP Mode Data And Session Staging Separation

OMP SHALL retain distinct native session/database data directories for its separate approval-mode processes. Process cwd SHALL follow the existing caller/session working directory, and config HOME SHALL remain the normal inherited deployment HOME.

#### Scenario: Native data separation
- **WHEN** OMP restricted and YOLO start under one conversation/pool key
- **THEN** their native persisted data SHALL use distinct selected mode data roots without isolated HOME or neutral-cwd proof.

#### Scenario: Staging identity
- **WHEN** a skill payload is created for a session
- **THEN** its location SHALL remain session cwd/tmp/Skill API ID, independent of native process data directories.

### Requirement: Native OMP Generated Extension Asset Selection

Restricted OMP SHALL load the selected generated development or installed native-loadable extension asset. Missing required development output SHALL report the existing bundle build remedy. File ownership or replacement evidence SHALL not be an integration authorization prerequisite.

#### Scenario: Generated artifact usable
- **WHEN** the shipped bundle exists in the selected deployment location
- **THEN** native loading SHALL use that generated ESM asset without a runtime import map.

#### Scenario: Missing required output
- **WHEN** restricted launch cannot find its generated asset
- **THEN** startup SHALL fail with the asset path and build remedy rather than use raw source as a load fallback.

### Requirement: Native OMP Shared Environment And Egress Behavior

Both OMP modes SHALL retain the existing shared sandbox/environment filtering, provider credentials, proxy decisions and session/pool markers. Mode selection SHALL not introduce new egress rules or OMP settings-source identity requirements. OpenCode behavior SHALL remain unchanged.

#### Scenario: Shared egress settings
- **WHEN** OMP starts in either mode under the same sandbox configuration
- **THEN** the existing proxy/sandbox decision SHALL remain identical and credentials SHALL follow shared filtering.

#### Scenario: Pooled skill identity
- **WHEN** a shared OMP process starts
- **THEN** it SHALL retain the shared marker and JWT directory without a frozen session ID; the current-session pointer SHALL remain session-scoped.

### Requirement: Native OMP Local Read And Search Behavior

OMP native read and local search SHALL remain usable under native approval policy. Native activation, ignore/hidden controls, cwd and output settings SHALL retain their upstream behavior and SHALL not be described as callback filesystem authorization.

#### Scenario: Native local capabilities
- **WHEN** restricted read/grep/glob calls are dispatched
- **THEN** they SHALL use native tools and native allow policy; find SHALL retain model-dependent auto activation without adding a judge.

#### Scenario: Actual external read route
- **WHEN** native read/search reaches a path outside daemon session roots
- **THEN** acceptance SHALL record the native operation and any actual ACP request/result; protected callback guarantees SHALL apply only to callbacks that execute.

### Requirement: Native OMP Capability Admission Before Tool Dispatch

Restricted OMP’s capability handler SHALL be attached through the official pre-dispatch extension tool-call API and SHALL block unmatched calls before dispatch. Native YOLO SHALL retain its separately selected native policy.

#### Scenario: Known capability dispatch
- **WHEN** restricted native tool_call names a mapped ability
- **THEN** the handler SHALL continue to native dispatch without repeating native or ACP authorization.

#### Scenario: Unmatched capability
- **WHEN** restricted native tool_call names an unmatched tool
- **THEN** the call SHALL be blocked before execution with a bounded unknown-tool reason.

#### Scenario: Ordinary file write
- **WHEN** a native ordinary write reaches the advertised ACP write callback
- **THEN** the existing shared callback policy SHALL decide it and a rejected write SHALL cause no unauthorized file change.

### Requirement: Consumer ACP Lifecycle And Mode Recovery Regression Suite

The combined lifecycle suite SHALL drive real connector, pool and orchestrator consumers with mock ACP transport, covering normal lifecycle, shared recovery, mode coexistence/lease serialization, callback denial and unchanged OpenCode flows. Evidence SHALL remain distinguished from real-native and image acceptance.

#### Scenario: Lifecycle and restore
- **WHEN** the fixture drives initialize/new/prompt/cancel/load
- **THEN** the shipped consumers SHALL restore model/reasoning/context in existing order and rejected callback writes SHALL have no side effects.

#### Scenario: Mode coexistence
- **WHEN** restricted and YOLO OMP sessions use the same conversation key
- **THEN** separate native-mode processes SHALL serialize under one lease and preserve their own contexts.

#### Scenario: OpenCode flows
- **WHEN** OpenCode exercises selection/start/reuse/recovery
- **THEN** existing observable launch, permission and optional-context outcomes SHALL remain unchanged.

### Requirement: Handwritten Native OMP Configuration Consumption

OMP SHALL directly consume hand-written native YAML. Application startup and code/image builds SHALL not generate, serialize, template or rewrite OMP configuration. Deployment SHALL manually configure native skill discovery and the shared skill root; native configuration errors SHALL use native reporting.

#### Scenario: No production configuration writes
- **WHEN** OMP startup or extension/image build is observed after deployment provisioning
- **THEN** no write/replacement operation SHALL target authored OMP mode/model YAML; build installation SHALL only copy tracked authored bytes.

#### Scenario: Native model file
- **WHEN** the deployment installs its authored models file at the native agent config path
- **THEN** native OMP SHALL consume that file directly with its supported provider schema, independently of OpenCode JSON.

#### Scenario: Custom skill deployment
- **WHEN** a deployment selects a custom shared skill-script root
- **THEN** the deployer SHALL author that same discovery root in native OMP YAML; no interpolation or equality-rejection service SHALL be required.

### Requirement: OMP Native Capability Policy Parity

Restricted OMP SHALL permit native abilities corresponding to OpenCode read/search/todo/skill/network/modify/execute policies and deny unmatched tools. Both modes SHALL explicitly deny the LSP tool using native approval settings. Native URL/search result differences SHALL remain upstream-owned.

#### Scenario: Restricted mapped abilities
- **WHEN** a native read, grep, glob, find when active, todo, web_search, edit/write, delete/move or bash call occurs
- **THEN** it SHALL continue through its native approval/ACP path without origin/epoch or a second command/filesystem policy.

#### Scenario: Explicit LSP denial
- **WHEN** either native OMP mode invokes the LSP tool
- **THEN** native exact-name approval SHALL deny the tool; acceptance SHALL make no implicit-server startup claim.

#### Scenario: Native network and skills
- **WHEN** a native URL read, web search or skill URI read occurs
- **THEN** it SHALL use the original native implementation without project-owned transport/backend/schema or skill-URI metadata replacement.

### Requirement: Pinned Native OMP Confined Runtime Consumer Evidence

Native OMP acceptance SHALL exercise the official pinned binary with the authored configuration and shipped native-loadable extension, and SHALL distinguish real native lifecycle/configuration evidence from mock/helper dispatch evidence. Required binary/confinement/observation prerequisites SHALL fail explicitly when unavailable or mismatched.

#### Scenario: Authored models in both launch modes
- **WHEN** restricted and YOLO native ACP processes initialize and create sessions using the authored fixture
- **THEN** the actual native model catalog SHALL resolve the fixture model without generated configuration, a fabricated catalog or a paid prompt.

#### Scenario: Confined pooled native persistence and load
- **WHEN** real opposite-mode pool consumers run with filesystem confinement enabled and restore their own actual sessions after process restart
- **THEN** each SHALL consume its selected read-only assets and persist/load beneath its own selected native data directory while shared lease/mode selection remains in effect.

#### Scenario: No authored configuration writes
- **WHEN** production factory/native startup runs after named test provisioning is complete
- **THEN** writable opens or replacements of authored native mode/model YAML SHALL be absent, as observed by filesystem events rather than settings-byte equality.

#### Scenario: Missing prerequisites are not success
- **WHEN** the exact pinned native binary, supported confinement runtime or required filesystem observation cannot be exercised
- **THEN** acceptance SHALL report the precise failed prerequisite and SHALL not silently skip or label mock evidence as native success.
