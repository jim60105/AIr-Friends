# Spec Delta

## MODIFIED Requirements

### Requirement: Health Check Server

The system SHALL provide HTTP health check endpoints when `health.enabled` is `true`.

#### Scenario: Health Endpoint

- **GIVEN** the health check server is running on port `health.port`
- **WHEN** `GET /health` or `GET /healthz` is requested
- **THEN** the response SHALL be JSON with: `status` ("healthy"|"degraded"|"unhealthy"), `timestamp`, `uptime`, and `checks` array
- **AND** HTTP 200 SHALL be returned for "healthy" or "degraded"
- **AND** HTTP 503 SHALL be returned for "unhealthy"

#### Scenario: Readiness Endpoint

- **GIVEN** the health check server is running
- **WHEN** `GET /ready` or `GET /readyz` is requested
- **THEN** the response SHALL check: platform connections, skill script existence, required binaries (rg, bun, git), Skill API connectivity (when `skillApi.enabled`), and workspace directory writability
- **AND** HTTP 200 SHALL be returned only when all checks pass
- **AND** readiness results SHALL be cached for 30 seconds to avoid excessive subprocess spawning

#### Scenario: Prometheus Metrics Endpoint

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** `GET {metrics.path}` (default "/metrics") is requested
- **THEN** the response SHALL return Prometheus exposition format text
- **AND** the metrics endpoint SHALL share the same port as health check

#### Scenario: Platform Health Checks

- **GIVEN** a platform adapter reports connection state
- **WHEN** health is checked
- **THEN** "connected" state SHALL map to "pass", "reconnecting" to "warn", and other states to "fail"
