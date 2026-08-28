# Delta: jwt-skill-auth

## ADDED Requirements

### Requirement: Pool Process Identity Hygiene

The shared pool process environment SHALL NOT export a per-session identity (`SESSION_ID`), because a value frozen at spawn time would misattribute every later session served by that process. In shared-process mode the current-session pointer is the sole source of owning-session identity; the skill client library SHALL raise a stable `SKILL_SESSION_UNRESOLVED` structured error when the pointer is unavailable instead of falling back to any environment value. Per-spawn mode SHALL keep `$SESSION_ID` as its authoritative identity source.

#### Scenario: No frozen identity in the pool environment
- **GIVEN** the pool spawns a shared agent process while session `sess_A` holds the lease
- **WHEN** the process environment is inspected (including by the agent's own shell tools)
- **THEN** `SESSION_ID` SHALL NOT be present, while `SKILL_SHARED_PROCESS` and the absolute `SKILL_JWT_DIR` SHALL be

#### Scenario: Stale identity cannot be observed by later sessions
- **GIVEN** session `sess_B` runs on the process that was spawned for `sess_A`
- **WHEN** the agent runs `env` or any skill script during its turn
- **THEN** no environment value SHALL name `sess_A`; the pointer, `active.json`, and the prompt-rendered session id all name `sess_B`
