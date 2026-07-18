## MODIFIED Requirements

### Requirement: Permission Handling — Restricted Mode

In restricted (non-YOLO) mode, the system SHALL selectively approve or deny permission requests based on whitelists and path validation. Command whitelist matching SHALL be anchored to the invocation entrypoint, agent-workspace writes SHALL be gated by the session's `canWriteAgentWorkspace` flag, and all path boundary checks SHALL be boundary-safe (equal-or-separator-prefixed). Because filesystem-touching bash tools are routed to this gate (configured `"ask"` rather than `"allow"`), `requestPermission()` is the authoritative decision point for those commands: a generic allow-listed command SHALL be approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, and `referencesOutOfWorkspacePath` SHALL treat a filesystem-reaching URI-scheme token (e.g. `file://`, and other non-network schemes such as `ftp://`/`gopher://`) as referencing a path outside the workspace. Network URL schemes (`http://`/`https://`) are NOT treated as filesystem paths — `agent-browser` navigates to them legitimately and their egress is mediated separately (F14).

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

#### Scenario: Edit/write within agent workspace requires write permission
- **GIVEN** an edit/write permission request for a path within the agent workspace
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request ONLY if the session's `canWriteAgentWorkspace` flag is `true`; otherwise it SHALL reject the request with logging

#### Scenario: Edit/write within TMPDIR
- **GIVEN** an edit/write permission request for a path within the session TMPDIR
- **WHEN** the file extension passes the allowed extensions check
- **THEN** it SHALL auto-approve the request regardless of `canWriteAgentWorkspace`

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
