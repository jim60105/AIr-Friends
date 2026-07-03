## MODIFIED Requirements

### Requirement: Dashboard HTTP Server Lifecycle

The system SHALL provide a web dashboard HTTP server on a configurable port (default 8090) and a configurable bind host (`dashboard.host`, default `127.0.0.1`). The server SHALL only start when `dashboard.enabled` is `true` and `dashboard.passphrase` is non-empty. Binding to all interfaces (`0.0.0.0`) SHALL require the operator to explicitly set `dashboard.host` to `0.0.0.0`.

#### Scenario: Server Starts on Configured Port

- **GIVEN** `dashboard.enabled` is `true`, `dashboard.passphrase` is a sufficiently strong value, and `dashboard.port` is `8090`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL listen on port `8090`

#### Scenario: Server Binds Localhost by Default

- **GIVEN** `dashboard.enabled` is `true` and `dashboard.host` is not configured
- **WHEN** the dashboard server starts
- **THEN** it SHALL bind to `127.0.0.1` (not all interfaces)

#### Scenario: Server Binds All Interfaces Only When Explicitly Configured

- **GIVEN** `dashboard.host` is explicitly set to `0.0.0.0`
- **WHEN** the dashboard server starts
- **THEN** it SHALL bind to `0.0.0.0`

#### Scenario: Server Does Not Start When Disabled

- **GIVEN** `dashboard.enabled` is `false`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL NOT be started

#### Scenario: Server Does Not Start When Passphrase Empty

- **GIVEN** `dashboard.enabled` is `true` and `dashboard.passphrase` is `""`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL NOT be started
- **AND** a warning SHALL be logged indicating the passphrase is required

#### Scenario: Server Stops on Graceful Shutdown

- **GIVEN** the dashboard server is running
- **WHEN** the application receives a shutdown signal
- **THEN** the dashboard server SHALL stop accepting new connections and close gracefully
