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

## ADDED Requirements

### Requirement: File Sent Audit Phase

The system SHALL write a `file_sent` audit entry when the `send-file` skill delivers at least one file. The entry data SHALL contain `filesCount` (integer, number of files delivered), `captionHash` (SHA-256 hash of the caption text when `hashContent` is true; omitted otherwise), `fileNamesHash` (SHA-256 hash of the comma-joined file names when `hashContent` is true; the plain comma-joined file names otherwise), and `platform`. Individual file content SHALL NOT be hashed or recorded (files may be large binary data). On partial delivery (e.g. Misskey chat mid-batch failure), the entry SHALL still be written with the delivered count and the failure SHALL additionally be visible via the `skill_call` entry's `skillResult`.

#### Scenario: Successful multi-file send
- **GIVEN** audit is enabled with `hashContent: true`
- **WHEN** `send-file` succeeds with `filePaths: ["a.png", "b.png"]` and caption `"here you go"` on Discord
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 2`, `captionHash: "sha256:<hex>"`, `fileNamesHash: "sha256:<hex>"`, and `platform: "discord"`

#### Scenario: File send without caption
- **GIVEN** audit is enabled with `hashContent: false`
- **WHEN** `send-file` succeeds with a single file and no caption
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`
- **AND** the entry SHALL NOT contain a `captionHash` field

#### Scenario: Partial delivery still emits file sent entry
- **GIVEN** audit is enabled
- **WHEN** `send-file` delivers 1 of 2 files on Misskey chat before a mid-batch failure
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`
