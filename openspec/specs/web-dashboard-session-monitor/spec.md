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

`GET /api/sessions/history` SHALL return recently completed sessions (up to 100, ring buffer). Each entry SHALL include `id`, `type`, `platform`, `userId`, `startTime`, `endTime`, `status`, and `durationMs`.

#### Scenario: Returns Empty Initially

- **GIVEN** no sessions have completed since application startup
- **WHEN** a `GET /api/sessions/history` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with an empty JSON array `[]`

#### Scenario: Captures Completed Sessions

- **GIVEN** a session has completed with `status: "success"` and duration of 5000ms
- **WHEN** a `GET /api/sessions/history` request is received with a valid session cookie
- **THEN** the response SHALL include an entry with the session's `id`, `type`, `platform`, `userId`, `startTime`, `endTime`, `status`, and `durationMs`

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

`GET /api/sessions/:id/audit` SHALL return audit log entries for a specific session by reading from the audit JSONL file.

#### Scenario: Returns Audit Entries for Valid Session

- **GIVEN** audit logging is enabled and a session with ID `"sess_abc123"` has audit entries
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON array of audit log entries

#### Scenario: Returns 404 for Unknown Session

- **GIVEN** no audit file exists for session ID `"sess_unknown"`
- **WHEN** a `GET /api/sessions/sess_unknown/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 404

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

#### Scenario: Requires Audit to Be Enabled

- **GIVEN** `audit.enabled` is `false`
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 404 or an appropriate error indicating audit is not enabled
