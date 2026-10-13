# OMP Network Transport (Row 19 — `control-omp-url-fetch-transport`)

This document is the transport-side counterpart to
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) (F14 egress mediation): the
permission gate decides _whether a tool call may run_; this layer decides,
per hop, _where an admitted URL read is allowed to go and how_. Rule source
stays a single classifier — [`src/utils/ssrf.ts`](../src/utils/ssrf.ts) —
imported verbatim by both the daemon `safeFetch` and the OMP fetch-transport
adapter (`src/acp/omp/fetch-transport.ts`); nothing here forks, copies, or
softens a rule.

## The two supported egress postures (D6)

Both postures run the **identical shared rule set** (public allow;
loopback / RFC1918 / link-local / unique-local / unspecified / multicast /
cloud-metadata blocks; DNS answers validated per answer; fail closed on any
resolution failure). The posture changes **routing only**:

| Posture (`agent.sandbox.*`)                                                             | Adapter verdict for an allowed URL                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `egressProxy: true` && `unrestrictedEgress: false` (default) + running validating proxy | `allow-via-proxy` — the request is issued against the consumed `getRunningEgressProxyUrl()` endpoint                           |
| `unrestrictedEgress: true` (operator opt-in)                                            | `allow-direct` — every public case that enforcing allows is allowed with **no new denial introduced** and no proxy requirement |

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
  _tool result_ (the native output shape) exactly as the native `read`
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
validation is _defense in depth_ there, not the sole gate); under
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
the _same existing facts_ — a well-formed loopback proxy URL selects the
via-proxy route, its absence reports the operator-selected unrestricted
posture, and a malformed/non-loopback value fails closed to `unresolved`.
**Ambiguity table:**

| Env shape seen in the agent process                        | Posture reported               | What it does NOT mean                                                           |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `HTTP_PROXY`/`HTTPS_PROXY` = loopback validating-proxy URL | enforcing (via-proxy)          | that any native client honors the vars, or that non-adapted traffic is mediated |
| no proxy vars                                              | unrestricted (operator opt-in) | that adaptation is off — the adapter still decides every adapted hop            |
| malformed / non-loopback proxy value                       | unresolved (every hop blocks)  | a misconfiguration escape hatch                                                 |

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

| ID | Location (file + symbol)                                                                                             | Frozen fact                                                                                                                                     |
| -- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | `packages/coding-agent/src/tools/index.ts` (`ToolSession.fetch`)                                                     | `ToolSession` carries an optional `fetch?: FetchImpl` documented as injected into the URL read pipeline, defaulting to global fetch             |
| S2 | `…/tools/fetch.ts` (`renderUrl`, `renderHtmlToText`)                                                                 | The override reaches ONLY the reader-provider enrichment runners (`fetchImpl = fetchOverride ?? fetch`)                                         |
| S3 | `…/web/scrapers/types.ts` (`loadPage`)                                                                               | The primary page fetch bypasses the override: global `fetch` with `redirect: "follow"`                                                          |
| S4 | `…/web/scrapers/utils.ts` (`fetchBinary`)                                                                            | The binary fetch bypasses it too: global `fetch` with `redirect: "follow"`                                                                      |
| S5 | `…/tools/fetch.ts` (`tryMdSuffix`, `tryLlmEndpoints`, markdown/feed alternates, doc-link retry)                      | Secondary scraper URLs route through `loadPage`/`fetchBinary` and inherit the S3/S4 bypass                                                      |
| S6 | `…/tools/read.ts` (`parseReadUrlTarget` → `executeReadUrl`/`fetchReadUrl`) + `fetch.ts` (`materializeReadUrlToFile`) | The model's URL read enters via the `read` tool's URL branch; the file-shaped consumer is `materializeReadUrlToFile`                            |
| S7 | `…/extensibility/extensions/types.ts` (`registerTool`, `ToolDefinition.execute`, `ctx.invokeTool`)                   | The extension API exposes `registerTool(tool: ToolDefinition)` with execute + delegation context                                                |
| S8 | `…/sdk.ts` (`nativeToolsByName` capture, `setNativeToolResolver`) + `runner.ts` (`getRegisteredTool`)                | Extension tools are applied over the registry after natives are captured; last-extension-wins; natives reachable via same-tool `ctx.invokeTool` |
| S9 | `…/main.ts` (`createAcpSessionFactory`) + `sdk.ts` (`toolSession` literal)                                           | **No** ACP-bootstrapped injection point populates `ToolSession.fetch` at the pin                                                                |

[`src/acp/omp/fetch-routes.ts`](../src/acp/omp/fetch-routes.ts)
`FETCH_ROUTE_TABLE` is the enumeration (statuses use only the P0 vocabulary
tiers; citations re-verified at pin `2a2c6dc` / v18.6.1):

- `completed-by-adapter`: `read.url-branch.text`,
  `read.url-branch.binary`, `read.url-branch.secondary-hops`,
  `read.url-branch.materialization-consumers` — served entirely by the
  trusted extension's `registerTool` name-replacement of `read`
  (last-extension-wins, natives captured, same-tool `ctx.invokeTool`
  delegation for non-URL inputs).
- Owned skill-URI reads (`repair-omp-owned-skill-handoff`): the same `read`
  replacement declares the pinned native `readsSkillUris` capability and
  classifies `skill://` inputs on their OWN branch — distinct from HTTP(S),
  local paths, and the blanket rejected-scheme denial. An owned
  `SkillUriAuthorization` seam resolves the URI ONLY against the declared
  canonical owned source (`OMP_IMAGE_SKILLS_ROOT`), gated on the live
  discovery generation and per-call link-free identity/writability/containment
  checks of the target. Authorized reads delegate the ORIGINAL URI once
  through `ctx.invokeTool` to the captured native skill reader (zero network
  dispatch; the canonical path is authorization evidence only, never a
  rewritten native argument); unwired seams, foreign same-name shadows,
  symlink-replaced identities, traversal spellings, stale/absent generations,
  and off-image roots deny BEFORE delegation with no fallback root. Network
  completion grants nothing here: the URL-route completion above and the
  skill-URI admission are independent decisions. The grant stays IMAGE-ONLY
  and is unchanged by `bind-omp-owned-module-evidence`: an owned DEVELOPMENT
  module never adds a skill-URI root or a fallback source, and the separately
  selected native script root used by delivered prompts does not expand this
  URI authorization.
- `partial-seam-not-selected`: the native `ToolSession.fetch` seam —
  exists, enrichment reach only, and **no** supported ACP-bootstrapped
  injection point sets it; promotion would require a P0 revision.
- `blocked-pending-adapter` (each with `userDecisionRequired`):
  `native.loadPage.direct`, `native.fetchBinary.direct` (permanently blocked
  for callers outside the replacement — DECIDED disposition),
  `search-provider.subrequests` (row 20's adapter).

14a's `url-read`/`web-fetch` inventory rows carry an additive
completing-adapter marker naming this change and the table; the
`web-search` row is untouched by the marker. Since
`admit-completed-omp-network-adapters`, the 14b clamp consumes the route
owner's typed completion: a URL-shaped call on the registered owned `read`
replacement proceeds to the NAMED completing boundary (the completed route
set is recorded on the proceed); every other URL-shaped case — the `webfetch`
surface, an unregistered or shadowed name — still blocks at
`rejected_pending_adapter`. The marker is never a plain allow either way,
and the compiled-binary invocation claim below stays user-owned: completion
is composition evidence, not native observation.

Since `bind-omp-owned-module-evidence` the ownership step in front of this
completion uses PHYSICAL deployment-module evidence instead of session
identity, so the owned `read`/`web_search` replacements genuinely reach this
clamp in production with no acquired session context. The clamp's own
registration evidence is no longer a name-only membership test: the live
roster record for the exact name must BE this owned extension AND pass the
full provenance admission (physical evidence against the accepted anchor,
coherent epoch/generation) at this instant, so a foreign same-name
registration can never complete a controlled route. Denials still perform no
transport or backend delegation, and absent credentials still block
`rejected_pending_adapter` with no native-provider fallback.

## Honesty table (D1) — what the suites do and cannot certify

| Claim                                                                                                                                                  | Status                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter decisions on every blocked/allowed/redirect/secondary/binary/credential/selector case                                                          | **Certified** by the mock-only suites (`tests/acp/omp-fetch-transport-decisions.test.ts`, `tests/acp/omp-fetch-transport-shapes.test.ts`; zero-network sentinel) |
| The compiled OMP binary invokes the registered replacement; `registerTool`/handler attach mechanics; per-request proxy execution at the pinned runtime | **UNVERIFIED, user-owned** — mock transport tests can never observe native traffic and clear nothing here                                                        |
| The P0 transport-bypass record (`loadPage`/`fetchBinary` auto-follow)                                                                                  | **Not cleared** by any local artifact; blocked rows above keep `userDecisionRequired` permanently                                                                |

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

## Web-search transport adapter (row 20 — `adapt-omp-web-search`)

This section extends (does not rewrite) the fetch sections above: the
web-search adapter reuses row 17's decision core wholesale — the same
`ssrf.ts` single classifier, the same enforcing/unrestricted postures, the
same `MAX_REDIRECT_HOPS = 5` manual per-hop revalidation and credential-free
`{ host, hopIndex, decision, reason }` records — via
[`src/acp/omp/search-transport.ts`](../src/acp/omp/search-transport.ts)
(`decideSearchRoute` delegates to `decideFetchHop`; search-only reason codes
are credential-scope only: `no-supported-credential`,
`explicit-model-outside-supported-set`).

### Pinned-source citation table (re-verified at `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` / v18.6.1 — static reads of the pinned source, never executed native behavior)

| ID  | Location (file + symbol)                                                                                                                                                                                       | Frozen fact                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | `packages/coding-agent/src/tools/index.ts` + `tools/settings.ts` (`cfgWebSearchEnabled`)                                                                                                                       | Built-in `web_search` is constructed per session (default ON); a registered extension tool replaces it (S8 last-extension-wins)                                                                                                                                                                              |
| W2  | `…/web/search/index.ts` (`executeSearch` candidate loop)                                                                                                                                                       | The provider `SearchParams` literal is built WITHOUT any `fetch` field — provider requests cannot be transport-injected on the native call path                                                                                                                                                              |
| W3  | `…/web/search/provider.ts` (`PROVIDER_LOADERS`, `GROUNDED_PROVIDER_LOADERS`)                                                                                                                                   | Both registries exist: grounded backends beyond Gemini/OpenRouter are each secret-gated; the pure engines are paid-key or keyless scraping surfaces                                                                                                                                                          |
| W4  | `…/web/search/providers/gemini.ts` (`callGeminiDeveloperSearch`, `isAvailable`) + `docs/providers.md` env table + `packages/ai/src/providers/google.ts`                                                        | Gemini developer-API grounding POSTs `${base}/models/gemini-2.5-flash:streamGenerateContent?alt=sse` with `x-goog-api-key`; the `google` provider's env fallback is `GEMINI_API_KEY` — already in row 7's set                                                                                                |
| W5  | `…/web/search/providers/openrouter.ts` + `docs/providers.md` env table                                                                                                                                         | OpenRouter web-plugin grounding POSTs `${baseUrl}/chat/completions` with `plugins:[{id:"web"}]`, `authorization: Bearer`; env fallback `OPENROUTER_API_KEY` — also in row 7's set. RECORDED CORRECTION: the proposal cited the pi-ai `stream.ts` env-key table; at this pin the table is `docs/providers.md` |
| W6  | `…/web/search/providers/base.ts` + `gemini.ts`/`openrouter.ts` (`(fetchImpl ?? fetch)`)                                                                                                                        | The `fetch?: FetchImpl` seam exists on the parameter type and both providers honor it with a global-fetch fallback — but W2's caller never populates it (the same PARTIAL shape as `ToolSession.fetch`)                                                                                                      |
| W7  | `…/web/search/providers/gemini.ts` (`fetchWithRetry` MAX_RETRIES=3; `finalizeGeminiSearchResult`/`resolveGroundingRedirect` HEAD `redirect:"manual"` 5 s) + `providers/utils.ts` (`classifyProviderHttpError`) | Unguarded retry + grounding-redirect HEAD enrichment subrequests leave on the unpopulated seam; the HTTP error classification shape is the honest-failure interface mirrored here                                                                                                                            |
| W8  | `…/web/search/index.ts` (`formatForLLM`, `hasRenderableSearchContent`, zero-available / all-failed / no-sources-204 branches) + `packages/utils/src/format.ts`                                                 | The native result observable is the `{ content:[{type:"text"}], details:{response, error?} }` envelope over the `formatForLLM` layout with exactly those honest branches — the interface-parity target                                                                                                       |
| W9  | `…/web/search/index.ts` (`WebSearchTool.execute`)                                                                                                                                                              | The tool consumes only session auth/registry/model surface; no transport seam is exposed for ACP bootstrapping to populate                                                                                                                                                                                   |
| W10 | row-17 S7/S8 (consumed import-only)                                                                                                                                                                            | The `registerTool` replacement mechanism + same-tool `ctx.invokeTool` delegation are the row-17 verified surfaces, reused verbatim                                                                                                                                                                           |

### Backend tiering (frozen machine-readable table)

[`src/acp/omp/search-routes.ts`](../src/acp/omp/search-routes.ts)
`SEARCH_ROUTE_TABLE` enumerates every pinned search surface, keyed to row
7's credential set (`GEMINI_API_KEY` + `OPENROUTER_API_KEY` **only**):

- `completed-by-adapter`: `web_search.grounding.gemini`,
  `web_search.grounding.openrouter`, and their
  `web_search.grounding.grounding-redirect-enrichment` secondary-hop route —
  served entirely by the trusted extension's `registerTool` name-replacement
  of `web_search` (restricted sessions only), ACTIVE exactly where the
  backend's credential is present (`webSearchSeamState`; Gemini first, then
  OpenRouter — selection is presence-only and never switches on failure).
- `candidate-to-verify` (`userDecisionRequired`): `web_search.scraping-engines`
  — keyless scraping backends exist but were NOT selected (admitting them
  adds arbitrary-provider config, which this change never does; the scraper
  redirect-following bypass routes stay blocked).
- `no-supported-mechanism` (`userDecisionRequired`):
  `web_search.unsupported-credential-set.backends` — grounded
  anthropic/codex/xai/openai and the paid engines each need their own
  provider secret. **Design §9: no unrelated vendor secret is added merely
  to select OMP search** — these stay blocked; promotion needs a P0 revision
  plus an explicit user decision.
- `blocked-pending-adapter` (`userDecisionRequired`, permanently for
  outsiders): `web_search.native.global-fetch-provider-path` — any caller
  outside the replacement keeps the P0-recorded bypass (unpopulated seam,
  global fetch, auto-redirects, `fetchWithRetry`).

14a's `web-search` inventory row carries the additive completing-adapter
marker naming this change and the table — backend-gated and route-scoped: it
is NOT a plain allow (kind unchanged). Since
`admit-completed-omp-network-adapters` the row also carries the native
replacement name `web_search` (never deny-by-absence), and 14b consumes the
backend-gated decision per call: registered owned replacement + a supported
backend's EXACT completed grounding route proceeds to the named boundary;
with no supported credential — or no registered owned replacement — it still
fails closed at `rejected_pending_adapter` with zero endpoint requests. The
`url-read`/`web-fetch` rows and row 17's `fetch-routes.ts` completed set are
byte-identical; the cross-table test
pins that `search-provider.
subrequests` stays `blocked-pending-adapter` there and never gets cited
pending against a completed contract here.

### Controlled routing and interface honesty

The provider endpoint request and every Gemini grounding-redirect
enrichment HEAD re-enter the SAME per-hop decision (validating proxy under
enforcing posture, `redirect: "manual"`, hop bound, fail-closed on
unresolvable DNS/policy); enrichment `Location` targets are re-validated as
their own secondary hops with the native keep-the-proxy-URL failure default,
bounded count (10) and timeout (5 s). One controlled attempt per decision —
no `fetchWithRetry`-style unguarded retry. The result stays the agent's
native shape: `formatForLLM` layout (`## Sources`/`## Citations`, snippet
truncate 240), honest branches only — no-configured-model, provider
auth/rate/HTTP/malformed failures name-tagged via the pinned classification
shape, and the zero-sources refusal — **never** fabricated results, **never**
a backend switch on failure, **never** an agent switch; empty-vs-error stays
distinct. Credentials appear in request construction only: records, logs,
and envelopes are credential- and payload-free.

**Capability gap:** with neither `GEMINI_API_KEY` nor `OPENROUTER_API_KEY`
present, restricted `web_search` fails closed to the native-shaped
`Error: No web search model configured.` with zero transport and the
credential-scope block record; the route stays `blocked-pending-adapter` /
`userDecisionRequired` — a documented gap, not an invented mechanism.
**Seam posture with credentials present (`admit-completed-omp-network-adapters`):**
the composition-side consumption step formerly deferred here has landed: the
14b clamp honors the route owner's typed decision — the registered owned
`web_search` replacement plus a CURRENT supported backend's completed
grounding route proceeds to the NAMED completing boundary (credential
presence read fresh per call, presence booleans only). This changes no
evidence limit: the proceed is composition-evidence-only, the per-hop
transport policy inside the replacement is untouched, and every pinned
verdict and evidence limit above is unchanged.
**Native YOLO sessions** keep native search with no adapter clamp (14b
posture, D6): the replacement registers restricted-sessions-only and
delegates nothing in YOLO because it never registers there.

### Honesty (search addendum to the D1 table)

| Claim                                                                                              | Status                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter decisions + interface shape on every credential/allow/block/redirect/enrichment/error case | **Certified** by the mock-only suites (`tests/acp/omp-search-transport-decisions.test.ts`, `tests/acp/omp-search-interface-shape.test.ts`; zero-network sentinel, zero paid/live search) |
| The compiled OMP binary invokes the `web_search` replacement / adapter at the pinned runtime       | **UNVERIFIED, user-owned** — mock suites certify adapter decisions ONLY; positive replacement-mechanism fixtures are labeled synthetic and clear nothing native                          |
| The P0 web-search bypass record (global-fetch provider path, `fetchWithRetry`)                     | **Not cleared** by any local artifact; the blocked rows above keep `userDecisionRequired` permanently                                                                                    |

Section 15 checklist additions (user-owned, real deployment):

5. In a restricted session with `GEMINI_API_KEY` (or `OPENROUTER_API_KEY`
   only) present, run a `web_search` query and confirm the adapter-shaped
   `formatForLLM` result plus the `[air-search-adapter]` decision-record log
   line — the replacement is being invoked at all.
6. With neither key present, confirm the honest
   `Error: No web search model configured.` and zero egress from the
   session for that call.
7. Under the enforcing posture, confirm the proxy observes the provider
   CONNECT (and the grounding-redirect HEAD), and that a synthetic
   grounding-redirect `Location` pointing at a private address is never
   issued.

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section H: adapter/proxy mediation incl. binary/text fetch, redirects, private-target failures; the F14 residual and per-request-proxy candidate stay open there).

## Native tool-contract alignment (correction batch C2 — `align-omp-native-tool-contracts`)

The `read`/`web_search` replacement definitions carry the pinned-mandatory
`parameters` schema (closed objects; the canonical bare `@sinclair/typebox`
builder facade the pinned legacy loader host-resolves — see
[OMP_PACKAGING.md](OMP_PACKAGING.md) §5 for the boundary exception). The
schemas are the executors' declared input vocabulary 1:1, so the host
input-gate rejects invalid declared fields (including an undeclared
`provider` request) BEFORE transport dispatch — the executor-side parsers
stay as the independent second layer, and every per-hop decision, posture,
and record stays the adapter's own. URL-read results are native
`AgentToolResult.content` arrays: a supported inline image becomes one
base64 `ImageContent`; any other binary is the pinned
`[Binary content: <mime>, <size>] <url>` text descriptor with the exact
bytes kept base64 in `details.binaryData` — model-facing content never
carries arbitrary bytes, and no new filesystem materialization sink exists.
None of this changes what egress is decided or who decides it.
