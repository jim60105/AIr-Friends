/**
 * Controlled Web-Search Transport Adapter — pure decision core + native-shape
 * interface (row 20, `adapt-omp-web-search`, design D1–D6).
 *
 * Two surfaces live here (tasks 2.1/2.2):
 *
 * 1. The pure decision core `decideSearchRoute(input, deps)`, evaluated over
 *    the injected `{ resolveHost, credentialPresence, posture }`. EVERY hop
 *    decision — the provider endpoint request and every result-enrichment
 *    subrequest — delegates to row 17's `decideFetchHop`
 *    (`./fetch-transport.ts`, import-only). This module ships no second SSRF
 *    classifier, no local copy of any rule, and no new posture value: the
 *    decisions, reason codes, hop bound, and credential-free
 *    `{ host, hopIndex, decision, reason }` records are row 17's verbatim.
 *    The ONLY search-only reason additions are the two credential-scope codes
 *    `no-supported-credential` and `explicit-model-outside-supported-set`.
 *
 * 2. The native-shape interface module: query-parameter pass-through with the
 *    pinned schema field names (W2), supported-backend request construction
 *    mirroring the pinned observable request shape (W4/W5), result mapping to
 *    the `{ content: [{ type: "text" }], details: { response } }` envelope
 *    with the pinned `formatForLLM` layout (W8), and the honest error mapping
 *    (no-fabrication / no-unguarded-retry / no-backend-switch / no-agent-
 *    switch, empty-vs-error). The format helpers below are interface mirrors
 *    of the pinned `@oh-my-pi/pi-utils` `truncate`/`formatCount`/`formatAge`
 *    bodies at commit 2a2c6dc (formatting only — never transport rules).
 *
 * Credential scope (row 7, design D1): the supported credential set is
 * EXACTLY `GEMINI_API_KEY` + `OPENROUTER_API_KEY`. Backend selection is
 * credential-presence only. Provider base URL + wire model are frozen pinned
 * catalog data (W4/W5 citations below), never operator config: no new
 * config/env/Helm field exists in this layer and none can be introduced from
 * here (the `endpoints` seam is a test-injection surface, not config).
 * Provider CREDENTIALS appear only in request construction (header at
 * request time), never in decision inputs, records, logs, or fixtures.
 *
 * Honesty invariants (spec-locked): provider auth/rate/HTTP/malformed
 * failures surface as honest tool errors in the pinned
 * `formatSearchProviderFailure` message shape — never fabricated results,
 * never an unguarded native transport retry (the pinned `fetchWithRetry`
 * shape is a P0-recorded bypass and is NOT reproduced; the executor issues
 * ONE attempt per decision), never a backend or agent switch on failure. A
 * zero-available-credential deployment yields the native `Error: No web
 * search model configured.`-family message; a zero-source response yields the
 * native 204-style honest no-sources failure. No fabricated content path
 * exists in this code.
 *
 * Transport-facts honesty (task 4.3, mirrors docs/OMP_NETWORK.md): the
 * factory's best-effort env routing stays exactly as-is and is NOT
 * enforcement — `HTTP_PROXY` presence alone never established mediation (the
 * pre-existing F14 residual is unchanged). The Skill API loopback endpoint
 * and the proxy endpoint are fixed deployment transport facts and stay OUT
 * of every decision input. Provider endpoint hosts are validated like every
 * other target: the adapter never exempts them.
 */

import {
  decideFetchHop,
  type FetchDecisionRecord,
  type FetchEgressPolicy,
  type FetchHopDecision,
  formatFetchDecisionLog,
  type FetchTransportFn,
  MAX_REDIRECT_HOPS,
  type ResolveHost,
} from "./fetch-transport.ts";

// The shared bound is re-exported (never copied) so consumers and tests
// consume the same constant ssrf.ts owns through row 17.
export { MAX_REDIRECT_HOPS };

// ---------------------------------------------------------------------------
// Credential scope (row 7's set verbatim; presence is the decision input).
// ---------------------------------------------------------------------------

/** The row-7 supported search credential keys, exactly (nothing else). */
export const SUPPORTED_SEARCH_CREDENTIAL_ENV: Record<SupportedSearchBackend, string> = Object.freeze({
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
});

/** Credential-presence input: presence booleans ONLY, never values. */
export interface SearchCredentialPresence {
  readonly geminiKey: boolean;
  readonly openrouterKey: boolean;
}

/**
 * The process-env read of credential PRESENCE (task 4.3): the two supported
 * names, presence only. Never log the returned state or the env itself; the
 * values never pass through this function's output.
 */
export function credentialPresenceFromEnv(
  env: Record<string, string | undefined> = defaultAgentEnv(),
): SearchCredentialPresence {
  return Object.freeze({
    geminiKey: (env["GEMINI_API_KEY"] ?? "") !== "",
    openrouterKey: (env["OPENROUTER_API_KEY"] ?? "") !== "",
  });
}

function defaultAgentEnv(): Record<string, string | undefined> {
  try {
    if (typeof process !== "undefined" && process.env) return process.env;
  } catch {
    // Environment unreadable: fail closed — no credential present.
  }
  return {};
}

// ---------------------------------------------------------------------------
// Decision vocabulary (row 17 verbatim + the two sanctioned search additions).
// ---------------------------------------------------------------------------

/** The supported backends, frozen to the credential set (D1). */
export type SupportedSearchBackend = "gemini" | "openrouter";

/**
 * Hop-level block reasons are row 17's verbatim; the search adapter adds
 * EXACTLY two credential-scope codes and nothing else (tasks 2.1).
 */
export type SearchBlockReason =
  | "disallowed-scheme"
  | "url-unparseable"
  | "dns-unresolved"
  | "dns-invalid-answer"
  | "disallowed-address"
  | "cloud-metadata"
  | "hop-limit-exceeded"
  | "egress-policy-unresolved"
  | "no-supported-credential"
  | "explicit-model-outside-supported-set";

/** The two sanctioned search-only credential-scope reason codes. */
export type SearchCredentialBlockReason = "no-supported-credential" | "explicit-model-outside-supported-set";

/** Hop kinds mirror row 17: provider endpoint and enrichment secondary. */
export type SearchHopKind = "provider-endpoint" | "enrichment";

/** Input for one search-route decision (endpoint hop or enrichment hop). */
export interface SearchRouteInput {
  /** The URL whose hop is being decided (provider POST or HEAD target). */
  readonly url: string;
  /** The endpoint hop kind; enrichment re-enters as row-17 secondary hops. */
  readonly hopKind: SearchHopKind;
  /** Redirect hops already followed (0 at hop 1); shared search budget. */
  readonly hopsFollowed: number;
  /**
   * Explicit backend request outside the supported set (a caller naming
   * anthropic/openai/brave/duckduckgo/...): the adapter never adopts it.
   */
  readonly requestedUnsupportedBackend?: boolean;
}

/** Dependencies the pure decision core is evaluated over (all injected). */
export interface SearchDecisionDeps {
  readonly resolveHost: ResolveHost;
  readonly credentialPresence: SearchCredentialPresence;
  readonly posture: FetchEgressPolicy;
}

/**
 * Credential-free pre-transport record for the credential-scope block.
 * Carries no host (no host was ever consulted), no credential, and only the
 * fixed reason code — at most `{ hopIndex, decision, reason }`.
 */
export interface SearchCredentialRecord {
  readonly hopIndex: 0;
  readonly decision: "block";
  readonly reason: SearchCredentialBlockReason;
}

/** The credential-scope block (D4): fail-closed with the user decision. */
export interface SearchCredentialBlock {
  readonly decision: "block";
  readonly reason: SearchCredentialBlockReason;
  readonly userDecisionRequired: true;
  readonly record: SearchCredentialRecord;
}

/**
 * Decision for one search-route hop. `allow-*`/`block` hop decisions reuse
 * row 17's decision + record shapes verbatim; the credential-scope block is
 * the only search-native shape and carries `userDecisionRequired` (D4).
 */
export type SearchRouteDecision = FetchHopDecision | SearchCredentialBlock;

/** Every decision record the search adapter can emit (both shapes). */
export type SearchDecisionRecord = FetchDecisionRecord | SearchCredentialRecord;

/** Render one record (row-17 or credential scope) as a credential-free log line. */
export function formatSearchDecisionLog(record: SearchDecisionRecord): string {
  if ("host" in record) {
    return formatFetchDecisionLog(record).replace("[air-fetch-adapter]", "[air-search-adapter]");
  }
  return `[air-search-adapter] hop=${record.hopIndex} decision=${record.decision} reason=${record.reason}`;
}

// ---------------------------------------------------------------------------
// Backend selection (D1/D4: credential presence is the ONLY input).
// ---------------------------------------------------------------------------

/**
 * Select the supported backend from credential presence ONLY. Gemini first
 * when its credential is present, otherwise OpenRouter when present,
 * otherwise null (D4 fail-closed: no scraping engine, no other backend,
 * ever). Failure of a selected backend NEVER falls through to the other
 * (spec: no silent different-backend fallback on a served request).
 */
export function selectSearchBackend(presence: SearchCredentialPresence): SupportedSearchBackend | null {
  if (presence.geminiKey) return "gemini";
  if (presence.openrouterKey) return "openrouter";
  return null;
}

/**
 * Decide ONE search hop. Credential scope first (pre-transport, zero
 * network): with no supported credential — or an explicit request for a
 * backend outside the supported set — the hop blocks with the sanctioned
 * credential-scope reason and `userDecisionRequired`. Every surviving hop
 * (provider endpoint and enrichment subrequest alike) delegates verbatim to
 * row 17's `decideFetchHop`: same rules, same posture, same records, same
 * hop bound. The adapter never re-implements, forks, softens, or bypasses
 * that rule set.
 */
export async function decideSearchRoute(
  input: SearchRouteInput,
  deps: SearchDecisionDeps,
): Promise<SearchRouteDecision> {
  if (selectSearchBackend(deps.credentialPresence) === null) {
    return {
      decision: "block",
      reason: "no-supported-credential",
      userDecisionRequired: true,
      record: Object.freeze({ hopIndex: 0, decision: "block", reason: "no-supported-credential" } as const),
    };
  }
  if (input.requestedUnsupportedBackend === true) {
    return {
      decision: "block",
      reason: "explicit-model-outside-supported-set",
      userDecisionRequired: true,
      record: Object.freeze({
        hopIndex: 0,
        decision: "block",
        reason: "explicit-model-outside-supported-set",
      } as const),
    };
  }
  // Every transport hop is row 17's decision, verbatim (import-only reuse;
  // enrichment re-enters as a "secondary" hop type with the shared budget).
  return await decideFetchHop(
    {
      url: input.url,
      hopType: input.hopKind === "enrichment"
        ? "secondary"
        : (input.hopsFollowed > 0 ? "redirect" : "initial"),
      hopsFollowed: input.hopsFollowed,
    },
    { resolveHost: deps.resolveHost, policy: deps.posture },
  );
}

// ---------------------------------------------------------------------------
// Native-shape interface: query schema, request construction (W2/W4/W5).
// ---------------------------------------------------------------------------

/**
 * The pinned `webSearchSchema` field names (W2), passed through 1:1. Input
 * validation here is native-schema-equivalent with the adapter's bound caps:
 * the query is model-controlled, so its length and the bounded numeric
 * selectors are clamped BEFORE request construction (no unbounded
 * passthrough into a provider POST body).
 */
export interface SearchToolQuery {
  query: string;
  recency?: "day" | "week" | "month" | "year";
  limit?: number;
  max_tokens?: number;
  temperature?: number;
  num_search_results?: number;
}

/** Adapter caps on model-controlled query fields (bounded input). */
export const MAX_SEARCH_QUERY_CHARS = 4096;
export const MAX_SEARCH_RESULTS_CAP = 20;

/**
 * Validate/passthrough the pinned query schema shape. Returns the normalized
 * query or a short honest validation message (bounded; never echoes the
 * payload).
 */
export function parseSearchToolInput(
  params: Record<string, unknown>,
): { readonly ok: true; readonly query: SearchToolQuery } | { readonly ok: false; readonly error: string } {
  const rawQuery = params["query"];
  if (typeof rawQuery !== "string" || rawQuery.length === 0) {
    return { ok: false, error: "web_search: `query` must be a non-empty string" };
  }
  if (rawQuery.length > MAX_SEARCH_QUERY_CHARS) {
    return { ok: false, error: `web_search: \`query\` exceeds the ${MAX_SEARCH_QUERY_CHARS}-character bound` };
  }
  const recency = params["recency"];
  if (recency !== undefined && !["day", "week", "month", "year"].includes(String(recency))) {
    return { ok: false, error: "web_search: `recency` must be day | week | month | year" };
  }
  const numeric: Record<string, number | undefined> = {};
  for (const key of ["limit", "max_tokens", "temperature", "num_search_results"] as const) {
    const value = params[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `web_search: \`${key}\` must be a finite number` };
    }
    numeric[key] = key === "num_search_results"
      ? Math.min(Math.max(Math.trunc(value), 1), MAX_SEARCH_RESULTS_CAP)
      : value;
  }
  return {
    ok: true,
    query: Object.freeze({
      query: rawQuery,
      ...(recency !== undefined ? { recency: recency as "day" | "week" | "month" | "year" } : {}),
      ...(numeric["limit"] !== undefined ? { limit: numeric["limit"] } : {}),
      ...(numeric["max_tokens"] !== undefined ? { max_tokens: numeric["max_tokens"] } : {}),
      ...(numeric["temperature"] !== undefined ? { temperature: numeric["temperature"] } : {}),
      ...(numeric["num_search_results"] !== undefined
        ? { num_search_results: numeric["num_search_results"] }
        : {}),
    }),
  };
}

/**
 * Frozen pinned catalog endpoint data (W4/W5 at 2a2c6dc — static catalog
 * facts, never config): the `google` provider's developer base + a concrete
 * grounding model row, and the `openrouter` base + a concrete grounding
 * model row. Injectable via the `endpoints` dep for tests only; there is NO
 * env or config override path — an override would be arbitrary-provider
 * config the proposal forbids ("none, ever").
 */
export const PINNED_SEARCH_ENDPOINTS: Record<
  SupportedSearchBackend,
  { readonly baseUrl: string; readonly model: string }
> = Object.freeze({
  gemini: {
    /** Pinned catalog baseUrl for `google` grounding rows (W4). */
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    /** Pinned catalog grounding model (api `google-generative-ai`, W4). */
    model: "gemini-2.5-flash",
  },
  openrouter: {
    /** Pinned catalog baseUrl for `openrouter` grounding rows (W5). */
    baseUrl: "https://openrouter.ai/api/v1",
    /** Pinned catalog grounding model (api `openrouter`, W5). */
    model: "~google/gemini-flash-latest",
  },
});

/** A fully constructed provider request (credential header value included;
 *  consumed once by the controlled executor, never logged, never returned). */
export interface BuiltSearchRequest {
  readonly backend: SupportedSearchBackend;
  readonly url: string;
  readonly init: { method: "POST"; headers: Record<string, string>; body: string };
}

/** Build the Gemini developer request mirroring the pinned observable shape
 *  (W4): `${baseUrl}/models/${model}:streamGenerateContent?alt=sse` with
 *  `x-goog-api-key`, contents/tools(googleSearch) body. */
export function buildGeminiSearchRequest(
  query: SearchToolQuery,
  apiKey: string,
  endpoints: typeof PINNED_SEARCH_ENDPOINTS = PINNED_SEARCH_ENDPOINTS,
): BuiltSearchRequest {
  const base = endpoints.gemini.baseUrl.replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: query.query }] }],
    tools: [{ googleSearch: {} }],
  };
  const generationConfig: Record<string, number> = {};
  if (query.max_tokens !== undefined) generationConfig["maxOutputTokens"] = query.max_tokens;
  if (query.temperature !== undefined) generationConfig["temperature"] = query.temperature;
  if (Object.keys(generationConfig).length > 0) body["generationConfig"] = generationConfig;
  return {
    backend: "gemini",
    url: `${base}/models/${endpoints.gemini.model}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    },
  };
}

/** Build the OpenRouter web-plugin request mirroring the pinned observable
 *  shape (W5): `${baseUrl}/chat/completions`, Bearer auth,
 *  `plugins: [{ id: "web", max_results }]` (pinned DEFAULT_NUM_RESULTS = 5). */
export function buildOpenRouterSearchRequest(
  query: SearchToolQuery,
  apiKey: string,
  endpoints: typeof PINNED_SEARCH_ENDPOINTS = PINNED_SEARCH_ENDPOINTS,
): BuiltSearchRequest {
  const base = endpoints.openrouter.baseUrl.replace(/\/+$/, "");
  const body = {
    model: endpoints.openrouter.model,
    plugins: [{ id: "web", max_results: query.num_search_results ?? 5 }],
    messages: [{ role: "user", content: query.query }],
  };
  return {
    backend: "openrouter",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

// ---------------------------------------------------------------------------
// Native-shape result types (W8) + pinned format-interface mirrors.
// ---------------------------------------------------------------------------

export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  ageSeconds?: number;
}

export interface SearchCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface SearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** The unified response shape (pinned `SearchResponse` observable fields). */
export interface SearchResponse {
  provider: SupportedSearchBackend | "none";
  answer?: string;
  sources: SearchSource[];
  citations?: SearchCitation[];
  searchQueries?: string[];
  usage?: SearchUsage;
  model?: string;
}

/** Mirror of pinned `truncate` (pi-utils format.ts @ 2a2c6dc). */
export function formatSearchTruncate(str: string, maxLen: number, ellipsis = "…"): string {
  if (str.length <= maxLen) return str;
  const sliceLen = Math.max(0, maxLen - ellipsis.length);
  return `${str.slice(0, sliceLen)}${ellipsis}`;
}

/** Mirror of pinned `formatCount` (pluralize included; pi-utils @ 2a2c6dc). */
export function formatSearchCount(label: string, count: number): string {
  const safeCount = Number.isFinite(count) ? count : 0;
  let plural = `${label}s`;
  if (safeCount === 1) plural = label;
  else if (/(?:ch|sh|s|x|z)$/i.test(label)) plural = `${label}es`;
  else if (/[^aeiou]y$/i.test(label)) plural = `${label.slice(0, -1)}ies`;
  return `${safeCount} ${plural}`;
}

/** Mirror of pinned `formatAge` (pi-utils format.ts @ 2a2c6dc). */
export function formatSearchAge(ageSeconds: number | null | undefined): string {
  if (!ageSeconds) return "";
  const mins = Math.floor(ageSeconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

/** Mirror of pinned `formatForLLM` (web/search/index.ts @ 2a2c6dc): optional
 *  leading `Note:` lines, optional answer, `## Sources`
 *  `[i] title (age) / url / snippet(240)`, `## Citations`,
 *  search-query echo. */
export function formatSearchForLLM(response: SearchResponse, notes: readonly string[] = []): string {
  const parts: string[] = [];
  for (const note of notes) parts.push(`Note: ${note}`);
  if (response.answer) {
    parts.push(response.answer);
    if (response.sources.length > 0) {
      parts.push("\n## Sources");
      parts.push(formatSearchCount("source", response.sources.length));
    }
  }
  for (const [i, src] of response.sources.entries()) {
    const age = formatSearchAge(src.ageSeconds) || src.publishedDate;
    const agePart = age ? ` (${age})` : "";
    parts.push(`[${i + 1}] ${src.title}${agePart}\n    ${src.url}`);
    if (src.snippet) parts.push(`    ${formatSearchTruncate(src.snippet, 240)}`);
  }
  if (response.citations && response.citations.length > 0) {
    parts.push("\n## Citations");
    parts.push(formatSearchCount("citation", response.citations.length));
    for (const [i, citation] of response.citations.entries()) {
      const title = citation.title || citation.url;
      parts.push(`[${i + 1}] ${title}\n    ${citation.url}`);
      if (citation.citedText) parts.push(`    ${formatSearchTruncate(citation.citedText, 240)}`);
    }
  }
  if (response.searchQueries && response.searchQueries.length > 0) {
    parts.push(`Search queries: ${response.searchQueries.length}`);
    for (const q of response.searchQueries.slice(0, 3)) parts.push(`- ${formatSearchTruncate(q, 120)}`);
  }
  return parts.join("\n");
}

/** Mirror of pinned `hasRenderableSearchContent` (web/search/index.ts). */
export function hasRenderableSearchContent(response: SearchResponse): boolean {
  if (response.answer?.trim()) return true;
  if (response.sources.length > 0) return true;
  if (response.citations?.length) return true;
  if (response.searchQueries?.some((query) => query.trim())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Honest error mapping (W7/W8 interface mirrors).
// ---------------------------------------------------------------------------

/** Pinned backend labels (SEARCH_PROVIDER_LABELS observable values). */
export const SEARCH_BACKEND_LABELS: Record<SupportedSearchBackend, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

/** Cap + scrub bound for provider-derived error text (D6 records posture). */
export const MAX_ERROR_BODY_CHARS = 300;

function capAndScrub(body: string, credential: string): string {
  let text = body.replace(/\s+/g, " ").trim();
  if (credential !== "") text = text.split(credential).join("[redacted]");
  // Query strings and userinfo must never ride error text either.
  text = text.replace(/https?:\/\/\S*\?\S*/g, "[url-redacted]");
  return formatSearchTruncate(text, MAX_ERROR_BODY_CHARS);
}

/** Provider-classified failure (pinned `SearchProviderError` observable). */
export class SearchProviderFailure extends Error {
  readonly provider: SupportedSearchBackend;
  readonly status?: number;
  constructor(provider: SupportedSearchBackend, message: string, status?: number) {
    super(message);
    this.name = "SearchProviderFailure";
    this.provider = provider;
    this.status = status;
  }
}

/**
 * Provider HTTP classification (pinned `classifyProviderHttpError` observable
 * shape @ providers/utils.ts): credits-pattern body, 402, 401, 403 map to
 * the pinned provider-tagged messages; every other non-2xx falls through to
 * the pinned provider error line. Credential material is scrubbed from any
 * interpolated body text (the native path redacts the key from error text;
 * the adapter redacts the request credential from every provider-derived
 * message and caps the interpolated text) before it reaches the envelope.
 */
export function classifySearchProviderHttpError(
  backend: SupportedSearchBackend,
  status: number,
  body: string,
  credential: string,
): SearchProviderFailure {
  const sanitized = capAndScrub(body, credential);
  if (/credits?\s*(?:exhausted|exceeded)|quota|insufficient/i.test(sanitized)) {
    return new SearchProviderFailure(backend, `${backend}: credits exhausted`, status);
  }
  if (status === 402) return new SearchProviderFailure(backend, `${backend}: 402 credits exhausted`, status);
  if (status === 401) return new SearchProviderFailure(backend, `${backend}: 401 unauthorized`, status);
  if (status === 403) return new SearchProviderFailure(backend, `${backend}: 403 forbidden`, status);
  const surface = backend === "gemini" ? "Gemini Developer API" : "OpenRouter web search";
  return new SearchProviderFailure(backend, `${surface} error (${status}): ${sanitized}`, status);
}

/** Mirror of pinned `formatSearchProviderFailure` (web/search/provider.ts). */
export function formatSearchProviderFailure(failure: unknown, backend: SupportedSearchBackend): string {
  if (failure instanceof SearchProviderFailure) {
    if (failure.status === 401 || failure.status === 403) {
      return `${SEARCH_BACKEND_LABELS[failure.provider]} authorization failed (${failure.status}). Check API key or base URL.`;
    }
    return failure.message;
  }
  if (failure instanceof Error) return failure.message;
  return `Unknown error from ${SEARCH_BACKEND_LABELS[backend]}`;
}

/**
 * The adapter's envelope, byte-shape-comparable to the native result:
 * `{ content: [{ type: "text", text }], details: { response, error? } }`.
 */
export interface SearchToolEnvelope {
  readonly content: ReadonlyArray<{ type: "text"; text: string }>;
  readonly details: {
    readonly response: SearchResponse;
    readonly error?: string;
    readonly adapterCompleted?: true;
  };
}

/** The native failure envelope (W8 all-failed branch shape). */
export function searchFailureEnvelope(
  backend: SupportedSearchBackend,
  failure: unknown,
): SearchToolEnvelope {
  const message = formatSearchProviderFailure(failure, backend);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { response: { provider: backend, sources: [] }, error: message },
  };
}

/** The native no-sources honest failure (W8 204 branch shape). */
export function searchNoSourcesFailure(backend: SupportedSearchBackend): SearchProviderFailure {
  return new SearchProviderFailure(
    backend,
    `${SEARCH_BACKEND_LABELS[backend]} returned no sources; the selected model may not support hosted web search.`,
    204,
  );
}

/** Success envelope (native shape + the completion marker in details). */
export function searchSuccessEnvelope(
  response: SearchResponse,
  notes: readonly string[] = [],
): SearchToolEnvelope {
  return {
    content: [{ type: "text" as const, text: formatSearchForLLM(response, notes) }],
    details: { response, adapterCompleted: true as const },
  };
}

/**
 * The zero-available-credential native-shaped message (W8):
 * `No web search model configured.` — surfaced in the same envelope the
 * native tool uses (text `Error: …` + `details.error`). This is the D4
 * fail-closed result for a credential-absent deployment.
 */
export function searchNoModelConfiguredEnvelope(message = "No web search model configured."): SearchToolEnvelope {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { response: { provider: "none", sources: [] }, error: message },
  };
}

// ---------------------------------------------------------------------------
// Response parsers mirroring the pinned observable fields (D3).
// ---------------------------------------------------------------------------

/** Mirror of pinned `parseGeminiSearchStream` fields: SSE `data:` chunks →
 *  answer parts, groundingChunks → sources (deduped), groundingSupports →
 *  citations, webSearchQueries, usageMetadata, modelVersion. */
export function parseGeminiSearchStreamText(raw: string, fallbackModel: string): SearchResponse {
  const answerParts: string[] = [];
  const sources: SearchSource[] = [];
  const citations: SearchCitation[] = [];
  const searchQueries: string[] = [];
  const seenUrls = new Set<string>();
  let model = fallbackModel;
  let usage: SearchUsage | undefined;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr) continue;
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      continue;
    }
    const responseData = (chunk["response"] ?? chunk) as Record<string, unknown>;
    const candidate = (responseData["candidates"] as Array<Record<string, unknown>> | undefined)?.[0];
    const content = candidate?.["content"] as { parts?: Array<{ text?: string }> } | undefined;
    if (content?.parts) for (const part of content.parts) if (part.text) answerParts.push(part.text);
    const meta = candidate?.["groundingMetadata"] as
      | {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        groundingSupports?: Array<{ segment?: { text?: string }; groundingChunkIndices?: number[] }>;
        webSearchQueries?: string[];
      }
      | undefined;
    if (meta?.groundingChunks) {
      for (const grChunk of meta.groundingChunks) {
        const uri = grChunk.web?.uri;
        if (uri && !seenUrls.has(uri)) {
          seenUrls.add(uri);
          sources.push({ title: grChunk.web?.title ?? uri, url: uri });
        }
      }
    }
    if (meta?.groundingSupports && meta.groundingChunks) {
      for (const support of meta.groundingSupports) {
        for (const idx of support.groundingChunkIndices ?? []) {
          const web = meta.groundingChunks[idx]?.web;
          if (web?.uri) {
            citations.push({ url: web.uri, title: web.title ?? web.uri, citedText: support.segment?.text });
          }
        }
      }
    }
    if (meta?.webSearchQueries) {
      for (const q of meta.webSearchQueries) if (!searchQueries.includes(q)) searchQueries.push(q);
    }
    const usageMeta = responseData["usageMetadata"] as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;
    if (usageMeta) {
      usage = {
        inputTokens: usageMeta.promptTokenCount ?? 0,
        outputTokens: usageMeta.candidatesTokenCount ?? 0,
        totalTokens: usageMeta.totalTokenCount ?? 0,
      };
    }
    if (typeof responseData["modelVersion"] === "string") model = responseData["modelVersion"];
  }
  return {
    provider: "gemini",
    answer: answerParts.join("") || undefined,
    sources,
    citations: citations.length > 0 ? citations : undefined,
    searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
    usage,
    model,
  };
}

/** Mirror of pinned OpenRouter `parseResponse` fields: choices[0].message
 *  content (string or parts), url_citation annotations → deduped
 *  sources+citations, usage, model. Malformed shapes surface as the pinned
 *  `OpenRouter returned an invalid response` failure (502). */
export function parseOpenRouterSearchResponse(
  payload: unknown,
  modelId: string,
): SearchResponse | SearchProviderFailure {
  if (!isOpenRouterResponseLike(payload)) {
    return new SearchProviderFailure(
      "openrouter",
      "OpenRouter returned an invalid response: response did not match the expected chat-completion shape",
      502,
    );
  }
  const response = payload as Record<string, unknown>;
  const message = ((response["choices"] as Array<Record<string, unknown>> | undefined)?.[0]?.["message"]) as
    | { content?: string | Array<{ text?: string }>; annotations?: Array<Record<string, unknown>> }
    | undefined;
  let answer: string | undefined;
  if (typeof message?.content === "string") answer = message.content.trim() || undefined;
  else if (Array.isArray(message?.content)) {
    answer = (message.content ?? [])
      .map((part) => part.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() || undefined;
  }
  const sources: SearchSource[] = [];
  const citations: SearchCitation[] = [];
  const seenUrls = new Set<string>();
  for (const annotation of message?.annotations ?? []) {
    const citation = annotation["url_citation"] as { url?: string; title?: string; content?: string } | undefined;
    if (!citation) continue;
    const url = citation.url?.trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title = citation.title?.trim() || url;
    const citedText = citation.content?.trim() || undefined;
    sources.push({ title, url, snippet: citedText });
    citations.push({ title, url, citedText });
  }
  const usageRaw = response["usage"] as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  const usage: SearchUsage | undefined = usageRaw
    ? {
      inputTokens: typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : undefined,
      outputTokens: typeof usageRaw.completion_tokens === "number" ? usageRaw.completion_tokens : undefined,
      totalTokens: typeof usageRaw.total_tokens === "number" ? usageRaw.total_tokens : undefined,
    }
    : undefined;
  return {
    provider: "openrouter",
    answer,
    sources,
    citations: citations.length > 0 ? citations : undefined,
    usage,
    model: typeof response["model"] === "string" ? response["model"] : modelId,
  };
}

function isOpenRouterResponseLike(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record["id"] !== undefined && typeof record["id"] !== "string") return false;
  if (record["model"] !== undefined && typeof record["model"] !== "string") return false;
  if (record["choices"] !== undefined && !Array.isArray(record["choices"])) return false;
  if (record["usage"] !== undefined && (record["usage"] === null || typeof record["usage"] !== "object")) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Enrichment (W7): grounding-redirect HEAD secondaries.
// ---------------------------------------------------------------------------

/** Pinned `isGroundingRedirectUrl` (providers/gemini.ts @ 2a2c6dc). */
export function isGroundingRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "vertexaisearch.cloud.google.com" && parsed.pathname.includes("/grounding-api-redirect");
  } catch {
    return false;
  }
}

/**
 * Enrichment bounds mirroring the pinned native shape: each grounding-redirect
 * URL is a controlled secondary hop with the SHARED search hop budget (row 17
 * secondary pattern — hop indices stay comparable across one search), the
 * pinned 5 s hard timeout per HEAD, and a count cap capping payload-driven
 * fan-out (a hostile/odd provider payload cannot issue unbounded hops).
 */
export const MAX_ENRICHMENT_SUBREQUESTS = 10;
export const ENRICHMENT_TIMEOUT_MS = 5_000;

/** Deps for enrichment HEADs (all injected; mirrors row-17 transport deps). */
export interface SearchEnrichmentDeps {
  readonly resolveHost: ResolveHost;
  readonly credentialPresence: SearchCredentialPresence;
  readonly posture: FetchEgressPolicy;
  readonly fetchImpl: FetchTransportFn;
  readonly signal?: AbortSignal;
  readonly recordSink?: (record: SearchDecisionRecord) => void;
}

/** Enrichment outcome: resolved URL, or keep-the-proxy-URL native default. */
export interface EnrichmentOutcome {
  readonly resolvedUrl: string;
  readonly blocked: boolean;
}

/**
 * Resolve ONE grounding-redirect proxy URL through the controlled transport:
 * the hop decision is row 17's (`decideSearchRoute` → `decideFetchHop` as a
 * secondary hop), then a manual single `HEAD` with `redirect: "manual"` (and
 * the consumed proxy under enforcing posture) is issued — ONE attempt, the
 * pinned 5 s hard timeout. The response `Location`, when present, is itself
 * a NEW secondary hop re-validated by the same core BEFORE its URL is
 * adopted (a private/metadata Location is never handed back as a resolved
 * source). Failure (transport error, timeout, blocked hop, blocked Location)
 * keeps the proxy URL — the pinned native silent-but-honest behavior — and
 * every hop is recorded credential-free.
 */
export async function resolveGroundingRedirectThroughTransport(
  proxyUrl: string,
  hopsFollowed: number,
  deps: SearchEnrichmentDeps,
): Promise<EnrichmentOutcome> {
  const decisionDeps = {
    resolveHost: deps.resolveHost,
    credentialPresence: deps.credentialPresence,
    posture: deps.posture,
  };
  const decision = await decideSearchRoute(
    { url: proxyUrl, hopKind: "enrichment", hopsFollowed },
    decisionDeps,
  );
  if (decision.decision === "block") {
    deps.recordSink?.(decision.record);
    return { resolvedUrl: proxyUrl, blocked: true };
  }
  deps.recordSink?.(decision.record);
  try {
    const timeout = AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS);
    const init: Record<string, unknown> = {
      method: "HEAD",
      redirect: "manual",
      signal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
    };
    if (decision.decision === "allow-via-proxy") init["proxy"] = decision.proxyEndpoint;
    const response = await deps.fetchImpl(proxyUrl, init as RequestInit);
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) return { resolvedUrl: proxyUrl, blocked: false };
    const resolved = new URL(location, proxyUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return { resolvedUrl: proxyUrl, blocked: false };
    }
    // The Location target re-enters as its OWN secondary hop: adopted only
    // when row 17's core allows it; a blocked target keeps the proxy URL.
    const locationDecision = await decideSearchRoute(
      { url: resolved.toString(), hopKind: "enrichment", hopsFollowed: hopsFollowed + 1 },
      decisionDeps,
    );
    if (locationDecision.decision === "block") {
      deps.recordSink?.(locationDecision.record);
      return { resolvedUrl: proxyUrl, blocked: true };
    }
    deps.recordSink?.(locationDecision.record);
    return { resolvedUrl: resolved.toString(), blocked: false };
  } catch {
    return { resolvedUrl: proxyUrl, blocked: false };
  }
}

// ---------------------------------------------------------------------------
// The controlled provider-route executor (single attempt, manual hops).
// ---------------------------------------------------------------------------

/**
 * Body cap for provider responses read by the executor (pinned 2 MiB
 * `readLimitedText` cap — answer streams are bounded reads, never unbounded
 * through the proxy seam).
 */
export const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;

const IS_REDIRECT_STATUS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };

/** Transport deps for the executor (tests inject every field). */
export interface SearchTransportDeps extends SearchDecisionDeps {
  readonly fetchImpl: FetchTransportFn;
  readonly recordSink?: (record: SearchDecisionRecord) => void;
  readonly signal?: AbortSignal;
  readonly endpoints?: typeof PINNED_SEARCH_ENDPOINTS;
  /** Credential value for request construction ONLY (never recorded/logged). */
  readonly credential: string;
}

export type SearchRouteResult =
  | { readonly ok: true; readonly response: SearchResponse; readonly notes: readonly string[] }
  | {
    readonly ok: false;
    readonly failure:
      | { readonly kind: "blocked"; readonly record: SearchDecisionRecord }
      | { readonly kind: "provider"; readonly error: SearchProviderFailure | Error };
  };

/**
 * Issue ONE provider request through the controlled transport and map the
 * response to the native-shape result.
 *
 * - ONE controlled attempt per decision: no `fetchWithRetry`-style unguarded
 *   retry (the pinned native retry is a P0 bypass and is NOT reproduced).
 * - Redirects follow ONLY via the manual per-hop loop mirroring row 17:
 *   each hop decided BEFORE issue, `redirect: "manual"` at every issue, hop
 *   bound `MAX_REDIRECT_HOPS`, private-target `Location`s blocked at the hop.
 * - Enrichment (`gemini` grounding-redirect URLs in the parsed payload) re-
 *   enters as secondary hops within the shared budget and caps.
 * - Honest branches mirror the pinned parsers: an empty grounded Gemini
 *   payload and an OpenRouter response with neither answer nor citations are
 *   honest 502-family provider failures; a renderable response with zero
 *   sources and zero citations is the native 204-style no-sources failure —
 *   never an answer-shaped fabrication.
 */
export async function runSearchRoute(
  request: BuiltSearchRequest,
  deps: SearchTransportDeps,
): Promise<SearchRouteResult> {
  const decisionDeps: SearchDecisionDeps = {
    resolveHost: deps.resolveHost,
    credentialPresence: deps.credentialPresence,
    posture: deps.posture,
  };
  // Manual hop loop over the provider endpoint (row-17 semantics: decided
  // before issue, redirect:"manual", proxy under enforcing, hop bound).
  let currentUrl = request.url;
  let hopsFollowed = 0;
  let response: Response | undefined;
  for (;;) {
    const hopDecision = await decideSearchRoute(
      { url: currentUrl, hopKind: "provider-endpoint", hopsFollowed },
      decisionDeps,
    );
    if (hopDecision.decision === "block") {
      deps.recordSink?.(hopDecision.record);
      return { ok: false, failure: { kind: "blocked", record: hopDecision.record } };
    }
    deps.recordSink?.(hopDecision.record);
    const init: Record<string, unknown> = {
      method: request.init.method,
      headers: new Headers(request.init.headers),
      body: request.init.body,
      redirect: "manual",
      ...(deps.signal ? { signal: deps.signal } : {}),
    };
    if (hopDecision.decision === "allow-via-proxy") init["proxy"] = hopDecision.proxyEndpoint;
    try {
      response = await deps.fetchImpl(currentUrl, init as RequestInit);
    } catch (error) {
      // Transport failure: honest provider error, no unguarded retry.
      return {
        ok: false,
        failure: {
          kind: "provider",
          error: new SearchProviderFailure(
            request.backend,
            error instanceof Error ? error.message : String(error),
            0,
          ),
        },
      };
    }
    if (!(response.status in IS_REDIRECT_STATUS)) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) {
      return {
        ok: false,
        failure: {
          kind: "provider",
          error: new SearchProviderFailure(
            request.backend,
            `${SEARCH_BACKEND_LABELS[request.backend]} redirect without Location`,
            502,
          ),
        },
      };
    }
    hopsFollowed += 1;
    // The NEXT hop's decision (including the hop bound) runs BEFORE issue;
    // a private/metadata Location blocks at the hop, never issuing the hop.
    currentUrl = new URL(location, currentUrl).toString();
  }
  // `break` guarantees assignment above; narrow for the type system.
  if (!response) {
    return { ok: false, failure: { kind: "provider", error: new SearchProviderFailure(request.backend, "no response", 0) } };
  }
  const bodyText = await readCappedBodyText(response, MAX_SEARCH_RESPONSE_BYTES).catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      failure: {
        kind: "provider",
        error: classifySearchProviderHttpError(request.backend, response.status, bodyText, deps.credential),
      },
    };
  }
  const endpoints = deps.endpoints ?? PINNED_SEARCH_ENDPOINTS;
  const parsed = parseProviderResponseBody(request.backend, bodyText, endpoints, deps.credential);
  if (parsed instanceof SearchProviderFailure) {
    return { ok: false, failure: { kind: "provider", error: parsed } };
  }
  let searchResponse = parsed;
  // Pinned executeSearch no-sources branch (W8): a grounded candidate with
  // zero sources AND zero citations is the honest 204-style failure — an
  // answer without sources is not a search result (fabrication guard).
  if (searchResponse.sources.length === 0 && !searchResponse.citations?.length) {
    return { ok: false, failure: { kind: "provider", error: searchNoSourcesFailure(request.backend) } };
  }
  const notes: string[] = [];
  // Gemini enrichment: bounded, budget-shared, failure-keeps-proxy-URL.
  if (request.backend === "gemini") {
    const redirectUrls = new Set<string>();
    for (const src of searchResponse.sources) if (isGroundingRedirectUrl(src.url)) redirectUrls.add(src.url);
    for (const cit of searchResponse.citations ?? []) if (isGroundingRedirectUrl(cit.url)) redirectUrls.add(cit.url);
    const targets = [...redirectUrls];
    if (targets.length > MAX_ENRICHMENT_SUBREQUESTS) {
      notes.push(`enrichment capped at ${MAX_ENRICHMENT_SUBREQUESTS} redirect resolutions`);
    }
    const resolved = new Map<string, string>();
    let blockedCount = 0;
    for (const url of targets.slice(0, MAX_ENRICHMENT_SUBREQUESTS)) {
      const outcome = await resolveGroundingRedirectThroughTransport(url, hopsFollowed, {
        resolveHost: deps.resolveHost,
        credentialPresence: deps.credentialPresence,
        posture: deps.posture,
        fetchImpl: deps.fetchImpl,
        ...(deps.signal ? { signal: deps.signal } : {}),
        ...(deps.recordSink ? { recordSink: deps.recordSink } : {}),
      });
      resolved.set(url, outcome.resolvedUrl);
      if (outcome.blocked) blockedCount += 1;
    }
    if (blockedCount > 0) notes.push(`${blockedCount} enrichment redirect(s) blocked; proxy URL kept`);
    if (resolved.size > 0) {
      searchResponse = {
        ...searchResponse,
        sources: searchResponse.sources.map((src) => ({ ...src, url: resolved.get(src.url) ?? src.url })),
        citations: searchResponse.citations?.map((cit) => ({ ...cit, url: resolved.get(cit.url) ?? cit.url })),
      };
    }
  }
  return { ok: true, response: searchResponse, notes };
}

/** Parse a 2xx provider body into the native-shape response or the honest
 *  pinned-parser failure (both backends' empty/malformed branches mirror the
 *  pinned guards; nothing here can fabricate content). */
function parseProviderResponseBody(
  backend: SupportedSearchBackend,
  bodyText: string,
  endpoints: typeof PINNED_SEARCH_ENDPOINTS,
  credential: string,
): SearchResponse | SearchProviderFailure {
  if (backend === "gemini") {
    const result = parseGeminiSearchStreamText(bodyText, endpoints.gemini.model);
    // Pinned `finalizeGeminiSearchResult` guard: a wholly empty grounded
    // payload is an honest 502-family failure, never a fabricated success.
    return !result.answer && result.sources.length === 0
      ? new SearchProviderFailure("gemini", "Gemini API returned an empty grounded response", 502)
      : result;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    return new SearchProviderFailure(
      "openrouter",
      `OpenRouter returned an invalid response: ${
        capAndScrub(error instanceof Error ? error.message : String(error), credential)
      }`,
      502,
    );
  }
  const result = parseOpenRouterSearchResponse(payload, endpoints.openrouter.model);
  if (result instanceof SearchProviderFailure) return result;
  if (!result.answer && result.sources.length === 0) {
    // Pinned branch: neither answer nor citations → honest 502 failure.
    return new SearchProviderFailure("openrouter", "OpenRouter web search returned no answer or citations", 502);
  }
  return result;
}

async function readCappedBodyText(response: Response, cap: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const room = cap - total;
      chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
      total += Math.min(value.byteLength, room);
    }
  }
  if (total >= cap) await reader.cancel().catch(() => {});
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, total - offset);
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return new TextDecoder().decode(merged.subarray(0, offset));
}
