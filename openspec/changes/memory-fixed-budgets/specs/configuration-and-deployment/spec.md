## ADDED Requirements

### Requirement: Fixed Memory Budget Configuration

The `memory.recall` configuration section SHALL also support the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `coreMaxTokens` | integer ≥ 0 | `512` |
| `workingMaxItems` | integer ≥ 0 | `4` |
| `workingMaxTokens` | integer ≥ 0 | `384` |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `memory.workingTierLimit` SHALL keep its storage meaning and SHALL NOT affect injection. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Budget defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `coreMaxTokens` SHALL be `512`, `workingMaxItems` `4` and `workingMaxTokens` `384`

#### Scenario: Negative budget rejected
- **GIVEN** `config.yaml` sets `memory.recall.coreMaxTokens: -1`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`
