/**
 * Machine-readable Web-Search route enumeration (row 20,
 * `adapt-omp-web-search`, design D2/D4).
 *
 * One row per pinned search route: which backend routes the trusted
 * extension's `registerTool` name-replacement of `web_search` completes
 * through the controlled transport (`completed-by-adapter`, gated on the
 * row-7 credential presence), which scraping engines exist keyless in the
 * pinned registry but were NOT selected (`candidate-to-verify`), which
 * backends are selectable only with a secret the design refuses to add
 * (`no-supported-mechanism`, design §9 no-unrelated-vendor-secret), and
 * which route stays blocked for any caller outside the replacement
 * (`blocked-pending-adapter`, each `blocked-pending-adapter`/`no-supported-
 * mechanism`/`candidate-to-verify` row carrying `userDecisionRequired`).
 * Citations are the W1-W10 pinned-source facts re-verified at commit
 * `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` (v18.6.1) with file + symbol
 * locations frozen this session — static reads of the pinned source, never
 * executed native behavior. One citation-location correction against the
 * proposal wording is recorded on W5 (the env-key table lives in
 * `docs/providers.md` at the pin, not the pi-ai `stream.ts`).
 *
 * Honesty invariants: statuses use the P0 vocabulary tiers; NO row claims
 * `supported` for native-binary behavior; the mock acceptance suites
 * certify this change's adapter decisions only and can never clear the P0
 * bypass record (W6/W7) or prove the compiled binary invokes the
 * replacement (design §15 user checklist, unverified). Backend gating: the
 * completed rows are active EXACTLY where a supported-tier credential is
 * present (`webSearchSeamState`); a credential-absent deployment keeps the
 * 14a pending outcome and the 14b `rejected_pending_adapter` block.
 */

import { PINNED_OMP_COMMIT, PINNED_OMP_VERSION } from "./compatibility-contracts.ts";
import type { SearchCredentialPresence } from "./search-transport.ts";

/** The P0 vocabulary tiers used by this table; no row claims `supported`. */
export type SearchRouteStatus =
  | "completed-by-adapter"
  | "candidate-to-verify"
  | "no-supported-mechanism"
  | "blocked-pending-adapter";

/** The selected supported mechanism (D2), stated once for its rows. */
export const SEARCH_COMPLETING_MECHANISM =
  "trusted-extension registerTool name-replacement of `web_search` (last-extension-wins, S7/S8 " +
  "reused per W10): search calls served entirely by the search-transport adapter over the " +
  "row-17 controlled transport; YOLO/non-restricted and delegation calls go verbatim to the " +
  "captured native via the same-tool ctx.invokeTool resolver (W10)";

/** One pinned source citation backing a route verdict. */
export interface SearchRouteCitation {
  readonly id: "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8" | "W9" | "W10";
  readonly ompVersion: string;
  readonly ompCommit: string;
  readonly location: string;
  readonly fact: string;
}

const PIN = { ompVersion: PINNED_OMP_VERSION, ompCommit: PINNED_OMP_COMMIT } as const;

/** The frozen W1-W10 citation set (re-verified at the pin; one recorded
 *  citation-location correction on W5, no behavioral drift). */
export const SEARCH_ROUTE_CITATIONS: readonly SearchRouteCitation[] = Object.freeze(
  [
    {
      id: "W1",
      ...PIN,
      location:
        "packages/coding-agent/src/tools/index.ts (`web_search: s => new WebSearchTool(s)` " +
        "construction table) + packages/coding-agent/src/tools/settings.ts (cfgWebSearchEnabled, " +
        "setting id `web_search.enabled`, default true)",
      fact:
        "The built-in `web_search` tool is constructed per session (gated by cfgWebSearchEnabled, " +
        "default ON), so the tool surface a restricted session sees is the native built-in unless a " +
        "registered extension tool replaces it (S8 last-extension-wins).",
    },
    {
      id: "W2",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/index.ts (executeSearch candidate loop; the " +
        "`provider.search({ ... })` parameter literal)",
      fact:
        "executeSearch walks the configured web-model role chain and builds the provider SearchParams " +
        "literal WITHOUT any `fetch` field, so provider requests cannot be transport-injected on the " +
        "native call path.",
    },
    {
      id: "W3",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/provider.ts (PROVIDER_LOADERS engine registry: brave, " +
        "tavily, exa, jina, perplexity, kagi, firecrawl, duckduckgo, mojeek, ecosia, startpage, " +
        "public, scraping google, ...; GROUNDED_PROVIDER_LOADERS: gemini, anthropic, codex, xai, " +
        "openrouter, openai)",
      fact:
        "Both provider registries exist at the pin: grounded backends beyond Gemini/OpenRouter " +
        "(anthropic/codex/xai/openai) and the pure search engines (paid keys or keyless scraping) are " +
        "all selectable in native code — each outside the row-7 credential set is credential-gated or " +
        "an operator-unconfigured scraping surface, never selectable by this deployment.",
    },
    {
      id: "W4",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/providers/gemini.ts (callGeminiDeveloperSearch: " +
        "`${endpoint.url}/models/${model}:streamGenerateContent?alt=sse`, `x-goog-api-key` header via " +
        "modelRegistry.resolver + withAuth; GeminiProvider.isAvailable: authStorage.keys.source(" +
        "\"google\") for api `google-generative-ai`) + docs/providers.md env table (`google` -> " +
        "GEMINI_API_KEY) + packages/ai/src/providers/google.ts (`requires an API key (GEMINI_API_KEY " +
        "or options.apiKey)`)",
      fact:
        "The Gemini developer-API grounding path runs on the `google` provider whose API-key env " +
        "fallback is GEMINI_API_KEY — row 7's credential set already carries it; the request is one " +
        "developer-endpoint POST carrying the key header.",
    },
    {
      id: "W5",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/providers/openrouter.ts (POST " +
        "`${model.baseUrl}/chat/completions` with `plugins: [{ id: \"web\", max_results }]`, " +
        "`authorization: Bearer`; OpenRouterGroundedProvider.isAvailable: " +
        "authStorage.keys.source(model?.provider ?? \"openrouter\")) + docs/providers.md env table " +
        "(`openrouter` -> OPENROUTER_API_KEY)",
      fact:
        "The OpenRouter web-plugin grounding path runs on the `openrouter` provider whose API-key env " +
        "fallback is OPENROUTER_API_KEY — also already in row 7's credential set. CITATION LOCATION " +
        "CORRECTION (recorded, not reinterpreted): the proposal cites the `@oh-my-pi/pi-ai` stream.ts " +
        "env-key table; at this pin the provider env-key table is docs/providers.md (no OPENROUTER " +
        "entry exists in packages/ai stream.ts).",
    },
    {
      id: "W6",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/providers/base.ts (SearchParams carries `fetch?: " +
        "FetchImpl`) + providers/gemini.ts `(fetchImpl ?? fetch)` inside fetchWithRetry + " +
        "providers/openrouter.ts `(params.fetch ?? fetch)`",
      fact:
        "The transport seam exists on the provider parameter type and both candidate providers honor " +
        "it with a global-fetch fallback — but per W2 the ACP-path caller never populates it, so " +
        "native provider requests leave on global fetch (the same PARTIAL shape P0/row 17 recorded " +
        "for ToolSession.fetch).",
    },
    {
      id: "W7",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/providers/gemini.ts (fetchWithRetry MAX_RETRIES=3 " +
        "exponential backoff; finalizeGeminiSearchResult + resolveGroundingRedirect HEAD " +
        "redirect:\"manual\" 5 s timeout via (fetchImpl ?? fetch); isGroundingRedirectUrl matches " +
        "vertexaisearch.cloud.google.com /grounding-api-redirect) + providers/utils.ts " +
        "(classifyProviderHttpError: credits pattern, 402, 401, 403)",
      fact:
        "The Gemini path adds an unguarded transport retry around the endpoint POST and follows " +
        "grounding-redirect enrichment URLs with per-URL HEAD subrequests — both leave on the " +
        "unpopulated seam (global fetch), the exact bypass class P0 recorded; the HTTP error " +
        "classification shape is the honest-failure interface the adapter mirrors.",
    },
    {
      id: "W8",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/index.ts (formatForLLM: Note:/answer/`## Sources` + " +
        "formatCount + `[i] title (age)`, url, snippet truncate 240 / `## Citations` / `Search " +
        "queries:` echo; hasRenderableSearchContent; zero-available branch " +
        "`No web search model configured.`; all-failed branch " +
        "`Error: <formatSearchProviderFailure>` / `All web search providers failed: ...`; the " +
        "no-sources SearchProviderError 204 throw; envelope { content: [{ type: \"text\" }], " +
        "details: { response, error? } }) + packages/utils/src/format.ts (truncate/formatCount/" +
        "formatAge)",
      fact:
        "The native tool result observable is the text envelope over the formatForLLM layout with " +
        "these exact honest branches: no-configured-model, provider failure (name-tagged), and the " +
        "204-style zero-sources refusal — the interface parity target for the adapter.",
    },
    {
      id: "W9",
      ...PIN,
      location:
        "packages/coding-agent/src/web/search/index.ts (WebSearchTool.execute: session authStorage / " +
        "modelRegistry / getSessionId / getActiveModel; no transport field is read) + the row-17 S9 " +
        "finding on the same ToolSession surface",
      fact:
        "WebSearchTool.execute consumes only the session's credential/registry/model surface; the " +
        "session exposes no transport seam that the ACP bootstrapping populates, so the tool itself " +
        "cannot be transport-injected without the name replacement.",
    },
    {
      id: "W10",
      ...PIN,
      location:
        "row-17 citations S7/S8 (packages/coding-agent/src/extensibility/extensions/types.ts " +
        "registerTool/ToolDefinition/ctx.invokeTool; packages/coding-agent/src/sdk.ts native " +
        "capture + last-extension-wins) — consumed import-only via src/acp/omp/fetch-routes.ts",
      fact:
        "The replacement mechanism and the same-tool native-delegation context are the row-17 " +
        "verified surfaces (S7/S8), reused verbatim; this table cites them by their S7/S8 identity " +
        "rather than restating them.",
    },
  ] as const,
);

/** Machine-readable route row per design D4 / tasks 3.1. */
export interface SearchRouteRow {
  readonly routeId: string;
  readonly mechanism: string;
  readonly status: SearchRouteStatus;
  readonly citations: readonly SearchRouteCitation[];
  readonly userDecisionRequired?: true;
  readonly notes: string;
}

function citation(...ids: readonly SearchRouteCitation["id"][]): readonly SearchRouteCitation[] {
  return SEARCH_ROUTE_CITATIONS.filter((c) => (ids as readonly string[]).includes(c.id));
}

const supportedMechanism = SEARCH_COMPLETING_MECHANISM;
const noNativeMechanism = 'none — provider requests leave on global fetch with redirect: "follow" ' +
  "and fetchWithRetry retries (P0-recorded bypass)";

/**
 * The frozen route table. `completed-by-adapter` covers EXACTLY the two
 * grounded backends whose credential is in row 7's set plus their enrichment
 * secondary-hop route — and, per `webSearchSeamState`, ONLY while that
 * credential is actually present; every other backend and every caller
 * outside the replacement stays blocked with `userDecisionRequired`.
 */
export const SEARCH_ROUTE_TABLE: readonly SearchRouteRow[] = Object.freeze(
  [
    {
      routeId: "web_search.grounding.gemini",
      mechanism: supportedMechanism,
      status: "completed-by-adapter",
      citations: citation("W2", "W4", "W6", "W10"),
      notes:
        "Gemini developer-API grounding (x-goog-api-key, `google` provider -> GEMINI_API_KEY from " +
        "row 7's set) is served by the search adapter's endpoint route over the row-17 controlled " +
        "transport (manual per-hop validation, single controlled attempt, no fetchWithRetry). Active " +
        "exactly where GEMINI_API_KEY is present (webSearchSeamState); native provider transport is " +
        "never invoked on this path. Mock-only certification; native invocation user-owned (§15).",
    },
    {
      routeId: "web_search.grounding.openrouter",
      mechanism: supportedMechanism,
      status: "completed-by-adapter",
      citations: citation("W2", "W5", "W6", "W10"),
      notes:
        "OpenRouter web-plugin grounding (`/chat/completions`, `openrouter` provider -> " +
        "OPENROUTER_API_KEY from row 7's set) is served by the same adapter endpoint route. Active " +
        "exactly where OPENROUTER_API_KEY is present (webSearchSeamState). Mock-only " +
        "certification; native invocation user-owned (§15).",
    },
    {
      routeId: "web_search.grounding.grounding-redirect-enrichment",
      mechanism: supportedMechanism,
      status: "completed-by-adapter",
      citations: citation("W7"),
      notes:
        "Gemini grounding-redirect HEAD resolutions re-enter the SAME per-hop decision as secondary " +
        "hops with the shared budget, bounded count/timeout, and the native keep-the-proxy-URL " +
        "failure default — a secondary-hop route of the completed backends (W7 bypass removed " +
        "inside the replacement only).",
    },
    {
      routeId: "web_search.unsupported-credential-set.backends",
      mechanism: "none — requires a provider secret outside the row-7 credential set",
      status: "no-supported-mechanism",
      userDecisionRequired: true,
      citations: citation("W3"),
      notes:
        "Grounded anthropic/codex/xai/openai and the paid pure engines (brave/tavily/exa/jina/" +
        "perplexity/kagi/firecrawl/...) exist in the pinned registries but each needs its own " +
        "provider key/OAuth secret; design §9 and the batch out-of-scope rule refuse any unrelated " +
        "vendor secret merely to select OMP search, so this stays no-supported-mechanism — a P0 " +
        "revision plus an explicit user decision is the only promotion path.",
    },
    {
      routeId: "web_search.scraping-engines",
      mechanism: "none — keyless scraping engines exist but were NOT selected",
      status: "candidate-to-verify",
      userDecisionRequired: true,
      citations: citation("W3"),
      notes:
        "duckduckgo/mojeek/ecosia/startpage/public/scraping-google need no secret but are " +
        "operator-unconfigured scraping backends; admitting them would add arbitrary-provider " +
        "config, which this change never does (DECIDED disposition: scraper redirect-following " +
        "bypass routes stay blocked). Candidate-to-verify, not selected.",
    },
    {
      routeId: "web_search.native.global-fetch-provider-path",
      mechanism: noNativeMechanism,
      status: "blocked-pending-adapter",
      userDecisionRequired: true,
      citations: citation("W2", "W6", "W7", "W9"),
      notes:
        "For any caller outside the replacement (e.g. the native tool under a native YOLO session, " +
        "per 14b posture D6 adds no clamp there), provider requests keep the P0-recorded bypass " +
        "permanently: the SearchParams.fetch seam is never populated on the ACP path (W2/W9) and " +
        "requests ride global fetch with automatic redirects + fetchWithRetry (W6/W7). Inside the " +
        "replacement the native provider path is never invoked at all.",
    },
  ] as const,
);

/** True when the route is completed by this change's adapter. */
export function isSearchRouteCompleted(routeId: string): boolean {
  return SEARCH_ROUTE_TABLE.find((row) => row.routeId === routeId)?.status === "completed-by-adapter";
}

/** The completing-adapter marker text appended to 14a's web-search row. */
export const SEARCH_COMPLETING_ADAPTER_MARKER =
  "COMPLETING-ADAPTER: adapt-omp-web-search — the Gemini/OpenRouter grounded backends and their " +
  "grounding-redirect enrichment route complete through src/acp/omp/search-routes.ts " +
  "SEARCH_ROUTE_TABLE via the controlled transport, ACTIVE exactly where a supported-tier backend " +
  "credential is present (webSearchSeamState). This marker names the completing adapter for those " +
  "routes only; it is NOT a plain allow, never covers the native global-fetch provider path or any " +
  "backend outside the row-7 credential set, and the allow-gated-pending-adapter outcome below " +
  "still fails closed at 14b while no supported credential is present or until the replacement " +
  "mechanism's native invocation is user-observed.";

/** The seam state of the web-search row for a given credential presence. */
export type WebSearchSeamState =
  | { readonly state: "adapter-completing"; readonly backend: "gemini" | "openrouter" }
  | { readonly state: "pending-blocked"; readonly reason: "no-supported-credential" };

/**
 * Backend gate for the seam (D4): the 14a marker is ACTIVE exactly where a
 * supported-tier backend's credential is present — Gemini first, then
 * OpenRouter — and the seam stays pending-blocked (14b `rejected_pending_
 * adapter` semantics preserved, kind unchanged) with neither key present.
 * Pure over the presence input; reads no env, logs nothing.
 */
export function webSearchSeamState(
  presence: SearchCredentialPresence,
): WebSearchSeamState {
  if (presence.geminiKey) return { state: "adapter-completing", backend: "gemini" };
  if (presence.openrouterKey) return { state: "adapter-completing", backend: "openrouter" };
  return { state: "pending-blocked", reason: "no-supported-credential" };
}
