## MODIFIED Requirements

### Requirement: Reply Rules

The system SHALL enforce the following reply limits per session:

- **`send-reply`**: Maximum 1 call per session (`MAX_REPLIES_PER_SESSION = 1`). Additional calls SHALL be rejected with HTTP 429 status and a message advising use of `edit-reply` instead.
- **Doom-loop detection**: If `send-reply` is attempted 4 or more times (`MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4`), the system SHALL terminate the agent via `onTerminateRequest` callback.
- **`edit-reply`**: Requires a prior successful `send-reply` (`replySent = true`). If `edit-reply` is called 3 or more times (`MAX_EDIT_CALLS_BEFORE_TERMINATE = 3`), the system SHALL terminate the agent.
- **`send-file` quota**: `send-file` SHALL be limited to 1 successful call per session (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call). Additional calls SHALL be rejected with HTTP 429. If `send-file` is attempted 4 or more times (`MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4`), the system SHALL terminate the agent via `onTerminateRequest` (doom-loop protection). `send-file` SHALL NOT be tracked by the reply count/doom-loop counters, SHALL NOT set `replySent`, SHALL NOT update the session's `lastSentMessageId`, and SHALL NOT trigger conversation summary generation. A file send is a distinct communication channel: it SHALL be tracked via the session file-send state, and a call is counted as successful when at least one file was delivered. `send-file` SHALL only be callable from user-triggered message/channelLurk sessions: triggerless sessions (spontaneous, self-research, memory-maintenance, reminders) SHALL be rejected with HTTP 403 because they only track replies and an untracked file send would cause duplicate output or repeat delivery. `send-file` skill results SHALL NOT be served from the request deduplication cache (the quota/doom-loop gate must run on every attempt, including identical repeated calls).
- **Minimum response requirement**: At least one reply (via `send-reply`), one reaction (via `react-message`), or one file send (via `send-file`) SHALL be produced per session. If none of the three occurs when the agent completes, the retry mechanism SHALL trigger.

#### Scenario: Second send-reply rejected
- **GIVEN** a session where `send-reply` has already been called once
- **WHEN** `send-reply` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: Doom-loop terminates agent
- **GIVEN** a session where `send-reply` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** the system SHALL invoke `onTerminateRequest` to terminate the agent process

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
- **THEN** the system SHALL invoke `onTerminateRequest` to terminate the agent process

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

Skill script contract failures SHALL produce structured, instructive errors that teach the correct usage, so the agent can self-correct mid-turn. The shared payload helper SHALL raise typed errors carrying a stable `code` and a guidance message; the scripts SHALL emit them as JSON on stderr (extending the existing `exitWithError` contract with a `code` field) and SHALL NOT call the Skill API. The guidance message SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill. The error codes SHALL be: `SKILL_LEGACY_FLAG` (legacy free-text flag used, in either `--flag value` or `--flag=value` form — guidance SHALL state the flag was removed for security, forbid message content on the command line, and show the two-step payload-file flow), `SKILL_MISSING_PAYLOAD` (required payload flag absent — guidance SHALL name the required flag and show the two-step flow), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (path resolves outside the session staging directory, including symlink escapes — guidance SHALL explain the payload must live under `$TMPDIR/$SESSION_ID/...` and why, and show the correct form), `SKILL_PAYLOAD_NOT_FOUND` (file absent or unreadable — guidance SHALL instruct writing the file first with the edit/write tool, then invoking the script), and `SKILL_SINGLE_FILE_FLAG` (the `send-file` script invoked with the removed singular `--file-path` flag in either form — guidance SHALL state that the flag was replaced by the repeatable `--file-paths` flag, explain that the skill supports multiple files per invocation, and show a copy-pasteable example with two or more `--file-paths` arguments). The `error` field SHALL be self-contained prose containing the fix and a full example command.

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

## ADDED Requirements

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

The system SHALL track successful `send-file` calls as session responses, mirroring reply and reaction tracking. The file-sent state SHALL be session-scoped: `SessionRegistry` SHALL maintain a per-session `fileSent` flag (initialized `false` at registration, alongside the existing `replySent` flag) with `markFileSent(sessionId)` and `hasFileSent(sessionId)` operations. The Skill API server SHALL call `markFileSent()` when at least one file was delivered to the platform (including partial Misskey chat delivery); it SHALL NOT be marked on total failure. The session orchestrator SHALL read `hasFileSent(sessionId)` (a missing/expired session SHALL be treated as `fileSent: false`) and SHALL consider the agent to have responded when `replySent || reactionSent || fileSent` is true. Because the state lives on the session record, it is inherently cleared when a session ends and can never leak across concurrent sessions on the same channel. The `SessionResponse` SHALL include a `fileSent` boolean, set to `false` explicitly in every flow that does not track file sends. Error-message dispatch SHALL be skipped when `fileSent` is true.

#### Scenario: File send counts as a response
- **GIVEN** a session where the agent called `send-file` successfully but neither `send-reply` nor `react-message`
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the session SHALL be treated as successful without retrying

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
