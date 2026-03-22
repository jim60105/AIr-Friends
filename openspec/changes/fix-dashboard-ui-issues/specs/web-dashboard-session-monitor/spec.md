## MODIFIED Requirements

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
