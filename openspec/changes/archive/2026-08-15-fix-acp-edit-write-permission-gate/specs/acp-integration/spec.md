## MODIFIED Requirements

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
