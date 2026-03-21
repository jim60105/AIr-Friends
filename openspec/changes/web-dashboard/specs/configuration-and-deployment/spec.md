# Configuration and Deployment (Delta)

## Purpose

Extends the configuration and deployment capability with dashboard configuration, environment variable overrides, Helm chart updates, and container port exposure.

## MODIFIED Requirements

### Requirement: Environment Variable Overrides via ENV_MAPPINGS

The system SHALL support environment variable overrides for configuration fields as defined in the `ENV_MAPPINGS` constant in `src/utils/env.ts`.

#### Scenario: String Override

- **GIVEN** `DISCORD_TOKEN` environment variable is set to `"my-token"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `platforms.discord.token` SHALL be set to `"my-token"`

#### Scenario: Boolean Conversion

- **GIVEN** `DISCORD_ENABLED` is set to `"true"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be converted to boolean `true`

#### Scenario: Integer Conversion

- **GIVEN** `HEALTH_PORT` is set to `"9090"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be converted to integer `9090`

#### Scenario: Comma-Separated Array

- **GIVEN** `AGENT_SANDBOX_ALLOWED_ENV_VARS` is set to `"FOO,BAR,BAZ"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed into `["FOO", "BAR", "BAZ"]`

#### Scenario: JSON String Override

- **GIVEN** `CHANNELS` is set to a valid JSON array string
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be parsed as JSON and set as the config value
- **AND** invalid JSON SHALL be silently skipped

#### Scenario: Reply Policy Backward Compatibility

- **GIVEN** `REPLY_POLICY` or `REPLY_TO` is set to `"whitelist"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** the value SHALL be mapped to `"channels"`

#### Scenario: Dashboard Enabled Override

- **GIVEN** `DASHBOARD_ENABLED` is set to `"true"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.enabled` SHALL be set to boolean `true`

#### Scenario: Dashboard Port Override

- **GIVEN** `DASHBOARD_PORT` is set to `"9000"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.port` SHALL be set to integer `9000`

#### Scenario: Dashboard Passphrase Override

- **GIVEN** `DASHBOARD_PASSPHRASE` is set to `"my-secret"`
- **WHEN** `applyEnvOverrides` runs
- **THEN** `dashboard.passphrase` SHALL be set to `"my-secret"`

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
- **THEN** defaults SHALL be applied for: `memory` (searchLimit=10, maxChars=2000, recentMessageLimit=20), `logging` (level="INFO"), `health` (enabled=false, port=8080), `skillApi` (enabled=true, port=3001, host="127.0.0.1"), `replyPolicy` ("channels"), `rateLimit`, `gitBackup`, `sandbox`, `idleTimeout`, `dashboard` (enabled=false, port=8090, passphrase=""), and others

#### Scenario: Dashboard Config Defaults

- **GIVEN** the `dashboard` config section is not present in the config file
- **WHEN** validation runs
- **THEN** `dashboard.enabled` SHALL default to `false`
- **AND** `dashboard.port` SHALL default to `8090`
- **AND** `dashboard.passphrase` SHALL default to `""`

## ADDED Requirements

### Requirement: Dashboard Configuration Section

The configuration system SHALL support a `dashboard` config section with `enabled` (boolean, default `false`), `port` (number, default `8090`), and `passphrase` (string, required when enabled).

#### Scenario: Dashboard Config in YAML

- **GIVEN** `config.yaml` contains:
  ```yaml
  dashboard:
    enabled: true
    port: 8090
    passphrase: "my-secret"
  ```
- **WHEN** the configuration is loaded
- **THEN** `dashboard.enabled` SHALL be `true`
- **AND** `dashboard.port` SHALL be `8090`
- **AND** `dashboard.passphrase` SHALL be `"my-secret"`

#### Scenario: Config Example and Env Example Updated

- **GIVEN** the project documentation files
- **WHEN** `config.example.yaml` and `.env.example` are examined
- **THEN** they SHALL include the `dashboard` section with `enabled`, `port`, and `passphrase` fields

### Requirement: Dashboard Passphrase as Kubernetes Secret

The Helm chart SHALL store `DASHBOARD_PASSPHRASE` as a Kubernetes Secret and reference it in the deployment environment variables.

#### Scenario: Helm Chart Secret

- **GIVEN** the Helm chart templates
- **WHEN** the deployment is rendered with `dashboard.passphrase` set
- **THEN** `DASHBOARD_PASSPHRASE` SHALL be stored in a Kubernetes Secret resource
- **AND** the deployment SHALL reference the Secret via `secretKeyRef` in its environment variables

#### Scenario: Helm Values Updated

- **GIVEN** the `helm/values.yaml` file
- **WHEN** the values are examined
- **THEN** it SHALL include `DASHBOARD_ENABLED`, `DASHBOARD_PORT`, and `DASHBOARD_PASSPHRASE` entries under the `env:` section

### Requirement: Container Dashboard Port Exposure

The Containerfile SHALL expose the dashboard port.

#### Scenario: Dashboard Port Exposed

- **GIVEN** the Containerfile is built
- **WHEN** the final image is produced
- **THEN** the dashboard port (default `8090`) SHALL be exposed via an `EXPOSE` directive
