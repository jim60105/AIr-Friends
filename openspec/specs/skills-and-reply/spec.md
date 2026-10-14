# Skills and Reply

## Purpose

Defines the shell-based skill execution architecture, Skill API HTTP server, session authentication, available skills, reply rules, retry mechanism, edit-reply behavior, and content processing (XML stripping, newline unescaping).

## Requirements

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts in `skills/{skill-name}/scripts/`, each with a `SKILL.md` describing its usage, and SHALL be executed with a `--session-id` parameter while using the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP.

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
- **THEN** it SHALL use the shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`
- **AND** `--allow-read` SHALL be required for reading the staged payload file and the per-session JWT file, and `--allow-write` SHALL enable the script's best-effort deletion of the consumed payload file

#### Scenario: SKILL.md describes the session-id source truthfully
- **GIVEN** a skill's `SKILL.md`
- **WHEN** it documents the session-id source
- **THEN** it SHALL state that the session id rendered in the system prompt is authoritative, and that `$SESSION_ID` is present only in per-spawn deployments

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

The system SHALL authenticate all Skill API requests with a per-session signed JWT: a valid session ID alone SHALL NOT be sufficient, and a raw per-session caller token presented on its own SHALL be rejected.

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

#### Scenario: Caller token minted at registration becomes the JWT jti
- **GIVEN** a session is registered
- **WHEN** the system authenticates it
- **THEN** the system SHALL mint a high-entropy per-session caller token (256-bit CSPRNG, distinct from the session ID) that becomes the JWT `jti` claim

#### Scenario: JWT issued on lease acquisition with a fresh exp
- **GIVEN** a session JWT with header `{"alg":"HS256"}`, payload `{ sub, channel, jti, iat, exp }`, and an HMAC-SHA256 signature with the deployment-level secret
- **WHEN** the session acquires the global execution lease (NOT at registration)
- **THEN** the JWT SHALL be issued — or re-issued with a fresh `exp`
- **AND** a session queued behind a long in-flight session SHALL NOT present an expired JWT

#### Scenario: Bearer JWT verified on every request
- **GIVEN** a Skill API request
- **WHEN** it presents the session's JWT via an `Authorization: Bearer <jwt>` header
- **THEN** the server SHALL verify (1) the signature (constant-time comparison), (2) `sub == sessionId`, (3) `channel == session channelId`, and (4) `jti == session caller token` and `exp` validity
- **AND** any failure SHALL be rejected with HTTP 403 (401 for expired or unknown session)

#### Scenario: Idle sessions expire
- **GIVEN** a configurable idle `timeoutMs`
- **WHEN** a session is idle beyond `timeoutMs`
- **THEN** the session registry SHALL treat it as absent on `get()`, run periodic cleanup, and refresh the session's `lastActivityAt` via `touch()` on each authenticated call

#### Scenario: JWT does not defend against subprocess file readers
- **GIVEN** the JWT is provisioned into the owning subprocess via the per-session JWT file and the current-session pointer
- **WHEN** an attacker can read that subprocess's files directly
- **THEN** the JWT does not by itself defend against that vector (addressed by agent filesystem confinement and the permission gate)
- **AND** its purpose SHALL be to ensure that knowledge of a session ID obtained through any other channel does not grant the ability to act as that session

### Requirement: Available Skills

The system SHALL register core skills via `SkillRegistry`: `memory-save`, `memory-search`, `memory-patch`, `memory-stats`, `memory-export` (MemoryHandler), `send-reply`, `edit-reply`, `get-message` (ReplyHandler), `fetch-context` (ContextHandler), and `react-message` (ReactionHandler).

#### Scenario: Conditional skill not registered
- **GIVEN** reminders are not enabled in configuration
- **WHEN** the skill registry initializes
- **THEN** `set-reminder`, `cancel-reminder`, and `list-reminders` SHALL NOT be registered

#### Scenario: Core skills register with their handlers
- **WHEN** the skill registry initializes
- **THEN** the memory skills (`memory-save`, `memory-search`, `memory-patch`, `memory-stats`, `memory-export`) SHALL be handled by `MemoryHandler`
- **AND** `send-reply`, `edit-reply`, and `get-message` SHALL be handled by `ReplyHandler`
- **AND** `fetch-context` SHALL be handled by `ContextHandler` and `react-message` by `ReactionHandler`

#### Scenario: Core skills carry their documented purpose
- **WHEN** a skill is registered
- **THEN** `memory-save` (Save a new memory), `memory-search` (Search existing memories), `memory-patch` (Update memory attributes), `memory-stats` (Get memory statistics), and `memory-export` (Export memories as file) SHALL be available
- **AND** `send-reply` (Send a reply message), `edit-reply` (Edit a previously sent reply), `get-message` (Get a message by ID), `fetch-context` (Fetch additional platform data), and `react-message` (Add emoji reaction to a message) SHALL be available

#### Scenario: Reminder skills register only when reminders are enabled
- **GIVEN** `remindersConfig?.enabled && reminderStore` is satisfied
- **WHEN** the skill registry initializes
- **THEN** `set-reminder`, `cancel-reminder`, and `list-reminders` SHALL be registered
- **AND** otherwise they SHALL NOT be registered

#### Scenario: send-file registers only when enabled
- **GIVEN** `sendFileConfig?.enabled`
- **WHEN** the skill registry initializes
- **THEN** `send-file` SHALL be registered
- **AND** it SHALL NOT be registered when send-file is disabled in configuration

### Requirement: Reply Rules

The system SHALL enforce per-session reply limits: `send-reply` SHALL be limited to one successful call per session (`MAX_REPLIES_PER_SESSION = 1`), and attempts at or beyond `MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4` SHALL terminate the agent (the send-reply doom-loop).

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

#### Scenario: edit-reply requires a prior reply and has its own doom-loop
- **GIVEN** a session
- **WHEN** `edit-reply` is called
- **THEN** it SHALL require a prior successful `send-reply` (`replySent = true`)
- **AND** if `edit-reply` is called 3 or more times (`MAX_EDIT_CALLS_BEFORE_TERMINATE = 3`), the system SHALL terminate the agent (per-spawn: process termination; shared-process: `session/cancel`)

#### Scenario: send-file has its own one-call quota
- **GIVEN** a session
- **WHEN** `send-file` is called
- **THEN** it SHALL be limited to 1 successful call per session (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call)
- **AND** additional calls SHALL be rejected with HTTP 429, and if `send-file` is attempted 4 or more times (`MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4`) the system SHALL terminate the agent via `onTerminateRequest` (doom-loop protection)

#### Scenario: send-file is a distinct communication channel
- **GIVEN** a successful `send-file` call
- **WHEN** the session response is evaluated
- **THEN** `send-file` SHALL NOT be tracked by the reply count/doom-loop counters, SHALL NOT set `replySent`, SHALL NOT update the session's `lastSentMessageId`, and SHALL NOT trigger conversation summary generation
- **AND** it SHALL be tracked via the session file-send state, counted as successful when at least one file was delivered

#### Scenario: send-file rejected in triggerless sessions
- **GIVEN** a triggerless session (spontaneous, self-research, memory-maintenance, reminders)
- **WHEN** `send-file` is called
- **THEN** the session SHALL be rejected with HTTP 403, because such sessions only track replies and an untracked file send would cause duplicate output or repeat delivery

#### Scenario: send-file results bypass the deduplication cache
- **GIVEN** a `send-file` skill invocation
- **WHEN** it completes
- **THEN** the result SHALL NOT be served from the request deduplication cache
- **AND** the quota/doom-loop gate SHALL run on every attempt, including identical repeated calls

#### Scenario: Minimum response requirement triggers retry
- **GIVEN** a session that completed with no reply, reaction, or file send
- **WHEN** the agent completes
- **THEN** at least one reply (`send-reply`), reaction (`react-message`), or file send (`send-file`) SHALL have been produced per session
- **AND** if none of the three occurs, the retry mechanism SHALL trigger

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

#### Scenario: Retry prompt lists payload-file failure causes
- **GIVEN** an agent ends its turn without a reply, reaction, or file send
- **WHEN** the retry prompt is sent
- **THEN** it SHALL state that the turn ended without a reply, reaction, or file send
- **AND** it SHALL list the likely causes of a failed `send-reply`/`send-file` under the payload-file contract: legacy `--message`/`--caption` used and rejected, payload file never written, payload staged outside the session's absolute staging directory named in the prompt, or a previous skill call that errored (with an instruction to read that error's output)

#### Scenario: Retry prompt gives the correct two-step example
- **GIVEN** an agent whose reply or file send failed under the payload-file contract
- **WHEN** the retry prompt is sent
- **THEN** it SHALL give the correct two-step example: write the payload under the literal absolute staging directory rendered in the prompt, then invoke the script with the payload-file flag pointing at that absolute path

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

#### Scenario: Guidance states what was wrong, why it matters, and the correct pattern
- **GIVEN** a skill script contract failure
- **WHEN** the guidance message is produced
- **THEN** it SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill
- **AND** the `error` field SHALL be self-contained prose containing the fix and a full example command

#### Scenario: SKILL_SESSION_UNRESOLVED error for an unresolvable shared-mode pointer
- **GIVEN** shared-process mode with a missing, unreadable, or malformed current-session pointer
- **WHEN** the owning session cannot be resolved
- **THEN** the error SHALL have code `SKILL_SESSION_UNRESOLVED`
- **AND** the guidance SHALL name the expected pointer path and the "invoke skills during a live turn" remedy

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
- **THEN** it SHALL resolve the file's real path (`Deno.realPath`) and SHALL re-check the real path for containment
- **AND** a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected

#### Scenario: On success the payload is deleted
- **GIVEN** a successful payload-file invocation
- **WHEN** the script has passed the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged)
- **THEN** the script SHALL best-effort delete the payload file afterwards

### Requirement: Reply Threading Anchor and Message ID Roles

The system SHALL distinguish four per-session message-ID roles — `lastSentMessageId`, `lastFileMessageId`, `lastReplyAnchorMessageId`, and `triggerMessageId` — so no tool can confuse the ID of a message the bot sent with the ID of the message being replied to.

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

#### Scenario: lastSentMessageId records only the last text reply
- **WHEN** a message is sent via `send-reply` or `edit-reply`
- **THEN** the last sent message ID SHALL be recorded in `lastSentMessageId`, updated ONLY by those two skills, including after Misskey's delete-and-recreate new ID
- **AND** a message delivered by `send-file` SHALL NEVER be recorded here
- **AND** `lastSentMessageId` SHALL be consumed by `edit-reply` scoping and the `get-message` fallback

#### Scenario: lastFileMessageId records only delivered file messages
- **WHEN** a file is delivered by `send-file`
- **THEN** its ID SHALL be recorded in `lastFileMessageId`, updated ONLY by `send-file` and ONLY when at least one file was delivered (on Misskey chat partial delivery, the last *delivered* message ID)
- **AND** it SHALL be consumed as the reply threading anchor and by the `get-message` fallback

#### Scenario: lastReplyAnchorMessageId records the reply's own anchor
- **WHEN** a text reply is created
- **THEN** `lastReplyAnchorMessageId` SHALL record the reply anchor in effect when `send-reply` succeeded, recorded ONLY on a successful `send-reply`
- **AND** it SHALL NOT be changed by `edit-reply`, so Misskey `edit-reply` re-creation threads to this recorded anchor and never rewrites the original thread parent

#### Scenario: triggerMessageId targets the triggering message
- **GIVEN** a session triggered by a message
- **WHEN** its message-ID roles are used
- **THEN** `triggerMessageId` SHALL hold the ID of the triggering message (empty for triggerless sessions)
- **AND** it SHALL be the fallback reply anchor and the target of `react-message`

#### Scenario: Reply anchor resolution and threading
- **WHEN** a message needs a reply anchor
- **THEN** the session's reply anchor SHALL resolve to `lastFileMessageId ?? triggerMessageId`
- **AND** `send-reply` SHALL thread to the reply anchor, Misskey `edit-reply` re-creation SHALL thread to `lastReplyAnchorMessageId` (falling back to the reply anchor when unset), `send-file` SHALL thread to the trigger message, and `react-message` SHALL target `triggerMessageId`, never the bot's own file message

#### Scenario: get-message resolves its target with fallbacks
- **WHEN** `get-message` is called
- **THEN** it SHALL resolve its target as `params.messageId`, falling back to `lastSentMessageId`, then `lastFileMessageId`
- **AND** it SHALL return an error when none of those exists

### Requirement: Edit-Reply Platform Behavior

`edit-reply` SHALL operate only on the current session's own most-recently-sent **text reply**: the handler SHALL reject any request whose `params.messageId` does not equal `context.lastSentMessageId`, and file-message IDs SHALL NEVER be editable.

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

#### Scenario: Misskey note edit recreates the note on its original anchor
- **GIVEN** a Misskey note reply (`note:` channel prefix) with a recorded `context.lastReplyAnchorMessageId`
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL delete the old note via `notes/delete` and create a new note via `notes/create` with `replyId` equal to `context.lastReplyAnchorMessageId` (falling back to the reply anchor)
- **AND** the returned `messageId` SHALL differ from the original, and visibility and `visibleUserIds` SHALL be preserved

#### Scenario: Misskey chat edit uses delete-and-recreate
- **GIVEN** a Misskey chat reply (`chat:` channel prefix)
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL use a delete-and-recreate strategy via `chat/messages/delete` followed by `chat/messages/create-to-user`

#### Scenario: Failed delete aborts the edit
- **GIVEN** an `edit-reply` operation whose delete step fails
- **WHEN** the delete is attempted
- **THEN** the system SHALL abort without creating a new message and SHALL return an error

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

The `react-message` skill SHALL add an emoji reaction to the message that triggered the session (`context.triggerMessageId`), and SHALL NEVER target a message the bot itself sent.

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

#### Scenario: Downgraded reaction reported truthfully
- **GIVEN** a Misskey note reaction whose adapter result is `success: true` with `storedReaction` different from the requested emoji
- **WHEN** the `react-message` handler builds its skill result
- **THEN** the result data SHALL report the stored reaction (not the requested emoji) and indicate the requested emoji was not applied as such
- **AND** the reaction SHALL be marked sent via `reactionSentMap`, so the session counts as responded and no missing-reply retry is triggered

#### Scenario: Reaction requires a valid emoji and trigger message
- **GIVEN** a `react-message` invocation
- **WHEN** the handler validates it
- **THEN** it SHALL require a non-empty `emoji` parameter and a valid `context.triggerMessageId` (the trigger message)
- **AND** it SHALL NOT act when the emoji is empty or the trigger message is absent

#### Scenario: Duplicate reactions prevented per channel
- **GIVEN** a workspace:channel combination
- **WHEN** `react-message` is called
- **THEN** the system SHALL track reactions per workspace:channel combination via `reactionSentMap` to prevent duplicate reactions

#### Scenario: Reaction after a file send stays on the trigger
- **GIVEN** a session that has since sent its own messages (e.g. a file message)
- **WHEN** `react-message` is called
- **THEN** the reaction SHALL be added to `context.triggerMessageId`
- **AND** it SHALL NEVER target a message the bot itself sent

### Requirement: Send-File Workspace Boundary

The `send-file` skill SHALL validate every requested `filePaths` path before sending any file: each path SHALL be within the user's or agent's workspace, path traversal (`..`) SHALL be blocked, and any invalid, unsafe, or unreadable path SHALL reject the whole invocation.

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

#### Scenario: Per-file size and extension limits enforced
- **GIVEN** a `send-file` request
- **WHEN** `validateFilePath()` is called
- **THEN** files exceeding `config.maxFileSizeMb` (default: 25 MB) SHALL be rejected, and only files with extensions in `config.allowedExtensions` SHALL be permitted
- **AND** file read failures SHALL return an error without crashing

#### Scenario: Real-path containment blocks symlink escapes
- **GIVEN** a symlink inside the workspace that resolves outside the workspace or agent-workspace boundary
- **WHEN** a `send-file` request for that path is validated
- **THEN** containment SHALL be checked against the file's REAL path (`Deno.realPath`, symlink-aware) and the path SHALL be rejected
- **AND** `Deno.stat`/`Deno.readFile` follow symlinks, so without this check they would exfiltrate arbitrary host files

#### Scenario: Batch limits checked before any byte is read
- **GIVEN** a multi-file `send-file` invocation
- **WHEN** the batch is processed
- **THEN** the number of files SHALL NOT exceed `config.maxFilesPerInvocation` (default: 10) and the total byte size SHALL NOT exceed `config.maxTotalSizeMb` (default: 50), checked before any file bytes are read
- **AND** validation, batch-limit checks, and file reading SHALL be all-or-nothing (preflight): if any path fails validation, any limit is exceeded, or any read fails, the system SHALL reject the entire invocation and SHALL NOT send any file

### Requirement: Send-File Multi-File Sending

The `send-file` skill SHALL support sending multiple files in one invocation: the script SHALL accept a repeatable `--file-paths` flag (alias `-f`), with at least one occurrence required, and SHALL pass the paths to the Skill API as the `filePaths` array parameter.

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

#### Scenario: Removed singular flag rejected in either form
- **GIVEN** a `send-file` script invoked with the removed singular `--file-path` flag
- **WHEN** the flag is given in either form (`--file-path value` or `--file-path=value`)
- **THEN** it SHALL be rejected with code `SKILL_SINGLE_FILE_FLAG` and the script SHALL NOT call the Skill API

#### Scenario: Optional caption applies to the whole batch
- **GIVEN** a multi-file `send-file` invocation
- **WHEN** a caption is provided
- **THEN** the optional caption SHALL follow the payload-file flow (`--caption-file`) and SHALL apply to the whole file batch

#### Scenario: Drive uploads complete before any message is created
- **GIVEN** a Misskey multi-file delivery
- **WHEN** the handler executes
- **THEN** all Drive uploads SHALL complete before any message is created
- **AND** on ANY failure path that leaves uploads unreferenced by a delivered message (an upload failure mid-batch, a note-creation failure, or a chat mid-batch send failure), the adapter SHALL stop and best-effort delete the unreferenced Drive files

#### Scenario: Misskey chat delivery is not atomic
- **GIVEN** a Misskey chat multi-file delivery
- **WHEN** a message send fails mid-batch
- **THEN** the adapter SHALL stop, best-effort delete the not-yet-referenced Drive uploads, and return a partial-failure result carrying the delivered `messageIds` and the error

#### Scenario: Result data reports delivered message IDs
- **GIVEN** any `send-file` delivery
- **WHEN** the handler returns
- **THEN** the handler SHALL return `data` containing `messageIds` (all delivered message IDs, in send order), `messageId` (the last delivered message ID), `filesCount` (the number of delivered files — used for audit and metrics), plus the `nextAction` exit hint used by `send-reply`

#### Scenario: Files-sent metric counts per delivered file
- **GIVEN** a `send-file` delivery
- **WHEN** files are delivered
- **THEN** the `airfriends_files_sent_total` metric SHALL be incremented once per delivered file
- **AND** it SHALL NOT be incremented once per call

### Requirement: Send-File Response Tracking

The system SHALL track successful `send-file` calls as session responses: `SessionRegistry` SHALL maintain a per-session `fileSent` flag (initialized `false`) with `markFileSent(sessionId)` and `hasFileSent(sessionId)`, and the orchestrator SHALL treat the agent as responded when `replySent || reactionSent || fileSent` is true.

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

#### Scenario: fileSent marked only when at least one file is delivered
- **GIVEN** a `send-file` skill result
- **WHEN** the Skill API server processes it
- **THEN** the server SHALL call `markFileSent()` when at least one file was delivered to the platform (including partial Misskey chat delivery)
- **AND** it SHALL NOT be marked on total failure

#### Scenario: lastFileMessageId recorded on delivery
- **GIVEN** a `send-file` result with at least one delivered file
- **WHEN** the Skill API server processes it
- **THEN** it SHALL record the last delivered message ID as the session's `lastFileMessageId` via `setLastFileMessageId()`, resolving it from the result data as `messageId`, else the last entry of `messageIds`
- **AND** if the result carries no usable message ID at all, the server SHALL log a warning and record nothing (the reply anchor stays on the trigger — it SHALL NOT record a bogus ID)
- **AND** on total failure it SHALL NOT record any ID

#### Scenario: File ID roles stay strictly separate
- **GIVEN** a session's message-ID state
- **WHEN** a skill writes an ID
- **THEN** `lastFileMessageId` SHALL NEVER be written by `send-reply`, `edit-reply`, or any other skill, and `lastSentMessageId` SHALL NEVER be written by `send-file`

#### Scenario: Orchestrator treats missing session as fileSent false
- **GIVEN** the session orchestrator reads `hasFileSent(sessionId)`
- **WHEN** the session is missing or expired
- **THEN** it SHALL be treated as `fileSent: false`
- **AND** the orchestrator SHALL consider the agent responded only when `replySent || reactionSent || fileSent` is true

#### Scenario: File-send state is scoped to the session record
- **WHEN** the session orchestrator evaluates success
- **THEN** the file-sent state SHALL live on the session record, so it is inherently cleared when the session ends and can never leak across concurrent sessions on the same channel
- **AND** the `SessionResponse` SHALL include a `fileSent` boolean, set to `false` explicitly in every flow that does not track file sends
- **AND** error-message dispatch SHALL be skipped when `fileSent` is true

### Requirement: Instructive workspace-path errors for send-file

When a `send-file` `--file-paths` value is relative, resolves inside the workspace boundary but the file does not exist, and contains a segment-boundary occurrence of the workspace's own `{platform}/{userId}` key, the handler SHALL return a structured failure with code `SKILL_FILE_PATH_WORKSPACE_PREFIXED` naming the workspace root and explaining the double-join.

#### Scenario: Double-joined workspace path gets a corrected example
- **GIVEN** workspace root `/app/data/workspaces/discord/123` and agent cwd equal to that root, and `out.png` existing at the workspace root
- **WHEN** `send-file` is invoked with `--file-paths "data/workspaces/discord/123/out.png"` (stat fails on the double-joined location)
- **THEN** the result SHALL have `success: false` and code `SKILL_FILE_PATH_WORKSPACE_PREFIXED`
- **AND** the error SHALL name the workspace root, explain the double-join, and show `--file-paths "out.png"` as the corrected form

#### Scenario: Double-join signature with no existing candidate does not guess
- **WHEN** `--file-paths` carries the workspace-key prefix but the de-prefixed candidate also does not exist
- **THEN** the result SHALL carry `SKILL_FILE_PATH_WORKSPACE_PREFIXED` with the double-join explanation
- **AND** the error SHALL NOT claim a specific intended filename

#### Scenario: Legitimate in-workspace paths unaffected
- **WHEN** `send-file` is invoked with an existing relative path (`exports/report.pdf`, including one that legitimately contains `discord/123/` directories) or an absolute path inside the workspace
- **THEN** delivery SHALL proceed exactly as before with no guidance error (the heuristic is reached only on stat failure)

#### Scenario: Ordinary missing file keeps the plain error
- **WHEN** `--file-paths "nope.png"` refers to a nonexistent file with no workspace-key segment match
- **THEN** the existing plain stat-failure error SHALL be returned without the prefixed code

#### Scenario: Guidance names the intended file only when it exists
- **GIVEN** a double-joined `--file-paths` value whose de-prefixed candidate path exists
- **WHEN** the handler builds the guidance error
- **THEN** it SHALL name the de-prefixed candidate path as the likely intended file
- **AND** otherwise it SHALL NOT guess and SHALL instead instruct re-checking paths relative to the workspace root

#### Scenario: Handler never silently rewrites or sends candidate files
- **GIVEN** a double-joined `--file-paths` value
- **WHEN** the handler processes it
- **THEN** it SHALL NOT silently rewrite paths or send any candidate file
- **AND** absolute paths that resolve inside the workspace boundary SHALL continue to be accepted, and every other error path SHALL keep its existing generic message

### Requirement: Fetch-Context Limit Bounds

The `fetch-context` skill SHALL validate its `limit` parameter against the Misskey API specification bounds: when provided, `limit` MUST be an integer in the inclusive range `1..100`. An out-of-range or non-integer `limit` SHALL be rejected with an instructive failure message before any platform adapter call, and SHALL NOT be forwarded to the platform. When omitted, the default `limit` SHALL remain `20`.

#### Scenario: Limit above the upper bound rejected

- **GIVEN** a `fetch-context` request with `limit = 101`
- **WHEN** the context handler validates the parameters
- **THEN** the request SHALL fail with an error stating `limit` must be between 1 and 100
- **AND** no platform adapter call SHALL be made

#### Scenario: Fractional limit rejected

- **GIVEN** a `fetch-context` request with `limit = 10.5`
- **WHEN** the context handler validates the parameters
- **THEN** the request SHALL fail with an error stating `limit` must be an integer between 1 and 100

#### Scenario: In-range limit accepted

- **GIVEN** a `fetch-context` request with `limit = 100`
- **WHEN** the context handler validates the parameters
- **THEN** validation SHALL succeed and the adapter SHALL be called with `limit = 100`

#### Scenario: Omitted limit uses default

- **GIVEN** a `fetch-context` request with no `limit` parameter
- **WHEN** the context handler validates the parameters
- **THEN** validation SHALL succeed and the adapter SHALL be called with `limit = 20`

### Requirement: Fetch-Context Preserves Third-Party Quote References

Message results for `fetch-context` types `recent_messages` and `search_messages` SHALL retain the same optional typed `quotedNote` reference supplied by the platform history/search contract, with the existing result envelope, parameters, outer message content, and identity unchanged.

#### Scenario: Recent quote survives skill serialization
- **GIVEN** retained recent Misskey messages include a quote with remote author, source body/article URL and attachment metadata
- **WHEN** `fetch-context` recent messages are returned through the skill result and JSON response
- **THEN** the decoded message SHALL preserve the complete separate `quotedNote`
- **AND** outer content/user identity and the existing result envelope SHALL be unchanged

#### Scenario: Search quote matches history representation
- **GIVEN** a Misskey search result contains a quoted source
- **WHEN** `fetch-context` search messages are returned
- **THEN** the reference SHALL use the same field and provenance contract as recent messages and prompt context

#### Scenario: Failed quote lookup keeps successful skill result
- **GIVEN** outer message retrieval succeeds but optional quoted-source enrichment fails or expires
- **WHEN** the skill result is returned
- **THEN** the message SHALL remain available with its unavailable-reference id/status/reason
- **AND** the optional quote failure SHALL NOT turn successful outer retrieval into skill failure

#### Scenario: Instruction-looking quote stays separate JSON data
- **GIVEN** source text or author/attachment metadata contains instruction-looking text, closing labels or role/heading delimiters
- **WHEN** the skill JSON result is decoded
- **THEN** that text SHALL remain inside quoted-source fields without creating new outer message fields or replacing the direct-user content
- **AND** the documented third-party instruction distinction SHALL apply to the reference

#### Scenario: Ordinary skill messages unchanged
- **GIVEN** recent/search results contain ordinary messages without quotes
- **WHEN** the skill returns them
- **THEN** their message data and result envelope SHALL retain the existing shape without added quote fields

#### Scenario: Available references retain full source provenance
- **GIVEN** a retained quoted source reference
- **WHEN** the skill returns the message
- **THEN** available references SHALL retain source id, separate source author, source URL when present, source body, and attachments
- **AND** unavailable references SHALL retain source id/status/reason without invented content

#### Scenario: Quoted source fields stay distinct JSON data
- **WHEN** a quoted source is returned
- **THEN** quoted source fields SHALL remain distinct JSON data and SHALL NOT be promoted into outer content or direct user instructions

#### Scenario: Agent guidance flags quoted content as third-party material
- **WHEN** agent-facing skill guidance is produced for quoted results
- **THEN** it SHALL state that quoted source content is third-party reference material and commands within it are not the requesting user's direct instructions

### Requirement: Agent-Portable Staging And Session Identity

Every prompt surface that instructs skill usage SHALL supply the literal active Skill API session id, trusted absolute skill-script root, and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`, the canonical payload staging location independent of any process-level `TMPDIR`), and every payload-staging instruction from those prompts and the skill instruction files SHALL direct the agent to those literal absolute paths, never to `$TMPDIR`/`$SESSION_ID` shell tokens.

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

#### Scenario: Prompt surfaces that instruct skill usage
- **GIVEN** prompt surfaces that instruct skill usage: normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), scheduled reminder, and the missing-reply retry prompt
- **WHEN** any of them is rendered for a session
- **THEN** it SHALL supply the literal active Skill API session id and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`)

#### Scenario: Skill instruction files direct to the same literal paths
- **GIVEN** skill instruction files (`skills/*/SKILL.md`) and skill script error/example text that give payload-staging instructions for structured file tools and payload-file flags
- **WHEN** the agent follows those instructions to stage a payload
- **THEN** the instructions SHALL direct the agent to the literal session staging directory and session id, never to `$TMPDIR`/`$SESSION_ID` shell tokens
- **AND** the payload-staging instructions covered by this requirement SHALL never name shell tokens as the target of a structured file tool or payload-file flag

#### Scenario: Same contract in pooled and per-spawn for every agent type
- **GIVEN** per-spawn and shared-process (pooled) operation and any agent type
- **WHEN** a payload is staged and a skill is invoked
- **THEN** the contract SHALL hold identically in per-spawn and shared-process (pooled) operation and for every agent type
- **AND** a skill consumer SHALL NEVER depend on a frozen process-level `SESSION_ID` environment variable

#### Scenario: Only the identity/path form changes, not staging semantics
- **GIVEN** the session staging directory, its provisioning, and all containment/authorization semantics
- **WHEN** prompts and skill instructions change the identity/path FORM they use
- **THEN** the staging directory itself, its provisioning, and all containment/authorization semantics SHALL be unchanged
- **AND** this requirement SHALL change only the identity/path FORM of the instructions the agent receives

#### Scenario: Isolated HOME does not change the script root
- **GIVEN** an OMP child with an isolated HOME and a validated deployment-owned skills root
- **WHEN** any skill-instructing prompt or retry is rendered and its recipe is followed
- **THEN** the script SHALL execute at the rendered absolute root, not under child HOME
- **AND** its existing staged payload and active-session authentication SHALL remain unchanged

#### Scenario: Every secondary prompt supplies the root
- **WHEN** normal, spontaneous, lurk, research, summary, workspace/channel maintenance, reminder, and retry instructions are rendered
- **THEN** each SHALL name its trusted absolute script root consistently with its session-id/staging instructions
- **AND** static skill instructions SHALL direct the agent to that rendered root without a child-HOME fallback

### Requirement: Deployment-Resolved Skill Script Root Identity for Both Agent Types

Both agent types SHALL resolve ONE absolute deployment-resolved script root from the same configuration, shared by prompts/retries, script inventory and matching, readiness and skill mounts. Agent type, session cwd and HOME SHALL NOT independently select it. Root-resolution failure SHALL be explicit with no cross-agent fallback, and an instruction path SHALL NOT manufacture OMP owned or critical-skill provenance.

#### Scenario: Both agent types use the single configured installation

- **GIVEN** the deployment configures one skill root and an `opencode` session and an `omp` session both require skill scripts
- **WHEN** each session resolves its script root
- **THEN** every script-root consumer of both sessions SHALL use that one canonical absolute root
- **AND** no separately packaged skill tree SHALL contribute a grant to either session

#### Scenario: OpenCode container uses the actual shared install tree

- **GIVEN** an OpenCode container has built-ins and configured external skills installed under the configured root
- **WHEN** its prompt, inventory, permission decision and readiness check select skill scripts
- **THEN** each SHALL use that explicitly configured root
- **AND** the nonexistent `/app/skills` and any child-HOME spelling SHALL NOT be selected

#### Scenario: Repository development resolution agrees

- **GIVEN** the deployment working directory is the repository root and the default `skills` setting is in use
- **WHEN** either agent type resolves its development scripts
- **THEN** each script-root consumer SHALL identify the validated repository `skills/` tree by its absolute path
- **AND** no image skill root SHALL be substituted for either agent type

#### Scenario: Dashboard override and recovered pooled session retain root identity

- **GIVEN** a selected session agent type differs from the deployment default, or a pooled session reconnects
- **WHEN** prompts/retries and its connector are constructed or recovered
- **THEN** their root SHALL remain the single resolved root of that deployment
- **AND** reconnect SHALL NOT substitute a process/session cwd or a second installed tree

#### Scenario: Unresolvable root fails explicitly

- **GIVEN** the configured deployment root cannot be resolved or observed
- **WHEN** a skill-backed session of either agent type is prepared
- **THEN** preparation SHALL fail with a configuration error before an agent subprocess is launched
- **AND** no empty inventory, HOME scan or relative cwd fallback SHALL make preparation succeed

#### Scenario: Per-spawn and pooled connectors resolve the identical root

- **GIVEN** one deployment configuration used by a per-spawn connector and by a pooled connector
- **WHEN** both prepare sessions of either agent type
- **THEN** their resolved script root SHALL be byte-identical
- **AND** resolution SHALL NOT read the `SESSION_ID` environment variable or any other per-session value to select a root

### Requirement: Consumer Skill Handoff Regression Suite

The combined skill-handoff suite SHALL drive real orchestration, Skill API, session registry and reply/file/reaction handlers with the shared mock ACP fixture and mock platform. Both spawn shapes SHALL preserve authored native skill discovery, shared root/script inventory and current-session JWT/staging isolation.

#### Scenario: Both spawn shapes
- **WHEN** per-spawn and pooled OMP stage a payload and invoke a delivered absolute skill script path
- **THEN** the current session SHALL deliver its expected reply/file/reaction through the real handler chain with its own JWT and staging location.

#### Scenario: Isolation and retry
- **WHEN** a sibling JWT/staging path is presented or a session finishes without a response
- **THEN** the existing shared denial/retry rules SHALL remain and no sibling delivery or duplicate response SHALL occur.

#### Scenario: OpenCode consumer path
- **WHEN** OpenCode performs the same existing skill handoff
- **THEN** its current discovery, callback, script-entry and delivery outcomes SHALL remain unchanged.

#### Scenario: File and reaction responses retain summary behavior
- **WHEN** a turn delivers a file-only or reaction-only response
- **THEN** it SHALL satisfy the existing response gate without becoming a text-reply summary trigger, and retry SHALL remain suppressed.

#### Scenario: Literal instructions and one retry
- **WHEN** a turn has no recorded response in either spawn shape
- **THEN** the existing retry SHALL run once with the active literal session ID, script root and staging path; a second missing response SHALL follow the current failure path.

#### Scenario: Consumer coverage stays cross-component
- **WHEN** the combined suite asserts a delivery, rejection or retry
- **THEN** it SHALL exercise the real orchestration and Skill API/handler chain rather than duplicate a single-component wiring or schema assertion.

### Requirement: Skill Handoff Evidence And Deterministic Native Fixtures

Skill-handoff acceptance SHALL assert consumer-visible authorization, side effects and session transitions, label mocked ACP/model/platform evidence honestly, and preserve deterministic fixtures. Removed OMP governance assertions SHALL not be replaced by inverse requirements on upstream behavior.

#### Scenario: Behavior evidence
- **WHEN** handoff tests report successful delivery or a permission denial
- **THEN** results SHALL identify the exercised real components and mocks without claiming native/image/platform acceptance.

#### Scenario: Native evidence distinct
- **WHEN** a pinned official executable exercises native skill discovery/tool dispatch with a scripted loopback model
- **THEN** the report SHALL record its version and actual tool/result boundary separately from model reasoning and public network search success.
