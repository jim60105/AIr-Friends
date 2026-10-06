## ADDED Requirements

### Requirement: Independent Restricted ACP Filesystem Write Authorization

The ACP file-write sink SHALL authorize an ordinary restricted-mode write from the requesting session's own authoritative context and the target's canonical physical role, WITHOUT requiring or consulting any preceding permission request. It SHALL allow the requesting session's own canonical staging root; SHALL allow a shared Agent workspace target only when the session holds agent-workspace write authorization and the target carries an allowed write extension; SHALL deny every remaining ordinary user-workspace target, including one whose extension is otherwise allowed; and SHALL deny a target whose only applicable role is read-only trusted skills. A staging grant SHALL be the physical staging membership of the requesting session only: an alias or link reaching a sibling session's staging directory, an ordinary workspace directory or a process/state location SHALL NOT produce it. The same decision SHALL apply whether the agent reached the write through a permission request or called the file-write callback directly, and the preserved shared-authorization, shared-extension and outside-workspace reason codes SHALL keep their meanings.

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

### Requirement: Protected-IO-Only ACP Filesystem Callback Execution

Every ACP read and write callback decision SHALL be made on the requesting session's canonical root and target observations, and content IO SHALL occur only through the protected root-relative access operations under the single root role the authorization selected. A failed context, expansion, root construction, target observation, authorization or access step SHALL deny the operation with one mapped bounded reason and SHALL NOT fall back to ordinary path-based read/write, SHALL NOT retry under a broader root role, and SHALL NOT create a missing parent or staging directory as a side effect. The lexical sink predicates and the environment/HOME-derived skills trust rule they replaced SHALL be removed from the callback path, and no callback path SHALL remain that reaches content IO without an authorization decision.

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

### Requirement: Read-Only Trusted Skills Access In ACP Callbacks

ACP reading SHALL additionally admit a target whose canonical role is the deployment-owned read-only trusted skills root, subject to that root's ownership provenance and current resource-generation currency, and SHALL treat that admission as root-scoped rather than extension-allowlist-based. The trusted root SHALL confer read authority only: it SHALL NOT authorize any write in any mode, SHALL NOT authorize a file outside that owned root, and SHALL NOT change unrelated workspace read-extension rules. A workspace or project file SHALL NOT gain the trusted role by name, a link leaving the owned root SHALL NOT obtain it even when its destination is otherwise readable, and a stale generation, ownership mismatch or writable-root overlap SHALL fail with the specific trusted-identity reason and no fallback to another readable role. Absent supplied provenance, no trusted role SHALL exist. The previous environment/HOME-derived auto-approval of skill reads SHALL be replaced by this canonical classification, keeping the existing approved audit reason for a trusted skill read.

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

### Requirement: Bounded Specific ACP Filesystem Denial Diagnostics

Each filesystem-sink denial SHALL record exactly one bounded, machine-readable reason identifying the failed decision — restricted in-workspace target, read-only trusted-skills target, trusted-identity/provenance failure, canonical-observation failure, filesystem-access failure, or missing session context — using the existing bounded rejection buffer and audit mirroring. Preserved reason codes SHALL keep their meanings, added codes SHALL be a finite documented set, and a single denial SHALL NOT be recorded twice under contradictory reasons. Recorded fields SHALL remain sanitized and length-bounded, and the callback error SHALL use a static message that exposes no file content, secret, or unbounded agent- or platform-supplied text.

#### Scenario: Every sink denial yields one specific bounded reason
- **WHEN** each filesystem denial path is exercised once
- **THEN** exactly one recorded rejection SHALL appear for that denial with its named reason and bounded path field
- **AND** the raised callback error SHALL carry a static reason message without file content or raw platform error text

#### Scenario: Existing retry diagnostics keep working
- **GIVEN** a session that experienced filesystem denials during a turn that produced no reply
- **WHEN** the missing-reply retry prompt is assembled
- **THEN** the recorded reasons SHALL appear in the existing bounded rejection section
- **AND** the previously documented reasons SHALL remain available for shared-authorization and extension denials

## MODIFIED Requirements

### Requirement: ChatbotClient ACP Client Interface

The system SHALL implement the ACP `Client` interface via `ChatbotClient`, handling callbacks from external agents for permissions, session updates, and file operations. File-operation callbacks SHALL resolve the requesting session's authoritative context, decide authorization on canonical physical root/target observations, and perform content IO only through the protected filesystem access operations under the single authorized root role; the client SHALL continue advertising the ACP `fs` read/write capabilities so agents delegate file access instead of using native IO.

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

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Edit/write requests SHALL be recognized by the ACP tool `kind` (`"edit"` — the kind OpenCode v1.17.13+ sends for its `write`, `edit`, `apply_patch`, and `patch` tools, whose `title` is the target file path) or by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`), so scoped path validation always runs for file-modifying tools instead of falling through to unknown-tool rejection. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and file-path containment decisions for the filesystem sinks and the scoped edit/write approval SHALL be made against canonical physical root membership for the requesting session rather than lexical string containment. Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` remains the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14). This command-argument lexical check is a command-policy decision of its own and SHALL NOT be represented as physical containment of command execution.

Filesystem path checks used by the scoped edit/write approval and the file callbacks SHALL expand the session-bound tokens `$TMPDIR`, `${TMPDIR}`, `$SESSION_ID`, `${SESSION_ID}` and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` against the requesting session's own authoritative context — to the session TMPDIR (`{session cwd}/tmp`), the active Skill API session id, and the configured shared Agent workspace — through the shared contextual path-resolution contract before any containment decision, so a literal `$TMPDIR/$SESSION_ID/...` path resolves and is approved exactly like the expanded absolute path. An unbraced token SHALL require a variable-name boundary, so `$TMPDIR2`, `$SESSION_ID2`, `$AGENT_WORKSPACE2`, `$OTHER` or `${OTHER}` remain unexpanded and fail. Relative paths SHALL be anchored to the session cwd, never the daemon cwd, and an unavailable referenced token value SHALL fail rather than expand to an empty string. Every session flow SHALL set the session's owning Skill API session id in its permission context when one exists (message, spontaneous, self-research, memory-maintenance, channel memory-maintenance, reminder), so the gate expands `$SESSION_ID` consistently with the script-side `--session-id`; flows without a shell session leave it unset. The canonical resolved target SHALL be the only path handed to protected file IO: `readTextFile()` and `writeTextFile()` SHALL operate on the observed canonical target under an authorized root role, not on the raw request path. When auto-approving a skill command (whitelisted script-path or command-prefix match), the gate SHALL reject — instead of approve — any command whose whitespace-delimited tokens include a legacy free-text skill argument flag in either invocation form (`--message`, `--message=value`, `--content`, `--content=value`, `--query`, `--query=value`, `--caption`, `--caption=value`; distinct tokens such as `--message-id`, `--message-file`, `--content-file`, `--query-file`, `--caption-file` SHALL NOT trigger the rejection), so free-text content can never be smuggled through a shell command line that reaches the gate.

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
- **THEN** it SHALL treat it as a scoped edit/write request and apply the session-root authorization checks instead of rejecting it as an unknown tool call

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

### Requirement: Permission Handling — YOLO Mode

In YOLO mode (global `--yolo` flag or per-channel `yolo: true`), the system SHALL auto-approve ALL permission requests. YOLO SHALL additionally authorize ACP filesystem callbacks by broad physical containment only: a target holding the requesting session's user-workspace or the shared Agent workspace role SHALL be authorized with no staging-only restriction, no write-extension filter, no `canWriteAgentWorkspace` requirement and no restricted tool/LSP/command clamp, while targets outside those roots, replaced or escaping paths, and the read-only trusted skills root SHALL still be denied. This boundary applies to ACP-delegated file operations only and SHALL NOT be documented or tested as constraining native execution paths that do not use ACP callbacks, nor as denying a state file already inside the permitted broad workspace.

#### Scenario: YOLO auto-approve
- **GIVEN** YOLO mode is enabled (globally or per-channel)
- **WHEN** any permission request is received
- **THEN** it SHALL be auto-approved with reason `"yolo_mode"`

#### Scenario: YOLO filesystem callback keeps broad containment without restricted clamps
- **GIVEN** a YOLO session
- **WHEN** it writes any extension to any path physically inside its user workspace or the shared Agent workspace
- **THEN** the write SHALL be authorized through the protected access operation under that broad root role
- **AND** no restricted staging-only rule, extension allowlist or workspace-write authorization flag SHALL be applied

#### Scenario: YOLO does not relax escape or read-only-root denial
- **GIVEN** a YOLO session
- **WHEN** it requests a write to an external or sibling-workspace target, a path whose containment observation escapes, or any path inside the trusted read-only skills root
- **THEN** the write SHALL be denied with the mapped bounded reason and no content IO

#### Scenario: YOLO behavior is identical for both agents
- **GIVEN** an OpenCode and an OMP session in YOLO mode
- **WHEN** the same filesystem callback target is presented to each
- **THEN** both SHALL receive the same authorization outcome, with no restricted-mode policy copied into YOLO
