## ADDED Requirements

### Requirement: Self-Research Completion Verification Configuration

The configuration system SHALL support `selfResearch.verifyCompletion`, a boolean field (default `true`) that controls whether self-research sessions verify research-note production and run the corrective retry. The field SHALL be overridable via the `SELF_RESEARCH_VERIFY_COMPLETION` environment variable (`"true"` / `"false"`, matching the `ENV_MAPPINGS` pattern), and SHALL be documented in `config.example.yaml`, `.env.example`, and `helm/values.yaml` per project convention.

#### Scenario: Default value applied

- **GIVEN** the `selfResearch.verifyCompletion` field is not present in the config file
- **WHEN** configuration validation runs
- **THEN** `selfResearch.verifyCompletion` SHALL default to `true`

#### Scenario: Boolean environment variable override

- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION` is set to `"false"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `selfResearch.verifyCompletion` SHALL be set to `false`

#### Scenario: Invalid override falls back to default

- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION` is set to a non-boolean value
- **WHEN** `applyEnvOverrides` runs
- **THEN** the override SHALL be ignored with a warning and `selfResearch.verifyCompletion` SHALL keep its default `true`
