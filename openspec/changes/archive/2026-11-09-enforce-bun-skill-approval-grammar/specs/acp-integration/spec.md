# Spec Delta

## MODIFIED Requirements

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
- **GIVEN** a permission request to execute a whitelisted skill command that carries a legacy free-text flag, e.g. `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml .../send-reply.ts --session-id "$SESSION_ID" --message "定價 $0.435"` or `... --message=定價`
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

### Requirement: Root-Exact Script Entrypoint Approval

Restricted script approval SHALL require the invocation entrypoint to match an enumerated canonical absolute file inside the single deployment-resolved root of the selected agent. Relative paths SHALL use registered session cwd. Failed observations or changed root identity SHALL deny. Suffix, HOME and daemon-cwd fallback SHALL NOT grant approval. Existing shell/argument policies and native-YOLO posture SHALL remain unchanged.

#### Scenario: Literal trusted recipe is approved

- **GIVEN** an observed script under the resolved root and an otherwise valid restricted invocation
- **WHEN** the script is invoked directly or as the entrypoint after the exact literal prefix `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml`
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
- **AND** enumeration SHALL remain limited to `scripts/*.ts` with direct execution and the exact literal `bun run` prefix as the only accepted invocation forms
