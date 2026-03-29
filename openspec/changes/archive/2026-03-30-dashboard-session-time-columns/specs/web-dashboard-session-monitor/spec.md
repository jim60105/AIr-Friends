## MODIFIED Requirements

### Requirement: Session History

`GET /api/sessions/history` SHALL return recently completed sessions (up to 100, ring buffer). Each entry SHALL include `auditSessionId` (string, primary identifier — the skill-API session ID in `sess_*` format, used for audit log file lookups), `type`, `platform`, `userId`, `startTime`, `endTime`, `status` ("success" | "failure"), and `durationMs`. Sessions SHALL be returned in descending order by `endedAt` (newest first). The response SHALL NOT include an `id` field separate from `auditSessionId`.

The Session History table SHALL display the following columns: Session ID, Type, Platform, User, Time, Duration, Status. The Time column SHALL display the session start time. The Duration column SHALL display the session duration. The table SHALL use `table-fixed` layout with explicit column width distribution to prevent horizontal overflow.

#### Scenario: Session history returns newest first

- **WHEN** a client sends `GET /api/sessions/history`
- **THEN** the response SHALL be a JSON array of completed sessions sorted by `endedAt` in descending order (most recent session first)

#### Scenario: Session history uses auditSessionId as identifier

- **WHEN** a client sends `GET /api/sessions/history`
- **THEN** each session object in the response SHALL contain `auditSessionId` as the primary identifier field and SHALL NOT contain a separate `id` field

#### Scenario: Session history includes audit-loaded sessions

- **WHEN** the system has loaded historical sessions from audit logs at startup
- **THEN** `GET /api/sessions/history` SHALL include both in-memory sessions from the current runtime and historically loaded sessions from audit logs

#### Scenario: Session without audit logging enabled

- **WHEN** a session completes with `skillApi.enabled` set to false or audit logging disabled
- **THEN** the session SHALL be recorded with a fallback `auditSessionId` in format `sess_noaudit_{timestamp}` and the audit detail view SHALL display "No audit log available"

#### Scenario: Ring buffer capacity with mixed sources

- **WHEN** historical sessions from audit logs and new sessions from the current runtime together exceed the store capacity (100)
- **THEN** the oldest sessions (by `endedAt`) SHALL be evicted first, regardless of whether they were loaded from audit or recorded in the current runtime

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/history` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

#### Scenario: Session History table displays Time and Duration columns

- **WHEN** the Session History table is rendered with session data
- **THEN** the Time column SHALL display the formatted start time of each session
- **AND** the Duration column SHALL display the formatted duration of each session
- **AND** the table SHALL NOT display separate Started and Ended columns

#### Scenario: Session History table does not overflow horizontally

- **WHEN** the Session History table is rendered on any screen size
- **THEN** the table width SHALL NOT exceed its parent container width
- **AND** no horizontal scrollbar SHALL be visible
