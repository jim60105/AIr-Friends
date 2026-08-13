## MODIFIED Requirements

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts located in `skills/{skill-name}/scripts/` directories. Each skill SHALL have a `SKILL.md` file describing its usage for the agent. External ACP Agents SHALL execute these scripts with a `--session-id` parameter. Scripts SHALL use the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP. Skill scripts SHALL NOT accept free-text content (reply text, memory content, search queries, captions, reminder text) as CLI argument values in any form: any free-text argument SHALL be passed via a payload-file flag (e.g. `--message-file`, `--content-file`, `--query-file`, `--caption-file`) whose content is read from a file staged in the session-scoped TMPDIR, so that no user-facing content ever appears on a shell command line. The legacy free-text flags (`--message`, `--content`, `--query`, `--caption`) SHALL be rejected with a clear error in both invocation forms (`--flag value` and `--flag=value`); a script invoked with a legacy flag SHALL exit non-zero and SHALL NOT call the Skill API. Scripts SHALL be executed directly (shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`); the `--allow-read` permission is required for reading the staged payload file, and `--allow-write` enables the script's best-effort deletion of the consumed payload file (the only write the scripts perform — a containment-verified remove of the staging file).

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

#### Scenario: Skill receives session ID from environment variable
- **GIVEN** a skill script is executed by the agent
- **WHEN** the agent builds the bash command
- **THEN** the agent SHALL use `--session-id "$SESSION_ID"` where `$SESSION_ID` is resolved from the environment variable set in the agent subprocess
- **AND** the agent SHALL NOT need to know the actual session ID value

#### Scenario: Legacy free-text flag rejected
- **GIVEN** a skill script that sends or stores user-facing content (e.g. `send-reply`)
- **WHEN** the script is invoked with a legacy free-text flag such as `--message "定價 $0.435"` or `--message=定價 $0.435`
- **THEN** the script SHALL exit with a non-zero status and an error instructing the use of the payload-file flag (e.g. `--message-file`)
- **AND** the script SHALL NOT call the Skill API

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without having called `send-reply` or `react-message`. The retry SHALL clear the reply state, send a second prompt on the same ACP session requesting the agent to send a reply, and if the retry also fails, return a failure response. The retry prompt SHALL be instructive: it SHALL state that the turn ended without a reply or reaction, SHALL list the likely causes of a failed `send-reply` under the payload-file contract (legacy `--message` used and rejected, payload file never written, payload staged outside `$TMPDIR/$SESSION_ID/`, or a previous `send-reply` call that errored — with an instruction to read that error's output), SHALL give the correct two-step example invocation (write the payload to `$TMPDIR/$SESSION_ID/...` with the edit/write tool, then invoke the script with `--message-file`), and SHALL include the full `send-reply` and `react-message` SKILL.md content.

#### Scenario: Successful retry produces reply
- **GIVEN** an agent completes without sending a reply or reaction
- **WHEN** the retry mechanism triggers
- **THEN** the system SHALL send a retry prompt on the same session
- **AND** if the agent calls `send-reply` during retry, the session SHALL succeed

#### Scenario: Failed retry returns error
- **GIVEN** an agent completes without a reply and the retry also fails
- **WHEN** the retry prompt completes without a `send-reply` call
- **THEN** the system SHALL return a failure response indicating the agent did not produce a reply

#### Scenario: Retry prompt explains the cause and the correct pattern
- **GIVEN** an agent that ended its turn without a reply after a rejected `--message` invocation
- **WHEN** the retry prompt is sent
- **THEN** the prompt SHALL explain that the turn ended without a reply, SHALL mention that `--message` on the command line is no longer supported and that the payload must be written to `$TMPDIR/$SESSION_ID/...` and passed via `--message-file`
- **AND** the prompt SHALL include the full `send-reply` and `react-message` SKILL.md content

## ADDED Requirements

### Requirement: Instructive Skill Error Messages

Skill script contract failures SHALL produce structured, instructive errors that teach the correct usage, so the agent can self-correct mid-turn. The shared payload helper SHALL raise typed errors carrying a stable `code` and a guidance message; the scripts SHALL emit them as JSON on stderr (extending the existing `exitWithError` contract with a `code` field) and SHALL NOT call the Skill API. The guidance message SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill. The error codes SHALL be: `SKILL_LEGACY_FLAG` (legacy free-text flag used, in either `--flag value` or `--flag=value` form — guidance SHALL state the flag was removed for security, forbid message content on the command line, and show the two-step payload-file flow), `SKILL_MISSING_PAYLOAD` (required payload flag absent — guidance SHALL name the required flag and show the two-step flow), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (path resolves outside the session staging directory, including symlink escapes — guidance SHALL explain the payload must live under `$TMPDIR/$SESSION_ID/...` and why, and show the correct form), and `SKILL_PAYLOAD_NOT_FOUND` (file absent or unreadable — guidance SHALL instruct writing the file first with the edit/write tool, then invoking the script). The `error` field SHALL be self-contained prose containing the fix and a full example command.

#### Scenario: Legacy flag error teaches the payload-file flow
- **GIVEN** an agent invokes `send-reply` with `--message "定價 $0.435"` or `--message=定價`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_LEGACY_FLAG`, SHALL state that command-line message content is no longer supported because shell expansion corrupts or leaks it, and SHALL include the correct two-step example: write the text to `$TMPDIR/$SESSION_ID/reply.md` with the edit/write tool, then invoke with `--message-file "$TMPDIR/$SESSION_ID/reply.md"`
- **AND** the script SHALL NOT call the Skill API

#### Scenario: Missing payload flag error names the required flag
- **GIVEN** an invocation of a required-payload skill (e.g. `send-reply`) with neither the legacy flag nor a payload-file flag
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_MISSING_PAYLOAD`, SHALL name the required flag (`--message-file`), and SHALL include the two-step flow with a concrete example

#### Scenario: Out-of-bounds payload error explains the staging location
- **GIVEN** an agent passes a payload path outside the session staging directory (e.g. `memory.private.jsonl`, `~/.git-credentials`, a sibling session's directory, or a symlink escaping the staging directory)
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_OUT_OF_BOUNDS`, SHALL explain that the payload must be written under `$TMPDIR/$SESSION_ID/...` (the session's own staging directory) and why (the script refuses to send the content of arbitrary files), and SHALL show the correct form

#### Scenario: Missing payload file error instructs staging first
- **GIVEN** an agent passes a payload-file flag pointing at a file that does not exist or cannot be read
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_NOT_FOUND`, SHALL instruct writing the file first with the edit/write tool, and SHALL show both steps with a concrete example

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped TMPDIR. The mapping SHALL be: `send-reply`/`edit-reply`/`set-reminder` use `--message-file`, `send-file` uses `--caption-file`, `memory-save` uses `--content-file`, `memory-search`/`fetch-context` use `--query-file`. A REQUIRED free-text argument SHALL have exactly one payload-file flag; an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one. The payload file SHALL be written by the agent through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the `$TMPDIR/$SESSION_ID`-anchored path, so its bytes are preserved verbatim with no shell interpretation. The system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}` at session setup (when the shell session is registered), because neither the agent's edit/write tool nor `writeTextFile` creates parent directories; the directory is removed with the rest of `{workspace}/tmp` when the last session for the workspace ends. The script SHALL resolve the payload path against its working directory (the session workspace, which is the agent subprocess cwd) and SHALL require the resolved path to be inside the session staging directory `{workspace}/tmp/{sessionId}` (the session id from the script's own `--session-id` argument; sessions without an id fall back to `{workspace}/tmp`), using boundary-safe matching (equal-or-separator-prefixed) so prefix-sibling directories (`{base}-2`, `{base}2`) are rejected. When the payload file exists, the script SHALL resolve its real path (`Deno.realPath`) and SHALL re-check the real path for containment, so a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected. When the payload flag is missing, the referenced file is absent or unreadable, the path is outside the staging directory, or the real path escapes it, the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API. On success the script SHALL pass the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged), and SHALL best-effort delete the payload file afterwards. The script SHALL reject any legacy free-text flag in either invocation form before doing anything else.

#### Scenario: Valid session-scoped payload accepted
- **GIVEN** a session with id `sess_own` whose workspace TMPDIR is `{workspace}/tmp`, and a payload file staged at `{workspace}/tmp/sess_own/reply.md`
- **WHEN** `send-reply` is invoked with `--session-id "sess_own"` and `--message-file "$TMPDIR/$SESSION_ID/reply.md"`
- **THEN** the script SHALL resolve the path into its own staging directory `{workspace}/tmp/sess_own`, read the file content verbatim (including any `$` characters, newlines, and empty strings), and call the Skill API with that content as the `message` parameter

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
