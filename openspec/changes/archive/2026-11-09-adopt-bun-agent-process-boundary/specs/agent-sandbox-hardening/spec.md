# Spec Delta

## MODIFIED Requirements

### Requirement: Agent Subprocess Environment Isolation

The system SHALL spawn the ACP agent subprocess with a cleared parent environment so that it receives ONLY the explicitly-built allowlisted environment variables and inherits NO variables from the parent bot process; the spawn boundary SHALL pass the built environment as the complete child environment and SHALL NOT merge the parent environment into it.

#### Scenario: Parent secret not inherited by agent

- **GIVEN** the parent bot process has an environment variable (e.g. `DISCORD_TOKEN`) that is NOT part of the agent's built environment
- **WHEN** the agent subprocess is spawned
- **THEN** that variable SHALL NOT be present in the agent subprocess's actual environment

#### Scenario: Allowlisted variables still provided

- **GIVEN** the agent configuration builds an environment containing `PATH`, `HOME`, `TMPDIR`, `SESSION_ID`, `AGENT_WORKSPACE`, and `SKILL_JWT_DIR` (no `SKILL_API_SECRET` — the HMAC key stays in the bot process)
- **WHEN** the agent subprocess is spawned through the spawn boundary
- **THEN** the agent subprocess environment SHALL contain exactly those built variables (plus agent-type-specific variables) and nothing inherited from the parent

#### Scenario: Deployment secret kept out of the agent environment

- **GIVEN** the bot process holds the deployment `SKILL_API_SECRET` (it is the JWT issuer and Skill API verifier)
- **WHEN** the agent configuration builds the subprocess environment
- **THEN** `SKILL_API_SECRET` SHALL NOT be placed in the agent environment
- **AND** in shared-process mode the agent receives only the per-session JWT file via `SKILL_JWT_DIR`, a minimal session capability
