## MODIFIED Requirements

### Requirement: Helm values include dashboard exposure configuration
The `values.yaml` SHALL include a `dashboard` section with `service` and `ingress` sub-keys for configuring dashboard Kubernetes resources, separate from the existing application-level `env.DASHBOARD_*` variables.

#### Scenario: Default values include dashboard section
- **WHEN** a user installs the chart with default values
- **THEN** `values.yaml` SHALL contain a `dashboard` section with `service.enabled: false` and `ingress.enabled: false`

#### Scenario: Dashboard service values
- **WHEN** a user sets `dashboard.service.enabled: true`
- **THEN** the dashboard Service resource SHALL be created with the type from `dashboard.service.type` (default: `ClusterIP`) and port from `dashboard.service.port` (default: `8090`)

#### Scenario: Dashboard ingress values
- **WHEN** a user sets `dashboard.ingress.enabled: true` with hosts configured
- **THEN** the dashboard Ingress resource SHALL be created with the specified hosts, paths, TLS, and annotations
