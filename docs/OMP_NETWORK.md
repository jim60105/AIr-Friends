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
is NOT a plain allow (kind unchanged; with no supported credential 14b still
fails closed at `rejected_pending_adapter`). The `url-read`/`web-fetch`
rows, the `code-search` row (until row 21's own additive credential-gated
marker — see the code-search section below), and row 17's `fetch-routes.ts`
are byte-identical; the cross-table test pins that `search-provider.
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
**Interim posture even with credentials present:** 14b's composition still
blocks the `allow-gated-pending-adapter` outcome at
`rejected_pending_adapter` — the completed-route distinction is not wired
into the handler by this change (14b is owned elsewhere), so the reachable
capability turns on only once that composition-side step lands or the §15
observation confirms the replacement path; until then the adapter serves
decision data and the registered replacement, not the gated handler.
**Batch ownership gap (recorded for routing):** the required completion
step — the 14b gated handler honoring completed web-search routes via
`webSearchSeamState`/credential-presence input instead of blocking every
`allow-gated-pending-adapter` outcome — has no owner in this change (the
spec forbids row 20 from touching `enforcement.ts`); it needs a later
batch row or an explicit follow-up, or live web-search capability stays
dark even with `GEMINI_API_KEY`/`OPENROUTER_API_KEY` present.
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

## Public-code-search adapter contract (row 21 — `adapt-omp-public-code-search`)

This section extends (does not rewrite) the fetch and search sections above.
Its honest verdict is stronger than a mechanism gap: **the design §6/D4
parity premise is false at the pins, and no supported public-code-search
backend exists under the approved credential set.** OpenCode REMOVED its
`codesearch` tool upstream before the packaging pin, and pinned OMP has no
code-search tool. Public code/docs **content** remains reachable through the
completed URL-read route (rows 17/18, incl. the C8 special handlers as
validated secondary hops); a dedicated code-**search** backend stays blocked
with a documented capability gap and an explicit user decision — never a
fabricated fallback, never a NEVER_PASS secret promotion, never keyless
scraping (DECIDED disposition).

### Pinned-source citation table (re-verified at OpenCode tag `v1.18.21` / tree `826d9ad46a22bef0294998e08daa3c4904fea28f` and OMP `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` / v18.6.1 — static reads, never executed native behavior)

| ID | Location (file + symbol)                                                                                                                                                                 | Frozen fact                                                                                                                                                                          |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 | OpenCode tag tree (no `tool/codesearch.ts`; 404) + commits API for that path                                                                                                             | The parity tool is **removed upstream before the pin**: last commit touching it is `2481dde36d9aeb48de9fb21ffd2cfdc1d42804f1` — "chore: remove codesearch tool (#27019)", 2026-05-12 |
| C2 | `tool/registry.ts` + `agent-config/opencode.json`                                                                                                                                        | The `codesearch: "allow"` rule is **inert** — ids build from instantiated tools only; no `codesearch` id exists to match                                                             |
| C3 | `tool/mcp-websearch.ts`, `tool/websearch.ts`                                                                                                                                             | What OpenCode retains is webfetch reads + Exa/Parallel hosted-MCP websearch — neither is a code-index backend                                                                        |
| C4 | repo audit (`skills/`, repo-wide `grep_app`/`gh_grep`/`GREP_APP_API_TOKEN` zero hits; `git-backup-service.ts`/`git-credential-setup.ts` are GITHUB_TOKEN's only consumers)               | No code-search skill ships; no code-search token exists anywhere; the batch's external-skill premise is false at the pins                                                            |
| C5 | `skill-installer.ts` + `sandbox-manager.ts` (`AGENT_TYPE_ENV` sets, `NEVER_PASS_ENV`)                                                                                                    | External skills carry no per-skill token plumbing; neither agent credential set carries a GitHub credential; `GITHUB_TOKEN` is NEVER_PASS                                            |
| C6 | OMP `tools/builtin-names.ts`, `tools/index.ts`, `web/search/provider.ts`                                                                                                                 | Pinned OMP has no code-search tool and no code-index provider; the only surface is the `github` tool's `search_code`                                                                 |
| C7 | `tools/gh-search.ts` (`executeSearchCode`), `utils/github.ts` (`GH_NON_INTERACTIVE_ENV`, gh-auth-store failure text), `Containerfile`                                                    | `search_code` spawns the external `gh` binary with gh's own auth store; subprocess HTTP is invisible to any fetch-level decision core; the image installs no `gh`                    |
| C8 | `web/scrapers/index.ts` (`specialHandlers`), `searchcode.ts`, `sourcegraph.ts`, `tools/fetch.ts`                                                                                         | Keyless code/docs scraping exists ONLY as fetch-pipeline special handlers (URL → provider-API secondary) — the secondary class row 17 already controls                               |
| C9 | `tools/gh-search.ts` (`SEARCH_LIMIT_DEFAULT = 10`, `SEARCH_LIMIT_MAX = 50`, `FILE_PREVIEW_LIMIT = 50`, `apiCodeToSearchResult`/`formatSearchCodeResults`), `utils/github.ts` (8 MiB cap) | The pinned observable bounds and attribution shape the interface-parity contract documents                                                                                           |

### Route tiering (frozen machine-readable table)

[`src/acp/omp/code-search-routes.ts`](../src/acp/omp/code-search-routes.ts)
`CODE_SEARCH_ROUTE_TABLE`:

- `no-supported-mechanism` (`userDecisionRequired`):
  `code_search.github-api` — the GitHub Code Search API route the **reserved**
  trusted-extension `registerTool` completion would serve, gated on a
  supported read-only code-search credential the approved path does not
  register (C4/C5). Keyed to row 7's credential path: **design §9 — no
  unrelated vendor secret is required or promoted merely to select a
  backend.** `GITHUB_TOKEN` is registered for git backup/credential-store,
  sits in `NEVER_PASS_ENV`, and using it as a code-search credential would
  expand a repo-write-capable secret into the restricted agent (design D2)
  — this change never softens that rule and never promotes the name. Also
  `no-supported-mechanism`: `code_search.native.github-cli-search-code` —
  absent `gh` binary, gh's own auth store, subprocess transport outside the
  decision core (C6/C7).
- `candidate-to-verify` (`userDecisionRequired`, **not selected**):
  `code_search.scraping-handlers` — keyless searchcode/Sourcegraph handlers
  exist only inside row 17's completed URL-read route as validated secondary
  hops (C8); admitting a dedicated scraping tool would add arbitrary-provider
  config, which this change never does. "No scraping tool" ≠ "can't read
  those public sites": URL reads of them stay available through the
  controlled transport.
- `completed-by-adapter` (reference row, never claimed here):
  `code_search.url-read-content-path` — public code/docs content via rows
  17/18's completed routes. The design §6 parity decomposition (local text
  search native + URL-read content + provider-grounded web search + this
  honest gap) is machine-readable through this row.

### Controlled hop delegation and interface-parity contract

[`src/acp/omp/code-search-transport.ts`](../src/acp/omp/code-search-transport.ts)
`decideCodeSearchRoute` is pure over the injected
`{ resolveHost, credentialPresence, posture }` and delegates EVERY hop —
search endpoint and result-enrichment subrequest alike — to row 17's
`decideFetchHop` verbatim: same `ssrf.ts` single classifier, same
enforcing/unrestricted postures (the operator unrestricted posture adds no
new denial), `MAX_REDIRECT_HOPS = 5` manual per-hop revalidation,
credential-free `{ host, hopIndex, decision, reason }` records. The single
code-search-only reason addition is the credential-scope
`no-supported-credential`. No second stack, no new posture value, no
unguarded retry (one controlled attempt per decision; the executor strips
the credential header on any cross-origin redirect hop).

The interface-parity contract (spec-locked for the future sibling; C9
bounds): query-parameter pass-through; per-item **excerpt** (preview bound
50), **source attribution** (source URL), repository identity
(`nameWithOwner`-style), file path, language metadata; documented size
bounds (limit default 10 / max 50, total-rendered bound). Honesty rules are
row 18's verbatim: auth/rate/HTTP/malformed failures surface as honest
native-shape tool errors naming the provider — **never** fabricated
results, **never** an unguarded retry, **never** a backend or agent switch;
zero matches is an honest empty naming the query, distinct from every error
shape. Records/logs never carry credentials, headers, query strings, or
payload bytes.

### Capability gap and the user decision (credential absent — today's state)

With no supported code-search credential the decision is
`blocked_pending_adapter` + `userDecisionRequired` with ZERO transport (the
route stays `allow-gated-pending-adapter` at 14a /
`rejected_pending_adapter` at 14b). Both user decision options:

1. **Provision a separate read-only code-search credential** through row 7's
   approved config path (never a re-pointed `GITHUB_TOKEN`) — this flips
   the route table's credential predicate (exported data:
   `CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME`), after which the reserved
   `registerTool` completion (the 6th serial sibling of the
   12→13→14b→17→18 tree) lands against this change's pinned contract.
   Unauthenticated GitHub Code Search is unusable (rate-capped and
   auth-required), so a token is genuinely load-bearing, not ceremonial.
2. **Accept the gap**: local text search stays native (14a read-class),
   public code/docs content stays reachable through the completed URL-read
   route; no dedicated code-index search backend ships.

**The reserved mechanism is additionally unconsumable by the current
composition:** 14b's gated handler blocks every `allow-gated-pending-adapter`
outcome at `rejected_pending_adapter` without consulting completed-route
seam state, so a live code-search route needs THREE things: the credential
provisioning above, the composition-side seam-state step (the same
**Batch ownership gap** recorded in the web-search section above, now
covering the code-search route as well:
the 14b gated handler honoring `webSearchSeamState`/`codeSearchSeamState` +
credential-presence input instead of blocking every pending-adapter outcome
— no owner in this change, which forbids touching `enforcement.ts`; needs a
later batch row or explicit follow-up, or live web-search AND code-search
capability stay dark even with credentials present), and the section-15
native-observation below. A test pins that 14b still blocks even with a
synthetic activated marker. `HTTP_PROXY` alone remains non-enforcement
(unchanged honesty table); the Skill API loopback and proxy endpoint stay
out of every decision input; search endpoint hosts are validated like every
target with no exemption.

### Honesty (code-search addendum to the D1 table)

| Claim                                                                                                                                                                | Status                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter decisions + interface shape under both postures, credential-presence matrix, fail-closed gap with zero issued requests, record hygiene, route-table verdicts | **Certified** by the mock-only suites (`tests/acp/omp-code-search-transport-decisions.test.ts`, `tests/acp/omp-code-search-interface-shape.test.ts`; zero-network sentinel, zero live GitHub traffic) |
| A supported public-code-search backend exists at these pins                                                                                                          | **No** — the D4 premise-false finding stands (parity tool removed upstream; no OMP backend under the approved credential set); no mock or marker clears it                                            |
| The compiled OMP binary would invoke the reserved registerTool completion                                                                                            | **UNVERIFIED, user-owned** — no tool is registered in this state; synthetic executor fixtures are labeled P0 fixtures and certify adapter decisions ONLY                                              |

Section 15 checklist additions (user-owned, real deployment):

8. Confirm the external-CLI native surface is unreachable in restricted
   mode: a `github` `search_code` call is denied by 14a's default-deny and
   no `gh` binary exists in the image.
9. IF (and only if) the credential-provisioning decision lands and the
   reserved sibling registers: run a code-search query in a restricted
   session and confirm the adapter-shaped result plus the
   `[air-codesearch-adapter]` decision-record log line — the replacement is
   being invoked at all.
10. Under the enforcing posture, confirm the proxy observes the
    `api.github.com` CONNECT and that a synthetic redirect `Location`
    pointing at a private address is never issued.
