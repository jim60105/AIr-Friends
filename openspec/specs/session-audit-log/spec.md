# Session Audit Log

## Purpose

Per-session JSONL audit trail for replay and debugging. Each session writes timestamped entries tracking the full lifecycle from context assembly through session end.

## Requirements

### Requirement: Per-Session Audit Writer

The system SHALL create a `SessionAuditWriter` instance per session when audit is enabled. The writer SHALL be constructed with `auditBasePath`, `platform`, `userId`, `sessionId`, and `AuditConfig`. The audit file path SHALL be `{auditBasePath}/{platform}/{userId}/{sessionId}.jsonl`.

#### Scenario: Audit file creation
- **GIVEN** audit is enabled in configuration
- **WHEN** a new session starts for platform `discord`, user `123`, session `sess_abc`
- **THEN** audit entries SHALL be written to `data/audit/discord/123/sess_abc.jsonl`
- **AND** the parent directories SHALL be created recursively if they do not exist

#### Scenario: Audit disabled
- **GIVEN** `audit.enabled` is `false`
- **WHEN** a session starts
- **THEN** no `SessionAuditWriter` SHALL be created and no audit files SHALL be written

### Requirement: Audit Phases

The system SHALL support the following audit phases as defined in `AuditPhase`:

| Phase                  | Description                          |
| ---------------------- | ------------------------------------ |
| `trigger_received`     | Incoming trigger event recorded      |
| `session_start`        | Session registered and configured    |
| `rate_limit_checked`   | Rate limit evaluation result         |
| `context_assembly`     | Context assembly completed           |
| `yolo_resolution`      | YOLO mode resolution                 |
| `agent_connect`        | Agent subprocess connected           |
| `prompt_sent`          | Prompt sent to agent                 |
| `agent_message`        | Full prompt/context sent to agent    |
| `skill_call`           | Skill API invoked                    |
| `memory_operation`     | Memory skill operation               |
| `agent_response`       | Agent response received              |
| `agent_complete_message` | Agent complete buffered response   |
| `agent_complete_thought` | Agent complete buffered thought process |
| `reply_sent`           | Reply sent to platform               |
| `reply_edited`         | Reply edited on platform             |
| `file_sent`            | File(s) sent to platform via `send-file` |
| `retry_triggered`      | Missing-reply retry activated        |
| `session_end`          | Session lifecycle completed          |
| `permission_approved`  | Permission request approved          |
| `permission_denied`    | Permission request denied            |

Each entry SHALL contain an ISO 8601 `ts` timestamp, the `phase` string, and a `data` object with phase-specific payload fields.

#### Scenario: Skill call audit entry
- **GIVEN** audit is enabled and `skill_call` phase is included
- **WHEN** the Skill API Server handles a skill invocation
- **THEN** an audit entry SHALL be written with `phase: "skill_call"` containing `skillName`, `skillParams`, `skillResult`, and `skillDurationMs`

#### Scenario: Session end audit entry
- **GIVEN** audit is enabled and `session_end` phase is included
- **WHEN** a session completes
- **THEN** an audit entry SHALL be written with `success`, `replySent`, `reactionSent`, `fileSent`, `durationMs`, `repliesCount`, `skillCallsCount`, `memoryOpsCount`, `permissionDecisionsCount`, and optionally `error`
- **AND** `fileSent` SHALL be explicitly `false` in flows that do not track file sends (spontaneous, self-research, memory-maintenance, dry-run)

#### Scenario: Complete session audit trail
- **GIVEN** audit is enabled with all phases included
- **WHEN** a normal message session completes successfully with one reply and two memory saves
- **THEN** the session JSONL file SHALL contain entries in chronological order: `trigger_received`, `session_start`, `rate_limit_checked` (if rate limiting enabled), `context_assembly`, `yolo_resolution`, `agent_connect`, `prompt_sent`, `agent_message`, one or more `skill_call`/`memory_operation`/`agent_complete_thought`/`agent_complete_message` entries, `agent_response`, `reply_sent`, `session_end`

#### Scenario: File-send session audit trail
- **GIVEN** audit is enabled with all phases included
- **WHEN** a message session completes successfully by sending a file without a text reply
- **THEN** the session JSONL file SHALL contain a `file_sent` entry in the `skill_call`/`reply_sent` region
- **AND** the `session_end` entry SHALL have `fileSent: true` and `replySent: false`

### Requirement: Trigger Received Audit Phase

The system SHALL write a `trigger_received` audit entry as the first entry in each session's JSONL file, immediately after the session ID is assigned in `SessionOrchestrator`. The entry data SHALL contain `platform`, `channelId`, `userId`, `messageId`, `isDm` (boolean), `contentLength` (integer, length of message content), and `attachmentCount` (integer). For triggerless sessions (spontaneous, self-research, memory-maintenance), `messageId` SHALL be empty and `contentLength` SHALL be `0`.

#### Scenario: Normal message trigger
- **WHEN** a Discord message triggers a session for user `123` in channel `456` with message ID `789` containing 50 characters and 2 attachments
- **THEN** a `trigger_received` entry SHALL be written with `platform: "discord"`, `channelId: "456"`, `userId: "123"`, `messageId: "789"`, `isDm: false`, `contentLength: 50`, `attachmentCount: 2`

#### Scenario: Spontaneous post trigger
- **WHEN** a spontaneous post session starts
- **THEN** a `trigger_received` entry SHALL be written with `messageId: ""`, `contentLength: 0`, and `attachmentCount: 0`

#### Scenario: DM trigger
- **WHEN** a DM triggers a session with `isDm: true`
- **THEN** the `trigger_received` entry SHALL record `isDm: true`

### Requirement: Session Start Audit Phase

The system SHALL write a `session_start` audit entry immediately after session registration in the session registry. The entry data SHALL contain `sessionId`, `sessionType` (e.g., `"message"`, `"spontaneous"`, `"selfResearch"`, `"memoryMaintenance"`, `"channelLurk"`, `"reminder"`), `workspaceKey`, `agentType`, `model`, `reasoningEffort`, and `yolo` (boolean).

#### Scenario: Message session start
- **WHEN** a message session is registered with workspace key `discord/123`, agent type `opencode`, model `claude-opus-4.8`, reasoning effort `high`, and YOLO mode disabled
- **THEN** a `session_start` entry SHALL be written with `sessionType: "message"`, `workspaceKey: "discord/123"`, `agentType: "opencode"`, `model: "claude-opus-4.8"`, `reasoningEffort: "high"`, `yolo: false`

#### Scenario: Self-research session start
- **WHEN** a self-research session starts
- **THEN** a `session_start` entry SHALL be written with `sessionType: "selfResearch"`

#### Scenario: Reasoning effort recorded as default when chain resolves to default
- **WHEN** a session is registered and no routing-rule, section, or global override produces an active value (the effective chain resolves to `"default"`)
- **THEN** the `session_start` entry's `reasoningEffort` field SHALL be `"default"`

### Requirement: Rate Limit Checked Audit Phase

The system SHALL write a `rate_limit_checked` audit entry after every rate-limit evaluation, for both allowed and rejected requests. The entry data SHALL contain `decision` (`"allowed"` or `"rejected"`), `userId`, `platform`, `requestCount` (current count in the window), `maxRequests` (configured limit), and `cooldownRemainingMs` (milliseconds remaining in cooldown, `0` if not in cooldown).

#### Scenario: Request allowed
- **WHEN** rate-limit check allows a request from user `123` with 3 requests in the current window out of a max of 10
- **THEN** a `rate_limit_checked` entry SHALL be written with `decision: "allowed"`, `requestCount: 3`, `maxRequests: 10`, `cooldownRemainingMs: 0`

#### Scenario: Request rejected due to rate limit
- **WHEN** rate-limit check rejects a request from user `123` with 300000ms remaining in cooldown
- **THEN** a `rate_limit_checked` entry SHALL be written with `decision: "rejected"`, `cooldownRemainingMs: 300000`

#### Scenario: Rate limiting disabled
- **WHEN** `rateLimit.enabled` is `false`
- **THEN** no `rate_limit_checked` entry SHALL be written

### Requirement: Reply Edited Audit Phase

The system SHALL write a `reply_edited` audit entry when the `edit-reply` skill is successfully executed. The entry data SHALL contain `originalMessageId`, `newMessageId` (if the platform returns a new ID, e.g., Misskey delete-and-recreate), `replyContentHash` (SHA-256 hash of the new content when `hashContent` is true, otherwise the content length), `replyLength` (integer), and `platform`.

#### Scenario: Successful reply edit on Discord
- **WHEN** `edit-reply` succeeds for message `msg_001` on Discord with 100-character new content and `hashContent` is true
- **THEN** a `reply_edited` entry SHALL be written with `originalMessageId: "msg_001"`, `newMessageId: "msg_001"`, `replyContentHash: "sha256:<hex>"`, `replyLength: 100`, `platform: "discord"`

#### Scenario: Reply edit on Misskey (delete-and-recreate)
- **WHEN** `edit-reply` succeeds for message `note_001` on Misskey, producing new message `note_002`
- **THEN** a `reply_edited` entry SHALL be written with `originalMessageId: "note_001"`, `newMessageId: "note_002"`

### Requirement: File Sent Audit Phase

The system SHALL write a `file_sent` audit entry when the `send-file` skill delivers at least one file. The entry data SHALL contain `filesCount` (integer, number of files delivered), `messageId` (string, the last delivered message ID — the session reply anchor), `messageIds` (array of strings, all delivered message IDs in send order), `captionHash` (SHA-256 hash of the caption text when `hashContent` is true; omitted otherwise), `fileNamesHash` (SHA-256 hash of the comma-joined file names when `hashContent` is true; the plain comma-joined file names otherwise), and `platform`. Message IDs are platform message identifiers, not user content, and SHALL be recorded verbatim regardless of `hashContent`. Individual file content SHALL NOT be hashed or recorded (files may be large binary data). On partial delivery (e.g. Misskey chat mid-batch failure), the entry SHALL still be written with the delivered count and the delivered message IDs, and the failure SHALL additionally be visible via the `skill_call` entry's `skillResult`.

#### Scenario: Successful multi-file send
- **GIVEN** audit is enabled with `hashContent: true`
- **WHEN** `send-file` succeeds with `filePaths: ["a.png", "b.png"]` and caption `"here you go"` on Discord, delivering message ID `msg-1`
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 2`, `messageId: "msg-1"`, `messageIds: ["msg-1"]`, `captionHash: "sha256:<hex>"`, `fileNamesHash: "sha256:<hex>"`, and `platform: "discord"`

#### Scenario: File send without caption
- **GIVEN** audit is enabled with `hashContent: false`
- **WHEN** `send-file` succeeds with a single file and no caption
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`
- **AND** the entry SHALL NOT contain a `captionHash` field

#### Scenario: Multi-message delivery records all IDs
- **GIVEN** audit is enabled
- **WHEN** `send-file` delivers two Misskey chat messages with IDs `file-1` and `file-2`
- **THEN** a `file_sent` entry SHALL be written with `messageId: "file-2"` and `messageIds: ["file-1", "file-2"]`

#### Scenario: Partial delivery still emits file sent entry
- **GIVEN** audit is enabled
- **WHEN** `send-file` delivers 1 of 2 files on Misskey chat before a mid-batch failure, delivering message ID `file-1`
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`, `messageId: "file-1"`, and `messageIds: ["file-1"]`

### Requirement: Memory Operation Audit Phase

The system SHALL write a `memory_operation` audit entry for each memory skill invocation (`memory-save`, `memory-search`, `memory-patch`, `memory-stats`). The entry data SHALL contain `operation` (`"save"`, `"search"`, `"patch"`, `"stats"`), `memoryId` (the memory ID for save/patch, empty for search/stats), `visibility` (`"public"` or `"private"`, when applicable), `tier` (when applicable), `category` (when applicable), and `resultCount` (number of results for search, `0` for other operations). Content fields (`content`, `query`) SHALL be subject to the existing content hashing rules.

#### Scenario: Memory save operation
- **WHEN** `memory-save` is called with visibility `public`, tier `working`, category `fact`, and content `"User likes TypeScript"`
- **THEN** a `memory_operation` entry SHALL be written with `operation: "save"`, `visibility: "public"`, `tier: "working"`, `category: "fact"`, and `memoryId` set to the newly created memory's ID

#### Scenario: Memory search operation
- **WHEN** `memory-search` is called with query `"TypeScript"` and returns 5 results
- **THEN** a `memory_operation` entry SHALL be written with `operation: "search"`, `resultCount: 5`

#### Scenario: Memory patch operation
- **WHEN** `memory-patch` is called to disable memory `mem_001`
- **THEN** a `memory_operation` entry SHALL be written with `operation: "patch"`, `memoryId: "mem_001"`

### Requirement: Retry Triggered Audit Phase

The system SHALL write a `retry_triggered` audit entry when the missing-reply retry mechanism activates. The entry data SHALL contain `retryCount` (current retry attempt number, starting from 1), `maxRetries` (configured maximum retries), and `reason` (why the retry was triggered, e.g., `"no_reply_sent"`).

#### Scenario: First retry after missing reply
- **WHEN** an ACP agent completes without calling `send-reply` and the system initiates retry attempt 1 of 1
- **THEN** a `retry_triggered` entry SHALL be written with `retryCount: 1`, `maxRetries: 1`, `reason: "no_reply_sent"`

### Requirement: Agent Message Audit Phase

The system SHALL write an `agent_message` audit entry when the assembled prompt/context is sent to the ACP agent. The entry data SHALL contain `promptContentHash` (SHA-256 hash of the prompt text when `hashContent` is true, otherwise the prompt text), `promptLength` (integer), and `model`. This entry is written in addition to the existing `prompt_sent` phase and captures the content of what was sent.

#### Scenario: Prompt sent to agent with hash enabled
- **WHEN** a 5000-character prompt is sent to the agent with model `claude-opus-4.6` and `hashContent` is true
- **THEN** an `agent_message` entry SHALL be written with `promptContentHash: "sha256:<hex>"`, `promptLength: 5000`, `model: "claude-opus-4.6"`

#### Scenario: Prompt sent to agent with hash disabled
- **WHEN** a prompt is sent to the agent and `hashContent` is false
- **THEN** an `agent_message` entry SHALL be written with `promptContentHash` containing the full prompt text

### Requirement: Agent Complete Message Audit Phase

The system SHALL write an `agent_complete_message` audit entry when `ChatbotClient.flushMessageBuffer()` flushes accumulated agent response chunks into a complete message. The entry data SHALL contain `messageContentHash` (SHA-256 hash of the complete message when `hashContent` is true, otherwise the complete message text), `messageLength` (integer), and `chunkCount` (number of chunks that were buffered). This entry SHALL NOT be written when the message buffer is empty (zero chunks).

#### Scenario: Agent response with multiple chunks
- **WHEN** the agent sends 15 chunks totaling 2000 characters and the buffer is flushed with `hashContent` true
- **THEN** an `agent_complete_message` entry SHALL be written with `messageContentHash: "sha256:<hex>"`, `messageLength: 2000`, `chunkCount: 15`

#### Scenario: Empty buffer flush
- **WHEN** `flushMessageBuffer()` is called with an empty buffer
- **THEN** no `agent_complete_message` entry SHALL be written

#### Scenario: Multiple flushes in one session
- **WHEN** the agent produces two separate message blocks (e.g., due to tool use interleaving)
- **THEN** two separate `agent_complete_message` entries SHALL be written, one for each flush

### Requirement: Session End Summary Counters

The `session_end` audit entry SHALL include summary counters: `repliesCount` (number of `send-reply` calls), `skillCallsCount` (total skill API calls), `memoryOpsCount` (total memory skill calls), and `permissionDecisionsCount` (total permission approved + denied). These counters SHALL be tracked in-memory during the session and written as part of the `session_end` data payload.

#### Scenario: Session end with summary counters
- **WHEN** a session ends having sent 2 replies, made 5 skill calls (including 3 memory operations), and processed 4 permission decisions
- **THEN** the `session_end` entry SHALL contain `repliesCount: 2`, `skillCallsCount: 5`, `memoryOpsCount: 3`, `permissionDecisionsCount: 4`

#### Scenario: Session end with no activity
- **WHEN** a session ends without any skill calls, replies, or permission decisions
- **THEN** the `session_end` entry SHALL contain `repliesCount: 0`, `skillCallsCount: 0`, `memoryOpsCount: 0`, `permissionDecisionsCount: 0`

### Requirement: Audit writer creation integrated into shared session lifecycle

The creation and attachment of `SessionAuditWriter` to session registry SHALL be handled by the shared `runAgentSession()` method rather than duplicated in each `process*` method.

#### Scenario: Audit writer created by shared lifecycle
- **WHEN** `runAgentSession()` executes and audit is enabled
- **THEN** the audit writer SHALL be created and attached to the session registry as part of the shared lifecycle, not in individual `process*` methods

### Requirement: Fire-and-Forget Write

The `write()` method SHALL be fire-and-forget. I/O errors during audit writing SHALL be logged as warnings but SHALL NOT throw exceptions or crash the session. The system SHALL catch all errors in the `write()` method and log them via `logger.warn`.

#### Scenario: Filesystem error during write
- **GIVEN** the audit directory is not writable
- **WHEN** `write()` is called
- **THEN** the error SHALL be logged as a warning with `sessionId` and `phase`
- **AND** the session SHALL continue normally without interruption

### Requirement: Phase Filtering

When `audit.includedPhases` is a non-empty array, the system SHALL only record entries whose phase is in the configured list. When `includedPhases` is empty, all phases SHALL be recorded.

#### Scenario: Selective phase recording
- **GIVEN** `includedPhases` is `["skill_call", "reply_sent"]`
- **WHEN** a `context_assembly` phase entry is written
- **THEN** the entry SHALL be silently skipped (not written to file)

#### Scenario: All phases recorded
- **GIVEN** `includedPhases` is an empty array
- **WHEN** any phase entry is written
- **THEN** the entry SHALL be recorded to the JSONL file

### Requirement: Content Hashing

When `audit.hashContent` is `true`, the system SHALL hash user content fields using SHA-256 via the `sanitizeSkillParams()` function before writing audit entries. The hashed fields are: `content`, `query`, `text`, `message`, `replyContent`. Hashed values SHALL be prefixed with `sha256:`. The function SHALL process nested objects recursively. When `hashContent` is `false`, parameters SHALL be copied as-is.

#### Scenario: Hash enabled for skill params
- **GIVEN** `hashContent` is `true`
- **WHEN** a skill call audit entry has `skillParams` containing `{ content: "hello" }`
- **THEN** the recorded `content` field SHALL be `sha256:<hex_digest>` where the digest is the SHA-256 hash of `"hello"`

#### Scenario: Non-content fields preserved
- **GIVEN** `hashContent` is `true`
- **WHEN** a skill call audit entry has `skillParams` containing `{ visibility: "public" }`
- **THEN** the `visibility` field SHALL remain `"public"` (not hashed)

### Requirement: Retention Cleanup

The `cleanupAuditLogs()` function SHALL delete JSONL files whose `mtime` is older than `retentionDays`. The `AuditRetentionScheduler` SHALL execute cleanup at startup (when no restored state exists) and then every 24 hours (fixed interval). Empty user directories SHALL be cleaned up after file deletion. If the audit directory does not exist (`Deno.errors.NotFound`), cleanup SHALL complete silently without error.

#### Scenario: Expired file cleanup
- **GIVEN** `retentionDays` is `7`
- **AND** a JSONL file has `mtime` older than 7 days
- **WHEN** retention cleanup runs
- **THEN** the file SHALL be deleted
- **AND** the parent directory SHALL be removed if empty

#### Scenario: Retention disabled
- **GIVEN** `audit.enabled` is `false` or `retentionDays` is `0` or negative
- **WHEN** the scheduler starts
- **THEN** no cleanup timer SHALL be scheduled

#### Scenario: Concurrent execution guard
- **GIVEN** a cleanup is already running
- **WHEN** the timer fires again
- **THEN** the execution SHALL be skipped and the next timer SHALL be scheduled

### Requirement: Agent Complete Thought Audit Phase

The system SHALL emit an `agent_complete_thought` audit entry whenever buffered thought chunks are flushed at the end of a thought process or session turn. The entry `data` payload SHALL contain `thoughtContentHash` (optional string, formatted as `sha256:<hex>` or plain text depending on `hashContent` configuration), `thoughtLength` (integer, total character length of complete thought), and `chunkCount` (integer, number of thought chunks aggregated).

#### Scenario: Agent complete thought after multiple chunks
- **GIVEN** audit is enabled and `agent_complete_thought` phase is included
- **WHEN** the agent emits 3 `agent_thought_chunk` updates totaling 450 characters and then emits an `agent_message_chunk`
- **THEN** an audit entry SHALL be written with `phase: "agent_complete_thought"` containing `thoughtLength: 450` and `chunkCount: 3`

#### Scenario: Empty thought buffer flush does not emit audit entry
- **GIVEN** `thoughtBuffer` is empty
- **WHEN** `flushThoughtBuffer()` is called
- **THEN** no `agent_complete_thought` audit entry SHALL be written

#### Scenario: Multiple thought flushes in one session
- **GIVEN** an agent performs multiple turns or tool calls with reasoning in a single session
- **WHEN** `flushThoughtBuffer()` is called multiple times after non-empty thought chunks
- **THEN** multiple distinct `agent_complete_thought` entries SHALL be recorded in the session JSONL file in chronological sequence

### Requirement: Non-Blocking Audit Logging and Synchronous Timestamps

The system SHALL capture event timestamps synchronously at the exact moment of buffer flushing or phase occurrence and execute all audit log formatting, hashing, and filesystem writes asynchronously without blocking the main program workflow.

#### Scenario: Synchronous timestamp capture during asynchronous hashing
- **GIVEN** `hashContent` is enabled requiring asynchronous SHA-256 calculation
- **WHEN** `flushThoughtBuffer()` or `flushMessageBuffer()` is called at timestamp `T0`
- **THEN** `T0` SHALL be captured synchronously and recorded as `ts` in the audit entry even if the SHA-256 calculation completes at later timestamp `T1`

#### Scenario: Fire-and-forget non-blocking write
- **GIVEN** an audit entry is being written via `SessionAuditWriter.write()`
- **WHEN** the filesystem write operation is pending or fails
- **THEN** the main session execution SHALL continue immediately without blocking or throwing an unhandled exception

### Requirement: Prometheus Metric

The system SHALL increment the `airfriends_audit_entries_total` counter with label `{ phase }` each time an audit entry passes the phase filter and is about to be written. The counter SHALL be incremented even if the subsequent file write fails.

#### Scenario: Metric increment
- **GIVEN** audit is enabled and `skill_call` is an included phase
- **WHEN** a `skill_call` audit entry is written
- **THEN** `airfriends_audit_entries_total{phase="skill_call"}` SHALL be incremented by 1

### Requirement: Environment Variable Overrides

The following environment variables SHALL override their corresponding configuration values:

| Environment Variable    | Config Path            | Type                  |
| ----------------------- | ---------------------- | --------------------- |
| `AUDIT_ENABLED`         | `audit.enabled`        | `"true"` / `"false"`  |
| `AUDIT_RETENTION_DAYS`  | `audit.retentionDays`  | Integer string        |
| `AUDIT_HASH_CONTENT`    | `audit.hashContent`    | `"true"` / `"false"`  |
| `AUDIT_INCLUDED_PHASES` | `audit.includedPhases` | Comma-separated list  |

#### Scenario: Env override for included phases
- **GIVEN** `AUDIT_INCLUDED_PHASES` is set to `"skill_call,reply_sent,session_end"`
- **WHEN** configuration is loaded
- **THEN** `audit.includedPhases` SHALL be `["skill_call", "reply_sent", "session_end"]`
