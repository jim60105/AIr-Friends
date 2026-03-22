# Web Dashboard Session Monitor (Delta)

## Purpose

Security addition to the session monitor for input validation on session ID parameters used in audit log lookups.

## ADDED Requirements

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
