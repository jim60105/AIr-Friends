# Helm Dashboard Service

## Purpose

Provides a dedicated Kubernetes Service resource for the web dashboard, enabling internal cluster routing to the dashboard container port with configurable service type and port settings.

## Requirements

### Requirement: Conditional dashboard Service creation
The Helm chart SHALL create a dedicated Kubernetes Service for the web dashboard only when `dashboard.service.enabled` is `true` in values.

#### Scenario: Dashboard Service enabled
- **WHEN** `dashboard.service.enabled` is `true`
- **THEN** a Service resource named `{fullname}-dashboard` is created with the configured type and port

#### Scenario: Dashboard Service disabled by default
- **WHEN** no `dashboard.service` overrides are provided
- **THEN** no dashboard Service resource is created

### Requirement: Dashboard Service targets correct container port
The dashboard Service SHALL route traffic to the container port specified by `env.DASHBOARD_PORT`, defaulting to `8090`.

#### Scenario: Custom dashboard port
- **WHEN** `env.DASHBOARD_PORT` is set to `9000`
- **THEN** the Service `targetPort` SHALL be `9000`

#### Scenario: Default dashboard port
- **WHEN** `env.DASHBOARD_PORT` is not set or empty
- **THEN** the Service `targetPort` SHALL be `8090`

### Requirement: Dashboard Service type configurability
The dashboard Service SHALL support configurable Service types via `dashboard.service.type`.

#### Scenario: ClusterIP type (default)
- **WHEN** `dashboard.service.type` is not set
- **THEN** the Service type SHALL be `ClusterIP`

#### Scenario: NodePort type
- **WHEN** `dashboard.service.type` is set to `NodePort`
- **THEN** the Service type SHALL be `NodePort`

### Requirement: Dashboard Service uses standard labels
The dashboard Service SHALL use the chart's standard labels and selector labels for consistency.

#### Scenario: Labels applied
- **WHEN** the dashboard Service is created
- **THEN** it SHALL include `air-friends.labels` and `air-friends.selectorLabels` and the `app: air-friends` selector
