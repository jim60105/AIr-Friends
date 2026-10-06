## ADDED Requirements

### Requirement: Canonical Generic-Command Path Argument Decision

The generic-command gate SHALL decide every path argument of an allow-listed command — read input and write/output target — on the requesting session's canonical physical root membership rather than lexical string containment. The command gate SHALL maintain its OWN enumerated root-role set — the requesting session's canonical workspace, the shared Agent workspace when configured, the shared-process-mode process temporary directory when set, and the session's OpenCode tool-output directory — plus the OpenCode data root as a cross-session isolation boundary only. A tool-output directory SHALL receive a role only when canonical observation proves it lies inside the session workspace/TMPDIR or, in shared-process mode, inside the pool-key-scoped data root; the shared home-rooted OpenCode tool-output directory SHALL never receive a role and SHALL fail closed. A canonical target physically inside the data root but outside the requesting session's own data home, including the enumerating root listing, SHALL be denied. Known session/harness tokens (`~`, `~/...`, `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}`, `$TMPDIR`, `${TMPDIR}`, `$AGENT_WORKSPACE`, `${AGENT_WORKSPACE}`, `$SESSION_ID`, `${SESSION_ID}`) SHALL be expanded against the session's authoritative values first and then decided canonically; unexpandable home-anchored forms and known variables without a runtime value SHALL remain rejected without observation. Any canonical-observation failure — symlink escape, loop, dangling link, unresolvable or unavailable root, changed path — SHALL deny the argument and SHALL never fall back to a lexical decision. This gate SHALL apply exactly where today's generic-command allow-list applies: restricted mode only, with the same allow-list and decision cases, and SHALL add no clamp to native YOLO.

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

### Requirement: Generic-Command Policy Parity Under Canonicalization

Hardening the path-argument decision to canonical observations SHALL be a representation change only: the allow-listed tool set, dangerous-flag set, shell-operator and fd-redirect rules, per-segment chain evaluation rule, attached-option and URI-scheme rejections, unexpandable-token rejections, and every existing allow/deny case SHALL keep identical verdicts, so no OpenCode command routed to this gate gains or loses approval status incidentally. Restricted-mode OpenCode decisions SHALL be re-expressed canonically and OpenCode regression behavior preserved; the restricted tool inventory, provenance, and MCP admission decisions and trusted-extension handler wiring SHALL NOT be modified by this gate, and native YOLO SHALL continue to auto-approve before reaching it.

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

## MODIFIED Requirements

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Edit/write requests SHALL be recognized by the ACP tool `kind` (`"edit"` — the kind OpenCode v1.17.13+ sends for its `write`, `edit`, `apply_patch`, and `patch` tools, whose `title` is the target file path) or by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`), so scoped path validation always runs for file-modifying tools instead of falling through to unknown-tool rejection. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and file-path containment decisions for the filesystem sinks and the scoped edit/write approval SHALL be made against canonical physical root membership for the requesting session rather than lexical string containment. Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` remains the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — holds canonical physical membership in an enumerated command-gate root role for the requesting session, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14). The command-argument decision is a command-policy decision of its own, and its canonical observation SHALL NOT be represented as race-proof physical containment of the command's native execution.

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
- **WHEN** every path-like argument — read input and write/output target — canonically resolves to physical membership in an enumerated command-gate root role for the requesting session, and no code-execution / arbitrary-target flag is present
- **THEN** it SHALL auto-approve the request; and when any path-like argument (input or output) canonically resolves outside those roles — including through a parent-directory or final-file symlink escape, a sibling workspace, or another session's data area — or a tool with a file-reading argument DSL/indirection is used, or a flag such as `-exec`/`-delete`/`--pre` is present, it SHALL reject the request with logging

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
