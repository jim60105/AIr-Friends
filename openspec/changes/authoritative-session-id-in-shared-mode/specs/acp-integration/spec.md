# Delta: acp-integration

## MODIFIED Requirements

### Requirement: Agent Common Environment

All agent subprocesses SHALL receive common environment variables regardless of agent type.

#### Scenario: Common env vars
- **GIVEN** any agent type
- **WHEN** the subprocess is spawned
- **THEN** the environment SHALL include `TMPDIR` (set to `{workingDir}/tmp`), `AGENT_WORKSPACE` (if provided), `PATH`, `HOME`, `DENO_DIR`, `LANG`, `LC_ALL`, and `USER`

#### Scenario: SESSION_ID env var provided to agent (per-spawn mode)
- **GIVEN** a per-spawn session has been created via ACP `createSession()`
- **WHEN** the agent subprocess spawns child processes (e.g., skill scripts)
- **THEN** the `SESSION_ID` environment variable SHALL be set to the active session ID so that skill scripts can resolve `$SESSION_ID` in their shell environment

#### Scenario: Shared-process environment omits SESSION_ID
- **GIVEN** a shared-process (pool) agent process serving any session
- **WHEN** the agent spawns child processes (skill scripts) or inspects its environment
- **THEN** `SESSION_ID` SHALL NOT be present in the environment (a spawn-time frozen value would misattribute every later session; the current-session pointer is the sole identity source in this mode)

#### Scenario: No per-session credential in the agent environment
- **GIVEN** any agent subprocess (per-spawn or shared-process)
- **WHEN** its environment is inspected
- **THEN** it SHALL NOT contain the deployment `SKILL_API_SECRET` or any raw per-session caller-token environment value (e.g. a legacy `SKILL_API_TOKEN`); skill scripts authenticate with the per-session JWT file addressed by `SKILL_JWT_DIR`
