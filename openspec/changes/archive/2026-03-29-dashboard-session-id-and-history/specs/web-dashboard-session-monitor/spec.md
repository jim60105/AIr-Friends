## MODIFIED Requirements

### Requirement: Session History

The Dashboard SHALL expose `GET /api/sessions/history` returning an array of completed session objects from the `CompletedSessionStore`. Each session object SHALL include: `auditSessionId` (string, primary identifier), `type`, `platform`, `userId`, `startedAt`, `endedAt`, `status` ("success" | "failure"), and `durationMs`. Sessions SHALL be returned in descending order by `endedAt` (newest first). The response SHALL NOT include an `id` field separate from `auditSessionId`.

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
