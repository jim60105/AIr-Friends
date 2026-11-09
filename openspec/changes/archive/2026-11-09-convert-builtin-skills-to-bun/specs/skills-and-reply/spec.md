# Spec Delta

## MODIFIED Requirements

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as TypeScript scripts run by Bun in `skills/{skill-name}/scripts/`, each with a `SKILL.md` describing its usage, and SHALL be executed with a `--session-id` parameter while using the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP.

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

#### Scenario: Skill receives session ID from environment variable (per-spawn mode)
- **GIVEN** a legacy per-spawn skill caller using environment-backed session identity
- **WHEN** it invokes the script with `--session-id "$SESSION_ID"`
- **THEN** existing per-spawn environment resolution SHALL remain compatible
- **AND** current bundled recipes SHALL instead pass the literal session id rendered in the prompt
- **AND** shared-process identity SHALL remain resolved by the authoritative current-session pointer, not a process-frozen environment value

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

#### Scenario: Legacy free-text flag rejected
- **GIVEN** a skill script that sends or stores user-facing content (e.g. `send-reply`)
- **WHEN** the script is invoked with a legacy free-text flag such as `--message "定價 $0.435"` or `--message=定價 $0.435`
- **THEN** the script SHALL exit with a non-zero status and an error instructing the use of the payload-file flag (e.g. `--message-file`)
- **AND** the script SHALL NOT call the Skill API

#### Scenario: Free-text content stays off the command line
- **GIVEN** a skill script that carries free-text content (reply text, memory content, search queries, captions, reminder text)
- **WHEN** the script is invoked
- **THEN** the script SHALL NOT accept any free-text argument as a CLI value in any form
- **AND** any free-text argument SHALL be passed via a payload-file flag (e.g. `--message-file`, `--content-file`, `--query-file`, `--caption-file`) whose content is read from a file staged in the session-scoped TMPDIR, so no user-facing content ever appears on a shell command line

#### Scenario: Legacy free-text flags rejected in both forms
- **GIVEN** a skill script invoked with a legacy free-text flag (`--message`, `--content`, `--query`, or `--caption`)
- **WHEN** the flag is given in either form (`--flag value` or `--flag=value`)
- **THEN** the script SHALL exit non-zero with a clear error and SHALL NOT call the Skill API

#### Scenario: Owning session identity resolved without extra agent work
- **GIVEN** a skill script executed by the agent
- **WHEN** the shared client library resolves the owning session id
- **THEN** in per-spawn mode it SHALL resolve from the `SESSION_ID` environment variable, and in shared-process mode from the orchestrator-maintained current-session pointer file (written ONLY while the session holds the global execution lease via an atomic temp-file+rename write, and cleared on release)
- **AND** the library SHALL present the owning session's JWT, so in neither mode SHALL the agent need to read files or pass extra parameters

#### Scenario: Shared-mode pointer is the sole identity source
- **GIVEN** shared-process mode where the agent process environment SHALL NOT contain `SESSION_ID` (a spawn-time frozen value would name a different session)
- **WHEN** a skill script resolves its owning session
- **THEN** the pointer SHALL be the sole identity source and the library SHALL NOT fall back to any environment value
- **AND** when the pointer is unreadable or malformed (`sessionId` must be a non-empty string), the library SHALL fail with a stable `SKILL_SESSION_UNRESOLVED` structured error carrying the code in a machine-readable `code` field

#### Scenario: Session ID is advisory in shared-process mode
- **GIVEN** shared-process mode
- **WHEN** a skill script is invoked with an arbitrary `--session-id` value
- **THEN** the library SHALL substitute the pointer-resolved owning session in the API request body so the server's JWT `sub` check stays authoritative

#### Scenario: Skill snapshots identity at start
- **GIVEN** a skill script that runs or may outlive the current turn
- **WHEN** the script starts
- **THEN** it SHALL snapshot the owning session id and the JWT file content ONCE at script start, so a backgrounded or late-running skill subprocess cannot observe a later session's pointer or JWT file

#### Scenario: Skill scripts run with scoped Deno permissions
- **GIVEN** a skill script is executed directly
- **WHEN** it is run
- **THEN** it SHALL use the shebang `#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml`
- **AND** it SHALL load no `.env` file, install no package and read no `bunfig.toml` from its working directory, and SHALL stop with a non-zero exit when `/opt/air/skill-bunfig.toml` is missing

#### Scenario: SKILL.md describes the session-id source truthfully
- **GIVEN** a skill's `SKILL.md`
- **WHEN** it documents the session-id source
- **THEN** it SHALL state that the session id rendered in the system prompt is authoritative, and that `$SESSION_ID` is present only in per-spawn deployments

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped staging directory, resolved against the script's working directory with boundary-safe containment inside the session staging directory.

#### Scenario: Valid session-scoped payload accepted
- **GIVEN** a session with id `sess_own` whose staging directory is `/abs/workspaces/discord/123/tmp/sess_own` as rendered in its prompt
- **WHEN** `send-reply` is invoked with `--session-id "sess_own"` and `--message-file "/abs/workspaces/discord/123/tmp/sess_own/reply.md"`
- **THEN** the script SHALL resolve the path into its own staging directory, read the file content verbatim (including any `$` characters, newlines, and empty strings), and call the Skill API with that content as the `message` parameter

#### Scenario: Legacy token path still resolves for existing callers
- **GIVEN** a per-spawn session whose shell expanded `--message-file "$TMPDIR/$SESSION_ID/reply.md"` to `{workspace}/tmp/sess_own/reply.md` before the script ran
- **WHEN** `send-reply` is invoked with that expanded path
- **THEN** the script SHALL resolve and read it exactly as before this change
- **AND** a payload helper invoked with a raw (unexpanded) `$TMPDIR`/`$SESSION_ID` token path SHALL retain its current documented resolution behavior

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

#### Scenario: Symlink escape rejected
- **GIVEN** a session staging directory `{workspace}/tmp/sess_own` containing a symlink `leak.md` pointing at `/etc/passwd` (or at a path outside the staging directory)
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/leak.md`
- **THEN** the script SHALL resolve the real path, reject the payload because the real path escapes the staging directory, and SHALL NOT call the Skill API

#### Scenario: Missing payload file rejected
- **GIVEN** no payload file exists at the given path
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/nonexistent.md`
- **THEN** the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API

#### Scenario: Missing required payload flag rejected
- **GIVEN** a script invocation that provides neither the legacy flag nor the payload-file flag
- **WHEN** the script parses its arguments
- **THEN** the script SHALL exit non-zero with an error naming the required payload-file flag

#### Scenario: Optional payload omitted
- **GIVEN** a `send-file` invocation without a caption or a `fetch-context` invocation of type `recent_messages` without a query
- **WHEN** the script parses its arguments
- **THEN** the script SHALL proceed without a payload file, passing no caption/query parameter to the Skill API

#### Scenario: Payload-file flag mapping per skill
- **WHEN** a skill that carries free-text content is invoked
- **THEN** `send-reply`/`edit-reply`/`set-reminder` SHALL use `--message-file`, `send-file` SHALL use `--caption-file`, `memory-save` SHALL use `--content-file`, and `memory-search`/`fetch-context` SHALL use `--query-file`

#### Scenario: REQUIRED and OPTIONAL payload arguments
- **GIVEN** a free-text argument of a skill
- **WHEN** it is declared in the skill contract
- **THEN** a REQUIRED free-text argument SHALL have exactly one payload-file flag
- **AND** an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one

#### Scenario: Payload staged and written verbatim
- **GIVEN** a payload file staged in the session-scoped TMPDIR
- **WHEN** the agent writes it
- **THEN** it SHALL be written through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the absolute staging directory literal rendered into the agent's prompt, in per-spawn and shared-process mode alike
- **AND** its bytes SHALL be preserved verbatim with no shell interpretation

#### Scenario: Session staging directory pre-created at setup
- **GIVEN** a session is registered
- **WHEN** the shell session is set up
- **THEN** the system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}`, because neither the agent's edit/write tool nor `writeTextFile` creates parent directories
- **AND** the directory SHALL be removed with the rest of `{workspace}/tmp` when the last session for the workspace ends

#### Scenario: Only the pointer staging directory is used in shared mode
- **GIVEN** shared-process mode
- **WHEN** a script resolves the staging directory
- **THEN** it SHALL resolve it ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`), with no CLI-argument fallback
- **AND** a missing, unreadable, or malformed pointer SHALL make the script fail with the stable `SKILL_SESSION_UNRESOLVED` error BEFORE reading or deleting any payload file

#### Scenario: Strict pointer schema
- **GIVEN** a current-session pointer
- **WHEN** it is validated
- **THEN** `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots)
- **AND** numbers, objects, empty strings, and relative staging SHALL all be malformed and fail identically
- **AND** in per-spawn mode the staging directory SHALL be `{cwd}/tmp/{sessionId}` from the script's own `--session-id` argument (sessions without an id fall back to `{workspace}/tmp`)

#### Scenario: Real-path containment re-checked
- **GIVEN** a payload file that exists
- **WHEN** the script processes it
- **THEN** it SHALL resolve the file's real path (`realpath`) and SHALL re-check the real path for containment
- **AND** a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected

#### Scenario: On success the payload is deleted
- **GIVEN** a successful payload-file invocation
- **WHEN** the script has passed the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged)
- **THEN** the script SHALL best-effort delete the payload file afterwards

### Requirement: Invalid Payload Invocations Are Rejected Before Side Effects

An invalid payload invocation SHALL exit non-zero with a structured error and SHALL NOT call the Skill API: a legacy free-text flag in either form, a missing payload-file flag, an absent or unreadable file, or a path outside the session staging directory (a prefix sibling, a symlink whose real path escapes it, a workspace-root file, a home-anchored or absolute path, or another session's staging directory).

#### Scenario: Legacy free-text flag is rejected before anything else

- **GIVEN** a skill script invoked with a legacy free-text flag in either `--flag value` or `--flag=value` form
- **WHEN** the script parses its argument list
- **THEN** it SHALL reject the invocation before doing anything else
- **AND** it SHALL NOT call the Skill API

#### Scenario: Workspace-root, home-anchored and absolute payload paths rejected

- **GIVEN** an agent workspace whose staging directory is `{workspace}/tmp/sess_own` and whose root contains `memory.private.jsonl`, and an agent runtime home directory `$HOME`
- **WHEN** a script is invoked with `--message-file memory.private.jsonl`, `--message-file {workspace}/memory.private.jsonl`, `--message-file ~/.git-credentials`, `--message-file $HOME/.env`, or `--message-file /etc/passwd`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** it SHALL exit non-zero without calling the Skill API

#### Scenario: Another session's staging directory and prefix siblings rejected

- **GIVEN** a session `sess_own` whose staging directory is `{workspace}/tmp/sess_own`, a sibling session staging directory `{workspace}/tmp/sess_other`, and the prefix siblings `{base}-2` and `{base}2`
- **WHEN** a script invoked with `--session-id "sess_own"` receives `--message-file {workspace}/tmp/sess_other/reply.md`, `--message-file {workspace}/tmp/sess_own-2/reply.md`, or `--message-file {workspace}/tmp/sess_own2/reply.md`
- **THEN** the script SHALL reject the payload because the resolved path is not inside `{workspace}/tmp/sess_own`, using boundary-safe equal-or-separator-prefixed matching so `{base}-2` and `{base}2` are rejected

#### Scenario: Symlink escape rejected by the real-path re-check

- **GIVEN** a session staging directory `{workspace}/tmp/sess_own` containing a symlink `leak.md` pointing at `/etc/passwd` (or at a path outside the staging directory)
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/leak.md`
- **THEN** the script SHALL resolve the real path (`realpath`) and reject the payload because the real path escapes the staging directory
- **AND** it SHALL NOT call the Skill API

#### Scenario: Missing flag, absent file and unreadable file rejected

- **GIVEN** a script invocation that provides neither the legacy flag nor a payload-file flag, or a payload-file flag pointing at a path where no readable file exists
- **WHEN** the script parses its arguments or reads the payload
- **THEN** it SHALL exit non-zero with a structured error naming the required payload-file flag or the missing file
- **AND** it SHALL NOT call the Skill API

## ADDED Requirements

### Requirement: Skill Argument Parsing Matches The Previous Parser

Each built-in skill script SHALL parse its documented flags to the same values the previous parser produced, including aliases, defaults, repeated flags and numeric flags.

#### Scenario: Alias and default
- **GIVEN** the memory-search script invoked with `-s abc --query-file q.txt`
- **WHEN** its arguments are parsed
- **THEN** the session id SHALL be `abc` and the limit SHALL be the number `10`

#### Scenario: Numeric flag
- **GIVEN** the memory-search script invoked with `--limit 5`
- **WHEN** its arguments are parsed
- **THEN** the limit SHALL be the number `5`

#### Scenario: Missing required flag
- **GIVEN** a skill script invoked without `--session-id` and without a session pointer
- **WHEN** it runs
- **THEN** it SHALL exit non-zero before any HTTP request, as before
