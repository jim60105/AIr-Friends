# agent-sandbox-hardening Specification

## Purpose
TBD - created by archiving change fix-security-audit-findings. Update Purpose after archive.
## Requirements
### Requirement: Agent Subprocess Environment Isolation

The system SHALL spawn the ACP agent subprocess with a cleared parent environment so that the child receives ONLY the explicitly-built allowlisted environment variables and inherits NO variables from the parent bot process. The `Deno.Command` used to spawn the agent SHALL set `clearEnv: true`.

#### Scenario: Parent secret not inherited by agent

- **GIVEN** the parent bot process has an environment variable (e.g. `DISCORD_TOKEN`) that is NOT part of the agent's built environment
- **WHEN** the agent subprocess is spawned
- **THEN** that variable SHALL NOT be present in the agent subprocess's actual environment

#### Scenario: Allowlisted variables still provided

- **GIVEN** the agent configuration builds an environment containing `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, and `AGENT_WORKSPACE`
- **WHEN** the agent subprocess is spawned with `clearEnv: true`
- **THEN** the agent subprocess environment SHALL contain exactly those built variables (plus agent-type-specific variables) and nothing inherited from the parent

### Requirement: Entrypoint-Anchored Command Whitelist Matching

In restricted mode, the command whitelist matcher SHALL approve a skill-script execution only when the whitelisted script path is the actual invocation entrypoint. A whitelisted script path appearing merely as a trailing argument to an arbitrary command SHALL NOT be approved.

#### Scenario: Legitimate skill invocation approved

- **GIVEN** a command `deno run <flags> skills/memory-save/scripts/memory-save.ts <args>` where the script path is the entrypoint positional
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL approve the command

#### Scenario: Arbitrary command with whitelisted script as trailing argument rejected

- **GIVEN** a command whose first token is an arbitrary binary (e.g. `tar`, `cat`) and whose trailing argument is a whitelisted script path (e.g. `cat /home/deno/.git-credentials skills/memory-save/scripts/memory-save.ts`)
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

#### Scenario: Command-prefix skill with out-of-workspace path argument rejected

- **GIVEN** a command whose first token matches a whitelisted command prefix but whose arguments reference a path outside the workspace
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

### Requirement: Agent Workspace Write Gating

The ACP client `ClientConfig` SHALL include a `canWriteAgentWorkspace` flag. Edit/write requests targeting the shared agent workspace SHALL be approved ONLY when `canWriteAgentWorkspace` is `true`, in addition to passing existing path and extension checks. This gate SHALL be enforced at BOTH the `requestPermission` edit/write branch AND the `writeTextFile` handler (which are separate code paths). Writes to the per-session TMPDIR SHALL remain allowed regardless of this flag.

#### Scenario: Ordinary user session cannot write agent workspace

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent requests to write a `.md` file inside the shared agent workspace
- **THEN** the request SHALL be rejected with logging

#### Scenario: Self-research session may write agent workspace

- **GIVEN** a session with `canWriteAgentWorkspace: true`
- **WHEN** the agent requests to write a `.md` file inside the shared agent workspace and the extension check passes
- **THEN** the request SHALL be approved

#### Scenario: TMPDIR write allowed regardless of flag

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent requests to write a file within the session TMPDIR
- **THEN** the request SHALL be approved (subject to the existing extension check)

#### Scenario: Write gating enforced at writeTextFile handler

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent invokes `writeTextFile` directly for an agent-workspace path (bypassing the permission prompt)
- **THEN** the write SHALL be rejected

### Requirement: Boundary-Safe Path Validation

All ACP client path boundary checks (`isPathAllowed`, `isAgentWorkspacePath`, `isWithinTmpDir`) SHALL treat a candidate path as inside a base directory only when the resolved candidate equals the resolved base OR begins with the resolved base followed by a path separator. A sibling path that merely shares a string prefix with the base SHALL be rejected. `readTextFile` SHALL additionally enforce an explicit read-extension allowlist (memory JSONL `.jsonl`, markdown `.md`, plain text `.txt`) and deny other extensions; this read allowlist is intentionally distinct from (and broader than) the write allowlist so legitimate agent reads of workspace memory files are not blocked.

#### Scenario: Sibling-prefix path rejected

- **GIVEN** a base directory `/data/workspaces/discord/123`
- **WHEN** a path `/data/workspaces/discord/1234/memory.private.jsonl` is validated
- **THEN** the validation SHALL reject the path as outside the base

#### Scenario: Genuine subpath accepted

- **GIVEN** a base directory `/data/workspaces/discord/123`
- **WHEN** a path `/data/workspaces/discord/123/memory.public.jsonl` is validated
- **THEN** the validation SHALL accept the path

#### Scenario: readTextFile allows operational workspace reads

- **GIVEN** an agent read request for `memory.public.jsonl` inside the workspace
- **WHEN** `readTextFile` evaluates the request
- **THEN** the read SHALL be allowed (the `.jsonl` extension is in the read allowlist)

#### Scenario: readTextFile enforces extension check

- **GIVEN** an agent read request for a path inside an allowed directory whose extension is NOT in the read allowlist (e.g. a `.json` cache file)
- **WHEN** `readTextFile` evaluates the request
- **THEN** the read SHALL be rejected

