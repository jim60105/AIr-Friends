# Spec Delta

## MODIFIED Requirements

### Requirement: Retention Cleanup

The `cleanupAuditLogs()` function SHALL delete JSONL files whose `mtime` is older than `retentionDays`. The `AuditRetentionScheduler` SHALL execute cleanup at startup (when no restored state exists) and then every 24 hours (fixed interval). Empty user directories SHALL be cleaned up after file deletion. If the audit directory does not exist (the filesystem reports not-found, `ENOENT`), cleanup SHALL complete silently without error.

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
