# jwt-skill-auth Specification

## Purpose
Authenticates Skill API requests with per-session signed JWTs, so a request is only accepted when it carries a valid, server-verifiable proof that it originated from the owning agent subprocess.
## Requirements
### Requirement: Deployment Skill API Secret

At bootstrap the system SHALL generate a 256-bit CSPRNG deployment secret and persist it to `data/skill-secret` (overridable by environment variable). The secret SHALL be held ONLY by the bot process, which acts as both the JWT issuer and the Skill API verifier; the agent subprocess SHALL receive the per-session JWT file (a minimal, short-lived session capability) via `SKILL_JWT_DIR`, never the raw HMAC key.

#### Scenario: Secret generated and persisted
- **GIVEN** a fresh deployment with no persisted secret file
- **WHEN** the application bootstraps
- **THEN** it SHALL generate a 256-bit random secret and write it to `data/skill-secret` (mode `0600`)

#### Scenario: Persisted secret reused
- **GIVEN** an existing `data/skill-secret` file
- **WHEN** the application bootstraps
- **THEN** it SHALL load and reuse the persisted secret instead of generating a new one

#### Scenario: Agent process receives only the session capability
- **GIVEN** a shared agent process for a pool key
- **WHEN** the process environment is built
- **THEN** it SHALL contain `SKILL_JWT_DIR` but SHALL NOT contain `SKILL_API_SECRET`

### Requirement: Per-Session Signed JWT Issuance

For each session the system SHALL issue a standard 3-segment JWT (header `{"alg":"HS256"}`, payload `{ sub: <owning session id>, channel: <session's channel ID>, jti: <session's per-session caller token>, iat, exp }`) with an HMAC-SHA256 signature over `header.payload` using the deployment secret.

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

#### Scenario: Long-lived lease triggers JWT re-issue
- **GIVEN** a session whose JWT `exp` is aligned to the session idle TTL (30 minutes) and the same execution lease outlives it
- **WHEN** the JWT's `exp` passes while the session still holds the lease
- **THEN** the system SHALL re-issue the JWT with a fresh `exp` within the lease

#### Scenario: JWT file written with secure atomic hygiene
- **GIVEN** a per-session JWT being written under `SKILL_JWT_DIR` in a location outside the agent's restricted read boundary
- **WHEN** the system persists the JWT file
- **THEN** it SHALL create the temp file with mode `0600` before an atomic rename and validate the target as a regular file (`lstat`, no symlink)
- **AND** the deployment secret SHALL be at least 32 bytes (256 bits)

#### Scenario: Skill-JWT directory normalized once
- **GIVEN** a configured skill-JWT directory (absolute or relative)
- **WHEN** the system resolves it for issuing, cleanup, and the `SKILL_JWT_DIR` value exported to the agent process
- **THEN** it SHALL normalize the configured value to an absolute path ONCE and share that single path across every site, so JWT and pointer files resolve identically from any working directory; a configured relative value SHALL keep its existing meaning (relative to the bot process working directory)

### Requirement: Skill Lib JWT Presentation

For a Skill API request the shared skill client library SHALL present the owning session's JWT as an `Authorization: Bearer <jwt>` header, resolving the owning session id from `SESSION_ID` (per-spawn mode) or from the current-session pointer file (shared-process mode); in neither case SHALL the agent need to read files or pass extra parameters.

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

#### Scenario: Per-spawn mode resolves owner from SESSION_ID
- **GIVEN** a per-spawn agent process running a skill script
- **WHEN** the script invokes the shared client library
- **THEN** the owning session id SHALL be resolved from the `SESSION_ID` environment variable and its JWT presented

#### Scenario: Skill script snapshots owning identity once at start
- **GIVEN** a skill script that starts and may later be backgrounded while the next session begins
- **WHEN** the script starts
- **THEN** it SHALL snapshot the owning session id and the JWT file content ONCE at script start, so it cannot observe a later session's pointer or JWT file

#### Scenario: Lease cleared only after children exit and pointer verifies
- **GIVEN** an in-flight session releases the execution lease while its agent process's child skill scripts may still be running
- **WHEN** the system clears the current-session pointer and releases the lease
- **THEN** it SHALL wait (bounded timeout, then kill the agent process tree) for all child processes to exit and SHALL verify the pointer's current content equals the releasing session's id before clearing it, so a later session's pointer is never clobbered

### Requirement: Server-Side JWT Verification

The Skill API server SHALL verify the presented JWT with four checks before executing the skill handler: (1) the HMAC-SHA256 signature over `header.payload` matches the deployment secret (constant-time comparison); (2) the payload's `sub` equals the request's `sessionId`; (3) the payload's `channel` equals the session's registered channel ID; (4) the payload's `jti` equals the session's stored per-session caller token and `exp` has not passed.

#### Scenario: Valid JWT accepted
- **GIVEN** an active session `sess_abc_123` (channel `discord/123`, caller token `abc...`)
- **WHEN** a skill request presents the session's signed JWT with `sessionId: "sess_abc_123"`
- **THEN** all four checks pass and the server SHALL authenticate the request and execute the skill

#### Scenario: Cross-session impersonation rejected
- **GIVEN** the owning session is `sess_abc_123` (channel `discord/123`) and a prompt-injected agent calls the Skill API with another user's session id `sess_xyz_789` (channel `misskey/456`)
- **WHEN** the request presents the owning session's JWT (`sub=sess_abc_123`, `channel=discord/123`) with `sessionId: "sess_xyz_789"`
- **THEN** check (2) fails (`sub != sessionId`) and the server SHALL reject the request with HTTP 403

#### Scenario: Forged JWT rejected
- **GIVEN** a caller that knows the deployment secret signs a JWT with `sub` and `channel` matching the target session but an unknown `jti`
- **WHEN** the request is verified
- **THEN** check (4) fails (`jti` does not equal the target session's caller token) and the request SHALL be rejected with HTTP 403

#### Scenario: Expired JWT rejected
- **GIVEN** a presented JWT whose `exp` has passed
- **WHEN** the server verifies it
- **THEN** the request SHALL be rejected with HTTP 401

#### Scenario: Malformed or non-JWT Authorization rejected
- **GIVEN** a request whose Authorization header is missing, malformed, or is a legacy raw token
- **WHEN** the server authenticates it
- **THEN** the request SHALL be rejected with HTTP 403 and the skill handler SHALL NOT run

#### Scenario: Any failed check rejects and blocks execution
- **GIVEN** a presented JWT that fails any of the four verification checks
- **WHEN** the server authenticates it
- **THEN** the request SHALL be rejected (HTTP 403 for verification failures, HTTP 401 for expired or unknown session) and the skill handler SHALL NOT run

#### Scenario: Signature or channel mismatch rejected
- **GIVEN** a presented JWT whose HMAC signature does not match the deployment secret, or whose `channel` differs from the session's registered channel ID
- **WHEN** the server verifies it
- **THEN** the request SHALL be rejected with HTTP 403 and the skill handler SHALL NOT run

### Requirement: Pool Process Identity Hygiene

The shared pool process environment SHALL NOT export a per-session identity (`SESSION_ID`): a value frozen at spawn time would misattribute every later session served by that process.

#### Scenario: No frozen identity in the pool environment
- **GIVEN** the pool spawns a shared agent process while session `sess_A` holds the lease
- **WHEN** the process environment is inspected (including by the agent's own shell tools)
- **THEN** `SESSION_ID` SHALL NOT be present, while `SKILL_SHARED_PROCESS` and the absolute `SKILL_JWT_DIR` SHALL be

#### Scenario: Stale identity cannot be observed by later sessions
- **GIVEN** session `sess_B` runs on the process that was spawned for `sess_A`
- **WHEN** the agent runs `env` or any skill script during its turn
- **THEN** no environment value SHALL name `sess_A`; the pointer, `active.json`, and the prompt-rendered session id all name `sess_B`

#### Scenario: Current-session pointer is the sole identity source
- **GIVEN** a shared-process pool serving consecutive sessions
- **WHEN** a skill script resolves the owning session
- **THEN** the current-session pointer SHALL be the sole source of owning-session identity

#### Scenario: Unresolvable pointer raises structured error
- **GIVEN** the current-session pointer is unavailable or malformed (schema violation: non-string or empty session id) in shared-process mode
- **WHEN** a skill script resolves the owning session
- **THEN** the skill client library SHALL raise the stable `SKILL_SESSION_UNRESOLVED` structured error (code carried in the typed error's `code` field, so payload and identity-only scripts surface it identically) instead of falling back to any environment value

#### Scenario: Per-spawn mode keeps SESSION_ID authoritative
- **GIVEN** a per-spawn agent process
- **WHEN** a skill script resolves the owning session
- **THEN** `$SESSION_ID` SHALL remain the authoritative identity source

