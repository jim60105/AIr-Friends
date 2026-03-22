# Web Dashboard Session Monitor

## Purpose

Defines the session monitoring APIs for active session listing, session history, statistics display, and session audit detail viewing.

## Requirements

### Requirement: Active Session Listing

`GET /api/sessions/active` SHALL return a JSON array of currently active sessions with `id`, `type`, `platform`, `userId`, `channelId`, `startTime`, and `status`.

#### Scenario: Returns Empty Array When No Sessions

- **GIVEN** no sessions are currently active
- **WHEN** a `GET /api/sessions/active` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with an empty JSON array `[]`

#### Scenario: Returns Active Sessions with Correct Fields

- **GIVEN** two sessions are currently active
- **WHEN** a `GET /api/sessions/active` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON array containing two entries
- **AND** each entry SHALL include `id`, `type`, `platform`, `userId`, `channelId`, `startTime`, and `status`

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/active` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Session History

`GET /api/sessions/history` SHALL return recently completed sessions (up to 100, ring buffer). Each entry SHALL include `id`, `type`, `platform`, `userId`, `startTime`, `endTime`, `status`, `durationMs`, and `auditSessionId` (the skill-API session ID in `sess_*` format, used for audit log file lookups).

#### Scenario: Returns Empty Initially

- **GIVEN** no sessions have completed since application startup
- **WHEN** a `GET /api/sessions/history` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with an empty JSON array `[]`

#### Scenario: Captures Completed Sessions

- **GIVEN** a session has completed with `status: "success"` and duration of 5000ms
- **WHEN** a `GET /api/sessions/history` request is received with a valid session cookie
- **THEN** the response SHALL include an entry with the session's `id`, `type`, `platform`, `userId`, `startTime`, `endTime`, `status`, `durationMs`, and `auditSessionId`

#### Scenario: Oldest Entries Evicted When Buffer Full

- **GIVEN** 100 completed sessions are stored in the history buffer
- **WHEN** a 101st session completes
- **THEN** the oldest session entry SHALL be evicted
- **AND** the buffer SHALL contain exactly 100 entries

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/history` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Statistics Display

`GET /api/stats` SHALL return aggregated statistics from the Prometheus metrics registry including `sessions_total`, `active_sessions`, `replies_sent_total`, `messages_received_total`, `memory_operations_total`, and `skill_api_calls_total`.

#### Scenario: Returns Current Metric Values

- **GIVEN** the Prometheus metrics registry contains recorded metrics
- **WHEN** a `GET /api/stats` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON object containing `sessions_total`, `active_sessions`, `replies_sent_total`, `messages_received_total`, `memory_operations_total`, and `skill_api_calls_total`

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/stats` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Session Detail View

`GET /api/sessions/:id/audit` SHALL return audit log entries for a specific session by reading from the audit JSONL file. The `:id` parameter SHALL be the `auditSessionId` (skill-API session ID in `sess_*` format) from the `CompletedSession` record, which corresponds to the audit file naming convention. When a user clicks a session row to view audit data, the dashboard SHALL use `auditSessionId` (not the display ID) to query this endpoint.

The audit log UI SHALL display each entry with a clickable summary showing timestamp and phase, and an expandable section showing the full JSON data formatted with indentation (2-space indent). The JSON data SHALL NOT be truncated.

Expanded audit rows SHALL persist across polling refreshes. When `pollHistory()` re-renders the session history table, any previously expanded audit rows SHALL be automatically re-expanded.

#### Scenario: Returns Audit Entries for Valid Session

- **GIVEN** audit logging is enabled and a session with `auditSessionId` `"sess_abc123"` has audit entries
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON array of audit log entries

#### Scenario: Returns 404 for Unknown Session

- **GIVEN** no audit file exists for `auditSessionId` `"sess_unknown"`
- **WHEN** a `GET /api/sessions/sess_unknown/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 404

#### Scenario: Audit file not found for old session

- **WHEN** a user clicks a session row whose audit file has been cleaned up by retention
- **THEN** the dashboard displays "Audit log not found" (404 response)

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

#### Scenario: Requires Audit to Be Enabled

- **GIVEN** `audit.enabled` is `false`
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 404 or an appropriate error indicating audit is not enabled

#### Scenario: Audit entry displays formatted JSON

- **WHEN** a user expands an audit entry in the session detail view
- **THEN** the JSON data SHALL be displayed with 2-space indentation across multiple lines
- **AND** the full content SHALL be visible without truncation

#### Scenario: Expanded audit rows persist across polling

- **GIVEN** the user has expanded audit details for session `"sess_abc123"`
- **WHEN** `pollHistory()` refreshes the session history table
- **THEN** the audit row for `"sess_abc123"` SHALL remain expanded with its content visible

#### Scenario: User can collapse expanded audit row

- **GIVEN** an audit row is expanded for session `"sess_abc123"`
- **WHEN** the user clicks the session row again
- **THEN** the audit row SHALL collapse and be removed

### Requirement: UUID Format Validation on SessionId in Audit Lookups

`GET /api/sessions/:id/audit` SHALL validate that the `:id` parameter matches the expected `sess_` prefix followed by only alphanumeric characters (regex: `^sess_[a-zA-Z0-9]+$`). Requests with a non-matching `:id` SHALL be rejected with HTTP 400 before any file system access. This prevents path traversal and injection attacks through the session ID parameter.

#### Scenario: Valid sess_ format is accepted

- **GIVEN** audit logging is enabled
- **WHEN** a `GET /api/sessions/sess_abc123def/audit` request is received with a valid session cookie
- **THEN** the server SHALL proceed with the audit file lookup

#### Scenario: Path traversal in sessionId is rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/../../etc/passwd/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400 with message `"Invalid session ID format"`
- **AND** no file system read SHALL be attempted

#### Scenario: SessionId with slash characters is rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/sess_abc%2F..%2Fetc/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400

#### Scenario: SessionId without sess_ prefix is rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/notasession/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400 with message `"Invalid session ID format"`

#### Scenario: Empty sessionId is rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions//audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400 or HTTP 404
