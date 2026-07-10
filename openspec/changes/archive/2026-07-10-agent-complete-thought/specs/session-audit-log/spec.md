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
| `agent_complete_thought` | Agent complete buffered thought process |
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
- **THEN** the session JSONL file SHALL contain entries in chronological order: `trigger_received`, `session_start`, `rate_limit_checked` (if rate limiting enabled), `context_assembly`, `yolo_resolution`, `agent_connect`, `prompt_sent`, `agent_message`, one or more `skill_call`/`memory_operation`/`agent_complete_message`/`agent_complete_thought` entries, `agent_response`, `reply_sent`, `session_end`

## ADDED Requirements

### Requirement: Agent Complete Thought Audit Phase

The system SHALL write an `agent_complete_thought` audit entry when `ChatbotClient.flushThoughtBuffer()` flushes accumulated agent thought chunks into a complete thought string. The entry data SHALL contain `thoughtContentHash` (SHA-256 hash of the complete thought when `hashContent` is true, otherwise the complete thought text), `thoughtLength` (integer), and `chunkCount` (number of chunks that were buffered). This entry SHALL NOT be written when the thought buffer is empty (zero chunks).

#### Scenario: Agent thought process with multiple chunks
- **WHEN** the agent sends 8 thought chunks totaling 1200 characters and the thought buffer is flushed with `hashContent` true
- **THEN** an `agent_complete_thought` entry SHALL be written with `thoughtContentHash: "sha256:<hex>"`, `thoughtLength: 1200`, `chunkCount: 8`

#### Scenario: Empty thought buffer flush
- **WHEN** `flushThoughtBuffer()` is called with an empty thought buffer
- **THEN** no `agent_complete_thought` entry SHALL be written

#### Scenario: Multiple thought flushes in one session
- **WHEN** the agent produces two separate thought blocks (e.g., interleaving thoughts before tool calls and thoughts before final answers)
- **THEN** two separate `agent_complete_thought` entries SHALL be written, one for each flush

### Requirement: Non-Blocking Audit Logging and Synchronous Timestamps

The system SHALL ensure that all audit log writes are strictly non-blocking (`fire-and-forget`) and never hinder or block main program logic. To ensure downstream log servers receive accurate timestamps for sorting even when SHA-256 content hashing or file I/O executes asynchronously, `SessionAuditWriter.write(phase, data, timestamp?)` SHALL support an optional explicit timestamp captured synchronously at event occurrence time.

#### Scenario: Synchronous timestamp capture during asynchronous hashing
- **GIVEN** `hashContent` is true on `SessionAuditWriter`
- **WHEN** `flushThoughtBuffer()` or `flushMessageBuffer()` is called
- **THEN** the exact timestamp `ts` SHALL be captured synchronously (`new Date().toISOString()`) before initiating asynchronous SHA-256 hashing, and passed to `SessionAuditWriter.write(phase, data, ts)` so the written entry records the exact flush time

#### Scenario: Fire-and-forget non-blocking write
- **GIVEN** an audit entry is being emitted
- **WHEN** `SessionAuditWriter.write()` is invoked
- **THEN** the call SHALL return immediately (`Promise<void>`) without blocking session processing, and any underlying file write errors SHALL be logged as warnings without throwing exceptions into main program flow
