## MODIFIED Requirements

### Requirement: Session-Based Authentication

The system SHALL authenticate all skill API requests via BOTH a session ID and a per-session caller token bound to the subprocess that owns the session; a valid session ID alone SHALL NOT be sufficient. Session IDs SHALL follow the format `sess_{timestamp}_{UUID}` with 64+ bits of entropy. At session registration the system SHALL mint a high-entropy caller token distinct from the session ID, store it on the session, and provision it into the owning agent subprocess's environment. Each skill API request SHALL present the token (e.g. as an `Authorization: Bearer <token>` header); the server SHALL resolve the session by ID and then verify the presented token against the session's stored token using a constant-time comparison, rejecting a mismatched or absent token with HTTP 403. Sessions SHALL expire based on a configurable idle `timeoutMs`: the session registry SHALL treat a session idle beyond `timeoutMs` as absent on `get()`, run periodic cleanup, and refresh the session's `lastActivityAt` via `touch()` on each authenticated call.

Note: the caller token is provisioned into the owning subprocess's environment, so it does not by itself defend against an attacker who can read that subprocess's environment directly (that vector is addressed by agent filesystem confinement); its purpose is to ensure that knowledge of a session ID obtained through any other channel does not grant the ability to act as that session.

#### Scenario: Valid session ID without caller token rejected
- **GIVEN** an active session `sess_abc_123`
- **WHEN** a skill API request presents `sessionId: "sess_abc_123"` but no caller token, or a token that does not match the session's stored token
- **THEN** the server SHALL return HTTP 403 and SHALL NOT execute the skill

#### Scenario: Valid session ID with matching caller token accepted
- **GIVEN** an active session `sess_abc_123` whose owning subprocess holds the session's caller token
- **WHEN** a skill API request presents `sessionId: "sess_abc_123"` and the matching token via the `Authorization` header
- **THEN** the server SHALL authenticate the request and execute the skill handler

#### Scenario: Constant-time token comparison
- **GIVEN** a presented caller token
- **WHEN** the server verifies it against the session's stored token
- **THEN** the comparison SHALL be constant-time to avoid a timing oracle

#### Scenario: Session expiration
- **GIVEN** a session that has been inactive beyond `timeoutMs`
- **WHEN** a skill API request is made with that session ID
- **THEN** the session registry SHALL treat the session as absent and the server SHALL return 401

#### Scenario: Activity refreshes idle timeout
- **GIVEN** an active session receiving authenticated calls within `timeoutMs`
- **WHEN** each authenticated call is processed
- **THEN** the session's `lastActivityAt` SHALL be refreshed via `touch()` so an actively used session does not expire mid-turn
