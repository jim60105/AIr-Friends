## Why

Security audit run-2 (finding F14, MEDIUM) found that the agent's network egress is unmediated. The run-1 SSRF fix (`safeFetch` in `src/utils/ssrf.ts`) has exactly one call site — the image-attachment download at `src/core/session-orchestrator.ts:2578`. Meanwhile `agent-config/opencode.json` sets `"webfetch": "allow"`, `"websearch": "allow"`, and `"agent-browser *": "allow"`, giving the agent its own network stacks (OpenCode's fetch client and a bundled Chromium) that never touch `safeFetch`, and `sandbox.networkIsolation` defaults to `false` (`src/core/config-loader.ts:262`). So any chat user can ask the bot to fetch `http://169.254.169.254/latest/meta-data/…` (cloud metadata) or `http://127.0.0.1:8090/` (a loopback service) and get the **full response body relayed back as readable text**, with none of `safeFetch`'s loopback/private/link-local range checks applied. Web access is an intended feature, but "any untrusted user can make the bot read arbitrary internal HTTP endpoints" is not.

## What Changes

- **Mediate all agent egress instead of only the image-download sink.** Route the agent's outbound network through a validating forward proxy that applies `safeFetch`-style rules (scheme allow-list; reject loopback / RFC1918 / link-local / ULA / metadata `169.254.169.254` / unspecified / multicast; manual per-hop redirect re-validation), so `webfetch`, `websearch`, and `agent-browser` (Chromium) inherit SSRF protection — including Chromium's *post-launch* navigations, which an argument-level check cannot cover. The **authoritative** mechanism is a network route where the proxy is the *only* reachable egress (so a tool that ignores proxy env cannot escape it); `HTTP_PROXY`/`HTTPS_PROXY` env is a convenience layer whose honoring by Chromium and OpenCode's fetch client must be verified, not assumed (see `design.md`).
- **Make the default posture "no unmediated egress."** Change the default so the agent never has unrestricted access to the host's networks: if no validating egress path is configured, the agent runs network-isolated (via the existing `unshare --net` mechanism). Reaching the public internet for research requires either the validating proxy or an explicit, documented operator opt-in — never the current silent full-open default.
- **(Sequenced follow-on)** Close the DNS-rebinding TOCTOU in `safeFetch` itself (it validates via `Deno.resolveDns` then calls `fetch`, which re-resolves with no IP pinning). This is deliberately ordered *after* the egress mediation above, since pinning is moot while `webfetch`/`agent-browser` bypass the guard entirely.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `acp-integration`: the SandboxManager egress control SHALL support a validating-proxy mode in addition to full network-namespace isolation, and the default sandbox posture SHALL NOT grant the agent unmediated access to host-private networks.
- `multimedia-messages`: the SSRF validation used at the daemon fetch sink SHALL pin the resolved IP address for the connection to close the resolve-then-connect DNS-rebinding gap.

## Impact

- **Code:** `src/acp/sandbox-manager.ts` (proxy-confined egress mode; safe default), `src/core/config-loader.ts` (default `networkIsolation` / new egress-proxy config), `src/utils/ssrf.ts` (IP pinning), and the agent env plumbing so `agent-browser`/OpenCode honor the proxy (`HTTP_PROXY`/`HTTPS_PROXY` or namespace routing).
- **Config:** `agent-config/opencode.json` (`webfetch`/`websearch`/`agent-browser` remain usable but only through the mediated egress path), `config.example.yaml` / `.env.example` / `helm/values.yaml` (new egress-proxy settings; changed default).
- **Docs:** `docs/AGENT_PERMISSIONS.md` (web access is mediated; how to enable research egress safely).
- **Tests:** agent fetch of `169.254.169.254` and `127.0.0.1` is blocked through the mediated path; a public URL succeeds; `safeFetch` pins the validated IP.
- **Cross-reference:** F12 (file read) already grants local read, which bounds F14's incremental impact; F14 additionally addresses the *network* reach (internal HTTP services, cloud metadata) that file read does not. The `agent-browser file://` *file-read* variant is handled in the F12 change, not here.
