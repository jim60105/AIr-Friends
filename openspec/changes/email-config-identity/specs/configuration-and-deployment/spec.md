# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration Validation

The system SHALL validate the final merged configuration and reject invalid configs.

#### Scenario: Required Fields

- **GIVEN** the merged configuration is assembled
- **WHEN** `validateConfig` runs
- **THEN** it SHALL verify the presence of `agent.model`, `agent.systemPromptPath`, `workspace.repoPath`, and `workspace.workspacesDir`, plus credentials only for each enabled platform
- **AND** missing required fields SHALL throw `ConfigError` with `ErrorCode.CONFIG_MISSING_FIELD`

#### Scenario: At Least One Platform Enabled

- **GIVEN** no platform has `enabled: true`
- **WHEN** validation runs
- **THEN** a `ConfigError` with `ErrorCode.CONFIG_INVALID` SHALL be thrown with message "At least one platform must be enabled"

#### Scenario: Reply Policy Validation

- **GIVEN** `replyPolicy` is set to an invalid value
- **WHEN** validation runs
- **THEN** a `ConfigError` SHALL be thrown listing valid values: `"all"`, `"public"`, `"channels"`

#### Scenario: Channel ID Format Validation

- **GIVEN** a channel entry has an invalid ID format
- **WHEN** `loadChannels` processes it
- **THEN** the invalid entry SHALL be logged as a warning and skipped
- **AND** valid formats SHALL match supported `{platform}/account/{id}`, supported non-email `{platform}/channel/{id}`, or `misskey/timeline/self`; email account address values SHALL be canonicalized into safe user identifiers

#### Scenario: Spontaneous Post Interval Validation

- **GIVEN** `spontaneousPost.minIntervalMs` exceeds `maxIntervalMs`
- **WHEN** validation runs
- **THEN** the values SHALL be swapped
- **AND** `minIntervalMs` below 60000 SHALL be clamped to 60000

#### Scenario: Default Values Applied

- **GIVEN** optional config sections are missing
- **WHEN** validation runs
- **THEN** defaults SHALL be applied for: `memory` (recentMessageLimit=20, workingTierLimit=20), `logging` (level="INFO"), `health` (enabled=false, port=8080), `skillApi` (enabled=true, port=3001, host="127.0.0.1"), `replyPolicy` ("channels"), `rateLimit`, `gitBackup`, `sandbox`, `idleTimeout`, `dashboard` (enabled=false, port=8090, passphrase=""), and others

#### Scenario: Dashboard Config Defaults

- **GIVEN** the `dashboard` config section is not present in the config file
- **WHEN** validation runs
- **THEN** `dashboard.enabled` SHALL default to `false`
- **AND** `dashboard.port` SHALL default to `8090`
- **AND** `dashboard.passphrase` SHALL default to `""`

#### Scenario: Email-only configuration
- **WHEN** email is enabled with valid mail settings and Discord is disabled
- **THEN** no Discord token SHALL be required
- **AND** email activation SHALL remain subject to the production readiness guard until the activation change is applied
