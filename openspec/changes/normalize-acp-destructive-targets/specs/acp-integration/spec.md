## ADDED Requirements

### Requirement: Complete Destructive Operation Normalization

The permission gate SHALL normalize every destructive-shaped request (ACP `delete`/`move` tool kinds, native delete/move titles, and multi-operation patch shapes) into an ordered, complete operation set before any authorization decision, using the P0 destructive-intent contract's trustworthy operation input, parser/edit-syntax provenance, and binding to the input that will execute. Every deletion target, every move source and destination, and every other patch mutation target SHALL be represented as its own target requiring its own decision; a title, a permission-location list, or a first operation SHALL NEVER stand in for the decoded set. An arbitrary title string SHALL NOT be approved as a destructive permission request. Normalization is a pure decision: it SHALL NOT create, modify, delete or move anything, and it SHALL NOT implement a speculative native edit syntax beyond the supported parsers established by the P0 contract.

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

### Requirement: All-Target Destructive Authorization Under The Common Policy

For a normalized destructive request, the gate SHALL authorize each target through the same session-scoped filesystem decision used by the ordinary write sink — with no parallel destructive rule — and SHALL approve only when every target is authorized: every deletion target and every move source SHALL require an existing-target observation plus delete authority, every move destination and every patch mutation target SHALL require create/overwrite authority, and a single unauthorized target SHALL deny the whole request. Target decisions SHALL use canonical physical observations, including token expansion and escaping-symlink rejection, and trusted read-only skills targets SHALL be denied as both sources and destinations in every mode. The existing restricted staging/shared-write and native YOLO broad-containment rules SHALL decide destructive targets exactly as they decide ordinary writes, with no additional restricted clamp applied to YOLO.

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

### Requirement: Shared Client And Extension Destructive Decision Surface

The destructive normalization and all-target decision logic SHALL be one reusable module consumed by the ACP permission gate and, when its owner wires the handler, by the deployment-owned OMP restricted-tool adapter, so the extension path and the client path evaluate the identical operation set and completeness verdict. An incomplete native location list SHALL NOT authorize a larger patch on either surface, and neither surface SHALL maintain a private duplicate of the target-completeness rules, the reason vocabulary, or the authorization table. The shared logic SHALL be pure with respect to the filesystem: consumers own observation and mutation.

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

## MODIFIED Requirements

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Edit/write requests SHALL be recognized by the ACP tool `kind` (`"edit"` — the kind OpenCode v1.17.13+ sends for its `write`, `edit`, `apply_patch`, and `patch` tools, whose `title` is the target file path) or by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`), so scoped path validation always runs for file-modifying tools instead of falling through to unknown-tool rejection. Destructive-shaped requests (ACP `delete`/`move` kinds, native delete/move titles, and multi-operation patch shapes) SHALL be routed through complete destructive-intent normalization and the all-target destructive decision BEFORE the ordinary edit/write location-list approval, and the ordinary location-list approval SHALL NOT be used to decide a destructive-shaped request: a request whose decoded operation set is incomplete or inconsistent with its locations SHALL be denied rather than approved from its first or partial target list. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and file-path containment decisions for the filesystem sinks, the scoped edit/write approval and the destructive decision SHALL be made against canonical physical root membership for the requesting session rather than lexical string containment. Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` remains the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14). This command-argument lexical check is a command-policy decision of its own and SHALL NOT be represented as physical containment of command execution; its argument policy is unchanged by destructive normalization.

Filesystem path checks used by the scoped edit/write approval, the destructive target decisions and the file callbacks SHALL expand the session-bound tokens `$TMPDIR`, `${TMPDIR}`, `$SESSION_ID`, `${SESSION_ID}` and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` against the requesting session's own authoritative context — to the session TMPDIR (`{session cwd}/tmp`), the active Skill API session id, and the configured shared Agent workspace — through the shared contextual path-resolution contract before any containment decision, so a literal `$TMPDIR/$SESSION_ID/...` path resolves and is approved exactly like the expanded absolute path. An unbraced token SHALL require a variable-name boundary, so `$TMPDIR2`, `$SESSION_ID2`, `$AGENT_WORKSPACE2`, `$OTHER` or `${OTHER}` remain unexpanded and fail. Relative paths SHALL be anchored to the session cwd, never the daemon cwd, and an unavailable referenced token value SHALL fail rather than expand to an empty string. Every session flow SHALL set the session's owning Skill API session id in its permission context when one exists (message, spontaneous, self-research, memory-maintenance, channel memory-maintenance, reminder), so the gate expands `$SESSION_ID` consistently with the script-side `--session-id`; flows without a shell session leave it unset. The canonical resolved target SHALL be the only path handed to protected file IO: `readTextFile()` and `writeTextFile()` SHALL operate on the observed canonical target under an authorized root role, not on the raw request path. When auto-approving a skill command (whitelisted script-path or command-prefix match), the gate SHALL reject — instead of approve — any command whose whitespace-delimited tokens include a legacy free-text skill argument flag in either invocation form (`--message`, `--message=value`, `--content`, `--content=value`, `--query`, `--query=value`, `--caption`, `--caption=value`; distinct tokens such as `--message-id`, `--message-file`, `--content-file`, `--query-file`, `--caption-file` SHALL NOT trigger the rejection), so free-text content can never be smuggled through a shell command line that reaches the gate.

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

### Requirement: Permission Handling — YOLO Mode

In YOLO mode (global `--yolo` flag or per-channel `yolo: true`), the system SHALL auto-approve ALL permission requests, including destructive-shaped requests; destructive normalization SHALL NOT introduce a restricted tool, extension, staging-only or target-count clamp into YOLO approval. YOLO SHALL additionally authorize ACP filesystem callbacks by broad physical containment only: a target holding the requesting session's user-workspace or the shared Agent workspace role SHALL be authorized with no staging-only restriction, no write-extension filter, no `canWriteAgentWorkspace` requirement and no restricted tool/LSP/command clamp, while targets outside those roots, replaced or escaping paths, and the read-only trusted skills root SHALL still be denied — a rule that applies to destructive sources and destinations as well as ordinary writes. This boundary applies to ACP-delegated file operations only and SHALL NOT be documented or tested as constraining native execution paths that do not use ACP callbacks, nor as denying a state file already inside the permitted broad workspace.

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
