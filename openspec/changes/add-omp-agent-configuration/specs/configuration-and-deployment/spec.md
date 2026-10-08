## ADDED Requirements

### Requirement: Deployment Agent Type Value Domain And Synchronization

The configuration system SHALL treat `agent.defaultAgentType` as a deployment-level selection with the accepted value domain `"opencode" | "omp"`; the `AGENT_DEFAULT_TYPE` environment override SHALL target the same field and domain. Validation SHALL run at configuration-load time against the final merged value, accepting an omitted value as `"opencode"` and rejecting any other value (including a non-string) with `ConfigError` (`ErrorCode.CONFIG_INVALID`).

#### Scenario: Omitted type keeps the OpenCode default
- **GIVEN** neither the config file nor the environment sets `agent.defaultAgentType`
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and the effective default agent type SHALL be `"opencode"`

#### Scenario: OMP selected in the config file
- **GIVEN** `config.yaml` sets `agent.defaultAgentType: "omp"`
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and `agent.defaultAgentType` SHALL be `"omp"`

#### Scenario: OMP selected via environment override
- **GIVEN** `AGENT_DEFAULT_TYPE=omp` in the environment and no config-file value
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed and `agent.defaultAgentType` SHALL be `"omp"`

#### Scenario: Unknown type fails the load through either source
- **GIVEN** `agent.defaultAgentType` resolves to `"pi"`, `"OpenCode"`, `" omp "`, or `""` from the config file, the environment override, or an unresolved `${AGENT_DEFAULT_TYPE}` expansion
- **WHEN** configuration is loaded
- **THEN** loading SHALL fail with `ConfigError` reporting `agent.defaultAgentType` and the valid values `opencode` and `omp`
- **AND** the application SHALL NOT start with an unrecognized agent type deferred to first spawn

#### Scenario: All three configuration documents stay synchronized
- **GIVEN** the repository documentation files after the agent-type domain changed
- **WHEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` are examined
- **THEN** each SHALL document `AGENT_DEFAULT_TYPE`/`defaultAgentType` with `opencode` as the default and `omp` as a valid value
- **AND** none SHALL claim the field accepts only `opencode`

#### Scenario: Domain change updates all three documents in the same change
- **GIVEN** the accepted domain of `agent.defaultAgentType` changes
- **WHEN** the change is implemented
- **THEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` SHALL ALL be updated within the same change
- **AND** no document SHALL describe a narrower or wider domain than the loader accepts
