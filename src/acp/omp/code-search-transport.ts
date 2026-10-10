/**
 * Controlled Public-Code-Search Transport Adapter — pure decision core +
 * interface-parity contract (row 21, `adapt-omp-public-code-search`,
 * design D2-D5).
 *
 * Two surfaces live here (tasks 2.1/2.2):
 *
 * 1. The pure decision core `decideCodeSearchRoute(input, deps)`, evaluated
 *    over the injected `{ resolveHost, credentialPresence, posture }`. EVERY
 *    hop decision — the search-endpoint request and every result-enrichment
 *    subrequest — delegates to row 17's `decideFetchHop`
 *    (`./fetch-transport.ts`, import-only). This module ships no second SSRF
 *    classifier, no local copy of any rule, and no new posture value: the
 *    decisions, reason codes, hop bound, and credential-free
 *    `{ host, hopIndex, decision, reason }` records are row 17's verbatim.
 *    The ONLY code-search-only reason addition is the credential-scope code
 *    `no-supported-credential`.
 *
 * 2. The interface-parity contract, spec-locked for whenever a supported
 *    backend lands: query-parameter pass-through shape; the future-result
 *    mapping declaring per-item excerpt (bounded by the pinned preview
 *    limit 50), source attribution (source URL), repository identity
 *    (`nameWithOwner`-style), file path, and language fields, with
 *    documented total-size bounds mirroring the pinned limit default 10 /
 *    max 50 (C9); the honest error mapping copied verbatim from row 18's
 *    rules (auth/rate/HTTP/malformed → native-shape provider-failure message
 *    naming the provider, single controlled attempt per decision, no
 *    backend/agent switch) and the empty-vs-error distinction (zero matches
 *    → honest empty naming the query). The `runCodeSearchRoute` executor
 *    exists to PIN the reserved sibling's observable contract with runnable
 *    synthetic fixtures (tasks 4.1/5.2): in the current credential state the
 *    credential gate makes it fail closed with zero transport, and no
 *    trusted-extension tool is registered (route-table D4).
 *
 * Credential scope (design D2, stricter than row 18 by necessity): the
 * approved credential path registers NO code-search credential at these
 * pins, so there is NO env name this module may read — presence arrives
 * ONLY as an injected decision input. This module never reads process.env,
 * never consults a NEVER_PASS name (`GITHUB_TOKEN` et al.), and a
 * credential whose registered purpose is another subsystem (e.g. the
 * git-backup token) can never satisfy the predicate: only the presence of
 * the future row-7-registered dedicated read-only code-search credential
 * does. Presence is booleans ONLY — values never pass through any output
 * here, are never logged, and never appear in records.
 *
 * Honesty invariants (spec-locked): provider auth/rate/HTTP/malformed
 * failures surface as honest tool errors in the pinned provider-failure
 * message shape — never fabricated results, never an unguarded transport
 * retry (one controlled attempt per decision), never a backend or agent
 * switch. Zero matches is an honest empty naming the query, distinct from
 * every error shape. Decision records and log lines carry host/hop/decision/
 * reason only — never credentials, headers, query strings, or payload bytes.
 *
 * Transport-facts honesty (task 4.2, mirrors docs/OMP_NETWORK.md): the
 * factory's best-effort env routing stays exactly as-is and is NOT
 * enforcement — `HTTP_PROXY` presence alone never established mediation (the
 * pre-existing F14 residual is unchanged). The Skill API loopback endpoint
 * and the proxy endpoint are fixed deployment transport facts and stay OUT
 * of every decision input. Search endpoint hosts are validated like every
 * other target: the adapter never exempts them. Egress posture and proxy
 * endpoint are consumed from row 17's existing
 * `fetchEgressPolicyFromAgentEnv`/`deriveFetchEgressPolicy` singletons — no
 * new config/env/Helm field exists in this layer.
 *
 * Installed-closure note: the trusted-extension install closure imports
 * ONLY `./code-search-routes.ts` (via `tool-inventory.ts`'s marker); this
 * module is dev/consumer-side (tests, the future sibling) and is NOT part
 * of the declared install closure.
 */

import {
  decideFetchHop,
  type FetchDecisionRecord,
  type FetchEgressPolicy,
  type FetchHopDecision,
  type FetchTransportFn,
  formatFetchDecisionLog,
  MAX_REDIRECT_HOPS,
  type ResolveHost,
} from "./fetch-transport.ts";

// The shared bound is re-exported (never copied) so consumers and tests
// consume the same constant ssrf.ts owns through row 17.
export { MAX_REDIRECT_HOPS };

// ---------------------------------------------------------------------------
// Credential scope (D2): presence is an injected decision input ONLY.
// ---------------------------------------------------------------------------

/**
 * Credential-presence input: presence booleans ONLY, never values.
 * `dedicatedCodeSearchToken` means "the credential the approved config path
 * registers FOR CODE SEARCH is present" — a credential registered for any
 * other subsystem (git backup, MCP example, anything) is NOT this presence
 * and never satisfies the predicate (D2 blast-radius rule).
 */
export interface CodeSearchCredentialPresence {
  readonly dedicatedCodeSearchToken: boolean;
}

// ---------------------------------------------------------------------------
// Decision vocabulary (row 17 verbatim + the one sanctioned addition).
// ---------------------------------------------------------------------------

/**
 * Hop-level block reasons are row 17's verbatim; the code-search adapter
 * adds EXACTLY one credential-scope code and nothing else (tasks 2.1).
 */
export type CodeSearchBlockReason =
  | "disallowed-scheme"
  | "url-unparseable"
  | "dns-unresolved"
  | "dns-invalid-answer"
  | "disallowed-address"
  | "cloud-metadata"
  | "hop-limit-exceeded"
  | "egress-policy-unresolved"
  | "no-supported-credential";

/** The sanctioned code-search-only credential-scope reason code. */
export type CodeSearchCredentialBlockReason = "no-supported-credential";

/** Hop kinds mirror row 17/18: search endpoint and enrichment secondary. */
export type CodeSearchHopKind = "search-endpoint" | "enrichment";

/** Input for one code-search-route decision (endpoint hop or enrichment hop). */
export interface CodeSearchRouteInput {
  /** The URL whose hop is being decided (search POST/GET or enrichment target). */
  readonly url: string;
  /** The hop kind; enrichment re-enters as row-17 secondary hops. */
  readonly hopKind: CodeSearchHopKind;
  /** Redirect hops already followed (0 at hop 1); shared search budget. */
  readonly hopsFollowed: number;
}

/** Dependencies the pure decision core is evaluated over (all injected). */
export interface CodeSearchDecisionDeps {
  readonly resolveHost: ResolveHost;
  readonly credentialPresence: CodeSearchCredentialPresence;
  readonly posture: FetchEgressPolicy;
}

/**
 * Credential-free pre-transport record for the credential-scope block.
 * Carries no host (no host was ever consulted), no credential, and only the
 * fixed reason code — at most `{ hopIndex, decision, reason }`.
 */
export interface CodeSearchCredentialRecord {
  readonly hopIndex: 0;
  readonly decision: "block";
  readonly reason: CodeSearchCredentialBlockReason;
}

/** The credential-scope block (D2): fail-closed with the user decision. */
export interface CodeSearchCredentialBlock {
  readonly decision: "block";
  readonly reason: CodeSearchCredentialBlockReason;
  readonly userDecisionRequired: true;
  readonly record: CodeSearchCredentialRecord;
}

/**
 * Decision for one code-search hop. `allow-*`/`block` hop decisions reuse
 * row 17's decision + record shapes verbatim; the credential-scope block is
 * the only code-search-native shape and carries `userDecisionRequired`.
 */
export type CodeSearchRouteDecision = FetchHopDecision | CodeSearchCredentialBlock;

/** Every decision record the code-search adapter can emit (both shapes). */
export type CodeSearchDecisionRecord = FetchDecisionRecord | CodeSearchCredentialRecord;

/** Render one record (row-17 or credential scope) as a credential-free log line. */
export function formatCodeSearchDecisionLog(record: CodeSearchDecisionRecord): string {
  if ("host" in record) {
    return formatFetchDecisionLog(record).replace(
      "[air-fetch-adapter]",
      "[air-codesearch-adapter]",
    );
  }
  return `[air-codesearch-adapter] hop=${record.hopIndex} decision=${record.decision} reason=${record.reason}`;
}

/**
 * Decide ONE code-search hop. Credential scope first (pre-transport, zero
 * network): with no dedicated code-search credential present the hop blocks
 * with the sanctioned credential-scope reason and `userDecisionRequired` —
 * no scraping backend fallback, no NEVER_PASS credential consultation, no
 * transport call. Every surviving hop (search endpoint and enrichment
 * subrequest alike) delegates verbatim to row 17's `decideFetchHop`: same
 * rules, same posture, same records, same hop bound. The adapter never
 * re-implements, forks, softens, or bypasses that rule set.
 */
export async function decideCodeSearchRoute(
  input: CodeSearchRouteInput,
  deps: CodeSearchDecisionDeps,
): Promise<CodeSearchRouteDecision> {
  if (!deps.credentialPresence.dedicatedCodeSearchToken) {
    return {
      decision: "block",
      reason: "no-supported-credential",
      userDecisionRequired: true,
      record: Object.freeze(
        { hopIndex: 0, decision: "block", reason: "no-supported-credential" } as const,
      ),
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
// Interface-parity contract (D5; pinned bounds = C9). Spec-locked for the
// future registerTool sibling — pinned by tests, not prose (tasks 4.1).
// ---------------------------------------------------------------------------

/**
 * The code-search query shape (query-parameter pass-through; GitHub text-
 * match search field names). Input validation is native-schema-equivalent
 * with adapter caps: the query is model-controlled, so its length and the
 * bounded selectors are clamped BEFORE request construction.
 */
export interface CodeSearchQuery {
  query: string;
  /** `repo:owner/name`-style scope filter, passed through. */
  repo?: string;
  /** Language filter, passed through. */
  language?: string;
  /** Result bound: default 10, hard-capped at the pinned max 50 (C9). */
  limit?: number;
}

/** Pinned reference bounds (C9: gh-search.ts SEARCH_LIMIT_DEFAULT/MAX, FILE_PREVIEW_LIMIT). */
export const CODE_SEARCH_LIMIT_DEFAULT = 10;
export const CODE_SEARCH_LIMIT_MAX = 50;
export const CODE_SEARCH_PREVIEW_LIMIT = 50;

/** Adapter caps on the model-controlled query text. */
export const MAX_CODE_SEARCH_QUERY_CHARS = 4096;
/** Total rendered-size bound for one result set (documented envelope bound). */
export const MAX_CODE_SEARCH_RESULT_CHARS = 20_000;

/**
 * Validate/passthrough the query shape. Returns the normalized query or a
 * short honest validation message (bounded; never echoes the payload).
 */
export function parseCodeSearchInput(
  params: Record<string, unknown>,
): { readonly ok: true; readonly query: CodeSearchQuery } | {
  readonly ok: false;
  readonly error: string;
} {
  const rawQuery = params["query"];
  if (typeof rawQuery !== "string" || rawQuery.length === 0) {
    return { ok: false, error: "code_search: `query` must be a non-empty string" };
  }
  if (rawQuery.length > MAX_CODE_SEARCH_QUERY_CHARS) {
    return {
      ok: false,
      error: `code_search: \`query\` exceeds the ${MAX_CODE_SEARCH_QUERY_CHARS}-character bound`,
    };
  }
  const normalized: CodeSearchQuery = { query: rawQuery };
  for (const key of ["repo", "language"] as const) {
    const value = params[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || value.length > 200) {
      return { ok: false, error: `code_search: \`${key}\` must be a short non-empty string` };
    }
    normalized[key] = value;
  }
  if (params["limit"] !== undefined) {
    const limit = params["limit"];
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
      return { ok: false, error: "code_search: `limit` must be a finite number" };
    }
    normalized.limit = Math.min(Math.max(Math.trunc(limit), 1), CODE_SEARCH_LIMIT_MAX);
  } else {
    normalized.limit = CODE_SEARCH_LIMIT_DEFAULT;
  }
  return { ok: true, query: Object.freeze(normalized) };
}

/** One rendered result item (C9 attribution/excerpt shape). */
export interface CodeSearchItem {
  /** Repository identity, `owner/name` style (C9 nameWithOwner). */
  readonly nameWithOwner: string;
  /** File path within the repository (C9). */
  readonly path: string;
  /** Language metadata when the backend reports it. */
  readonly language?: string;
  /** Bounded text-match excerpt (preview limit 50; C9). */
  readonly excerpt: string;
  /** Source attribution: the item's browsable source URL. */
  readonly sourceUrl: string;
}

/** The unified code-search response (native-shaped details payload). */
export interface CodeSearchResponse {
  readonly provider: "github-code-search" | "none";
  /** Query echo (spec: the result names the query). */
  readonly query: string;
  readonly items: readonly CodeSearchItem[];
  /** Total rendered text bound applied (C9 total-size documentation). */
  readonly truncated: boolean;
}

/** Truncate to a pinned bound with the pinned ellipsis convention. */
function truncateBounded(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Map a GitHub Code Search API (`/search/code`, text-match media type)
 * payload to the interface-parity shape: per-item excerpt bounded to the
 * pinned preview limit, repo/path/language attribution, per-item source URL.
 * Malformed or non-object payloads surface as the honest malformed failure
 * (never fabricated items).
 */
export function parseCodeSearchResponse(
  payload: unknown,
  query: string,
): CodeSearchResponse | CodeSearchProviderFailure {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return new CodeSearchProviderFailure(
      "github-code-search",
      "GitHub Code Search returned an invalid response: payload is not an object",
      502,
    );
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record["items"])) {
    return new CodeSearchProviderFailure(
      "github-code-search",
      "GitHub Code Search returned an invalid response: `items` is missing or not a list",
      502,
    );
  }
  const items: CodeSearchItem[] = [];
  let totalChars = 0;
  let truncated = false;
  for (const raw of record["items"] as readonly unknown[]) {
    if (raw === null || typeof raw !== "object") {
      return new CodeSearchProviderFailure(
        "github-code-search",
        "GitHub Code Search returned an invalid response: an item is not an object",
        502,
      );
    }
    const item = raw as Record<string, unknown>;
    const repo = item["repository"];
    const nameWithOwner = repo !== null && typeof repo === "object"
      ? (repo as Record<string, unknown>)["nameWithOwner"]
      : undefined;
    const path = item["path"];
    if (typeof nameWithOwner !== "string" || typeof path !== "string") {
      return new CodeSearchProviderFailure(
        "github-code-search",
        "GitHub Code Search returned an invalid response: an item lacks repository/path attribution",
        502,
      );
    }
    // Text-match excerpts (Accept: application/vnd.github.text-match+json);
    // absent matches yield an excerpt-free item, never a fabricated one.
    const matches = Array.isArray(item["text_matches"])
      ? item["text_matches"] as readonly unknown[]
      : [];
    let excerpt = "";
    for (const rawMatch of matches) {
      if (rawMatch !== null && typeof rawMatch === "object") {
        const fragment = (rawMatch as Record<string, unknown>)["fragment"];
        if (typeof fragment === "string" && fragment.length > 0) {
          excerpt = fragment;
          break;
        }
      }
    }
    const language = typeof item["language"] === "string" ? item["language"] : undefined;
    const htmlUrl = typeof item["html_url"] === "string" ? item["html_url"] : "";
    const bounded = truncateBounded(excerpt, CODE_SEARCH_PREVIEW_LIMIT);
    const projected = totalChars + bounded.length;
    if (projected > MAX_CODE_SEARCH_RESULT_CHARS) {
      truncated = true;
      break;
    }
    totalChars = projected;
    items.push({
      nameWithOwner,
      path,
      ...(language !== undefined ? { language } : {}),
      excerpt: bounded,
      sourceUrl: htmlUrl || `https://github.com/${nameWithOwner}/blob/HEAD/${path}`,
    });
  }
  return { provider: "github-code-search", query, items, truncated };
}

// ---------------------------------------------------------------------------
// Honest error mapping (row-18 rules verbatim, C9 provider identity).
// ---------------------------------------------------------------------------

/** Cap + scrub bound for provider-derived error text (records posture). */
export const MAX_CODE_SEARCH_ERROR_BODY_CHARS = 300;

function capAndScrub(body: string, credential: string): string {
  let text = body.replace(/\s+/g, " ").trim();
  if (credential !== "") text = text.split(credential).join("[redacted]");
  // Query strings and userinfo must never ride error text either.
  text = text.replace(/https?:\/\/\S*\?\S*/g, "[url-redacted]");
  return truncateBounded(text, MAX_CODE_SEARCH_ERROR_BODY_CHARS);
}

/** Provider-classified failure (row-18 `SearchProviderFailure` observable). */
export class CodeSearchProviderFailure extends Error {
  readonly provider: "github-code-search";
  readonly status?: number;
  constructor(provider: "github-code-search", message: string, status?: number) {
    super(message);
    this.name = "CodeSearchProviderFailure";
    this.provider = provider;
    this.status = status;
  }
}

/**
 * Provider HTTP classification mirroring row 18's pinned shape: 401/403 map
 * to auth, 402/429 to rate/credits, every other non-2xx to the provider
 * error line; credential material and query strings are scrubbed from any
 * interpolated body text before it reaches the envelope.
 */
export function classifyCodeSearchHttpError(
  provider: "github-code-search",
  status: number,
  body: string,
  credential: string,
): CodeSearchProviderFailure {
  const sanitized = capAndScrub(body, credential);
  if (status === 401) {
    return new CodeSearchProviderFailure(provider, "github-code-search: 401 unauthorized", status);
  }
  if (status === 403) {
    if (sanitized.includes("rate limit")) {
      return new CodeSearchProviderFailure(
        provider,
        "github-code-search: 403 rate limit exceeded",
        status,
      );
    }
    return new CodeSearchProviderFailure(provider, "github-code-search: 403 forbidden", status);
  }
  if (status === 429) {
    return new CodeSearchProviderFailure(
      provider,
      "github-code-search: 429 rate limit exceeded",
      status,
    );
  }
  return new CodeSearchProviderFailure(
    provider,
    `GitHub Code Search error (${status}): ${sanitized}`,
    status,
  );
}

/** Mirror of the pinned provider-failure formatter (row-18 rule verbatim). */
export function formatCodeSearchProviderFailure(failure: unknown): string {
  if (failure instanceof CodeSearchProviderFailure) {
    if (failure.status === 401 || failure.status === 403) {
      return `GitHub Code Search authorization failed (${failure.status}). Check the code-search credential.`;
    }
    if (failure.status === 429) {
      return "GitHub Code Search rate limit exceeded (429). Retry later or use an authenticated credential.";
    }
    return failure.message;
  }
  if (failure instanceof Error) return failure.message;
  return "Unknown error from GitHub Code Search";
}

// ---------------------------------------------------------------------------
// Native-shaped envelopes.
// ---------------------------------------------------------------------------

/**
 * The adapter's envelope, byte-shape-comparable to the native result:
 * `{ content: [{ type: "text", text }], details: { response, error? } }`.
 */
export interface CodeSearchToolEnvelope {
  readonly content: ReadonlyArray<{ type: "text"; text: string }>;
  readonly details: {
    readonly response: CodeSearchResponse;
    readonly error?: string;
    readonly adapterCompleted?: true;
  };
}

/** Render the response in the native-shaped text layout (C9 attribution layout). */
export function formatCodeSearchForLLM(response: CodeSearchResponse): string {
  const parts: string[] = [`Code search: ${response.query}`];
  if (response.items.length === 0) {
    parts.push(`No code matches found for query: ${response.query}`);
  }
  for (const [i, item] of response.items.entries()) {
    const lang = item.language ? ` (${item.language})` : "";
    parts.push(`[${i + 1}] ${item.nameWithOwner}/${item.path}${lang}\n    ${item.sourceUrl}`);
    if (item.excerpt) parts.push(`    ${truncateBounded(item.excerpt, CODE_SEARCH_PREVIEW_LIMIT)}`);
  }
  if (response.truncated) parts.push("(result size bound applied)");
  return parts.join("\n");
}

/** Success envelope (native shape + the completion marker in details). */
export function codeSearchSuccessEnvelope(
  response: CodeSearchResponse,
): CodeSearchToolEnvelope {
  return {
    content: [{ type: "text" as const, text: formatCodeSearchForLLM(response) }],
    details: { response, adapterCompleted: true as const },
  };
}

/** The honest failure envelope (native failure-message shape naming the provider). */
export function codeSearchFailureEnvelope(
  failure: unknown,
): CodeSearchToolEnvelope {
  const message = formatCodeSearchProviderFailure(failure);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: {
      response: { provider: "none", query: "", items: [], truncated: false },
      error: message,
    },
  };
}

/**
 * The credential-absent honest tool error (D2 fail-closed): names the
 * capability gap and the user decision, never fabricates a result, never
 * hints a scraping fallback.
 */
export function codeSearchNoCredentialEnvelope(): CodeSearchToolEnvelope {
  const message =
    "No supported code-search credential is configured; public code search is unavailable " +
    "(capability gap — provision a separate read-only code-search credential via the approved " +
    "config path, or accept the gap).";
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: {
      response: { provider: "none", query: "", items: [], truncated: false },
      error: message,
    },
  };
}

// ---------------------------------------------------------------------------
// The controlled search-route executor — RESERVED-MECHANISM CONTRACT.
// ---------------------------------------------------------------------------

/**
 * Body cap for search responses read by the executor (mirrors row 18's
 * bounded reads — result payloads are bounded reads, never unbounded).
 */
export const MAX_CODE_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Enrichment caps mirroring row 18's bounded, budget-shared secondaries. */
export const MAX_CODE_SEARCH_ENRICHMENT_SUBREQUESTS = 10;
export const CODE_SEARCH_ENRICHMENT_TIMEOUT_MS = 5_000;

const IS_REDIRECT_STATUS: Record<number, true> = {
  301: true,
  302: true,
  303: true,
  307: true,
  308: true,
};

/** A fully constructed search request (credential header value included;
 *  consumed once by the controlled executor, never logged, never returned). */
export interface BuiltCodeSearchRequest {
  readonly provider: "github-code-search";
  readonly url: string;
  readonly init: { method: "GET"; headers: Record<string, string> };
}

/** Pinned search endpoint origin (C7 identity — the API the removed tool and
 *  gh-search wrapped; frozen catalog data, never operator config). */
export const CODE_SEARCH_ENDPOINT = "https://api.github.com/search/code";

/** Build the code-search request from the validated query (query-parameter
 *  pass-through). The credential appears in the header at construction only. */
export function buildCodeSearchRequest(
  query: CodeSearchQuery,
  token: string,
): BuiltCodeSearchRequest {
  const searchTerms = [query.query];
  if (query.repo) searchTerms.push(`repo:${query.repo}`);
  if (query.language) searchTerms.push(`language:${query.language}`);
  const url = `${CODE_SEARCH_ENDPOINT}?q=${encodeURIComponent(searchTerms.join(" "))}&per_page=${
    query.limit ?? CODE_SEARCH_LIMIT_DEFAULT
  }`;
  return {
    provider: "github-code-search",
    url,
    init: {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github.text-match+json",
      },
    },
  };
}

/** Transport deps for the executor (tests inject every field). */
export interface CodeSearchTransportDeps extends CodeSearchDecisionDeps {
  readonly fetchImpl: FetchTransportFn;
  readonly recordSink?: (record: CodeSearchDecisionRecord) => void;
  readonly signal?: AbortSignal;
  /** Credential value for request construction ONLY (never recorded/logged). */
  readonly credential: string;
}

export type CodeSearchRouteResult =
  | { readonly ok: true; readonly response: CodeSearchResponse }
  | {
    readonly ok: false;
    readonly failure:
      | { readonly kind: "blocked"; readonly record: CodeSearchDecisionRecord }
      | { readonly kind: "provider"; readonly error: CodeSearchProviderFailure | Error };
  };

/**
 * Issue ONE code-search request through the controlled transport and map the
 * response to the interface-parity shape. THIS IS THE RESERVED SIBLING'S
 * PINNED CONTRACT: no tool is registered today and the credential gate
 * unconditionally fails the decision closed first, so in the current state
 * this executor is exercised only by labeled synthetic fixtures (tasks
 * 4.1/5.2). Its invariants mirror row 17/18 verbatim:
 *
 * - ONE controlled attempt per decision; no unguarded retry.
 * - Redirects follow ONLY via the manual per-hop loop: each hop decided
 *   BEFORE issue, `redirect: "manual"` at every issue, hop bound
 *   `MAX_REDIRECT_HOPS`, private-target `Location`s blocked at the hop.
 * - The credential header is sent to the pinned endpoint origin only; a
 *   redirect hop on a DIFFERENT origin is issued without it.
 * - Auth/rate/HTTP/malformed map to honest provider failures; zero matches
 *   is the honest empty naming the query — never a fabrication, never a
 *   backend or agent switch.
 */
export async function runCodeSearchRoute(
  request: BuiltCodeSearchRequest,
  deps: CodeSearchTransportDeps,
): Promise<CodeSearchRouteResult> {
  const decisionDeps: CodeSearchDecisionDeps = {
    resolveHost: deps.resolveHost,
    credentialPresence: deps.credentialPresence,
    posture: deps.posture,
  };
  let currentUrl = request.url;
  let hopsFollowed = 0;
  let response: Response | undefined;
  const pinnedOrigin = new URL(request.url).origin;
  for (;;) {
    const hopDecision = await decideCodeSearchRoute(
      { url: currentUrl, hopKind: "search-endpoint", hopsFollowed },
      decisionDeps,
    );
    if (hopDecision.decision === "block") {
      deps.recordSink?.(hopDecision.record);
      return { ok: false, failure: { kind: "blocked", record: hopDecision.record } };
    }
    deps.recordSink?.(hopDecision.record);
    const headers = new Headers(request.init.headers);
    if (new URL(currentUrl).origin !== pinnedOrigin) headers.delete("authorization");
    const init: Record<string, unknown> = {
      method: request.init.method,
      headers,
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
          error: new CodeSearchProviderFailure(
            request.provider,
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
          error: new CodeSearchProviderFailure(
            request.provider,
            "GitHub Code Search redirect without Location",
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
  if (!response) {
    return {
      ok: false,
      failure: {
        kind: "provider",
        error: new CodeSearchProviderFailure(request.provider, "no response", 0),
      },
    };
  }
  const bodyText = await readCappedBodyText(response, MAX_CODE_SEARCH_RESPONSE_BYTES).catch(() =>
    ""
  );
  if (!response.ok) {
    return {
      ok: false,
      failure: {
        kind: "provider",
        error: classifyCodeSearchHttpError(
          request.provider,
          response.status,
          bodyText,
          deps.credential,
        ),
      },
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: "provider",
        error: new CodeSearchProviderFailure(
          request.provider,
          `GitHub Code Search returned an invalid response: ${
            capAndScrub(error instanceof Error ? error.message : String(error), deps.credential)
          }`,
          502,
        ),
      },
    };
  }
  const parsed = parseCodeSearchResponse(payload, requestQueryEcho(request));
  if (parsed instanceof CodeSearchProviderFailure) {
    return { ok: false, failure: { kind: "provider", error: parsed } };
  }
  return { ok: true, response: parsed };
}

/** The query echo re-derived from the constructed request's query string
 *  (the executor never logs it; it only names the empty-vs-error result). */
function requestQueryEcho(request: BuiltCodeSearchRequest): string {
  try {
    return decodeURIComponent(new URL(request.url).searchParams.get("q") ?? "");
  } catch {
    return "";
  }
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
