# Delta: skills-and-reply

## ADDED Requirements

### Requirement: Agent-Portable Staging And Session Identity

Every prompt surface that instructs skill usage — normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), scheduled reminder, AND the missing-reply retry prompt — SHALL supply the literal active Skill API session id and the ABSOLUTE session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`, the canonical payload staging location that is independent of any process-level `TMPDIR`), and every payload-staging instruction those prompts and the skill instruction files (`skills/*/SKILL.md`, skill script error/example text) give for structured file tools and payload-file flags SHALL direct the agent to those literal absolute paths, never to `$TMPDIR`/`$SESSION_ID` shell tokens. No payload-staging instruction in a rendered prompt SHALL contain an unexpanded `$TMPDIR` or `$SESSION_ID` token. This contract SHALL hold identically in per-spawn and shared-process (pooled) operation and for every agent type; a skill consumer SHALL NEVER depend on a frozen process-level `SESSION_ID` environment variable. The staging directory itself, its provisioning, and all containment/authorization semantics SHALL be unchanged — this requirement changes only the identity/path FORM of the instructions the agent receives.

#### Scenario: Rendered prompts name literal id and absolute staging dir
- **GIVEN** a session with Skill API id `sess_42` whose staging directory is `/abs/workspaces/discord/123/tmp/sess_42`
- **WHEN** any payload-staging prompt (system prompt, retry prompt, summary prompt) is rendered for that session
- **THEN** the rendered text SHALL contain the literal `sess_42` and the absolute directory `/abs/workspaces/discord/123/tmp/sess_42`
- **AND** the payload-file/structured-file-tool instructions in the rendered text SHALL contain NO `$TMPDIR` or `$SESSION_ID` token

#### Scenario: Pooled session gets the same literal contract as per-spawn
- **GIVEN** a shared-process (pooled, `SKILL_SHARED_PROCESS=1`) deployment whose process environment has NO `SESSION_ID` variable and a channel-scoped process `TMPDIR`
- **WHEN** a session's prompt and (if needed) its retry prompt are rendered and delivered
- **THEN** the prompts SHALL name that session's own literal Skill API id and its own absolute staging directory
- **AND** the agent's staged payload → script invocation SHALL resolve to the owning session's staging directory without any process-frozen identity

#### Scenario: End-to-end mocked delivery in both spawn shapes
- **GIVEN** a mocked platform and the REAL Skill API handler and reply-handler logic
- **WHEN** a per-spawn session and a pooled session each stage a payload at the prompt-rendered absolute path and invoke `send-reply` through the real script payload contract
- **THEN** exactly the intended reply SHALL be recorded for each session with NO duplicate retry or fallback delivery
- **AND** the staging path consumed by the handler SHALL be the same absolute directory the prompt named

## MODIFIED Requirements

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped TMPDIR. The mapping SHALL be: `send-reply`/`edit-reply`/`set-reminder` use `--message-file`, `send-file` uses `--caption-file`, `memory-save` uses `--content-file`, `memory-search`/`fetch-context` use `--query-file`. A REQUIRED free-text argument SHALL have exactly one payload-file flag; an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one. The payload file SHALL be written by the agent through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the ABSOLUTE staging directory literal rendered into its prompt (identical guidance in per-spawn and shared-process mode), so its bytes are preserved verbatim with no shell interpretation. For backward compatibility with existing OpenCode callers, a payload path (or structured file-tool path) that still carries the `$TMPDIR`/`$SESSION_ID` shell tokens SHALL keep resolving to the same staging directory it resolves to today; the shared payload helper's token/pointer/path resolution behavior SHALL be unchanged by the instruction-surface switch, and this compatibility SHALL be covered by tests. The system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}` at session setup (when the shell session is registered), because neither the agent's edit/write tool nor `writeTextFile` creates parent directories; the directory is removed with the rest of `{workspace}/tmp` when the last session for the workspace ends. The script SHALL resolve the payload path against its working directory and SHALL require the resolved path to be inside the session staging directory, using boundary-safe matching (equal-or-separator-prefixed) so prefix-sibling directories (`{base}-2`, `{base}2`) are rejected. The staging directory SHALL be resolved per mode: in SHARED-process mode ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`) — with no CLI-argument fallback — and a missing, unreadable, or malformed pointer SHALL make the script fail with the stable `SKILL_SESSION_UNRESOLVED` error BEFORE reading or deleting any payload file. Malformed is defined by a strict pointer schema: `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots); numbers, objects, empty strings, and relative staging are all malformed and fail identically; in per-spawn mode the staging directory is `{cwd}/tmp/{sessionId}`, where the session id comes from the script's own `--session-id` argument (sessions without an id fall back to `{workspace}/tmp`). When the payload file exists, the script SHALL resolve its real path (`Deno.realPath`) and SHALL re-check the real path for containment, so a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected. When the payload flag is missing, the referenced file is absent or unreadable, the path is outside the staging directory, or the real path escapes it, the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API. On success the script SHALL pass the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged), and SHALL best-effort delete the payload file afterwards. The script SHALL reject any legacy free-text flag in either invocation form before doing anything else.

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

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without having called `send-reply`, `react-message`, or `send-file`. The retry SHALL clear the reply state, send a second prompt on the same ACP session requesting the agent to send a reply, and if the retry also fails, return a failure response. A session that produced a reply, a reaction, or a file send SHALL NOT be retried. The retry prompt SHALL be instructive and agent-portable in EVERY spawn shape (per-spawn and pooled): it SHALL state that the turn ended without a reply, reaction, or file send; SHALL list the likely causes of a failed `send-reply`/`send-file` under the payload-file contract (legacy `--message`/`--caption` used and rejected, payload file never written, payload staged outside the session's staging directory, or a previous skill call that errored — with an instruction to read that error's output); SHALL give the correct two-step example invocation naming the LITERAL active Skill API session id and the ABSOLUTE staging directory (write the payload to `{absolute staging dir}/...` with the edit/write tool, then invoke the script with the payload-file flag pointing at that absolute path); and SHALL include the full `send-reply`, `react-message`, and `send-file` SKILL.md content. The retry prompt's file-tool and payload-flag instructions SHALL contain no unexpanded `$TMPDIR`/`$SESSION_ID` tokens in any spawn shape. Retry timing, attempt limits, and the reply-quota authority SHALL remain unchanged.

#### Scenario: Successful retry produces reply
- **GIVEN** an agent completes without sending a reply, reaction, or file
- **WHEN** the retry mechanism triggers
- **THEN** the system SHALL send a retry prompt on the same session
- **AND** if the agent calls `send-reply` during retry, the session SHALL succeed

#### Scenario: Failed retry returns error
- **GIVEN** an agent completes without a reply and the retry also fails
- **WHEN** the retry prompt completes without a `send-reply`, `react-message`, or `send-file` call
- **THEN** the system SHALL return a failure response indicating the agent did not produce a reply

#### Scenario: Retry prompt explains the cause and the correct pattern
- **GIVEN** an agent that ended its turn without a reply after a rejected `--message` invocation
- **WHEN** the retry prompt is sent
- **THEN** the prompt SHALL explain that the turn ended without a reply, SHALL mention that `--message` on the command line is no longer supported and that the payload must be written to the session's absolute staging directory and passed via `--message-file`
- **AND** the prompt SHALL name the literal session id and the absolute staging directory, with no unexpanded `$TMPDIR`/`$SESSION_ID` token in its instructions
- **AND** the prompt SHALL include the full `send-reply`, `react-message`, and `send-file` SKILL.md content

#### Scenario: Per-spawn retry carries the same literal guidance as pooled
- **GIVEN** a per-spawn (non-pooled) session whose process environment does export a session `SESSION_ID`
- **WHEN** its missing-reply retry prompt is built
- **THEN** the retry text SHALL name the literal session id and absolute staging directory rather than shell tokens
- **AND** the prompt SHALL remain actionable even if the agent ignores the environment entirely

#### Scenario: File-only session is not retried
- **GIVEN** an agent completes a turn after a successful `send-file` call without sending a reply or reaction
- **WHEN** the missing-response check runs
- **THEN** the retry mechanism SHALL NOT trigger
- **AND** the session SHALL be recorded as successful with `fileSent: true`

### Requirement: Instructive Skill Error Messages

Skill script contract failures SHALL produce structured, instructive errors that teach the correct usage, so the agent can self-correct mid-turn. The shared payload helper SHALL raise typed errors carrying a stable `code` and a guidance message; the scripts SHALL emit them as JSON on stderr (extending the existing `exitWithError` contract with a `code` field) and SHALL NOT call the Skill API. The guidance message SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill, anchored on the staging directory and session id RENDERED IN THE AGENT'S SYSTEM PROMPT (absolute literal paths) rather than on `$TMPDIR`/`$SESSION_ID` shell tokens. The error codes SHALL be: `SKILL_LEGACY_FLAG` (legacy free-text flag used, in either `--flag value` or `--flag=value` form — guidance SHALL state the flag was removed for security, forbid message content on the command line, and show the two-step payload-file flow), `SKILL_MISSING_PAYLOAD` (required payload flag absent — guidance SHALL name the required flag and show the two-step flow), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (path resolves outside the session staging directory, including symlink escapes — guidance SHALL name the resolved staging base the script enforced and explain the payload must live under it and why, and show the correct form), `SKILL_PAYLOAD_NOT_FOUND` (file absent or unreadable — guidance SHALL instruct writing the file first with the edit/write tool under the rendered staging directory, then invoking the script), and `SKILL_SINGLE_FILE_FLAG` (the `send-file` script invoked with the removed singular `--file-path` flag in either form — guidance SHALL state that the flag was replaced by the repeatable `--file-paths` flag, explain that the skill supports multiple files per invocation, and show a copy-pasteable example with two or more `--file-paths` arguments), and `SKILL_SESSION_UNRESOLVED` (shared-process mode with a missing, unreadable, or malformed current-session pointer — the owning session cannot be resolved; guidance SHALL name the expected pointer path and the "invoke skills during a live turn" remedy). The `error` field SHALL be self-contained prose containing the fix and a full example command.

#### Scenario: Legacy flag error teaches the payload-file flow
- **GIVEN** an agent invokes `send-reply` with `--message "定價 $0.435"` or `--message=定價`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_LEGACY_FLAG`, SHALL state that command-line message content is no longer supported because shell expansion corrupts or leaks it, and SHALL include the correct two-step example: write the text to the session staging directory shown in the system prompt (e.g. `{staging}/reply.md`) with the edit/write tool, then invoke with `--message-file` pointing at that file
- **AND** the script SHALL NOT call the Skill API

#### Scenario: Missing payload flag error names the required flag
- **GIVEN** an invocation of a required-payload skill (e.g. `send-reply`) with neither the legacy flag nor a payload-file flag
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_MISSING_PAYLOAD`, SHALL name the required flag (`--message-file`), and SHALL include the two-step flow with a concrete example

#### Scenario: Out-of-bounds payload error explains the staging location
- **GIVEN** an agent passes a payload path outside the session staging directory (e.g. `memory.private.jsonl`, `~/.git-credentials`, a sibling session's directory, or a symlink escaping the staging directory)
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_OUT_OF_BOUNDS`, SHALL name the resolved staging base the script enforced, explain that the payload must be written under that directory (the session's own staging directory) and why (the script refuses to send the content of arbitrary files), and SHALL show the correct form
- **AND** the guidance SHALL direct the agent to the staging directory rendered in its system prompt rather than assuming a `$TMPDIR`/`$SESSION_ID` shell environment

#### Scenario: Missing payload file error instructs staging first
- **GIVEN** an agent passes a payload-file flag pointing at a file that does not exist or cannot be read
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_NOT_FOUND`, SHALL instruct writing the file first with the edit/write tool under the prompt-rendered staging directory, and SHALL show both steps with a concrete example

#### Scenario: Singular send-file flag error teaches repeatable flag
- **GIVEN** an agent invokes `send-file` with `--file-path report.pdf` or `--file-path=report.pdf`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_SINGLE_FILE_FLAG`, SHALL state that `--file-path` was replaced by the repeatable `--file-paths` flag, and SHALL include a copy-pasteable example passing two or more files
