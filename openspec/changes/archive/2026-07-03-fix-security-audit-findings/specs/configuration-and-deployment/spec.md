## MODIFIED Requirements

### Requirement: Dashboard Configuration Section

The configuration system SHALL support a `dashboard` config section with `enabled` (boolean, default `false`), `port` (number, default `8090`), `host` (string, default `127.0.0.1`), `passphrase` (string, required when enabled, minimum 16 characters), `behindHttpsProxy` (boolean, default `false`), and `trustedProxies` (string array of real connection addresses whose `X-Forwarded-For` header is trusted for rate-limit keying, default empty). Each new field SHALL have a corresponding environment variable override.

#### Scenario: Dashboard Config in YAML

- **GIVEN** `config.yaml` contains:
  ```yaml
  dashboard:
    enabled: true
    port: 8090
    host: "127.0.0.1"
    passphrase: "a-sufficiently-long-secret"
    behindHttpsProxy: false
    trustedProxies: []
  ```
- **WHEN** the configuration is loaded
- **THEN** `dashboard.enabled` SHALL be `true`
- **AND** `dashboard.port` SHALL be `8090`
- **AND** `dashboard.host` SHALL be `"127.0.0.1"`
- **AND** `dashboard.behindHttpsProxy` SHALL be `false`

#### Scenario: Host defaults to localhost

- **GIVEN** `config.yaml` sets `dashboard.enabled: true` without a `host` field
- **WHEN** the configuration is loaded
- **THEN** `dashboard.host` SHALL default to `"127.0.0.1"`

#### Scenario: Weak passphrase rejected when enabled

- **GIVEN** `config.yaml` sets `dashboard.enabled: true` and `dashboard.passphrase: "short"`
- **WHEN** the configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError` indicating the passphrase does not meet the minimum strength

#### Scenario: Environment variable overrides for new dashboard fields

- **GIVEN** environment variables `DASHBOARD_HOST`, `DASHBOARD_BEHIND_HTTPS_PROXY`, and `DASHBOARD_TRUSTED_PROXIES` are set
- **WHEN** the configuration is loaded
- **THEN** they SHALL override `dashboard.host`, `dashboard.behindHttpsProxy`, and `dashboard.trustedProxies` respectively

#### Scenario: Config Example and Env Example Updated

- **GIVEN** the project documentation files
- **WHEN** `config.example.yaml`, `.env.example`, and `helm/values.yaml` are examined
- **THEN** they SHALL include the `dashboard` section with `enabled`, `port`, `host`, `passphrase`, `behindHttpsProxy`, and `trustedProxies` fields
