# OMP Network Transport (Row 19 — `control-omp-url-fetch-transport`)

This document is the transport-side counterpart to
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) (F14 egress mediation): the
permission gate decides *whether a tool call may run*; this layer decides,
per hop, *where an admitted URL read is allowed to go and how*. Rule source
stays a single classifier — [`src/utils/ssrf.ts`](../src/utils/ssrf.ts) —
imported verbatim by both the daemon `safeFetch` and the OMP fetch-transport
adapter (`src/acp/omp/fetch-transport.ts`); nothing here forks, copies, or
softens a rule.

## The two supported egress postures (D6)

Both postures run the **identical shared rule set** (public allow;
loopback / RFC1918 / link-local / unique-local / unspecified / multicast /
cloud-metadata blocks; DNS answers validated per answer; fail closed on any
resolution failure). The posture changes **routing only**:

| Posture (`agent.sandbox.*`) | Adapter verdict for an allowed URL |
| --- | --- |
| `egressProxy: true` && `unrestrictedEgress: false` (default) + running validating proxy | `allow-via-proxy` — the request is issued against the consumed `getRunningEgressProxyUrl()` endpoint |
| `unrestrictedEgress: true` (operator opt-in) | `allow-direct` — every public case that enforcing allows is allowed with **no new denial introduced** and no proxy requirement |

Anything else (configured-but-dead proxy, or neither posture configured)
resolves to `unresolved`, which fails closed on every hop with the
adapter-only reason `egress-policy-unresolved`. **There is no YOLO-only
network denial anywhere**: native YOLO sessions register no replacement at
all (the exemption is structural at the registration site), and no posture
gains an extra block.

## Per-hop decision semantics

- Every issued request carries `redirect: "manual"`. The native
  `redirect: "follow"` shape (the P0-recorded bypass in `loadPage` /
  `fetchBinary`) is never emitted by this adapter: each Location is
  re-validated through the same rules **before** the next request is issued.
- The hop bound imports `MAX_REDIRECT_HOPS = 5` from `ssrf.ts` and blocks
  exactly when more than five redirects would be followed — the same
  accounting `safeFetch` performs (six-hop chains block with
  `hop-limit-exceeded`, never issuing the sixth followed hop).
- Scraper-derived secondary URLs (markdown/feed alternates, document-link
  retries, `.md`/llms.txt probes) re-enter the **same** per-hop decision
  with the **shared** hop budget; probes never reset or multiply it.
- Two block reasons are adapter-only by design — `hop-limit-exceeded`
  (the native auto-follow never sees it) and `egress-policy-unresolved`
  (transport facts unresolvable) — and are enumerable at the decision seam.
- Decision records and log lines carry `{ host, hopIndex, decision,
  reason }` only. No URL userinfo, query, headers, credentials, or payload
  bytes are representable in the record type; the URL survives into the
  *tool result* (the native output shape) exactly as the native `read`
  emits it, and into nothing else.

## DNS authority and pinning (D3)

Classification authority is `ssrf.ts`'s exported rules (`isDisallowedAddress`
et al.), applied to addresses from an injectable resolver boundary; empty or
failing answers block (`dns-unresolved`, fail closed like `safeFetch`).
Allowed plain-HTTP/IPv4 requests reuse `pinValidatedUrl` (connect-by-IP with
the original `Host` header), the same D3 remediation `safeFetch` uses. The
documented `ssrf.ts` **open question** carries over verbatim: HTTPS
hostname hosts cannot be connect-by-IP pinned under the current Deno/Bun
fetch surface — under the enforcing posture the validating proxy re-resolves,
re-validates, and pins at the actual egress point (the adapter's own
validation is *defense in depth* there, not the sole gate); under
`unrestrictedEgress` the operator has accepted raw egress risk (pre-existing
F14 posture, unchanged).

## `HTTP_PROXY` presence is NOT enforcement (consumed-facts honesty)

The factory's env assembly (`src/acp/agent-factory.ts`) stays **best-effort
and untouched**: it writes `HTTP_PROXY`/`HTTPS_PROXY` + loopback `NO_PROXY`
only under the enforcing posture with a running proxy. Its known
non-enforcement status is unchanged and fully owned by the F14 section of
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md): a client that ignores the env
vars escapes mediation, and the loopback `NO_PROXY` carve-out is host-wide.
The adapter's agent-process read (`fetchEgressPolicyFromAgentEnv`) consumes
the *same existing facts* — a well-formed loopback proxy URL selects the
via-proxy route, its absence reports the operator-selected unrestricted
posture, and a malformed/non-loopback value fails closed to `unresolved`.
**Ambiguity table:**

| Env shape seen in the agent process | Posture reported | What it does NOT mean |
| --- | --- | --- |
| `HTTP_PROXY`/`HTTPS_PROXY` = loopback validating-proxy URL | enforcing (via-proxy) | that any native client honors the vars, or that non-adapted traffic is mediated |
| no proxy vars | unrestricted (operator opt-in) | that adaptation is off — the adapter still decides every adapted hop |
| malformed / non-loopback proxy value | unresolved (every hop blocks) | a misconfiguration escape hatch |

No new config/env/Helm field exists anywhere in this layer.

## Trust separation (D5)

The Skill API loopback endpoint, operator-configured provider endpoints, and
the proxy endpoint itself are fixed deployment transport facts fixed at
spawn. They are never inputs to `decideFetchHop`: the presence of a trusted
loopback call never authorizes a model fetch to an arbitrary
loopback/private target, and no trusted-origin exception path exists.
Skill API traffic and provider routing stay architecturally distinct from
arbitrary tool fetch targets.

## Route completeness (frozen machine-readable table)

### Pinned-source citation table (re-verified at `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` / v18.6.1 — static reads of the pinned source, never executed native behavior; zero drift from the proposal wording)

| ID | Location (file + symbol) | Frozen fact |
| --- | --- | --- |
| S1 | `packages/coding-agent/src/tools/index.ts` (`ToolSession.fetch`) | `ToolSession` carries an optional `fetch?: FetchImpl` documented as injected into the URL read pipeline, defaulting to global fetch |
| S2 | `…/tools/fetch.ts` (`renderUrl`, `renderHtmlToText`) | The override reaches ONLY the reader-provider enrichment runners (`fetchImpl = fetchOverride ?? fetch`) |
| S3 | `…/web/scrapers/types.ts` (`loadPage`) | The primary page fetch bypasses the override: global `fetch` with `redirect: "follow"` |
| S4 | `…/web/scrapers/utils.ts` (`fetchBinary`) | The binary fetch bypasses it too: global `fetch` with `redirect: "follow"` |
| S5 | `…/tools/fetch.ts` (`tryMdSuffix`, `tryLlmEndpoints`, markdown/feed alternates, doc-link retry) | Secondary scraper URLs route through `loadPage`/`fetchBinary` and inherit the S3/S4 bypass |
| S6 | `…/tools/read.ts` (`parseReadUrlTarget` → `executeReadUrl`/`fetchReadUrl`) + `fetch.ts` (`materializeReadUrlToFile`) | The model's URL read enters via the `read` tool's URL branch; the file-shaped consumer is `materializeReadUrlToFile` |
| S7 | `…/extensibility/extensions/types.ts` (`registerTool`, `ToolDefinition.execute`, `ctx.invokeTool`) | The extension API exposes `registerTool(tool: ToolDefinition)` with execute + delegation context |
| S8 | `…/sdk.ts` (`nativeToolsByName` capture, `setNativeToolResolver`) + `runner.ts` (`getRegisteredTool`) | Extension tools are applied over the registry after natives are captured; last-extension-wins; natives reachable via same-tool `ctx.invokeTool` |
| S9 | `…/main.ts` (`createAcpSessionFactory`) + `sdk.ts` (`toolSession` literal) | **No** ACP-bootstrapped injection point populates `ToolSession.fetch` at the pin |

[`src/acp/omp/fetch-routes.ts`](../src/acp/omp/fetch-routes.ts)
`FETCH_ROUTE_TABLE` is the enumeration (statuses use only the P0 vocabulary
tiers; citations re-verified at pin `2a2c6dc` / v18.6.1):

- `completed-by-adapter`: `read.url-branch.text`,
  `read.url-branch.binary`, `read.url-branch.secondary-hops`,
  `read.url-branch.materialization-consumers` — served entirely by the
  trusted extension's `registerTool` name-replacement of `read`
  (last-extension-wins, natives captured, same-tool `ctx.invokeTool`
  delegation for non-URL inputs).
- `partial-seam-not-selected`: the native `ToolSession.fetch` seam —
  exists, enrichment reach only, and **no** supported ACP-bootstrapped
  injection point sets it; promotion would require a P0 revision.
- `blocked-pending-adapter` (each with `userDecisionRequired`):
  `native.loadPage.direct`, `native.fetchBinary.direct` (permanently blocked
  for callers outside the replacement — DECIDED disposition),
  `search-provider.subrequests` (row 20's adapter),
  `code-search.subrequests` (row 21's reserved slot).

14a's `url-read`/`web-fetch` inventory rows carry an additive
completing-adapter marker naming this change and the table; the
`web-search`/`code-search` rows are untouched, and until the native
invocation below is observed, 14b still blocks both URL-shaped outcomes at
`rejected_pending_adapter` — the marker is never a plain allow.

## Honesty table (D1) — what the suites do and cannot certify

| Claim | Status |
| --- | --- |
| Adapter decisions on every blocked/allowed/redirect/secondary/binary/credential/selector case | **Certified** by the mock-only suites (`tests/acp/omp-fetch-transport-decisions.test.ts`, `tests/acp/omp-fetch-transport-shapes.test.ts`; zero-network sentinel) |
| The compiled OMP binary invokes the registered replacement; `registerTool`/handler attach mechanics; per-request proxy execution at the pinned runtime | **UNVERIFIED, user-owned** — mock transport tests can never observe native traffic and clear nothing here |
| The P0 transport-bypass record (`loadPage`/`fetchBinary` auto-follow) | **Not cleared** by any local artifact; blocked rows above keep `userDecisionRequired` permanently |

### Section 15 user checklist (native-traffic observation)

Run against the real deployment (each item is user-owned; nothing in-repo
claims it):

1. In a restricted session, have the agent `read` a public URL and confirm
   the adapter-shaped result (`URL:`/`Content-Type:`/`Method:` header block)
   and the decision-record log line appear — the replacement is being
   invoked at all.
2. Point a URL read at a private IP (e.g. `http://169.254.169.254/`) and
   confirm a block naming `cloud-metadata`, and at a public host under the
   enforcing posture confirm the proxy observes the CONNECT.
3. Trigger a redirect chain (public redirector → private target) and
   confirm the private hop is never issued.
4. Confirm native non-adapted clients' env-proxy honoring (the pre-existing
   F14 test: private IP + confirm 403 from the proxy) — this adapter does
   not change that residual.
