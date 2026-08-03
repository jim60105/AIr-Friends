## MODIFIED Requirements

### Requirement: External Skill Auto-Installation

The system SHALL support automatic installation of external agent skills at startup.

#### Scenario: Skills Configured

- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** `installExternalSkills` SHALL run before `AgentCore` initialization
- **AND** each skill SHALL be installed via `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y`

#### Scenario: Sequential Installation

- **GIVEN** multiple external skills are configured
- **WHEN** installation runs
- **THEN** skills SHALL be installed sequentially to avoid filesystem conflicts in `~/.agents/skills/`

#### Scenario: Individual Failure Isolation

- **GIVEN** one external skill fails to install
- **WHEN** installation continues
- **THEN** the failure SHALL be logged but SHALL NOT block application startup
- **AND** remaining skills SHALL still be attempted

#### Scenario: Environment Variable Override

- **GIVEN** `AGENT_EXTERNAL_SKILLS` is set to a JSON string
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed as JSON and override `agent.externalSkills`

#### Scenario: Validation

- **GIVEN** an external skill entry is missing `repo` or `skill`
- **WHEN** config validation runs
- **THEN** the invalid entry SHALL be logged as a warning and filtered out
- **AND** `agent.externalSkills` SHALL default to an empty array when not configured
