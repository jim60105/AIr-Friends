# Delta: skills-and-reply

## MODIFIED Requirements

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped TMPDIR. The mapping SHALL be: `send-reply`/`edit-reply`/`set-reminder` use `--message-file`, `send-file` uses `--caption-file`, `memory-save` uses `--content-file`, `memory-search`/`fetch-context` use `--query-file`. A REQUIRED free-text argument SHALL have exactly one payload-file flag; an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one. The payload file SHALL be written by the agent through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the `$TMPDIR/$SESSION_ID`-anchored path (per-spawn; in shared-process mode the agent writes to the prompt-rendered staging directory), so its bytes are preserved verbatim with no shell interpretation. The system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}` at session setup (when the shell session is registered), because neither the agent's edit/write tool nor `writeTextFile` creates parent directories; the directory is removed with the rest of `{workspace}/tmp` when the last session for the workspace ends. The script SHALL resolve the payload path against its working directory and SHALL require the resolved path to be inside the session staging directory, using boundary-safe matching (equal-or-separator-prefixed) so prefix-sibling directories (`{base}-2`, `{base}2`) are rejected. The staging directory SHALL be resolved per mode: in SHARED-process mode ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`) — with no CLI-argument fallback — and a missing, unreadable, or malformed pointer SHALL make the script fail with the stable `SKILL_SESSION_UNRESOLVED` error BEFORE reading or deleting any payload file. Malformed is defined by a strict pointer schema: `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots); numbers, objects, empty strings, and relative staging are all malformed and fail identically; in per-spawn mode `{cwd}/tmp/{sessionId}` where the session id comes from the script's own `--session-id` argument (sessions without an id fall back to `{workspace}/tmp`). When the payload file exists, the script SHALL resolve its real path (`Deno.realPath`) and SHALL re-check the real path for containment, so a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected. When the payload flag is missing, the referenced file is absent or unreadable, the path is outside the staging directory, or the real path escapes it, the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API. On success the script SHALL pass the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged), and SHALL best-effort delete the payload file afterwards. The script SHALL reject any legacy free-text flag in either invocation form before doing anything else.

#### Scenario: Valid session-scoped payload accepted
- **GIVEN** a per-spawn session with id `sess_own` whose workspace TMPDIR is `{workspace}/tmp`, and a payload file staged at `{workspace}/tmp/sess_own/reply.md`
- **WHEN** `send-reply` is invoked with `--session-id "sess_own"` and `--message-file "$TMPDIR/$SESSION_ID/reply.md"`
- **THEN** the script SHALL resolve the path into its own staging directory `{workspace}/tmp/sess_own`, read the file content verbatim (including any `$` characters, newlines, and empty strings), and call the Skill API with that content as the `message` parameter

#### Scenario: Shared-mode staging comes only from the pointer
- **GIVEN** shared-process mode and a current-session pointer naming `{staging}={workspace}/tmp` and sessionId `sess_B`
- **WHEN** a script is invoked with `--session-id "sess_A"` (any value) and a payload under `{workspace}/tmp/sess_B/`
- **THEN** the staging base SHALL be `{workspace}/tmp/sess_B` — the pointer's session, not the CLI argument's

#### Scenario: Shared-mode missing pointer fails before touching files
- **GIVEN** shared-process mode with NO readable current-session pointer
- **WHEN** a script is invoked with any `--session-id` value and any payload-file path under another session's staging directory
- **THEN** the script SHALL exit non-zero with code `SKILL_SESSION_UNRESOLVED`
- **AND** it SHALL NOT read, send, or delete the referenced payload file

#### Scenario: Workspace-root file cannot be used as payload
- **GIVEN** an agent workspace whose staging directory is `{workspace}/tmp/sess_own` and whose root contains `memory.private.jsonl`
- **WHEN** a script is invoked with `--message-file memory.private.jsonl` or `--message-file {workspace}/memory.private.jsonl`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** the script SHALL exit non-zero without calling the Skill API

#### Scenario: Home-anchored or absolute payload rejected
- **GIVEN** an agent with runtime home directory `$HOME`
- **WHEN** a script is invoked with `--message-file ~/.git-credentials`, `--message-file $HOME/.env`, or `--message-file /etc/passwd`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** the script SHALL exit non-zero without calling the Skill API

#### Scenario: Another session's staging directory rejected
- **GIVEN** a session with id `sess_own` and a sibling session `sess_other` sharing the workspace TMPDIR `{workspace}/tmp`
- **WHEN** a script invoked with `--session-id "sess_own"` receives `--message-file {workspace}/tmp/sess_other/reply.md`
- **THEN** the script SHALL reject the payload because it resolves outside `{workspace}/tmp/sess_own`

#### Scenario: Boundary-safe staging containment
- **GIVEN** a session with id `sess_own` and sibling directories `{workspace}/tmp/sess_own-2` and `{workspace}/tmp/sess_own2`
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own-2/reply.md` or `--message-file {workspace}/tmp/sess_own2/reply.md`
- **THEN** the script SHALL reject the payload because the resolved path is not inside `{workspace}/tmp/sess_own`

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts located in `skills/{skill-name}/scripts/` directories. Each skill SHALL have a `SKILL.md` file describing its usage for the agent. External ACP Agents SHALL execute these scripts with a `--session-id` parameter. Scripts SHALL use the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP. Skill scripts SHALL NOT accept free-text content (reply text, memory content, search queries, captions, reminder text) as CLI argument values in any form: any free-text argument SHALL be passed via a payload-file flag (e.g. `--message-file`, `--content-file`, `--query-file`, `--caption-file`) whose content is read from a file staged in the session-scoped TMPDIR, so that no user-facing content ever appears on a shell command line. The legacy free-text flags (`--message`, `--content`, `--query`, `--caption`) SHALL be rejected with a clear error in both invocation forms (`--flag value` and `--flag=value`); a script invoked with a legacy flag SHALL exit non-zero and SHALL NOT call the Skill API. The skill client library SHALL resolve the owning session id from the `SESSION_ID` environment variable in per-spawn mode, or from the orchestrator-maintained current-session pointer file in shared-process mode (that pointer is written ONLY while the session holds the global execution lease, via an atomic temp-file+rename write, and cleared on release), and SHALL present the owning session's JWT — in neither mode SHALL the agent need to read files or pass extra parameters. In shared-process mode the agent process environment SHALL NOT contain `SESSION_ID` (a spawn-time frozen value would name a different session), and the pointer SHALL be the sole identity source: when the pointer is unreadable or malformed (schema violation: `sessionId` must be a non-empty string) the library SHALL fail with a stable `SKILL_SESSION_UNRESOLVED` structured error — the typed error SHALL carry the code in a machine-readable `code` field so identity-only scripts (which do not touch payload files) surface it identically to payload scripts — rather than falling back to any environment value. The `--session-id` argument SHALL remain required, but its value is advisory in shared-process mode: the library SHALL substitute the pointer-resolved owning session in the API request body so the server's JWT `sub` check stays authoritative. The skill script SHALL snapshot the owning session id and the JWT file content ONCE at script start, so a backgrounded or late-running skill subprocess cannot observe a later session's pointer or JWT file. Scripts SHALL be executed directly (shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`); the `--allow-read` permission is required for reading the staged payload file and the per-session JWT file, and `--allow-write` enables the script's best-effort deletion of the consumed payload file. Each `SKILL.md` SHALL describe the session-id source truthfully: the session id rendered in the system prompt is authoritative; `$SESSION_ID` is present only in per-spawn deployments.

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

#### Scenario: Skill receives session ID from environment variable (per-spawn mode)
- **GIVEN** a skill script is executed by the agent (per-spawn mode)
- **WHEN** the agent builds the bash command
- **THEN** the agent SHALL use `--session-id "$SESSION_ID"` where `$SESSION_ID` is resolved from the environment variable set in the agent subprocess
- **AND** the agent SHALL NOT need to know the actual session ID value

#### Scenario: Shared-mode process environment carries no session identity variable
- **GIVEN** a shared-process (pool) agent process is spawned while serving session `sess_A`
- **WHEN** session `sess_B` later runs on the same process and the agent inspects its shell environment
- **THEN** `SESSION_ID` SHALL be absent from the environment
- **AND** any skill invocation SHALL resolve the owning session `sess_B` from the current-session pointer without agent involvement

#### Scenario: Unresolvable shared-mode identity fails loud
- **GIVEN** shared-process mode and a current-session pointer that is absent (lease ended)
- **WHEN** a skill script resolves the owning session
- **THEN** the library SHALL exit non-zero with a `SKILL_SESSION_UNRESOLVED` structured error naming the expected pointer path and the "invoke skills during a live turn" remedy
- **AND** the Skill API SHALL NOT be called

#### Scenario: Owning session resolved without agent work (shared mode)
- **GIVEN** a shared channel process running sessions for a channel
- **WHEN** a skill script invokes the shared client library
- **THEN** the library SHALL resolve the owning session id from the current-session pointer file (written only while that session holds the execution lease) and present that session's JWT
- **AND** the agent SHALL NOT need to read files or pass extra CLI arguments
- **AND** the script SHALL snapshot the session id and JWT at script start, so a backgrounded subprocess cannot observe a later session's pointer or JWT file
