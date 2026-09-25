## ADDED Requirements

### Requirement: Removed Memory Search Config Fields

`memory.searchLimit` and `memory.maxChars` SHALL NOT exist in the configuration model, the loader defaults, `MemoryStoreConfig`, `ContextAssemblyConfig`, or the startup log. Retrieval budgets are owned solely by `memory.recall` (injection) and the `memory-search` skill's per-call `limit` parameter (search results). Existing configuration files that still set `memory.searchLimit` or `memory.maxChars` SHALL load without error: the keys are merged and ignored, with no validation, warning, or environment-variable mapping.

#### Scenario: Fields absent from loaded config

- **GIVEN** a `config.yaml` that does not set `memory.searchLimit` or `memory.maxChars`
- **WHEN** the configuration is loaded
- **THEN** the `memory` section SHALL NOT contain `searchLimit` or `maxChars`: the fields are absent from the config model and the loader injects no defaults for them
- **AND** when a legacy file does set them, the merged values SHALL be inert and never read (see "Legacy keys ignored")

#### Scenario: Legacy keys ignored

- **GIVEN** a `config.yaml` that sets `memory.searchLimit: 5` and `memory.maxChars: 1000`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL succeed with no error and no startup log field derived from those values
- **AND** retrieval budgets SHALL be unaffected by them

#### Scenario: Surviving knobs unchanged

- **GIVEN** `memory.workingTierLimit`, a `memory.recall` budget, and a `memory-search` call with an explicit `limit`
- **WHEN** the configuration is loaded and a search runs
- **THEN** each SHALL behave exactly as specified before this removal

## MODIFIED Requirements

### Requirement: Configuration Validation

The system SHALL validate the final merged configuration and reject invalid configs.

#### Scenario: Required Fields

- **GIVEN** the merged configuration is assembled
- **WHEN** `validateConfig` runs
- **THEN** it SHALL verify the presence of `platforms.discord.token`, `agent.model`, `agent.systemPromptPath`, `workspace.repoPath`, and `workspace.workspacesDir`
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
- **AND** valid formats SHALL match `{platform}/account/{id}`, `{platform}/channel/{id}`, or `misskey/timeline/self`

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
