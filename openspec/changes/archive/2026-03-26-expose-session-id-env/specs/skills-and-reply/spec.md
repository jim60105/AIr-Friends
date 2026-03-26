## MODIFIED Requirements

### Requirement: Shell-Based Skill Architecture

Skills SHALL be implemented as Deno TypeScript scripts located in `skills/{skill-name}/scripts/` directories. Each skill SHALL have a `SKILL.md` file describing its usage for the agent. External ACP Agents SHALL execute these scripts with a `--session-id` parameter. Scripts SHALL use the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP.

#### Scenario: Skill receives session ID from environment variable
- **GIVEN** a skill script is executed by the agent
- **WHEN** the agent builds the bash command
- **THEN** the agent SHALL use `--session-id "$SESSION_ID"` where `$SESSION_ID` is resolved from the environment variable set in the agent subprocess
- **AND** the agent SHALL NOT need to know the actual session ID value
