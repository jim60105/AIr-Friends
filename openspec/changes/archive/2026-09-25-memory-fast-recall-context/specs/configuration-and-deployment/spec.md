## ADDED Requirements

### Requirement: Fast Recall Toggle Configuration

The `memory.recall` configuration section SHALL support `fastRecallEnabled` (boolean, default `true`). When it is `false`, no Fast Recall search SHALL run and no Fast Recall section SHALL be rendered. `config.example.yaml` SHALL document the key.

#### Scenario: Enabled by default
- **GIVEN** `config.yaml` has no `memory.recall.fastRecallEnabled`
- **WHEN** the configuration is loaded
- **THEN** `memory.recall.fastRecallEnabled` SHALL be `true`

#### Scenario: Non-boolean rejected
- **GIVEN** `config.yaml` sets `memory.recall.fastRecallEnabled: "yes"`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`
