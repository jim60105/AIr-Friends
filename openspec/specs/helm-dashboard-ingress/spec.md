# Helm Dashboard Ingress

## Purpose

Provides optional Kubernetes Ingress resource configuration for the web dashboard, enabling external HTTP(S) access with TLS, custom annotations, and path routing.

## Requirements

### Requirement: Optional Ingress for dashboard
The Helm chart SHALL create an Ingress resource for the dashboard only when `dashboard.ingress.enabled` is `true`.

#### Scenario: Ingress enabled with hostname
- **WHEN** `dashboard.ingress.enabled` is `true` and `dashboard.ingress.hosts` contains an entry with `host: "dashboard.example.com"`
- **THEN** an Ingress resource is created routing `dashboard.example.com` to the dashboard Service

#### Scenario: Ingress disabled by default
- **WHEN** no `dashboard.ingress` overrides are provided
- **THEN** no Ingress resource is created

### Requirement: Ingress className support
The Ingress resource SHALL support `ingressClassName` via `dashboard.ingress.className`.

#### Scenario: Ingress class specified
- **WHEN** `dashboard.ingress.className` is set to `"nginx"`
- **THEN** the Ingress `spec.ingressClassName` SHALL be `"nginx"`

#### Scenario: No ingress class specified
- **WHEN** `dashboard.ingress.className` is not set
- **THEN** the Ingress SHALL not include `spec.ingressClassName` (cluster default is used)

### Requirement: Ingress TLS support
The Ingress resource SHALL support TLS configuration via `dashboard.ingress.tls`.

#### Scenario: TLS configured
- **WHEN** `dashboard.ingress.tls` contains an entry with `secretName: "dashboard-tls"` and `hosts: ["dashboard.example.com"]`
- **THEN** the Ingress `spec.tls` SHALL include that TLS block

#### Scenario: No TLS configured
- **WHEN** `dashboard.ingress.tls` is empty or not set
- **THEN** the Ingress SHALL not include a `spec.tls` section

### Requirement: Ingress annotations support
The Ingress resource SHALL support custom annotations via `dashboard.ingress.annotations`, including Traefik-specific annotations for entrypoint selection, TLS, and middleware reference.

#### Scenario: Custom annotations
- **WHEN** `dashboard.ingress.annotations` contains `cert-manager.io/cluster-issuer: letsencrypt`
- **THEN** the Ingress metadata SHALL include that annotation

#### Scenario: Traefik annotations
- **WHEN** `dashboard.ingress.annotations` contains `traefik.ingress.kubernetes.io/router.entrypoints: websecure` and `traefik.ingress.kubernetes.io/router.tls: "true"`
- **THEN** the Ingress metadata SHALL include those Traefik-specific annotations

### Requirement: Ingress path configuration
Each host entry in `dashboard.ingress.hosts` SHALL support configurable paths with `path` and `pathType`.

#### Scenario: Custom path
- **WHEN** a host entry has `paths: [{path: "/dashboard", pathType: "Prefix"}]`
- **THEN** the Ingress rule SHALL route `/dashboard` with pathType `Prefix` to the dashboard Service

#### Scenario: Default path
- **WHEN** a host entry has `paths: [{path: "/", pathType: "Prefix"}]`
- **THEN** the Ingress rule SHALL route `/` to the dashboard Service
