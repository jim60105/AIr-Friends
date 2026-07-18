## Why

The F14 validating egress proxy (change `isolate-agent-network-egress`) applies a blanket
SSRF rule set — rejecting every loopback/RFC1918/link-local/ULA/metadata destination — to all
agent egress. This broke a load-bearing production workflow: the `image-generator-sd-webui`
skill can no longer reach the operator's Stable Diffusion WebUI at `http://192.168.1.10:7860`
(LAN, RFC1918) nor the in-cluster Cloudflare Access proxy at `http://internal-proxy:18080`
(resolves to a ClusterIP in `10.0.0.0/8`), because the skill's `curl` calls honor the injected
`HTTP_PROXY` and the proxy 403s both targets. The only existing escape hatch,
`agent.sandbox.unrestrictedEgress`, abandons SSRF mediation entirely — an unacceptable
trade-off for punching two known-good holes.

## What Changes

- Add an operator-configured egress allowlist `agent.sandbox.egressAllowHosts` (default `[]`):
  a list of hostnames / literal IPs the agent may reach even when they resolve to otherwise
  disallowed (private/internal) address ranges.
- The validating egress proxy exempts allowlisted destination hosts from the SSRF range check
  for both CONNECT tunneling and plain-HTTP forwarding, while keeping default-deny for
  everything else. The cloud-metadata address space (e.g. `169.254.169.254`, `fd00:ec2::254`)
  stays hard-blocked even for allowlisted hosts — no allowlist entry can ever reach it.
- Allowlisted hosts are additionally appended to the agent's `NO_PROXY`/`no_proxy` so
  env-honoring clients (e.g. `curl` in skill scripts) may connect directly, avoiding the
  proxy's forced `Connection: close` single-request semantics for large payloads (multi-MB
  base64 PNG responses from sd-webui).
- New environment override `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` (comma-separated), mapped to
  `agent.sandbox.egressAllowHosts`, plus `config.example.yaml` / `helm/values.yaml` /
  `docs/AGENT_PERMISSIONS.md` documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: the "SandboxManager Network Isolation" requirement gains an
  operator-trusted egress allowlist carve-out (allowlisted hosts bypass the proxy's range
  rejection and are appended to the agent's `NO_PROXY`; all other internal targets remain
  blocked); the "Sandbox Configuration" requirement gains the `egressAllowHosts` setting
  and its `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` env override.

## Impact

- `src/utils/egress-proxy.ts` — allowlist configuration + exemption in
  `resolveAndValidateEgress` (used by both CONNECT and plain-HTTP paths).
- `src/acp/agent-factory.ts` — `NO_PROXY` construction includes allowlisted hosts.
- `src/types/config.ts`, `src/core/config-loader.ts`, `src/utils/env.ts` — new
  `egressAllowHosts` setting, default, and env mapping.
- `src/bootstrap.ts` — pass the configured allowlist to the shared proxy at startup.
- `config.example.yaml`, `helm/values.yaml`, `docs/AGENT_PERMISSIONS.md` — configuration
  surface and security-posture documentation.
- `tests/utils/egress-proxy.test.ts` and sandbox/agent-factory tests — allowlist coverage.
- Deployment (out of repo scope, operator action): set
  `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS=192.168.1.10,internal-proxy` on the production
  ArgoCD Application.

Security posture: default behavior is unchanged (empty allowlist ⇒ identical to today).
Each allowlist entry is an explicit, operator-audited trust grant recorded in deployment
config; the agent and chat users cannot extend it at runtime.
