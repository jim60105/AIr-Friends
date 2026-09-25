## ADDED Requirements

### Requirement: Note Recall Configuration

The `memory.recall` configuration section SHALL also support the following keys. Every key SHALL be optional and fall back to its default.

| Key | Type | Default |
|---|---|---|
| `fastRecallNoteMaxResults` | integer ≥ 0 | `2` |
| `fastRecallNoteMaxTokens` | integer ≥ 0 | `256` |
| `noteMinRecallScore` | number ≥ 0 | set by note threshold calibration |
| `secondNoteRecallScore` | number ≥ 0 | set by note threshold calibration |

Values outside their allowed range SHALL be rejected at load time with a `ConfigError`. `config.example.yaml` SHALL document every key with its default.

#### Scenario: Note defaults applied
- **GIVEN** `config.yaml` has no `memory.recall` section
- **WHEN** the configuration is loaded
- **THEN** `fastRecallNoteMaxResults` SHALL be `2` and `fastRecallNoteMaxTokens` SHALL be `256`

#### Scenario: Disabling notes in Fast Recall
- **GIVEN** `config.yaml` sets `memory.recall.fastRecallNoteMaxResults: 0`
- **WHEN** Fast Recall runs
- **THEN** no note SHALL be selected
