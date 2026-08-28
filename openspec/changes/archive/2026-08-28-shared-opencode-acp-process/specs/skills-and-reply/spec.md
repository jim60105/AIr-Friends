## MODIFIED Requirements

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

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts located in `skills/{skill-name}/scripts/` directories. Each skill SHALL have a `SKILL.md` file describing its usage for the agent. External ACP Agents SHALL execute these scripts with a `--session-id` parameter. Scripts SHALL use the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP. Skill scripts SHALL NOT accept free-text content (reply text, memory content, search queries, captions, reminder text) as CLI argument values in any form: any free-text argument SHALL be passed via a payload-file flag (e.g. `--message-file`, `--content-file`, `--query-file`, `--caption-file`) whose content is read from a file staged in the session-scoped TMPDIR, so that no user-facing content ever appears on a shell command line. The legacy free-text flags (`--message`, `--content`, `--query`, `--caption`) SHALL be rejected with a clear error in both invocation forms (`--flag value` and `--flag=value`); a script invoked with a legacy flag SHALL exit non-zero and SHALL NOT call the Skill API. The skill client library SHALL resolve the owning session id from the `SESSION_ID` environment variable in per-spawn mode, or from the orchestrator-maintained current-session pointer file in shared-process mode (that pointer is written ONLY while the session holds the global execution lease, via an atomic temp-file+rename write, and cleared on release), and SHALL present the owning session's JWT — in neither mode SHALL the agent need to read files or pass extra parameters. The skill script SHALL snapshot the owning session id and the JWT file content ONCE at script start, so a backgrounded or late-running skill subprocess cannot observe a later session's pointer or JWT file. Scripts SHALL be executed directly (shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`); the `--allow-read` permission is required for reading the staged payload file and the per-session JWT file, and `--allow-write` enables the script's best-effort deletion of the consumed payload file.

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

#### Scenario: Skill receives session ID from environment variable
- **GIVEN** a skill script is executed by the agent (per-spawn mode)
- **WHEN** the agent builds the bash command
- **THEN** the agent SHALL use `--session-id "$SESSION_ID"` where `$SESSION_ID` is resolved from the environment variable set in the agent subprocess
- **AND** the agent SHALL NOT need to know the actual session ID value
- **AND** in shared-process mode the skill client library resolves the owning session id from the orchestrator-maintained pointer file, so the agent still needs no extra parameters

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
