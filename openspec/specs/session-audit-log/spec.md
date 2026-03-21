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

| Phase                | Description                          |
| -------------------- | ------------------------------------ |
| `context_assembly`   | Context assembly completed           |
| `yolo_resolution`    | YOLO mode resolution                 |
| `agent_connect`      | Agent subprocess connected           |
| `prompt_sent`        | Prompt sent to agent                 |
| `skill_call`         | Skill API invoked                    |
| `agent_response`     | Agent response received              |
| `reply_sent`         | Reply sent to platform               |
| `session_end`        | Session lifecycle completed          |
| `permission_approved`| Permission request approved          |
| `permission_denied`  | Permission request denied            |

Each entry SHALL contain an ISO 8601 `ts` timestamp, the `phase` string, and a `data` object with phase-specific payload fields.

#### Scenario: Skill call audit entry
- **GIVEN** audit is enabled and `skill_call` phase is included
- **WHEN** the Skill API Server handles a skill invocation
- **THEN** an audit entry SHALL be written with `phase: "skill_call"` containing `skillName`, `skillParams`, `skillResult`, and `skillDurationMs`

#### Scenario: Session end audit entry
- **GIVEN** audit is enabled and `session_end` phase is included
- **WHEN** a session completes
- **THEN** an audit entry SHALL be written with `success`, `replySent`, `reactionSent`, `durationMs`, and optionally `error`

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
