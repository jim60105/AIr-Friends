## 1. Validating egress proxy (D1)

- [x] 1.1 Implement a local validating forward proxy that reuses `src/utils/ssrf.ts` validation (scheme allow-list; reject loopback/RFC1918/link-local/ULA/metadata/unspecified/multicast; DNS-resolved range checks; both plain-HTTP and HTTPS CONNECT) — `src/utils/egress-proxy.ts`
- [~] 1.2 Wire the agent to egress through the proxy: `HTTP_PROXY`/`HTTPS_PROXY` set in the agent env (added to the sandbox env allow-list) with `NO_PROXY=localhost,127.0.0.1,::1` so the loopback Skill API bypasses the proxy. **The env-proxy convenience layer is implemented; the *authoritative network-route* backstop (a namespace whose only egress is the proxy) is NOT — a fresh network namespace severs the agent's loopback Skill API channel (`skills/lib/client.ts` calls `http://localhost:3001`), so the netns route first needs the Skill API bridged into the namespace (UDS or slirp). Recorded as a follow-on in `design.md` (D1 "authoritative binding" / Open Questions).**
- [ ] 1.3 Verify empirically whether OpenCode's `webfetch`/`websearch` client honors the proxy env; where it does not, the namespace route must still contain it. **A proxy-honoring client (curl) was confirmed to route through the proxy and be blocked (see 4.1), so the proxy mechanism works; OpenCode's own fetch client honoring `HTTP_PROXY` still needs checking against a live agent on a networked host (the sandbox has no outbound internet).**
- [ ] 1.4 Verify empirically whether `agent-browser` (Chromium) honors the proxy env/flags for ALL request classes incl. post-launch navigations. **Requires a live Chromium launch — run in the dev env; NOT yet executed headlessly. If Chromium ignores the env proxy, configure it via Chromium flags or fall back to the netns route (which needs the Skill API bridge from 1.2).**

## 2. Safe default posture (D2)

- [x] 2.1 In `src/core/config-loader.ts` / `DEFAULT_SANDBOX`, change the default so the agent is never given open egress: proxy-confined (`egressProxy: true`) by default; `resolveWantsNetworkIsolation()` fails closed when no posture is configured
- [x] 2.2 Replace the `which unshare` existence check in `src/acp/sandbox-manager.ts` with a **functional probe** — `src/acp/sandbox-capabilities.ts` `probeNetworkNamespace()` runs `unshare --user --map-root --net true` (userns-first; a bare `unshare --net` fails in a non-root container) and caches the result; coordinated with F12's confinement probe (same SCC/kernel constraint)
- [x] 2.3 Add an explicit `unrestrictedEgress` opt-in flag for operators who accept the risk; default off (`SandboxConfig.unrestrictedEgress`)
- [x] 2.4 Update egress selection so degradation (probe fails) never silently results in open egress — `SandboxManager.buildSpawnOptions` throws (fail closed) when isolation is required but the probe fails, and `resolveWantsNetworkIsolation` throws when no posture is configured
- [x] 2.5 Add the new settings to `config.example.yaml`, `helm/values.yaml` (`.env.example` is not present in the repo; env overrides documented via `AGENT_SANDBOX_*` in `src/utils/env.ts`)

## 3. safeFetch DNS-rebinding mitigation (D3, sequenced after D1/D2)

- [x] 3.1 In `src/utils/ssrf.ts`, pin the validated resolved IP for the connection (`pinValidatedUrl` + `validateAndPin` in `safeFetch`) so `fetch` does not re-resolve to a different address; range checks re-applied to the pinned address. **Plain-HTTP hostnames are pinned to the validated IP with Host preserved; literal-IP hosts need none; HTTPS hostname pinning is left unchanged because Deno `fetch` cannot connect-by-IP while preserving TLS SNI — tracked as an Open Question in `design.md`.**
- [x] 3.2 Add a test proving the connection targets the validated address, not a second resolution — `tests/utils/ssrf.test.ts` (`safeFetch - connects to the validated address, not a re-resolution`)

## 4. Tests

- [x] 4.1 Agent fetch of `http://169.254.169.254/…` and `http://127.0.0.1:…/` blocked through the mediated path — `tests/utils/egress-proxy.test.ts`, AND **VERIFIED end-to-end in the built image with a real proxy-honoring client**: `curl -x http://127.0.0.1:<proxy>` to `169.254.169.254` (cloud metadata), `127.0.0.1:6379` (loopback), and `10.0.0.5` (RFC1918) each returned **HTTP 403** from the proxy (confirming both that curl honors `HTTP_PROXY` and that the range check blocks internal targets before connecting).
- [~] 4.2 Agent fetch of a public URL succeeds through the proxy — proxy forward + IP-pinning path implemented; a live public-URL assertion needs outbound internet, which the CI/sandbox lacks. **Run on a networked host.**
- [ ] 4.3 Chromium (`agent-browser`) cannot reach a loopback service. **Needs a live Chromium navigation + network; not exercisable in the no-internet sandbox. Chromium DOES launch under the F12 bwrap confinement (verified). Whether Chromium honors `HTTP_PROXY` for all request classes remains to be verified on a networked host (task 1.4).**
- [x] 4.4 Default config (no proxy override, no opt-in) results in a non-open-egress posture, not open egress — `tests/acp/sandbox-manager.test.ts` (`no egress posture configured fails closed`, `unrestrictedEgress does not wrap`, isolation fail-closed)

## 5. Documentation

- [x] 5.1 Update `docs/AGENT_PERMISSIONS.md`: web access is mediated; how to enable research egress safely (the proxy is on by default); what the explicit unrestricted opt-in means and its risk; the Skill-API loopback constraint on full isolation

## 6. Verification

- [x] 6.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 6.2 Run `deno check src/main.ts`
- [x] 6.3 Run `deno task test` and confirm the egress tests pass and coverage does not regress
- [x] 6.4 Run `openspec validate isolate-agent-network-egress` and confirm it passes
