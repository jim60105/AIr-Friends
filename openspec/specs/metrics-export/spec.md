# Metrics Export

## Purpose

Expose operational metrics via a Prometheus-compatible endpoint for monitoring health, performance, and usage of the AIr-Friends bot.

## Requirements

### Requirement: Prometheus-Compatible Endpoint

The system SHALL expose a Prometheus-compatible metrics endpoint on the Health Check Server. The endpoint SHALL share the Health Check Server port — no additional port SHALL be required. The endpoint path SHALL default to `"/metrics"` and SHALL be configurable via `metrics.path`.

#### Scenario: Metrics endpoint returns Prometheus format

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a GET request is sent to the configured metrics path
- **THEN** the response SHALL be HTTP 200 with `Content-Type` from `metricsRegistry.contentType`
- **AND** the body SHALL contain Prometheus exposition format text

#### Scenario: Metrics endpoint returns 404 when disabled

- **GIVEN** `metrics.enabled` is `false` (default)
- **WHEN** a GET request is sent to `"/metrics"`
- **THEN** the response SHALL be HTTP 404

#### Scenario: Custom metrics path is respected

- **GIVEN** `metrics.path` is set to `"/custom-metrics"` and `metrics.enabled` is `true`
- **WHEN** a GET request is sent to `"/custom-metrics"`
- **THEN** the response SHALL be HTTP 200
- **AND** a GET request to `"/metrics"` SHALL return HTTP 404

#### Scenario: Health endpoint unaffected by metrics

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a GET request is sent to `"/health"`
- **THEN** the response SHALL be HTTP 200 with JSON health status

### Requirement: Dedicated Registry

The system SHALL use a `prom-client` dedicated `Registry` instance (not the global default) for test isolation. The registry SHALL have the default label `app: "air-friends"`.

#### Scenario: Metrics use dedicated registry

- **GIVEN** the metrics module is initialized
- **WHEN** metrics are registered
- **THEN** all metrics SHALL be registered on the dedicated `metricsRegistry`, not the global default registry

### Requirement: Metric Definitions

The system SHALL expose the following metrics with the specified types and labels:

| Metric Name | Type | Labels |
|---|---|---|
| `airfriends_sessions_total` | Counter | `platform`, `type`, `status` |
| `airfriends_session_duration_seconds` | Histogram | `platform`, `type`, `status` |
| `airfriends_active_sessions` | Gauge | — |
| `airfriends_messages_received_total` | Counter | `platform` |
| `airfriends_replies_sent_total` | Counter | `platform` |
| `airfriends_memory_operations_total` | Counter | `operation`, `visibility` |
| `airfriends_skill_api_calls_total` | Counter | `skill`, `status` |
| `airfriends_rate_limit_rejections_total` | Counter | `platform` |
| `airfriends_audit_entries_total` | Counter | `phase` |
| `airfriends_skill_readiness` | Gauge | `skill` |
| `airfriends_files_sent_total` | Counter | `platform` |
| `airfriends_reminders_set_total` | Counter | `platform` |
| `airfriends_reminders_delivered_total` | Counter | `platform`, `status` |
| `airfriends_reminders_cancelled_total` | Counter | `platform` |
| `airfriends_idle_timeout_total` | Counter | `platform`, `outcome` |

#### Scenario: Session counter increments on success

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a message session completes successfully on Discord
- **THEN** `airfriends_sessions_total{platform="discord",type="message",status="success"}` SHALL be incremented

#### Scenario: Session duration recorded in histogram

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a session completes in 5 seconds
- **THEN** `airfriends_session_duration_seconds` SHALL record the observation in the appropriate bucket

#### Scenario: Active sessions gauge reflects concurrent sessions

- **GIVEN** 2 sessions are actively running
- **WHEN** the gauge is queried
- **THEN** `airfriends_active_sessions` SHALL show `2`
- **AND** when both sessions complete, it SHALL show `0`

### Requirement: Histogram Buckets

The `airfriends_session_duration_seconds` histogram SHALL use the buckets: `[1, 5, 10, 30, 60, 120, 300, 600]`.

#### Scenario: Duration histogram uses configured buckets

- **GIVEN** the metrics module is initialized
- **WHEN** `airfriends_session_duration_seconds` is created
- **THEN** the histogram SHALL use buckets `[1, 5, 10, 30, 60, 120, 300, 600]`

### Requirement: In-Memory O(1) Operations

All metric operations (increment, observe, set) SHALL be pure in-memory O(1) operations with no I/O overhead. The metrics endpoint SHALL never expose user content or tokens — only aggregate numerical data.

#### Scenario: No user content in metrics output

- **GIVEN** sessions have been processed with user messages
- **WHEN** the `/metrics` endpoint is queried
- **THEN** the response SHALL contain only metric names, labels, and numerical values — no user content

### Requirement: Error Resilience

Metrics endpoint errors SHALL NOT crash the bot. When the metrics registry encounters an internal error, the endpoint SHALL return HTTP 500 and the bot SHALL continue processing messages normally.

#### Scenario: Metrics error returns 500

- **GIVEN** `metrics.enabled` is `true` and the registry encounters an error
- **WHEN** the `/metrics` endpoint is requested
- **THEN** the response SHALL be HTTP 500
- **AND** the bot SHALL continue operating normally

### Requirement: Environment Variable Overrides

`METRICS_ENABLED` SHALL override `metrics.enabled`. `METRICS_PATH` SHALL override `metrics.path`.

#### Scenario: Environment variables override config

- **GIVEN** `METRICS_ENABLED` is `"true"` and `METRICS_PATH` is `"/prom"`
- **WHEN** configuration is loaded
- **THEN** `metrics.enabled` SHALL be `true` and `metrics.path` SHALL be `"/prom"`
