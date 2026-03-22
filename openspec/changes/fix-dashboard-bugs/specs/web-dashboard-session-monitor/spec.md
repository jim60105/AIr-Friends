## MODIFIED Requirements

### Requirement: Session audit log lookup
The session history view SHALL use the skill-API session ID (format `sess_*`) for audit log lookups. The `CompletedSession` record SHALL include an `auditSessionId` field containing the skill-API session ID used for audit file naming. When a user clicks a session row to view audit data, the dashboard SHALL use `auditSessionId` to query the `/api/sessions/:id/audit` endpoint.

#### Scenario: View audit for completed session
- **WHEN** a user clicks a session row in session history
- **THEN** the dashboard requests `/api/sessions/<auditSessionId>/audit` using the skill-API session ID
- **AND** the audit data is displayed if the audit file exists

#### Scenario: Audit file not found for old session
- **WHEN** a user clicks a session row whose audit file has been cleaned up by retention
- **THEN** the dashboard displays "Audit log not found" (404 response)
