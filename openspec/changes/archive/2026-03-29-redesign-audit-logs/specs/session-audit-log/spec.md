## ADDED Requirements

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

The system SHALL write a `session_start` audit entry immediately after session registration in the session registry. The entry data SHALL contain `sessionId`, `sessionType` (e.g., `"message"`, `"spontaneous"`, `"selfResearch"`, `"memoryMaintenance"`, `"channelLurk"`, `"reminder"`), `workspaceKey`, `agentType`, `model`, and `yolo` (boolean).

#### Scenario: Message session start
- **WHEN** a message session is registered with workspace key `discord/123`, agent type `copilot`, model `claude-opus-4.6`, and YOLO mode disabled
- **THEN** a `session_start` entry SHALL be written with `sessionType: "message"`, `workspaceKey: "discord/123"`, `agentType: "copilot"`, `model: "claude-opus-4.6"`, `yolo: false`

#### Scenario: Self-research session start
- **WHEN** a self-research session starts
- **THEN** a `session_start` entry SHALL be written with `sessionType: "selfResearch"`

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

## MODIFIED Requirements

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
| `reply_sent`           | Reply sent to platform               |
| `reply_edited`         | Reply edited on platform             |
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
- **THEN** an audit entry SHALL be written with `success`, `replySent`, `reactionSent`, `durationMs`, `repliesCount`, `skillCallsCount`, `memoryOpsCount`, `permissionDecisionsCount`, and optionally `error`

#### Scenario: Complete session audit trail
- **GIVEN** audit is enabled with all phases included
- **WHEN** a normal message session completes successfully with one reply and two memory saves
- **THEN** the session JSONL file SHALL contain entries in chronological order: `trigger_received`, `session_start`, `rate_limit_checked` (if rate limiting enabled), `context_assembly`, `yolo_resolution`, `agent_connect`, `prompt_sent`, `agent_message`, one or more `skill_call`/`memory_operation`/`agent_complete_message` entries, `agent_response`, `reply_sent`, `session_end`

### Requirement: Session End Summary Counters

The `session_end` audit entry SHALL include summary counters: `repliesCount` (number of `send-reply` calls), `skillCallsCount` (total skill API calls), `memoryOpsCount` (total memory skill calls), and `permissionDecisionsCount` (total permission approved + denied). These counters SHALL be tracked in-memory during the session and written as part of the `session_end` data payload.

#### Scenario: Session end with summary counters
- **WHEN** a session ends having sent 2 replies, made 5 skill calls (including 3 memory operations), and processed 4 permission decisions
- **THEN** the `session_end` entry SHALL contain `repliesCount: 2`, `skillCallsCount: 5`, `memoryOpsCount: 3`, `permissionDecisionsCount: 4`

#### Scenario: Session end with no activity
- **WHEN** a session ends without any skill calls, replies, or permission decisions
- **THEN** the `session_end` entry SHALL contain `repliesCount: 0`, `skillCallsCount: 0`, `memoryOpsCount: 0`, `permissionDecisionsCount: 0`
