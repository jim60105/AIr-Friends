## ADDED Requirements

### Requirement: Memory Recall Configuration

The configuration system SHALL support a `memory.recall` section with the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `fastRecallMaxResults` | integer ≥ 0 | `2` |
| `fastRecallMaxTokens` | integer ≥ 0 | `192` |
| `minRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondRecallScore` | number ≥ 0 | set by threshold calibration |
| `secondResultRatio` | number in [0, 1] | `0.65` |
| `deepRecallMaxTokens` | integer > 0 | `1024` |
| `deepMinRecallScore` | number ≥ 0 | `0` |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `memory.recall.fastRecallMaxResults` SHALL be `2` and `memory.recall.secondResultRatio` SHALL be `0.65`

#### Scenario: Partial override
- **GIVEN** `config.yaml` sets only `memory.recall.fastRecallMaxTokens: 128`
- **WHEN** the configuration is loaded
- **THEN** `fastRecallMaxTokens` SHALL be `128` and every other key SHALL keep its default

#### Scenario: Invalid ratio rejected
- **GIVEN** `config.yaml` sets `memory.recall.secondResultRatio: 1.5`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError`
