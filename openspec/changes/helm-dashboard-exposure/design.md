## Context

The AIr-Friends Helm chart currently defines a single Service (`service.yaml`) that exposes the health check endpoint on port 8080. The web dashboard runs on a separate port (configurable via `DASHBOARD_PORT`, default 8090) and the deployment template already conditionally exposes this port on the container when `DASHBOARD_ENABLED` is set. However, there is no Kubernetes Service or Ingress to route traffic to it, so the dashboard is unreachable from outside the pod.

The existing Service and ServiceMonitor are tightly scoped to the health check port and should remain untouched.

## Goals / Non-Goals

**Goals:**
- Provide a conditional dashboard Service that is only created when the dashboard is enabled
- Provide an optional Ingress resource for external access to the dashboard
- Follow Helm chart best practices (conditional resources, sensible defaults, full label support)
- Maintain full backward compatibility — existing deployments with no dashboard config see zero changes

**Non-Goals:**
- Changing the existing health check Service or its port assignments
- Adding authentication at the Ingress level (the dashboard already has passphrase-based auth)
- Supporting non-HTTP protocols or gRPC for the dashboard
- Adding NetworkPolicy resources (can be added later)

## Decisions

### 1. Separate Service for dashboard (not adding a port to the existing Service)

**Decision**: Create a new `dashboard-service.yaml` template rather than adding a dashboard port to the existing health check Service.

**Rationale**: The existing Service is referenced by the ServiceMonitor and is semantically tied to health checks. Mixing dashboard traffic into it would conflate concerns. A separate Service also allows independent lifecycle control (enable/disable dashboard without touching health check routing).

**Alternatives considered**: Adding a second port to the existing Service — rejected because it would require the Service to exist even when the dashboard is disabled, and complicates ServiceMonitor targeting.

### 2. Standard Ingress resource (not IngressRoute or Gateway API)

**Decision**: Use the standard `networking.k8s.io/v1` Ingress resource with `ingressClassName` support.

**Rationale**: Maximum compatibility across clusters. Users on Traefik, nginx-ingress, or any other controller can use this. Gateway API adoption is still limited.

**Alternatives considered**: Traefik IngressRoute CRD — rejected as it limits portability. Gateway API — considered future work.

### 3. Dashboard values structure

**Decision**: Add a `dashboard` top-level section in `values.yaml` with `service` and `ingress` sub-keys, keeping the existing `env.DASHBOARD_ENABLED`, `env.DASHBOARD_PORT`, and `env.DASHBOARD_PASSPHRASE` env vars as the source of truth for the application.

**Rationale**: Separates Kubernetes resource configuration (Service type, Ingress host) from application configuration (port, passphrase). The dashboard port value is derived from `env.DASHBOARD_PORT` to avoid duplication.

### 4. Conditional resource creation

**Decision**: Both dashboard Service and Ingress are gated on `dashboard.service.enabled` and `dashboard.ingress.enabled` respectively, both defaulting to `false`.

**Rationale**: Opt-in approach ensures zero impact on existing deployments. Users must explicitly enable these resources.

## Risks / Trade-offs

- **[Risk] Dashboard port mismatch** → The dashboard Service `targetPort` derives from `env.DASHBOARD_PORT` with a fallback default of `8090`. If users set `DASHBOARD_PORT` via `extraEnv` instead of `env`, the Service could point to the wrong port. → Mitigation: Document that `env.DASHBOARD_PORT` is the canonical source.

- **[Risk] Ingress without TLS** → Users may expose the dashboard without TLS. → Mitigation: Include TLS configuration in the Ingress template and document it, but don't force it (some clusters terminate TLS at the load balancer).

- **[Trade-off] Two Services instead of one** → Slightly more resources. → Acceptable because it provides clean separation and independent lifecycle.
