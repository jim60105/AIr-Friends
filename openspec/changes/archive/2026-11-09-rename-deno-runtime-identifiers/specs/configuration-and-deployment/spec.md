# Spec Delta

## MODIFIED Requirements

### Requirement: YAML Configuration Loading

The system SHALL load configuration from YAML files with a defined merge order: defaults → base config → environment-specific config → environment variables. The email signature SHALL remain literal decoded text and SHALL be excluded from generic environment expansion.

#### Scenario: Default Config Path

- **GIVEN** no custom config path is specified
- **WHEN** the application starts
- **THEN** the system SHALL attempt to load `./config.yaml`

#### Scenario: Environment-Specific Config Override

- **GIVEN** `ENV` is set to `"production"`
- **WHEN** the config is loaded
- **THEN** the system SHALL load `config.yaml` first, then deep-merge `config.production.yaml` on top if it exists
- **AND** the environment SHALL default to `"development"` when `ENV` is not set, and `DENO_ENV` SHALL be ignored

#### Scenario: Environment Variable Syntax in Config Values

- **GIVEN** a config value outside `platforms.email.signature` contains `${DISCORD_TOKEN}`
- **WHEN** the config is loaded
- **THEN** the `expandEnvVars` function SHALL replace `${VAR_NAME}` with the corresponding environment variable value
- **AND** unresolved references (env var not set) SHALL be replaced with empty string

#### Scenario: Literal signature excludes expansion

- **WHEN** `platforms.email.signature` contains the literal text `${DISCORD_TOKEN}` on one of several lines
- **THEN** that text and its line structure SHALL remain unchanged even if DISCORD_TOKEN is set
- **AND** changing the signature SHALL require a restart

### Requirement: Stock Image Declares the Shared Skill Install Root

The stock container deployment SHALL explicitly set the single skill-directory configuration to `/home/air/.agents/skills`, matching both built-in COPY and external publication for every agent type. Helm and deployment examples SHALL document this same installation contract. Repository development SHALL retain relative `skills` resolved against the deployment working directory. Ambient HOME SHALL NOT supply this configuration.

#### Scenario: Stock image requires no missing cwd skill tree

- **GIVEN** the stock image runs from `/app` without an operator skill-directory override
- **WHEN** its existing configuration is loaded
- **THEN** both agent types SHALL select `/home/air/.agents/skills` from that one configured value
- **AND** neither agent type SHALL select a separately packaged image tree

### Requirement: External Skill Auto-Installation Into the Single Skill Root

The system SHALL support automatic installation of external agent skills at startup into the single deployment-resolved skill root supplied by `agent.skillsDir`. External publication SHALL be independent of ambient daemon HOME. Built-ins, external skills and both agent types SHALL share that install root and that one resolved value. External installations SHALL NOT overwrite bundled skills or shared skill libraries and SHALL NOT acquire authority outside the explicit root.

#### Scenario: Skills Configured

- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** external installation and publication SHALL finish before AgentCore initialization and connector inventory construction
- **AND** the requested skill SHALL be installed through `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` in a private installer HOME and published into the single resolved skill root
- **AND** private installer staging SHALL be removed after success or failure and SHALL never be scanned as an approval root

#### Scenario: Sequential Installation

- **GIVEN** multiple external skills are configured
- **WHEN** installation runs
- **THEN** installation/publication SHALL occur sequentially within the explicit destination

#### Scenario: Individual Failure Isolation

- **GIVEN** one external skill fails to install or publish
- **WHEN** installation continues
- **THEN** the failure SHALL be logged but SHALL NOT block application startup
- **AND** remaining skills SHALL still be attempted
- **AND** an absent skill SHALL contribute no inferred executable grant

#### Scenario: Environment Variable Override

- **GIVEN** `AGENT_EXTERNAL_SKILLS` is set to a JSON string
- **WHEN** environment overrides are applied
- **THEN** the value SHALL be parsed as JSON and override `agent.externalSkills`

#### Scenario: Validation

- **GIVEN** an external skill entry is missing `repo` or `skill`
- **WHEN** config validation runs
- **THEN** the invalid entry SHALL be logged as a warning and filtered out
- **AND** `agent.externalSkills` SHALL default to an empty array when not configured

#### Scenario: Container and development destinations agree with the gate

- **GIVEN** a container's root is `/home/air/.agents/skills`, or a development deployment's configured root resolves to its repository `skills/`
- **WHEN** an external skill is successfully published
- **THEN** its final path SHALL be contained in that exact deployment's script-root inventory for either agent type
- **AND** changing daemon HOME SHALL change neither the publication destination nor the script grant

#### Scenario: External collision or link escape cannot replace built-ins

- **WHEN** an external skill names a bundled skill or `lib`, contains traversal, or publication encounters a linked/escaping source or destination
- **THEN** publication SHALL fail for that entry without changing the bundled content or any path outside the explicit root
- **AND** the failure SHALL NOT grant the external copy authority the validated publication did not establish

#### Scenario: External installs are shared by both agent types

- **GIVEN** external skills are configured while OMP is the default agent
- **WHEN** bootstrap publishes them into the resolved skill root
- **THEN** publication SHALL target that one root, which every agent type also resolves
- **AND** no second trusted skill root SHALL be selected, installed or auto-approved by this system
