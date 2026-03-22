## Why

The Helm chart currently only exposes the health check port (8080) via a single Service. The web dashboard (running on a separate port, default 8090) has no Service or Ingress defined, making it impossible to access from outside the pod. Users deploying with this Helm chart cannot reach the dashboard without manually creating additional Kubernetes resources.

## What Changes

- Add a dedicated dashboard Service (conditionally created when `DASHBOARD_ENABLED` is set) to expose the dashboard port within the cluster
- Add an optional Ingress resource for the dashboard, supporting configurable hostname, TLS, path-based routing, and ingressClassName
- Update `values.yaml` with a `dashboard` section containing Service and Ingress configuration with sensible defaults
- Ensure the existing health check Service remains unchanged and backward-compatible
- Add the dashboard port to the ServiceMonitor when both dashboard and metrics are enabled

## Capabilities

### New Capabilities

- `helm-dashboard-service`: Conditional Kubernetes Service resource for the web dashboard, only created when dashboard is enabled
- `helm-dashboard-ingress`: Optional Ingress resource for external access to the dashboard with TLS, hostname, path, and ingressClassName support

### Modified Capabilities

- `configuration-and-deployment`: Add dashboard Service and Ingress values to `values.yaml` and document the new configuration options

## Impact

- **Helm templates**: New `dashboard-service.yaml` and `dashboard-ingress.yaml` templates
- **values.yaml**: New `dashboard` section with `service` and `ingress` sub-keys
- **Existing Service**: No changes — the health check service remains as-is
- **ServiceMonitor**: May need a dashboard port endpoint when metrics are exposed on the dashboard port
- **Backward compatibility**: All new resources are opt-in (disabled by default); existing deployments are unaffected
