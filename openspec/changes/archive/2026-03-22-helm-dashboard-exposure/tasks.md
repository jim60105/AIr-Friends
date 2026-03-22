## 1. Dashboard Service Template

- [x] 1.1 Create `helm/templates/dashboard-service.yaml` with conditional creation gated on `dashboard.service.enabled`, using `env.DASHBOARD_PORT` (default 8090) as `targetPort`, configurable `dashboard.service.type` (default ClusterIP) and `dashboard.service.port` (default 8090), standard chart labels and selector labels
- [x] 1.2 Verify the dashboard Service is not created when `dashboard.service.enabled` is `false` (default)

## 2. Dashboard Ingress Template

- [x] 2.1 Create `helm/templates/dashboard-ingress.yaml` with conditional creation gated on `dashboard.ingress.enabled`, supporting `ingressClassName`, `annotations`, `hosts` with `path`/`pathType`, and `tls` configuration
- [x] 2.2 Verify the Ingress is not created when `dashboard.ingress.enabled` is `false` (default)

## 3. Values Configuration

- [x] 3.1 Add `dashboard` section to `helm/values.yaml` with `service` sub-key (`enabled: false`, `type: ClusterIP`, `port: 8090`) and `ingress` sub-key (`enabled: false`, `className: ""`, `annotations: {}`, `hosts: []`, `tls: []`)
- [x] 3.2 Add commented usage examples in the `dashboard` section showing typical Traefik Ingress setup (entrypoints, TLS, middleware annotations) and a generic nginx-ingress alternative

## 4. Validation

- [x] 4.1 Run `helm template` with dashboard disabled to verify no dashboard resources are generated
- [x] 4.2 Run `helm template` with dashboard Service and Ingress enabled to verify correct resource generation
- [x] 4.3 Verify existing health check Service and ServiceMonitor are unaffected
