/**
 * Trusted-Extension `web_search` Replacement Sibling (row 20,
 * `adapt-omp-web-search`, design D2/D3/D4).
 *
 * Fifth serial extension of the row-12/13/14b/17 trusted tree. In the
 * RESTRICTED launch branch the definition replaces the native `web_search`
 * (W1) through the pinned `registerTool` surface (S7/S8 via W10,
 * last-extension-wins): every restricted-session search is served entirely
 * by the search-transport adapter over the row-17 controlled transport —
 * endpoint request and grounding-redirect enrichment hops alike, manual
 * per-hop revalidation, hop bound, ONE controlled attempt per decision (the
 * provider `fetchWithRetry`-style unguarded retry is never reproduced). The
 * native provider transport path is never invoked on this branch.
 *
 * The native tool SURFACE is reproduced, not reinvented (D3/W8): the pinned
 * query-schema field names pass through, results land in the
 * `{ content: [{ type: "text" }], details: { response } }` envelope with the
 * `formatForLLM` layout, and honest failures keep the native message shapes.
 * Honesty is spec-locked: no-fabrication (the adapter has no fabricated
 * content path), no backend switch on failure (the selected credential
 * backend owns the request), no agent switch, and the credential-absent
 * deployment fail-closes with the native `No web search model configured.`
 * -family message plus the credential-scope block record.
 *
 * Delegation: unlike the `read` sibling, `web_search` has NO non-URL input
 * branch — the whole tool surface is network. The non-restricted (native
 * YOLO) session is therefore exempted STRUCTURALLY at the registration site
 * (14b posture, D6: native search keeps running native with no adapter
 * clamp), so this definition is never registered there and no native
 * delegation call ever exists on this path; `ctx` (S7/S8 `invokeTool`) is
 * carried for signature compatibility only and the native provider
 * transport is never invoked from a registered definition. The 14b handler
 * still gates every call FIRST; this replacement adds no second decision
 * path.
 *
 * Transport facts (task 4.3): egress posture + proxy endpoint come from the
 * existing row-17 singletons (`fetchEgressPolicyFromAgentEnv`), the
 * credential PRESENCE comes from the process env exactly as row 7 passes it
 * (`GEMINI_API_KEY`/`OPENROUTER_API_KEY`, decision input only, NEVER
 * logged), and the Skill API loopback endpoint and proxy endpoint stay OUT
 * of every decision input. Provider endpoint hosts are validated like every
 * other target — no exemption. The factory's existing best-effort env
 * routing is untouched and is NOT enforcement: `HTTP_PROXY` presence alone
 * never established mediation (the pre-existing F14 residual is unchanged).
 */

import { type EnforcementLaunchMode, observeLaunchMode } from "./enforcement.ts";
import { Type } from "@sinclair/typebox";
import {
  buildGeminiSearchRequest,
  buildOpenRouterSearchRequest,
  credentialPresenceFromEnv,
  decideSearchRoute,
  type FetchEgressPolicy,
  fetchEgressPolicyFromAgentEnv,
  type FetchTransportFn,
  MAX_SEARCH_QUERY_CHARS,
  parseSearchToolInput,
  PINNED_SEARCH_ENDPOINTS,
  productionFetchTransport,
  type ResolveHost,
  runSearchRoute,
  SEARCH_BACKEND_LABELS,
  type SearchCredentialPresence,
  type SearchDecisionRecord,
  searchFailureEnvelope,
  searchNoModelConfiguredEnvelope,
  searchSuccessEnvelope,
  type SearchToolEnvelope,
  selectSearchBackend,
  webSearchSeamState,
} from "./_daemon/mod.ts";
import { type NativeToolParameterSchema, runtimeResolveHost } from "./read-replacement.ts";

/** The pinned `registerTool` surface seam (row-22 closure note applies). */
export interface SearchToolRegistrar {
  registerTool(tool: SearchReplacementDefinition): void;
}

/** Dependencies frozen at registration; every field injectable for tests. */
export interface SearchReplacementDeps {
  /** Consumed egress posture facts (production default: agent env read). */
  readonly policy?: FetchEgressPolicy;
  /** DNS boundary seam; production default resolves via the host runtime. */
  readonly resolveHost?: ResolveHost;
  /** Transport seam; production default is the global fetch (mocked in tests). */
  readonly fetchImpl?: FetchTransportFn;
  /** Credential-free decision-record sink (row-17 record shapes verbatim). */
  readonly recordSink?: (record: SearchDecisionRecord) => void;
  /** Credential presence seam; production default reads row 7's env names. */
  readonly credentialPresence?: SearchCredentialPresence;
  /** Credential value provider seam for request construction ONLY (never
   *  recorded/logged); production default reads the selected env name. */
  readonly credentialValue?: (backend: "gemini" | "openrouter") => string;
}

/**
 * The pinned `ToolDefinition.parameters` field is NOT optional (host
 * input-gate; see the read sibling's note). This schema is the executor
 * parser's (`parseSearchToolInput`) declared vocabulary 1:1 — the pinned
 * `webSearchSchema` field names — locked closed so the host gate and the
 * executor can never disagree. `provider` is deliberately NOT a declared
 * field (the pinned tool takes none): a provider request is defended at the
 * executor and, with this gate, rejected by the host before dispatch.
 * Numeric fields stay plain optional numbers: the parser owns the adapter
 * caps (finite check, `num_search_results` clamp), so the gate and parser
 * cannot drift.
 * The query bound is calibration-shared: JSON Schema `maxLength` and the
 * parser's `query.length` BOTH count UTF-16 code units, so the two
 * 4096-unit bounds agree today — a future surrogate-aware rewrite of
 * either side must keep that agreement or the gate and parser desync.
 */
export const SEARCH_REPLACEMENT_PARAMETERS = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: MAX_SEARCH_QUERY_CHARS }),
    recency: Type.Optional(
      Type.Union([
        Type.Literal("day"),
        Type.Literal("week"),
        Type.Literal("month"),
        Type.Literal("year"),
      ]),
    ),
    limit: Type.Optional(Type.Number()),
    max_tokens: Type.Optional(Type.Number()),
    temperature: Type.Optional(Type.Number()),
    num_search_results: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

/** The pinned ToolDefinition-shaped replacement (execute signature per S7). */
export interface SearchReplacementDefinition {
  readonly name: "web_search";
  readonly label: string;
  readonly description: string;
  readonly approval: "read";
  readonly parameters: NativeToolParameterSchema;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: SearchDelegationContext,
  ): Promise<SearchToolEnvelope>;
}

/** The supported same-tool native delegation context (S7/S8 `invokeTool`). */
export interface SearchDelegationContext {
  invokeTool?(
    params: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

/** Production credential reader: value used ONLY for request construction. */
function credentialValueFromEnv(backend: "gemini" | "openrouter"): string {
  const name = backend === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
  try {
    if (typeof process !== "undefined" && process.env) return process.env[name] ?? "";
  } catch {
    // Environment unreadable: fail closed — empty credential never issues.
  }
  return "";
}

/**
 * Build the `web_search` replacement ToolDefinition over the adapter.
 * `deps` are the consumed transport facts + injected seams; with no injected
 * `resolveHost`, resolution uses the runtime's own resolver and FAILS
 * CLOSED (block) when none exists — never an unvalidated direct issue.
 * Credentials appear nowhere in records, logs, or returned envelopes.
 */
export function createSearchReplacementToolDefinition(
  deps: SearchReplacementDeps = {},
): SearchReplacementDefinition {
  const policy = deps.policy ?? fetchEgressPolicyFromAgentEnv();
  const resolveHost: ResolveHost = deps.resolveHost ?? runtimeResolveHost;
  const fetchImpl = deps.fetchImpl ?? productionFetchTransport();
  const credentialValue = deps.credentialValue ?? credentialValueFromEnv;

  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for up-to-date information. Search requests are served through the AIr " +
      "controlled search transport with per-hop validation (supported configured providers only).",
    approval: "read",
    parameters: SEARCH_REPLACEMENT_PARAMETERS,
    async execute(toolCallId, params, signal, _onUpdate, _ctx) {
      void toolCallId;
      const presence = deps.credentialPresence ?? credentialPresenceFromEnv();

      // D4 fail-closed: no supported credential → the native-shaped honest
      // no-model message and the credential-scope block record (zero
      // transport). The 14b handler normally blocks this earlier at
      // rejected_pending_adapter; the replacement still never issues here.
      const seam = webSearchSeamState(presence);
      if (seam.state === "pending-blocked") {
        const decision = await decideSearchRoute(
          {
            url: PINNED_SEARCH_ENDPOINTS.gemini.baseUrl,
            hopKind: "provider-endpoint",
            hopsFollowed: 0,
          },
          { resolveHost, credentialPresence: presence, posture: policy },
        );
        if (decision.decision === "block") deps.recordSink?.(decision.record);
        return searchNoModelConfiguredEnvelope();
      }

      // Backend selection from credential presence ONLY (D1/D4). A served
      // request belongs to the selected backend; on ANY failure the
      // envelope names that backend — never the other one, never an agent
      // switch (spec-locked no-fallback-on-served-request).
      const backend = selectSearchBackend(presence);
      if (backend === null) return searchNoModelConfiguredEnvelope();

      const parsed = parseSearchToolInput(params);
      if (!parsed.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${parsed.error}` }],
          details: { response: { provider: backend, sources: [] }, error: parsed.error },
        };
      }

      // Explicit-backend guard: this deployment selects from the credential
      // set only; a caller-requested provider outside it is an honest block
      // (no adoption, no transport call). The replacement surfaces no
      // provider-selection parameter (the pinned tool takes none), so the
      // flag can only arrive via injected params — defended, not advertised.
      const requestedProvider = typeof params["provider"] === "string"
        ? params["provider"]
        : undefined;
      if (requestedProvider !== undefined && requestedProvider !== backend) {
        const decision = await decideSearchRoute(
          {
            url: PINNED_SEARCH_ENDPOINTS[backend].baseUrl,
            hopKind: "provider-endpoint",
            hopsFollowed: 0,
            requestedUnsupportedBackend: true,
          },
          { resolveHost, credentialPresence: presence, posture: policy },
        );
        if (decision.decision === "block") deps.recordSink?.(decision.record);
        const message =
          `web_search: provider "${requestedProvider}" is outside the supported configured set ` +
          `(selection is ${
            SEARCH_BACKEND_LABELS[backend]
          } via the row-7 credential set; no unrelated vendor secret exists here)`;
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { response: { provider: backend, sources: [] }, error: message },
        };
      }

      // Request construction (credential header at issue ONLY), then ONE
      // controlled attempt per decision through the row-17 transport with
      // manual per-hop redirect revalidation and enrichment revalidation.
      const credential = credentialValue(backend);
      const request = backend === "gemini"
        ? buildGeminiSearchRequest(parsed.query, credential)
        : buildOpenRouterSearchRequest(parsed.query, credential);
      const result = await runSearchRoute(request, {
        resolveHost,
        credentialPresence: presence,
        posture: policy,
        fetchImpl,
        credential,
        ...(deps.recordSink ? { recordSink: deps.recordSink } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) {
        if (result.failure.kind === "blocked") {
          const record = result.failure.record;
          const message = "host" in record
            ? `web_search blocked at hop ${record.hopIndex} (${record.reason})`
            : `web_search blocked (${record.reason})`;
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            details: { response: { provider: backend, sources: [] }, error: message },
          };
        }
        // Honest provider failure in the native message shape (W8). The
        // backend that owned the request is named; the other backend is
        // NEVER retried or switched to.
        return searchFailureEnvelope(backend, result.failure.error);
      }
      return searchSuccessEnvelope(result.response, result.notes);
    },
  };
}

// ---------------------------------------------------------------------------
// Load-time attach (restricted-session-only, mirrors the read sibling)
// ---------------------------------------------------------------------------

/** Registration outcome record (both branches). */
export interface SearchReplacementRegistrationResult {
  readonly registered: boolean;
  readonly mode: EnforcementLaunchMode;
  readonly definition?: SearchReplacementDefinition;
}

/**
 * The restricted-process registration branch: the YOLO/unidentified branch
 * registers NOTHING (14b posture — structural exemption at the site; the
 * native search tool stays native there with no adapter clamp, D6).
 */
export function registerSearchReplacement(
  mode: EnforcementLaunchMode | undefined,
  deps: SearchReplacementDeps = {},
): SearchReplacementRegistrationResult {
  if (mode !== "restricted") {
    return { registered: false, mode: mode ?? "native-yolo" };
  }
  return {
    registered: true,
    mode: "restricted",
    definition: createSearchReplacementToolDefinition(deps),
  };
}

/** Load-time attach options (injection seam for verification). */
export interface SearchReplacementLoadOptions extends SearchReplacementDeps {
  readonly observedCwd?: string;
}

let loadTimeSearchReplacementRegistration: SearchReplacementRegistrationResult = {
  registered: false,
  mode: "native-yolo",
};

/**
 * The synchronous load-time attach: identity branch → definition build.
 * Registration into the pinned `registerTool` surface happens through the
 * factory's synchronous attachment point; native invocation of the
 * replacement remains candidate-to-verify (design §15).
 */
export function attachSearchReplacementAtLoad(
  options: SearchReplacementLoadOptions = {},
): SearchReplacementRegistrationResult {
  const mode = observeLaunchMode(options.observedCwd ?? "");
  loadTimeSearchReplacementRegistration = registerSearchReplacement(mode, options);
  return Object.freeze({ ...loadTimeSearchReplacementRegistration });
}

/** The current load-time registration record (both branches, frozen copy). */
export function getLoadTimeSearchReplacementRegistration(): SearchReplacementRegistrationResult {
  return Object.freeze({ ...loadTimeSearchReplacementRegistration });
}

/**
 * The factory-side synchronous attachment point: the pinned host hands its
 * `registerTool` surface here (last-extension-wins, S8) and the restricted
 * definition is registered. Carries no readiness assertion and makes no
 * claim that the binary will ever call the tool.
 */
export function registerLoadTimeSearchReplacement(registrar: SearchToolRegistrar): boolean {
  const definition = loadTimeSearchReplacementRegistration.definition;
  if (!definition) return false;
  registrar.registerTool(definition);
  return true;
}
