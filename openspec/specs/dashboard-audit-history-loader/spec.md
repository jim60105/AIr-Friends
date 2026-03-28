# Dashboard Audit History Loader

## Purpose

Defines the capability for loading historical session records from persisted audit log files at application startup, enabling session history to survive restarts.

## Requirements

### Requirement: Audit log directory scanning at startup

The system SHALL scan the audit log directory (`data/audit/{platform}/{userId}/*.jsonl`) during `CompletedSessionStore` initialization to reconstruct historical session records from persisted audit log files.

#### Scenario: Successful startup scan with existing audit logs

- **WHEN** the application starts and the audit log directory contains JSONL files
- **THEN** the system SHALL parse each audit log file to extract session metadata (platform, userId, sessionType, timestamps, status) and populate the `CompletedSessionStore` with reconstructed `CompletedSession` records

#### Scenario: Startup scan with empty audit directory

- **WHEN** the application starts and the audit log directory is empty or does not exist
- **THEN** the system SHALL initialize `CompletedSessionStore` with an empty history and log a debug message

#### Scenario: Startup scan with corrupted audit file

- **WHEN** the application starts and an audit log file contains invalid JSON lines
- **THEN** the system SHALL skip the corrupted file, log a warning with the file path, and continue processing remaining files

#### Scenario: Startup scan respects capacity limit

- **WHEN** the audit log directory contains more files than the store capacity (100)
- **THEN** the system SHALL load only the 100 most recent sessions (by end timestamp) and discard older entries

### Requirement: Session metadata extraction from audit entries

The system SHALL extract `CompletedSession` fields from audit log entries using the first and last entries in each JSONL file.

#### Scenario: Extract metadata from complete audit log

- **WHEN** an audit log file contains both a `context_assembly` (or earliest) entry and a `session_end` entry
- **THEN** the system SHALL extract `platform` and `userId` from the directory path, `sessionType` and `status` from the `session_end` entry data, `startedAt` from the first entry timestamp, `endedAt` from the last entry timestamp, and compute `durationMs` from the difference

#### Scenario: Extract metadata from audit log missing session_end

- **WHEN** an audit log file does not contain a `session_end` entry
- **THEN** the system SHALL record the session with `status: "failure"` and use the last available entry timestamp as `endedAt`

### Requirement: Audit scan does not block application startup

The system SHALL perform the audit log scan asynchronously during initialization without blocking platform connections or other startup processes.

#### Scenario: Slow audit directory scan

- **WHEN** the audit log directory contains many files and scanning takes significant time
- **THEN** the system SHALL complete initialization and begin serving requests while the scan continues in the background, with sessions becoming available in the history as they are loaded
