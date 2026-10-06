## ADDED Requirements

### Requirement: Deployment Agent Type Value Domain And Synchronization

The configuration system SHALL treat `agent.defaultAgentType` as a deployment-level selection with the accepted value domain `"opencode" | "omp"`. The existing `AGENT_DEFAULT_TYPE` environment override SHALL target the same field and the same domain. Validation SHALL run at configuration-load time against the final merged value: an omitted value remains `"opencode"`; `"opencode"` and `"omp"` are accepted unchanged; any other value — including one differing only by case or surrounding whitespace, a non-string, or an empty string — SHALL fail the load with `ConfigError` (`ErrorCode.CONFIG_INVALID`) naming `agent.defaultAgentType` and the valid values. Whenever the accepted domain of this field changes, `config.example.yaml`, `.env.example`, and `helm/values.yaml` SHALL ALL be updated within the same change: each SHALL describe `opencode` as the default and `omp` as the other valid value, with no document describing a narrower or wider domain than the loader accepts.

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
