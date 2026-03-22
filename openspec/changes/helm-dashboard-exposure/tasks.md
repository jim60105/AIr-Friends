## 1. Dashboard Service Template

- [ ] 1.1 Create `helm/templates/dashboard-service.yaml` with conditional creation gated on `dashboard.service.enabled`, using `env.DASHBOARD_PORT` (default 8090) as `targetPort`, configurable `dashboard.service.type` (default ClusterIP) and `dashboard.service.port` (default 8090), standard chart labels and selector labels
- [ ] 1.2 Verify the dashboard Service is not created when `dashboard.service.enabled` is `false` (default)

## 2. Dashboard Ingress Template

- [ ] 2.1 Create `helm/templates/dashboard-ingress.yaml` with conditional creation gated on `dashboard.ingress.enabled`, supporting `ingressClassName`, `annotations`, `hosts` with `path`/`pathType`, and `tls` configuration
- [ ] 2.2 Verify the Ingress is not created when `dashboard.ingress.enabled` is `false` (default)

## 3. Values Configuration

- [ ] 3.1 Add `dashboard` section to `helm/values.yaml` with `service` sub-key (`enabled: false`, `type: ClusterIP`, `port: 8090`) and `ingress` sub-key (`enabled: false`, `className: ""`, `annotations: {}`, `hosts: []`, `tls: []`)
- [ ] 3.2 Add commented usage examples in the `dashboard` section showing typical Traefik Ingress setup (entrypoints, TLS, middleware annotations) and a generic nginx-ingress alternative

## 4. Validation

- [ ] 4.1 Run `helm template` with dashboard disabled to verify no dashboard resources are generated
- [ ] 4.2 Run `helm template` with dashboard Service and Ingress enabled to verify correct resource generation
- [ ] 4.3 Verify existing health check Service and ServiceMonitor are unaffected
