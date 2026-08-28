# Skills and Reply

## Purpose

Defines the shell-based skill execution architecture, Skill API HTTP server, session authentication, available skills, reply rules, retry mechanism, edit-reply behavior, and content processing (XML stripping, newline unescaping).
## Requirements
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
- **AND** in shared-process mode the skill client library resolves the owning session id from the orchestrator-maintained pointer file, so the agent still needs no extra parameters

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

### Requirement: Skill API HTTP Server

The system SHALL run an HTTP server (configurable host/port, typically `localhost:3001`) that exposes skill endpoints at `POST /api/skill/{skill-name}`. The server SHALL only accept POST requests (returning appropriate errors for other methods). OPTIONS requests SHALL return 204 for CORS preflight. The server SHALL implement a 1-second TTL request cache for deduplication of concurrent duplicate requests.

#### Scenario: Valid skill API call
- **GIVEN** an active session with ID `sess_abc_123`
- **WHEN** a POST request is sent to `/api/skill/memory-save` with `{ "sessionId": "sess_abc_123", "parameters": { ... } }`
- **THEN** the server SHALL authenticate the session, execute the skill handler, and return the result

#### Scenario: Invalid session rejected
- **GIVEN** an expired or non-existent session ID
- **WHEN** a skill API request is made with that session ID
- **THEN** the server SHALL return HTTP 401

### Requirement: Session-Based Authentication

The system SHALL authenticate all Skill API requests with a per-session signed JWT (see the `jwt-skill-auth` capability): a valid session ID alone SHALL NOT be sufficient, and a raw per-session caller token presented raw on its own SHALL be rejected. At session registration the system SHALL mint a high-entropy per-session caller token (256-bit CSPRNG, distinct from the session ID) that becomes the JWT `jti` claim. The session's JWT (header `{"alg":"HS256"}`, payload `{ sub, channel, jti, iat, exp }`, HMAC-SHA256 signature with the deployment-level secret) SHALL be issued — or re-issued with a fresh `exp` — when the session acquires the global execution lease (NOT at registration), so a session queued behind a long in-flight session cannot present an expired JWT. Each Skill API request SHALL present the session's JWT via an `Authorization: Bearer <jwt>` header; the server SHALL verify (1) the signature (constant-time comparison), (2) `sub == sessionId`, (3) `channel == session channelId`, and (4) `jti == session caller token` and `exp` validity, rejecting any failure with HTTP 403 (401 for expired or unknown session). Sessions SHALL expire based on a configurable idle `timeoutMs`: the session registry SHALL treat a session idle beyond `timeoutMs` as absent on `get()`, run periodic cleanup, and refresh the session's `lastActivityAt` via `touch()` on each authenticated call.

Note: the JWT is provisioned into the owning subprocess via the per-session JWT file and the current-session pointer, so it does not by itself defend against an attacker who can read that subprocess's files directly (that vector is addressed by agent filesystem confinement and the permission gate); its purpose is to ensure that knowledge of a session ID obtained through any other channel does not grant the ability to act as that session.

#### Scenario: Valid session ID without caller token rejected
- **GIVEN** an active session `sess_abc_123`
- **WHEN** a Skill API request presents `sessionId: "sess_abc_123"` without the session's signed JWT, or with a JWT that fails any of the four verification checks
- **THEN** the server SHALL return HTTP 403 and SHALL NOT execute the skill

#### Scenario: Valid session ID with matching caller token accepted
- **GIVEN** an active session `sess_abc_123` (channel `discord/123`) whose owning subprocess holds the session's signed JWT (`jti` = the session's caller token)
- **WHEN** a Skill API request presents `sessionId: "sess_abc_123"` and the session's JWT via the `Authorization` header
- **THEN** the server SHALL authenticate the request and execute the skill handler

#### Scenario: Cross-session impersonation rejected
- **GIVEN** the owning session is `sess_abc_123` (channel `discord/123`) and a prompt-injected agent calls the Skill API with another user's session id `sess_xyz_789` (channel `misskey/456`)
- **WHEN** the request presents the owning session's JWT (`sub=sess_abc_123`, `channel=discord/123`) with `sessionId: "sess_xyz_789"`
- **THEN** the `sub != sessionId` check fails and the server SHALL reject the request with HTTP 403

#### Scenario: Constant-time token comparison
- **GIVEN** a presented JWT
- **WHEN** the server verifies its HMAC-SHA256 signature
- **THEN** the comparison SHALL be constant-time to avoid a timing oracle

#### Scenario: Session expiration
- **GIVEN** a session that has been inactive beyond `timeoutMs`
- **WHEN** a Skill API request is made with that session ID
- **THEN** the session registry SHALL treat the session as absent and the server SHALL return 401

#### Scenario: Activity refreshes idle timeout
- **GIVEN** an active session receiving authenticated calls within `timeoutMs`
- **WHEN** each authenticated call is processed
- **THEN** the session's `lastActivityAt` SHALL be refreshed via `touch()` so an actively used session does not expire mid-turn

### Requirement: Available Skills

The system SHALL register the following skills via `SkillRegistry`:

| Skill             | Handler              | Description                     |
| ----------------- | -------------------- | ------------------------------- |
| `memory-save`     | MemoryHandler        | Save a new memory               |
| `memory-search`   | MemoryHandler        | Search existing memories        |
| `memory-patch`    | MemoryHandler        | Update memory attributes        |
| `memory-stats`    | MemoryHandler        | Get memory statistics           |
| `memory-export`   | MemoryHandler        | Export memories as file          |
| `send-reply`      | ReplyHandler         | Send a reply message            |
| `edit-reply`      | ReplyHandler         | Edit a previously sent reply    |
| `get-message`     | ReplyHandler         | Get a message by ID             |
| `fetch-context`   | ContextHandler       | Fetch additional platform data  |
| `react-message`   | ReactionHandler      | Add emoji reaction to a message |

The following skills SHALL be registered conditionally based on configuration:

| Skill              | Condition                         |
| ------------------ | --------------------------------- |
| `set-reminder`     | `remindersConfig?.enabled && reminderStore` |
| `cancel-reminder`  | Same as above                     |
| `list-reminders`   | Same as above                     |
| `send-file`        | `sendFileConfig?.enabled`         |

#### Scenario: Conditional skill not registered
- **GIVEN** reminders are not enabled in configuration
- **WHEN** the skill registry initializes
- **THEN** `set-reminder`, `cancel-reminder`, and `list-reminders` SHALL NOT be registered

### Requirement: Reply Rules

The system SHALL enforce the following reply limits per session:

- **`send-reply`**: Maximum 1 call per session (`MAX_REPLIES_PER_SESSION = 1`). Additional calls SHALL be rejected with HTTP 429 status and a message advising use of `edit-reply` instead.
- **Doom-loop detection**: If `send-reply` is attempted 4 or more times (`MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4`), the system SHALL terminate the agent. In per-spawn mode the `onTerminateRequest` callback SHALL terminate the per-session subprocess; in shared-process mode it SHALL cancel the current ACP session via `session/cancel` and SHALL NOT terminate the shared channel process.
- **`edit-reply`**: Requires a prior successful `send-reply` (`replySent = true`). If `edit-reply` is called 3 or more times (`MAX_EDIT_CALLS_BEFORE_TERMINATE = 3`), the system SHALL terminate the agent (per-spawn: process termination; shared-process: `session/cancel`).
- **`send-file` quota**: `send-file` SHALL be limited to 1 successful call per session (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call). Additional calls SHALL be rejected with HTTP 429. If `send-file` is attempted 4 or more times (`MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4`), the system SHALL terminate the agent via `onTerminateRequest` (doom-loop protection). `send-file` SHALL NOT be tracked by the reply count/doom-loop counters, SHALL NOT set `replySent`, SHALL NOT update the session's `lastSentMessageId`, and SHALL NOT trigger conversation summary generation. A file send is a distinct communication channel: it SHALL be tracked via the session file-send state, and a call is counted as successful when at least one file was delivered. `send-file` SHALL only be callable from user-triggered message/channelLurk sessions: triggerless sessions (spontaneous, self-research, memory-maintenance, reminders) SHALL be rejected with HTTP 403 because they only track replies and an untracked file send would cause duplicate output or repeat delivery. `send-file` skill results SHALL NOT be served from the request deduplication cache (the quota/doom-loop gate must run on every attempt, including identical repeated calls).
- **Minimum response requirement**: At least one reply (via `send-reply`), one reaction (via `react-message`), or one file send (via `send-file`) SHALL be produced per session. If none of the three occurs when the agent completes, the retry mechanism SHALL trigger.

#### Scenario: Second send-reply rejected
- **GIVEN** a session where `send-reply` has already been called once
- **WHEN** `send-reply` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: Doom-loop terminates agent
- **GIVEN** a session where `send-reply` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** in per-spawn mode the system SHALL invoke `onTerminateRequest` to terminate the per-session agent subprocess
- **AND** in shared-process mode it SHALL cancel the current ACP session via `session/cancel` and SHALL NOT terminate the shared channel process

#### Scenario: edit-reply before send-reply fails
- **GIVEN** a session where no reply has been sent yet
- **WHEN** `edit-reply` is called
- **THEN** the handler SHALL return an error "No reply has been sent yet. Use send-reply first."

#### Scenario: send-file does not consume the reply quota
- **GIVEN** a session where `send-file` has been called successfully
- **WHEN** `send-reply` is called afterwards
- **THEN** the `send-reply` SHALL NOT be rejected by the one-call limit

#### Scenario: Second send-file rejected
- **GIVEN** a session where `send-file` has already succeeded once
- **WHEN** `send-file` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: send-file in a triggerless session rejected
- **GIVEN** a session registered without a trigger event (e.g. spontaneous or reminder delivery)
- **WHEN** `send-file` is called
- **THEN** the server SHALL return HTTP 403 with an instructive error
- **AND** no file-send state or quota slot SHALL be recorded

#### Scenario: send-file doom-loop terminates agent
- **GIVEN** a session where `send-file` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** the system SHALL invoke `onTerminateRequest` (per-spawn: process termination; shared: `session/cancel`)

#### Scenario: Identical repeated attempts still reach the doom-loop gate
- **GIVEN** a session where `send-file` has succeeded once
- **WHEN** the agent repeats the exact same rejected `send-file` request 3 more times within the dedup-cache window
- **THEN** each attempt SHALL be re-executed (not served from cache) and the 4th attempt SHALL trigger agent termination

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without having called `send-reply`, `react-message`, or `send-file`. The retry SHALL clear the reply state, send a second prompt on the same ACP session requesting the agent to send a reply, and if the retry also fails, return a failure response. A session that produced a reply, a reaction, or a file send SHALL NOT be retried. The retry prompt SHALL be instructive: it SHALL state that the turn ended without a reply, reaction, or file send; SHALL list the likely causes of a failed `send-reply`/`send-file` under the payload-file contract (legacy `--message`/`--caption` used and rejected, payload file never written, payload staged outside `$TMPDIR/$SESSION_ID/`, or a previous skill call that errored — with an instruction to read that error's output); SHALL give the correct two-step example invocation (write the payload to `$TMPDIR/$SESSION_ID/...` with the edit/write tool, then invoke the script with the payload-file flag); and SHALL include the full `send-reply`, `react-message`, and `send-file` SKILL.md content.

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
- **THEN** the prompt SHALL explain that the turn ended without a reply, SHALL mention that `--message` on the command line is no longer supported and that the payload must be written to `$TMPDIR/$SESSION_ID/...` and passed via `--message-file`
- **AND** the prompt SHALL include the full `send-reply`, `react-message`, and `send-file` SKILL.md content

#### Scenario: File-only session is not retried
- **GIVEN** an agent completes a turn after a successful `send-file` call without sending a reply or reaction
- **WHEN** the missing-response check runs
- **THEN** the retry mechanism SHALL NOT trigger
- **AND** the session SHALL be recorded as successful with `fileSent: true`

### Requirement: Instructive Skill Error Messages

Skill script contract failures SHALL produce structured, instructive errors that teach the correct usage, so the agent can self-correct mid-turn. The shared payload helper SHALL raise typed errors carrying a stable `code` and a guidance message; the scripts SHALL emit them as JSON on stderr (extending the existing `exitWithError` contract with a `code` field) and SHALL NOT call the Skill API. The guidance message SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill. The error codes SHALL be: `SKILL_LEGACY_FLAG` (legacy free-text flag used, in either `--flag value` or `--flag=value` form — guidance SHALL state the flag was removed for security, forbid message content on the command line, and show the two-step payload-file flow), `SKILL_MISSING_PAYLOAD` (required payload flag absent — guidance SHALL name the required flag and show the two-step flow), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (path resolves outside the session staging directory, including symlink escapes — guidance SHALL explain the payload must live under `$TMPDIR/$SESSION_ID/...` and why, and show the correct form), and `SKILL_PAYLOAD_NOT_FOUND` (file absent or unreadable — guidance SHALL instruct writing the file first with the edit/write tool, then invoking the script), and `SKILL_SINGLE_FILE_FLAG` (the `send-file` script invoked with the removed singular `--file-path` flag in either form — guidance SHALL state that the flag was replaced by the repeatable `--file-paths` flag, explain that the skill supports multiple files per invocation, and show a copy-pasteable example with two or more `--file-paths` arguments), and `SKILL_SESSION_UNRESOLVED` (shared-process mode with a missing, unreadable, or malformed current-session pointer — the owning session cannot be resolved; guidance SHALL name the expected pointer path and the "invoke skills during a live turn" remedy). The `error` field SHALL be self-contained prose containing the fix and a full example command.

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

#### Scenario: Singular send-file flag error teaches repeatable flag
- **GIVEN** an agent invokes `send-file` with `--file-path report.pdf` or `--file-path=report.pdf`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_SINGLE_FILE_FLAG`, SHALL state that `--file-path` was replaced by the repeatable `--file-paths` flag, and SHALL include a copy-pasteable example passing two or more files
- **AND** the script SHALL NOT call the Skill API

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped TMPDIR. The mapping SHALL be: `send-reply`/`edit-reply`/`set-reminder` use `--message-file`, `send-file` uses `--caption-file`, `memory-save` uses `--content-file`, `memory-search`/`fetch-context` use `--query-file`. A REQUIRED free-text argument SHALL have exactly one payload-file flag; an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one. The payload file SHALL be written by the agent through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the `$TMPDIR/$SESSION_ID`-anchored path (per-spawn; in shared-process mode the agent writes to the prompt-rendered staging directory), so its bytes are preserved verbatim with no shell interpretation. The system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}` at session setup (when the shell session is registered), because neither the agent's edit/write tool nor `writeTextFile` creates parent directories; the directory is removed with the rest of `{workspace}/tmp` when the last session for the workspace ends. The script SHALL resolve the payload path against its working directory and SHALL require the resolved path to be inside the session staging directory, using boundary-safe matching (equal-or-separator-prefixed) so prefix-sibling directories (`{base}-2`, `{base}2`) are rejected. The staging directory SHALL be resolved per mode: in SHARED-process mode ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`) — with no CLI-argument fallback — and a missing, unreadable, or malformed pointer SHALL make the script fail with the stable `SKILL_SESSION_UNRESOLVED` error BEFORE reading or deleting any payload file. Malformed is defined by a strict pointer schema: `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots); numbers, objects, empty strings, and relative staging are all malformed and fail identically; in per-spawn mode the staging directory is `{cwd}/tmp/{sessionId}`, where the session id comes from the script's own `--session-id` argument (sessions without an id fall back to `{workspace}/tmp`). When the payload file exists, the script SHALL resolve its real path (`Deno.realPath`) and SHALL re-check the real path for containment, so a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected. When the payload flag is missing, the referenced file is absent or unreadable, the path is outside the staging directory, or the real path escapes it, the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API. On success the script SHALL pass the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged), and SHALL best-effort delete the payload file afterwards. The script SHALL reject any legacy free-text flag in either invocation form before doing anything else.

#### Scenario: Valid session-scoped payload accepted
- **GIVEN** a session with id `sess_own` whose workspace TMPDIR is `{workspace}/tmp`, and a payload file staged at `{workspace}/tmp/sess_own/reply.md`
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

### Requirement: Reply Threading Anchor and Message ID Roles

The system SHALL distinguish four message-ID roles per session so no tool can confuse the ID of a message the bot sent with the ID of the message being replied to:

- **`lastSentMessageId`** — the ID of the last message sent via `send-reply` or `edit-reply`. It SHALL be updated ONLY by those two skills (the Skill API server refreshes it after each successful call, including Misskey's delete-and-recreate new ID). It is consumed by `edit-reply` scoping and by the `get-message` fallback. A message delivered by `send-file` SHALL NEVER be recorded here.
- **`lastFileMessageId`** — the ID of the last message delivered by `send-file`. It SHALL be updated ONLY by `send-file`, and ONLY when at least one file was delivered (on Misskey chat partial delivery it SHALL be the last *delivered* message ID). It is consumed as the reply threading anchor and by the `get-message` fallback.
- **`lastReplyAnchorMessageId`** — the message ID that the last text reply was created as a reply to (the reply anchor in effect when `send-reply` succeeded). It SHALL be recorded ONLY on a successful `send-reply` and SHALL NOT be changed by `edit-reply`. Misskey `edit-reply` re-creation SHALL thread to this recorded anchor, so editing a reply never rewrites its original thread parent.
- **`triggerMessageId`** — the ID of the message that triggered the session (empty for triggerless sessions). It is the fallback reply anchor and the target of `react-message`.

The session's **reply anchor** SHALL resolve to `lastFileMessageId ?? triggerMessageId`. `send-reply` SHALL thread its message to the reply anchor. Misskey `edit-reply` re-creation SHALL thread to `lastReplyAnchorMessageId` (falling back to the reply anchor when unset). `send-file` SHALL thread to the trigger message (its delivered ID is only recorded after the call succeeds, and only one `send-file` call per session is permitted, so the anchor is always the trigger when `send-file` runs). `react-message` SHALL target `triggerMessageId`, never the bot's own file message.

The `get-message` skill SHALL resolve its target message as `params.messageId`, falling back to `lastSentMessageId`, then `lastFileMessageId`, and SHALL return an error when none exists.

#### Scenario: Send-reply after file send threads to the file message
- **GIVEN** a session that delivered files via `send-file` (so `lastFileMessageId` is `file-note-1`) and has a trigger message `trigger-1`
- **WHEN** `send-reply` is called
- **THEN** the reply SHALL be threaded to `file-note-1`, not to `trigger-1`
- **AND** `lastReplyAnchorMessageId` SHALL be recorded as `file-note-1`

#### Scenario: Send-reply before file send threads to the trigger message
- **GIVEN** a session that sent a reply first and delivers files afterwards
- **WHEN** `send-reply` was called before the file send
- **THEN** the reply SHALL be threaded to the trigger message (the anchor was still the trigger at call time)
- **AND** `lastReplyAnchorMessageId` SHALL be recorded as the trigger message
- **AND** the subsequent `send-file` SHALL also be threaded to the trigger message

#### Scenario: Failed file send leaves the anchor on the trigger
- **GIVEN** a session where a `send-file` call failed with no delivered messages
- **WHEN** `send-reply` is called afterwards
- **THEN** the reply SHALL be threaded to the trigger message
- **AND** no `lastFileMessageId` SHALL be recorded

#### Scenario: File send does not pollute the edit scope
- **GIVEN** a session that delivered files (so `lastFileMessageId` is `file-1`) and then sent a reply (so `lastSentMessageId` is `reply-1`)
- **WHEN** the session state is inspected
- **THEN** `lastSentMessageId` SHALL be `reply-1` and SHALL NOT be `file-1`

#### Scenario: Get-message fallback covers the file message
- **GIVEN** a session that delivered files via `send-file` but sent no text reply
- **WHEN** `get-message` is called without a `messageId` parameter
- **THEN** the skill SHALL fetch the message identified by `lastFileMessageId`

### Requirement: Edit-Reply Platform Behavior

`edit-reply` SHALL only operate on the current session's own most-recently-sent **text reply** message: the handler SHALL reject the request when `params.messageId` does not equal `context.lastSentMessageId`. Because `send-file` records its delivered message ID in `lastFileMessageId` and NEVER in `lastSentMessageId`, file-message IDs SHALL NEVER be editable: any attempt to pass a `send-file` message ID to `edit-reply` SHALL be rejected by the same scoping check and SHALL NOT delete or edit the file message. Subject to that scoping, `edit-reply` SHALL behave differently depending on the platform:

- **Discord**: SHALL use native `platformAdapter.editMessage()` to edit the message in-place.
- **Misskey Notes** (`note:` channel prefix): SHALL use a delete-and-recreate strategy — delete the old note via `notes/delete`, then create a new note via `notes/create` with the message the edited reply was originally created as a reply to (`context.lastReplyAnchorMessageId`, falling back to the reply anchor) as `replyId` to preserve the reply's original thread parent. The returned `messageId` will differ from the original. Visibility and `visibleUserIds` SHALL be preserved.
- **Misskey Chat** (`chat:` channel prefix): SHALL use a delete-and-recreate strategy via `chat/messages/delete` followed by `chat/messages/create-to-user`.

If the delete step fails, the system SHALL abort without creating a new message and SHALL return an error.

#### Scenario: Edit-reply on foreign message rejected
- **GIVEN** a session whose `context.lastSentMessageId` is `msg-A`
- **WHEN** `edit-reply` is called with `messageId` equal to `msg-B` (a message from another conversation)
- **THEN** the handler SHALL reject the request with an error and SHALL NOT delete or edit any message

#### Scenario: Edit-reply on a file message rejected
- **GIVEN** a session that delivered files (so `context.lastFileMessageId` is `file-1`) and sent a reply (so `context.lastSentMessageId` is `reply-1`)
- **WHEN** `edit-reply` is called with `messageId` equal to `file-1`
- **THEN** the handler SHALL reject the request with an error
- **AND** the file message SHALL NOT be deleted or edited

#### Scenario: Discord edit-reply
- **GIVEN** a reply was sent in a Discord channel and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL call `platformAdapter.editMessage()` to edit in-place

#### Scenario: Misskey note edit-reply
- **GIVEN** a reply was sent as a Misskey note and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL delete the old note and create a new note with the reply anchor as `replyId`
- **AND** if the delete fails, the system SHALL NOT create a new note

#### Scenario: Misskey note edit after a file send re-threads to the file note
- **GIVEN** a Misskey note session that sent a file note (so `context.lastFileMessageId` is `file-note-1`) and then a text reply threaded to it (so `context.lastReplyAnchorMessageId` is `file-note-1`)
- **WHEN** `edit-reply` is called on the text reply
- **THEN** the recreated note SHALL be threaded to `file-note-1` (the anchor recorded when the reply was created), preserving the conversation thread

#### Scenario: Editing a reply sent before the file send keeps its original thread parent
- **GIVEN** a Misskey note session where a text reply was sent first, threaded to the trigger (so `context.lastReplyAnchorMessageId` is `trigger-1`), and a file note was delivered afterwards (so `context.lastFileMessageId` is `file-note-1`)
- **WHEN** `edit-reply` is called on the text reply
- **THEN** the recreated note SHALL be threaded to `trigger-1`, NOT to `file-note-1` — the edit SHALL NOT rewrite the reply's original thread topology

#### Scenario: Successive Misskey edits in one session
- **GIVEN** a Misskey note reply was edited once, producing a new note ID (delete-and-recreate)
- **WHEN** `edit-reply` is called again in the same session with the new note ID
- **THEN** the session's tracked `lastSentMessageId` SHALL have been updated to that new ID after the first edit, so the second edit's scoping check SHALL pass and the edit SHALL proceed

### Requirement: XML Tag Stripping

The system SHALL strip XML-like tags from reply content before sending to platforms using the regex `/<\/?[a-zA-Z][a-zA-Z0-9_]*>/g`. Inner text between tags SHALL be preserved. This SHALL apply to `send-reply`, `edit-reply`, and the `send-file` caption.

#### Scenario: XML tags removed from reply
- **GIVEN** a reply message contains `<e>😆</e>`
- **WHEN** `stripXmlTags()` is applied
- **THEN** the result SHALL be `😆`

#### Scenario: XML tags removed from send-file caption
- **GIVEN** a `send-file` caption contains `<e>done</e>`
- **WHEN** the caption is processed before sending
- **THEN** the sent caption text SHALL be `done`

### Requirement: Literal Newline Unescaping

The system SHALL convert literal `\n` sequences (2 characters: backslash + n) to actual newline characters in reply content via `unescapeNewlines()`. This SHALL apply to `send-reply`, `edit-reply`, and the `send-file` caption, after XML tag stripping.

#### Scenario: Literal backslash-n converted
- **GIVEN** a reply message contains the literal string `Hello\nWorld`
- **WHEN** `unescapeNewlines()` is applied
- **THEN** the result SHALL contain an actual newline between `Hello` and `World`

#### Scenario: Literal backslash-n converted in send-file caption
- **GIVEN** a `send-file` caption contains the literal string `Line1\nLine2`
- **WHEN** the caption is processed before sending
- **THEN** the sent caption SHALL contain an actual newline between `Line1` and `Line2`

### Requirement: Reaction Handling

The `react-message` skill SHALL add an emoji reaction to the message that triggered the session (`context.triggerMessageId`), even when the bot has since sent its own messages (e.g. a file message): a reaction SHALL NEVER target a message the bot itself sent. It SHALL require a non-empty `emoji` parameter and a valid `context.triggerMessageId` (the trigger message). The system SHALL track reactions per workspace:channel combination via `reactionSentMap` to prevent duplicate reactions.

#### Scenario: Reaction added to trigger message
- **GIVEN** a session triggered by a message
- **WHEN** `react-message` is called with `emoji = "👍"`
- **THEN** the system SHALL call `platformAdapter.addReaction()` on the trigger message

#### Scenario: Reaction after a file send still targets the trigger message
- **GIVEN** a session that delivered files via `send-file` and has a trigger message `trigger-1`
- **WHEN** `react-message` is called
- **THEN** the reaction SHALL be added to `trigger-1`
- **AND** SHALL NOT be added to the bot's own file message

#### Scenario: No trigger message for reaction
- **GIVEN** a session without a `triggerMessageId` (e.g., spontaneous post)
- **WHEN** `react-message` is called
- **THEN** the handler SHALL return an error indicating no trigger message exists

### Requirement: Send-File Workspace Boundary

The `send-file` skill SHALL accept multiple file paths per invocation via the `filePaths` parameter (a non-empty array of strings). Every requested path SHALL be validated before any file is sent: each path SHALL be within the user's workspace or the agent workspace (if available); path traversal (`..`) SHALL be blocked; files exceeding `config.maxFileSizeMb` (default: 25 MB) SHALL be rejected; only files with extensions in `config.allowedExtensions` SHALL be permitted; file read failures SHALL return an error without crashing. Containment SHALL be checked against the file's REAL path (`Deno.realPath`, symlink-aware): a symlink inside the workspace that resolves outside the workspace or agent-workspace boundary SHALL be rejected, because `Deno.stat`/`Deno.readFile` follow symlinks and would otherwise exfiltrate arbitrary host files. The batch SHALL additionally be checked before any file bytes are read: the number of files SHALL NOT exceed `config.maxFilesPerInvocation` (default: 10) and the total byte size SHALL NOT exceed `config.maxTotalSizeMb` (default: 50). Validation, batch-limit checks, and file reading SHALL be all-or-nothing (preflight): if any path fails validation, any limit is exceeded, or any read fails, the system SHALL reject the entire invocation and SHALL NOT send any file.

#### Scenario: Path traversal blocked
- **GIVEN** a `send-file` request with path `../../etc/passwd`
- **WHEN** `validateFilePath()` is called
- **THEN** the system SHALL throw a `SkillError` with code `SKILL_INVALID_PARAMS`

#### Scenario: File within workspace allowed
- **GIVEN** a `send-file` request for a file within the workspace boundary
- **WHEN** `validateFilePath()` is called
- **THEN** the validation SHALL pass and the file SHALL be sent

#### Scenario: Symlink escaping the workspace rejected
- **GIVEN** a workspace containing a symlink `leak.pdf` that resolves to a file outside the workspace/agent-workspace boundary
- **WHEN** a `send-file` request for `leak.pdf` is processed
- **THEN** the invocation SHALL be rejected (real-path containment failure)
- **AND** no file SHALL be read or sent

#### Scenario: One invalid path rejects the whole multi-file call
- **GIVEN** a `send-file` request with `filePaths: ["ok.png", "../../etc/passwd"]` where `ok.png` is within the workspace
- **WHEN** the handler validates the paths
- **THEN** the invocation SHALL be rejected with a validation error
- **AND** no file SHALL be sent to the platform

#### Scenario: Batch exceeding the file-count limit rejected before read
- **GIVEN** `maxFilesPerInvocation` is `2`
- **WHEN** a `send-file` request with 3 file paths is processed
- **THEN** the invocation SHALL be rejected
- **AND** no file SHALL be read or sent

#### Scenario: Batch exceeding the aggregate size limit rejected before read
- **GIVEN** `maxTotalSizeMb` is `5`
- **WHEN** a `send-file` request with two files totaling 6 MB is processed
- **THEN** the invocation SHALL be rejected
- **AND** no file SHALL be read or sent

### Requirement: Send-File Multi-File Sending

The `send-file` skill SHALL support sending multiple files in one invocation. The skill script SHALL accept a repeatable `--file-paths` flag (short alias `-f`); each occurrence adds one file path, and at least one occurrence SHALL be required. The removed singular `--file-path` flag (either form) SHALL be rejected with code `SKILL_SINGLE_FILE_FLAG` and the script SHALL NOT call the Skill API. The script SHALL pass the paths to the Skill API as the `filePaths` array parameter. The optional caption SHALL follow the payload-file flow (`--caption-file`) and SHALL apply to the whole file batch. Delivery semantics per platform: on Discord, all files SHALL be sent in a single message with all attachments; on Misskey notes, all files SHALL be uploaded to Drive and attached to a single note via `fileIds`; on Misskey chat (whose API accepts one file per message), the system SHALL send one message per file, placing the caption text on the first message only. All Drive uploads SHALL complete before any message is created, and on ANY failure path that leaves uploads unreferenced by a delivered message (an upload failure mid-batch, a note-creation failure, or a chat mid-batch send failure) the adapter SHALL stop and best-effort delete the unreferenced Drive files. Delivery on Misskey chat SHALL NOT be atomic: if a message send fails mid-batch, the adapter SHALL stop, best-effort delete the not-yet-referenced Drive uploads, and return a partial-failure result carrying the delivered `messageIds` and the error. On any delivery, the handler SHALL return `data` containing `messageIds` (all delivered message IDs, in send order), `messageId` (the last delivered message ID), `filesCount` (the number of delivered files — used for audit and metrics), plus the `nextAction` exit hint used by `send-reply`. The `airfriends_files_sent_total` metric SHALL be incremented once per delivered file (not once per call).

#### Scenario: Multiple files on Discord in one message
- **GIVEN** a `send-file` invocation with `filePaths: ["a.png", "b.png"]` on a Discord channel
- **WHEN** the handler executes
- **THEN** the Discord adapter SHALL send one message containing both attachments
- **AND** the result SHALL contain the single message ID and `filesCount: 2`

#### Scenario: Multiple files on Misskey note in one note
- **GIVEN** a `send-file` invocation with `filePaths: ["a.png", "b.png"]` on a Misskey note channel
- **WHEN** the handler executes
- **THEN** both files SHALL be uploaded to Drive
- **AND** a single note SHALL be created with both file IDs attached

#### Scenario: Multiple files on Misskey chat send one message per file
- **GIVEN** a `send-file` invocation with `filePaths: ["a.png", "b.png"]` and a caption on a Misskey chat channel
- **WHEN** the handler executes
- **THEN** two chat messages SHALL be sent, one per file
- **AND** the caption SHALL be attached to the first message only

#### Scenario: Misskey chat mid-batch failure reports partial delivery
- **GIVEN** a `send-file` invocation with 3 files on a Misskey chat channel where the 2nd message send fails
- **WHEN** the handler executes
- **THEN** the first file SHALL be delivered and the invocation SHALL fail with the error
- **AND** the result SHALL include the delivered message ID(s) and the send SHALL count as a session response

#### Scenario: Multi-file script invocation
- **GIVEN** an agent writes two files `a.png` and `b.png` in the workspace
- **WHEN** the agent invokes `send-file.ts --session-id "$SESSION_ID" --file-paths a.png --file-paths b.png`
- **THEN** the script SHALL call the Skill API with `filePaths: ["a.png", "b.png"]`

#### Scenario: Singular flag rejected
- **GIVEN** an agent invokes `send-file.ts --file-path a.png`
- **WHEN** the script parses its arguments
- **THEN** the script SHALL exit non-zero with code `SKILL_SINGLE_FILE_FLAG` and an instructive message showing the repeatable `--file-paths` form
- **AND** the script SHALL NOT call the Skill API

### Requirement: Send-File Response Tracking

The system SHALL track successful `send-file` calls as session responses, mirroring reply and reaction tracking. The file-sent state SHALL be session-scoped: `SessionRegistry` SHALL maintain a per-session `fileSent` flag (initialized `false` at registration, alongside the existing `replySent` flag) with `markFileSent(sessionId)` and `hasFileSent(sessionId)` operations. The Skill API server SHALL call `markFileSent()` when at least one file was delivered to the platform (including partial Misskey chat delivery); it SHALL NOT be marked on total failure. When at least one file was delivered, the Skill API server SHALL ALSO record the last delivered message ID as the session's `lastFileMessageId` via `setLastFileMessageId()`, resolving it from the result data as `messageId`, else the last entry of `messageIds`; if the result carries no usable message ID at all, the server SHALL log a warning and record nothing (the reply anchor stays on the trigger — it SHALL NOT record a bogus ID). On total failure it SHALL NOT record any ID. `lastFileMessageId` SHALL NEVER be written by `send-reply`, `edit-reply`, or any other skill, and `lastSentMessageId` SHALL NEVER be written by `send-file` — the ID roles stay strictly separate. The session orchestrator SHALL read `hasFileSent(sessionId)` (a missing/expired session SHALL be treated as `fileSent: false`) and SHALL consider the agent to have responded when `replySent || reactionSent || fileSent` is true. Because the state lives on the session record, it is inherently cleared when a session ends and can never leak across concurrent sessions on the same channel. The `SessionResponse` SHALL include a `fileSent` boolean, set to `false` explicitly in every flow that does not track file sends. Error-message dispatch SHALL be skipped when `fileSent` is true.

#### Scenario: File send counts as a response
- **GIVEN** a session where the agent called `send-file` successfully but neither `send-reply` nor `react-message`
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the session SHALL be treated as successful without retrying

#### Scenario: File send records the delivered message ID
- **GIVEN** a session where `send-file` delivered a single message `file-1`
- **WHEN** the Skill API server processes the successful result
- **THEN** `lastFileMessageId` SHALL be set to `file-1`
- **AND** `lastSentMessageId` SHALL remain unset

#### Scenario: Partial file delivery counts as a response and records the last delivered ID
- **GIVEN** a Misskey chat session where 2 of 3 files were delivered (message IDs `file-1`, `file-2`) before a mid-batch failure
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** `lastFileMessageId` SHALL be `file-2` (the last delivered message)
- **AND** the missing-response retry SHALL NOT trigger

#### Scenario: Total failure records no file ID
- **GIVEN** a session where a `send-file` call fails with no delivered messages
- **WHEN** the Skill API server processes the failed result
- **THEN** `fileSent` SHALL NOT be marked
- **AND** `lastFileMessageId` SHALL NOT be set

#### Scenario: Delivery without a usable message ID records no anchor
- **GIVEN** a `send-file` result that reports delivered files but carries neither `messageId` nor a usable `messageIds` entry
- **WHEN** the Skill API server processes the result
- **THEN** `fileSent` SHALL be marked (files were delivered)
- **AND** `lastFileMessageId` SHALL NOT be set
- **AND** a warning SHALL be logged

#### Scenario: Partial file delivery counts as a response
- **GIVEN** a Misskey chat session where 1 of 2 files was delivered before a mid-batch failure
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the missing-response retry SHALL NOT trigger

#### Scenario: File-send state is per-session
- **GIVEN** two consecutive sessions for the same workspace:channel, the first delivering a file
- **WHEN** the second session's agent completes without any response
- **THEN** the second session SHALL NOT inherit the first session's `fileSent` state
- **AND** the missing-response retry SHALL trigger for the second session

#### Scenario: File-send disabled yields false
- **GIVEN** the `send-file` skill is disabled in configuration
- **WHEN** the orchestrator evaluates the session response
- **THEN** `fileSent` SHALL be `false` (the Skill API server never marks it because the skill is not registered)

#### Scenario: Error dispatch skipped after file send
- **GIVEN** a session that ends with `success: false` but `fileSent: true`
- **WHEN** the reply dispatcher evaluates the response
- **THEN** no error message SHALL be dispatched to the platform

