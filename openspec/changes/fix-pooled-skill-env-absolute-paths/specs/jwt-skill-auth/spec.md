# Delta: jwt-skill-auth

## MODIFIED Requirements

### Requirement: Per-Session Signed JWT Issuance

For each session the system SHALL issue a standard 3-segment JWT: header `{"alg":"HS256"}`, payload `{ sub: <owning session id>, channel: <session's channel ID>, jti: <session's per-session caller token>, iat, exp }`, and an HMAC-SHA256 signature over `header.payload` using the deployment secret. To avoid expiry while a session waits in the serialization queue, the JWT SHALL be issued (or re-issued with a fresh `exp`) when the session ACQUIRES the execution lease, not at registration. The JWT `exp` SHALL be aligned to the session idle TTL (30 minutes); if the same lease outlives it, the system SHALL re-issue the JWT with a fresh `exp` within the lease. The JWT SHALL be written atomically (temp file + rename, mode `0600`, symlink-safe path handling) to a per-session file under `SKILL_JWT_DIR`, in a location outside the agent's restricted read boundary, and SHALL be deleted when the session ends. The current-session pointer file SHALL be written atomically ONLY while the session holds the execution lease (and cleared on release), so a later queued session cannot overwrite the in-flight session's pointer. The per-session JWT file SHALL use secure file hygiene: the temp file is created with mode `0600` BEFORE the atomic rename, the target path is validated as a regular file (`lstat`, no symlink), and the deployment secret SHALL be at least 32 bytes (256 bits). The configured skill-JWT directory SHALL be normalized to an absolute path ONCE and shared by every issuing/cleanup site and by the `SKILL_JWT_DIR` value exported to the agent process, so JWT and pointer files resolve identically from any working directory; a configured relative value SHALL keep its existing meaning (relative to the bot process working directory).

#### Scenario: JWT issued at lease acquisition
- **GIVEN** a session `sess_abc_123` (channel `discord/123`, caller token `abc...`) that is queued behind an in-flight session
- **WHEN** the session acquires the execution lease
- **THEN** the system SHALL issue (or re-issue) the session's JWT with a fresh `exp` aligned to the session idle TTL, write the per-session JWT file atomically, and write the current-session pointer file for the duration of the lease

#### Scenario: JWT file removed when session ends
- **GIVEN** a completed or cancelled session
- **WHEN** the session ends
- **THEN** the system SHALL delete that session's JWT file from `SKILL_JWT_DIR`

#### Scenario: Pointer written only under the lease
- **GIVEN** an in-flight session holds the execution lease and a later session is queued
- **WHEN** the later session's setup runs before it acquires the lease
- **THEN** the current-session pointer file SHALL still contain the in-flight session's id, and SHALL be updated only when the later session acquires the lease

### Requirement: Skill Lib JWT Presentation

The shared skill client library SHALL present the owning session's JWT as an `Authorization: Bearer <jwt>` header on Skill API requests. The owning session id SHALL be resolved from the `SESSION_ID` environment variable (per-spawn mode) or, in shared-process mode, from the orchestrator-maintained current-session pointer file (written only while the session holds the execution lease). The skill script SHALL snapshot the owning session id and the JWT file content ONCE at script start, so a backgrounded skill subprocess cannot observe a later session's pointer or JWT file. Because `SKILL_JWT_DIR` is exported as an absolute path, JWT and pointer file resolution SHALL NOT depend on the skill script's working directory. In neither case SHALL the agent need to read files or pass extra parameters. On lease release the system SHALL verify the pointer's current content equals the releasing session's id before clearing it (so a later session's pointer is never clobbered), and SHALL wait (bounded timeout, then kill the agent process tree) for the agent process's child processes (skill scripts) to fully exit before clearing the pointer and releasing the lease, so a backgrounded script that starts LATE cannot pick up the next session's pointer or JWT file.

#### Scenario: Skill script presents the owning session's JWT
- **GIVEN** a skill script running under the owning session `sess_abc_123`
- **WHEN** the script calls the Skill API
- **THEN** it SHALL present that session's signed JWT in the Authorization header

#### Scenario: Owning session resolved without agent work
- **GIVEN** a shared channel process running sessions for a channel
- **WHEN** a skill script invokes the shared client library
- **THEN** the library SHALL resolve the owning session id from the current-session pointer file and present that session's JWT, without the agent reading files or passing extra CLI arguments

#### Scenario: JWT and pointer resolve regardless of script working directory
- **GIVEN** a shared-process session whose JWT and `active.json` pointer live under the absolute `SKILL_JWT_DIR`
- **WHEN** a skill script runs with its process cwd set to the session workspace (NOT the bot process cwd) and resolves the owning session
- **THEN** the pointer and JWT file SHALL be found on the first attempt, with no `SKILL_JWT_UNREADABLE` error and no fallback to a stale `SESSION_ID`

#### Scenario: Late-starting backgrounded script keeps the owning session's JWT
- **GIVEN** the agent backgrounded a skill script and the in-flight session then releases the lease
- **WHEN** the backgrounded script actually starts and reads the pointer
- **THEN** the pool SHALL still be waiting for the agent's child processes to exit (killing the process tree on timeout) before clearing the pointer, so the script's snapshot resolves to the OWNING session's id and JWT file, not the next session's
