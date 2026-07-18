## Context

F14 (`isolate-agent-network-egress`) routes all agent egress — `webfetch`, `websearch`,
`agent-browser`, and any env-honoring subprocess client such as the `curl` wrappers inside
skill scripts — through a local validating forward proxy (`src/utils/egress-proxy.ts`). The
proxy resolves each destination host and rejects any address in the disallowed set
(loopback, RFC1918, link-local, ULA, CGNAT, metadata, multicast) with a 403, for both
CONNECT tunneling and plain-HTTP absolute-form forwarding.

This is correct for untrusted destinations but has no notion of *operator-trusted internal
services*. The production deployment legitimately requires the agent to reach:

- `http://192.168.1.10:7860` — Stable Diffusion WebUI on the operator's LAN (RFC1918);
- `http://internal-proxy:18080` — in-cluster nginx reverse proxy (ClusterIP in `10/8`)
  that injects Cloudflare Access service-token headers for an external upstream.

Both are blocked, breaking the image-generation workflow. The only current escape hatch,
`unrestrictedEgress: true`, removes mediation for *all* destinations — strictly worse than
targeted trust grants.

Constraints:

- The default posture must remain byte-for-byte identical when the new setting is unset
  (empty allowlist ⇒ current behavior).
- The trust decision must be operator-only (deployment config), never extendable by the
  agent or by chat users at runtime.
- The proxy is a process-wide singleton started once during bootstrap; per-session
  allowlists are out of scope.

## Goals / Non-Goals

**Goals:**

- Let the operator enumerate specific egress destinations that are exempt from the SSRF
  range check, keeping default-deny for everything else.
- Cover every agent egress path that F14 mediates: CONNECT, plain-HTTP forward, and the
  `NO_PROXY` direct-connect fast path.
- Config parity with every other sandbox setting: YAML key + env override + helm value +
  example config + docs.

**Non-Goals:**

- CIDR ranges, wildcards, or port-level granularity — exact host entries only. A trusted
  host is operator-controlled end to end; port scoping adds config surface without a
  meaningful boundary, and range grants invite over-broad holes.
- Touching `safeFetch`/`ssrf.ts`. Those guard the *main process's* fetches of
  attacker-influenced URLs (e.g. federated Misskey attachments); the trust carve-out is
  strictly for agent egress. `isDisallowedAddress` stays allowlist-unaware.
- Per-session or per-channel allowlists; runtime mutation of the allowlist.

## Decisions

### D1: Exact-match host allowlist, matched pre-resolution

`egressAllowHosts` entries are hostnames or literal IPs (no scheme, no port). The proxy
normalizes both sides (trim, lowercase, strip IPv6 brackets) and compares the *requested*
destination host against the set before the range check. On match, DNS resolution still
happens (a hostname must resolve to be connectable) and the connection is still pinned to
the first resolved address, but `isDisallowedAddress` rejection is skipped.

Matching the requested name rather than the resolved address is deliberate: the operator
trusts *the name* (`internal-proxy` is cluster-DNS-controlled; `192.168.1.10` is a
literal). Matching resolved addresses instead would force the operator to enumerate
ClusterIPs, which are not stable across service re-creation.

DNS-rebinding is not reopened: an attacker controls neither the allowlist nor the
resolution of the names the operator chose to trust. Non-allowlisted hosts keep the full
resolve-validate-pin path unchanged.

**Metadata addresses stay non-exemptable.** The allowlist trust anchor is the *name*, and
for hostname entries (`internal-proxy`) the operator explicitly does not control the
resolved address across time — that instability is the very reason a name is allowlisted
instead of an IP. If cluster DNS were compromised or misconfigured to point an allowlisted
name at the cloud metadata endpoint, an unconditional exemption would turn the carve-out
into a credential-theft path. Therefore `resolveAndValidateEgress` SHALL reject resolved
addresses in the metadata space (`169.254.169.254`, IPv6 equivalents such as
`fd00:ec2::254`) *independently of* the allowlist: the exemption only lifts the
loopback/RFC1918/ULA/CGNAT/link-local range rejection, never the metadata block. No
legitimate allowlist use case needs the metadata address, so this costs nothing.

*Alternative considered*: CIDR allowlist (e.g. `192.168.10.0/24`). Rejected — broader than
the need, and normalizing/matching names is what the in-cluster service case requires
anyway (its IP is unstable).

### D2: Enforcement lives in `resolveAndValidateEgress`

Both proxy paths (CONNECT and plain-HTTP) already funnel through
`resolveAndValidateEgress`, so the exemption is implemented exactly once there. The
function gains awareness of a module-level normalized allowlist set.

### D3: Module-level allowlist configured at bootstrap

The proxy is already a process-wide singleton (`ensureEgressProxy` in `bootstrap.ts`). The
allowlist follows the same shape: bootstrap calls a `configureEgressAllowHosts(hosts)`
setter (idempotent, replaces the set) before starting the proxy; tests use the same setter
to install/clear fixtures. This avoids threading the list through every call site while
keeping `startEgressProxy` signature-stable for existing tests.

Loopback or unspecified entries (`127.0.0.1`, `localhost`, `::1`, `0.0.0.0`) are accepted
but logged at **error level** with a prominent startup warning. Because entries carry no
port scoping (a non-goal), a loopback entry exposes *every* port on the loopback
interface — the dashboard on `127.0.0.1:8090`, the Skill API, and any future
loopback-bound service — not just the one the operator had in mind. The docs state this
"all loopback ports" blast radius explicitly so the trade-off is made knowingly. The Skill
API remains protected by its per-session token (F13) and the dashboard by its passphrase
regardless.

### D4: Allowlisted hosts are appended to `NO_PROXY`

`agent-factory.ts` extends the existing `NO_PROXY=localhost,127.0.0.1,::1` with the
allowlist entries. Env-honoring clients (`curl` in the sd-webui skill scripts) then connect
*directly*, bypassing the proxy's plain-HTTP single-request `Connection: close` semantics —
which matters for sd-webui's multi-MB base64-PNG responses and long-blocking `txt2img`
POSTs. The proxy-side exemption (D1/D2) remains authoritative for clients that ignore
`NO_PROXY` (e.g. Chromium launched with an explicit proxy), so both routes agree on the
same trust set.

`NO_PROXY` matching semantics vary across HTTP clients (exact match vs. domain-suffix
match, case handling). This variance cannot widen the *proxy's* trust set — a client whose
loose `NO_PROXY` matching skips the proxy for a non-allowlisted host simply connects
directly, which for internal targets fails at the network level in a properly segmented
deployment and is exactly the pre-existing "env-proxy routing is best-effort, not a hard
boundary" residual limitation documented in F14. The implementation verifies `curl`'s
matching (the client the motivating skill uses) against bare-hostname and literal-IP
entries as part of the test tasks; the authoritative mediation remains the proxy.

*Alternative considered*: NO_PROXY only, no proxy-side change. Rejected — any client that
honors `HTTP_PROXY` but mishandles `NO_PROXY` (or is pointed at the proxy explicitly)
would still be blocked, reintroducing the bug for a subset of tools.

### D5: Config plumbing mirrors existing sandbox settings

- `SandboxConfig.egressAllowHosts: string[]`, default `[]` in `DEFAULT_SANDBOX`.
- Env override `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` (comma-separated), added to the
  existing comma-separated-array branch of `applyEnvOverrides`.
- `config.example.yaml` and `helm/values.yaml` document the setting with a security note;
  `docs/AGENT_PERMISSIONS.md` gains an "operator-trusted egress" subsection under F14.

## Risks / Trade-offs

- [Over-broad trust grant: operator allowlists a name whose resolution they do not fully
  control] → Metadata addresses are hard-blocked regardless of the allowlist (D1); docs
  steer toward literal IPs where stable, and name entries stay exact-match, so one entry
  can never widen into a range. Note the unavoidable tension: the in-cluster case *must*
  use a name precisely because its IP is unstable — the metadata hard-block is what keeps
  that residual DNS trust bounded.
- [Loopback entry exposes ALL loopback ports, not just the intended service] → Accepted
  with an error-level startup warning and explicit docs (D3); dashboard and Skill API
  carry their own auth.
- [`NO_PROXY` matching semantics differ across clients] → Cannot widen the proxy's trust
  set (a bypassing client just connects directly and hits network-level reality); curl's
  behavior is verified in tests; proxy remains the authoritative mediator (D4).
- [Traffic to allowlisted hosts is unmediated when it takes the NO_PROXY direct path] →
  Equivalent trust either way; the destination is operator-controlled. The proxy exemption
  and NO_PROXY entries are derived from the same config value, so they cannot drift.
- [Config typo (e.g. including a scheme or port in an entry) silently never matches] →
  Startup log lists the normalized allowlist; docs show exact expected format. Entries
  containing `/` or `:` (other than IPv6 literals) are warned about at startup.

## Migration Plan

1. Merge to `master` → `docker-publish-latest.yml` builds `ghcr.io/jim60105/air-friends:latest`.
2. Add `env.AGENT_SANDBOX_EGRESS_ALLOW_HOSTS = "192.168.1.10,internal-proxy"` to the
   ArgoCD Application's Helm parameters (operator step, outside this repo).
3. Sync + rollout restart; verify via the sd-webui skill's `probe.sh` connectivity test
   from a live session.

Rollback: remove the env parameter (allowlist reverts to `[]` ⇒ pre-change behavior); the
code path is inert when the list is empty.

## Open Questions

None — port-granularity and CIDR support were considered and explicitly declared
non-goals; they can be layered on later without breaking the entry format (a bare host
stays valid).
