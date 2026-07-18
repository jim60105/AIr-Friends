## Context

The agent has three ways to reach the network, only one of which is guarded:

- **Guarded:** the daemon-side image downloader calls `safeFetch` (`ssrf.ts:204`), the *only* call site (`session-orchestrator.ts:2578`). `safeFetch` enforces scheme + private-range checks and manual redirect re-validation.
- **Unguarded:** `agent-config/opencode.json` sets `webfetch`/`websearch` `"allow"` and `agent-browser *` `"allow"`. These run inside the agent process (OpenCode's own fetch client) or a bundled Chromium, using their own network stacks. They never call `safeFetch`.

`sandbox.networkIsolation` defaults to `false` (`config-loader.ts:262`; `DEFAULT_SANDBOX`), so the agent shares the container's full network. There is already a network-isolation mechanism — `acp-integration`'s "SandboxManager Network Isolation" requirement wraps the agent command in `unshare --net` when `networkIsolation` is `true`, with graceful degradation when `unshare` is unavailable. But turning it fully on removes the *intended* web-research capability (`docs/AGENT_PERMISSIONS.md:132`), which is why it defaults off.

The tension is real: full isolation is safe but kills a feature; the current default keeps the feature but exposes every internal HTTP endpoint to untrusted chat. The fix must keep web research while blocking internal targets — which means a *mediated* egress path, not a binary on/off.

There is also a secondary DNS-rebinding TOCTOU inside `safeFetch`: it validates with `Deno.resolveDns` (`ssrf.ts:214`) and then calls `fetch` (`:216`), which re-resolves independently with no pinning. On the one guarded path the response is base64'd as an image and never relayed readably, so it is blind-only — folded here as a sequenced follow-on, not the headline.

## Goals / Non-Goals

**Goals:**

- No untrusted-driven agent fetch can reach loopback / RFC1918 / link-local / ULA / cloud-metadata addresses, across *all* agent network paths (`webfetch`, `websearch`, `agent-browser`), including Chromium's post-launch navigations.
- Preserve legitimate public-internet research.
- Make the *default* configuration safe (no unmediated egress) without requiring the operator to know to turn something on.

**Non-Goals:**

- The `agent-browser file://` local-file read — that is F12 (a filesystem read, not network egress).
- Blocking the agent from the public internet outright (research is a feature); the goal is to block *internal* targets while allowing public ones through a mediated path.
- Backward compatibility / migration — pre-release, zero users.

## Decisions

### D1 — Validating forward proxy for all agent egress (primary)

Confine the agent's network so its only route out is a local validating proxy that applies the `safeFetch` rule set (scheme allow-list; reject loopback/RFC1918/link-local/ULA/metadata/unspecified/multicast; manual per-hop redirect re-validation; DNS pinning per D3).

The **authoritative** binding must be a *network route*, not env vars: run the agent in a network namespace whose only reachable egress is the proxy, so a tool that ignores `HTTP_PROXY` cannot bypass it. `HTTP_PROXY`/`HTTPS_PROXY` in the agent env is a convenience/correctness layer on top, **but must not be relied on as the sole control** — Chromium and OpenCode's fetch client honoring proxy env is unverified (and Chromium in particular has historically ignored env proxies for some request classes). This must be tested; where it cannot be guaranteed, the namespace route is the backstop that still contains the request.

- **Why a proxy rather than argument validation:** `webfetch`'s URL could be validated at the ACP gate, but `agent-browser` launches Chromium which then navigates freely (redirects, sub-resources, JS-driven requests, `fetch()` inside the page) — an initial-argument check cannot bound that. A proxy at the actual egress validates *every* request, whatever issued it.
- **Why it beats full isolation:** it keeps public research working while denying internal targets — resolving the feature-vs-safety tension instead of picking one side.
- **Shared privilege constraint with F12:** the network-namespace route (like `unshare --net`, and like F12's bubblewrap confinement) needs namespace/capability privileges a non-root `restricted-v2` OpenShift container may not have. This is the *same* constraint F12's D4 hits, and the two SHALL be verified together against the real target SCC/kernel. If unprivileged network namespaces are unavailable, the proxy-route backstop is unavailable too, and the design must fall back to env-proxy-plus-fail-closed or the explicit opt-in — never silent open egress.
- **Alternative considered — enable `unshare --net` unconditionally:** rejected as the *primary* because it removes the research feature; retained as the safe fallback (D2) when no proxy is configured.

### D2 — Safe default: never unmediated

Change the default so the agent never gets unrestricted host-network access:

- If a validating egress proxy is configured → agent egress is proxy-confined (D1).
- If not → the agent runs network-isolated (`unshare --net`), i.e. web tools are effectively unavailable but nothing internal is reachable.
- Unrestricted egress remains possible only via an explicit, documented opt-in flag (for operators who accept the risk, e.g. a trusted single-tenant deployment).

- **Why:** the vulnerability is fundamentally that the *default* is open. A secure default that fails toward isolation (not toward open network) is the core correction; the proxy is what makes the secure default also *useful*.
- **The current availability check is insufficient for a default:** today `wrapWithNetworkIsolation()` (`sandbox-manager.ts`) only checks that the `unshare` *binary* exists (`which unshare`) — not that `unshare --net` can actually **succeed** at runtime, which in a non-root `restricted-v2` container it may not. Making isolation the default fallback on top of a mere existence check risks turning **every agent spawn into a runtime failure on day one**. The check SHALL be replaced with a **functional probe** (e.g. run `unshare --net true` once at startup and observe the exit status) before isolation becomes the default posture.
- **Graceful degradation:** if the functional probe fails (non-Linux / missing / insufficient privilege), do **not** silently fall through to full open egress in a posture that expects mediation — surface it and require the explicit unrestricted opt-in, or fail closed (no web tools). The one outcome that must never happen silently is open egress.

### D3 — Pin the resolved IP in `safeFetch` (sequenced follow-on)

After D1/D2 make the egress guard authoritative, close the resolve-then-connect gap: resolve the host, choose a validated address, and connect to *that address* (e.g. pin via the connection, or resolve-and-connect-by-IP with an explicit `Host` header) so a second attacker-controlled resolution cannot swap in an internal IP between validation and connection.

- **Why sequenced after D1:** IP pinning on one daemon sink is pointless while `webfetch`/`agent-browser` bypass the guard entirely. Order matters (as the finding notes).
- **Constraint:** Deno `fetch` does not expose connect-time IP pinning directly; may require resolving to an IP and connecting by IP with SNI/Host preserved, or performing the request at a lower level. Flagged in Open Questions.

## Risks / Trade-offs

- **[Proxy adds a component to build/run]** → it is a small local validating forwarder; scope it to the SSRF rule set already implemented in `ssrf.ts` (reuse the validation logic). Ship D2's isolation default so that even without the proxy the system is safe (just feature-reduced).
- **[Chromium ignoring `HTTP_PROXY`]** → verify `agent-browser`/Chromium honors the proxy env (or configure it via Chromium flags); if a path escapes the proxy, the namespace route (only-route-is-proxy) is the backstop. Cover with a test that Chromium cannot reach `127.0.0.1`.
- **[`unshare --net` unavailable on the target runtime]** → same degradation concern as today; the difference is we must not degrade *toward open egress*. If neither proxy nor isolation is available, fail closed or require the explicit unrestricted opt-in with a loud warning.
- **[D3 pinning not expressible in Deno fetch]** → documented Open Question; the blind-only nature keeps it low-priority relative to D1/D2.
- **[Legitimate research feels restricted]** → operators enabling research configure the proxy once; the proxy allows all public destinations, only denying internal ranges.

## Migration Plan

No data migration (pre-release, zero users).

1. Implement the validating egress proxy reusing `ssrf.ts` validation; add config for it.
2. Flip the default posture (D2): isolated-by-default unless proxy configured or explicit unrestricted opt-in. Update `config.example.yaml`, `.env.example`, `helm/values.yaml`, and `docs/AGENT_PERMISSIONS.md`.
3. Land D3 (`safeFetch` IP pinning) after D1/D2.
4. Rollback: revert; if the proxy path proves unavailable in a deployment, operators can set the explicit unrestricted opt-in to restore prior behavior (with the documented risk).

## Open Questions

- **Proxy vs. namespace routing vs. both:** is `HTTP_PROXY`/`HTTPS_PROXY` env sufficient (does Chromium + OpenCode fetch both honor it reliably?), or is a namespace whose only route is the proxy required as the backstop? Recommended: env-proxy plus namespace-route backstop.
- **D3 IP pinning in Deno:** what is the least-invasive way to pin the validated IP for the connection given Deno `fetch`'s API? Resolve-and-connect-by-IP with preserved Host/SNI, or a lower-level client?
- **Default when neither proxy nor `unshare` is available:** fail closed (no web tools, safe) vs. require explicit unrestricted opt-in? Recommended: fail closed by default.

## Resolved During Implementation (2026-07-18)

- **Namespace privilege is available via the userns-first path — the old `unshare --net` was broken.** Empirically verified under rootless podman as UID 1000 (including `--security-opt no-new-privileges`, the closest local mirror of `restricted-v2`): a **bare `unshare --net` FAILS** (it needs `CAP_SYS_ADMIN` in the current user namespace), which is exactly the posture the deployment targets — so the shipped `wrapWithNetworkIsolation()` was non-functional there. The **userns-first incantation `unshare --user --map-root --net` SUCCEEDS**, because creating a user namespace first is permitted for unprivileged processes and grants the capability inside it. The functional probe and the wrapper now use the userns-first form. The true gating factor is node-level `user.max_user_namespaces`; where userns creation is disabled, the probe fails and the daemon fails closed.
- **Full network isolation is incompatible with the Skill API (new constraint).** The agent reaches the daemon's Skill API over loopback TCP (`skills/lib/client.ts` → `http://localhost:3001`). A fresh, empty network namespace has its own isolated loopback, so full `unshare --net` isolation **severs skill callbacks** (memory, reply) — the bot becomes nonfunctional. Consequences: (a) the **default posture is the validating proxy, not netns isolation**; the agent stays in the shared network so both the proxy and the Skill API are reachable, with `NO_PROXY` letting loopback bypass the proxy; (b) the "authoritative network-route" backstop (proxy as the *only* egress) is deferred to a follow-on that first bridges the Skill API into the namespace (Unix-domain socket, or `slirp4netns`/`pasta` that maps the loopback service); (c) `networkIsolation: true` remains available as an explicit operator choice for agents that need no skill callbacks, documented as such.
- **HTTPS IP-pinning (D3) is limited by Deno.** Plain-HTTP hostnames are pinned to the validated IP (authority rewrite + preserved `Host`); HTTPS hostname pinning would break TLS SNI/cert validation because Deno `fetch` cannot connect-by-IP while setting a separate SNI. HTTPS pinning stays an Open Question pending a Deno connect-with-pinned-IP API; the all-addresses range check still applies to HTTPS.

## Rubber-duck follow-ups (2026-07-18)

- **Proxy DNS-rebinding closed.** The proxy originally validated the host then let `Deno.connect`/`fetch` re-resolve it independently (a TOCTOU worse than the daemon `safeFetch` gap). It now resolves once, validates all addresses, and connects to the **pinned** validated IP for both CONNECT tunnels (raw byte tunnel — pinning is transparent to end-to-end TLS) and plain-HTTP (raw forward to the pinned IP with the request line rewritten to origin-form and `Host` preserved).
- **Residual: the env-proxy default is best-effort, not a boundary (acknowledged, documented).** Two gaps remain inherent to routing via `HTTP_PROXY`/`HTTPS_PROXY` without the netns route: (a) a client that ignores the proxy env (OpenCode `webfetch`/Chromium honoring is unverified) escapes it; (b) `NO_PROXY` (required so the loopback Skill API works without a network bridge) is host-wide, so the agent can still reach other loopback services on the daemon host directly. The `sandbox-manager.ts` comment claiming the network route is "authoritative" was corrected. Both gaps close only with the deferred authoritative netns route + Skill-API bridge; `docs/AGENT_PERMISSIONS.md` now states this residual explicitly so the posture is not over-trusted. `networkIsolation: true` remains the hard-boundary option for agents needing no egress.
