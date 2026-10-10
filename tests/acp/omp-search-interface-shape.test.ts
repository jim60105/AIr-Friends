/**
 * Mock-only interface-shape + route-table tests for the web-search transport
 * adapter (row 20, `adapt-omp-web-search`, tasks 5.2).
 *
 * Mocked provider responses/transport + mocked DNS; zero network, zero
 * paid/live search. Asserted field-by-field against the pinned observable
 * shapes (W4/W5/W7/W8): envelope layout, honest error mapping, the
 * empty-vs-error distinction, no-fabrication / no-backend-switch /
 * no-agent-switch, credential-free records, and the route-table/seam suite
 * (frozen tiering, marker ≠ allow, credential-absent keeps the seam
 * pending, 14a additive delta, URL-read rows byte-identical, cross-table
 * agreement). Route rows carry POSITIVE replacement-mechanism fixtures
 * explicitly labeled synthetic under the P0 fixture rules — they certify
 * adapter decisions only and can never clear the P0 bypass record (W6/W7) or
 * prove the native binary invokes the replacement (design §15, user-owned).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { type FetchEgressPolicy, type FetchTransportFn } from "@acp/omp/fetch-transport.ts";
import { FETCH_COMPLETING_ADAPTER_MARKER, FETCH_ROUTE_TABLE } from "@acp/omp/fetch-routes.ts";
import {
  buildGeminiSearchRequest,
  buildOpenRouterSearchRequest,
  type BuiltSearchRequest,
  formatSearchAge,
  formatSearchCount,
  formatSearchForLLM,
  formatSearchTruncate,
  hasRenderableSearchContent,
  parseSearchToolInput,
  type SearchCredentialPresence,
  type SearchDecisionRecord,
  searchFailureEnvelope,
  type SearchResponse,
  searchNoModelConfiguredEnvelope,
  searchNoSourcesFailure,
  type SearchRouteResult,
  type SearchToolEnvelope,
} from "@acp/omp/search-transport.ts";
import { runSearchRoute } from "@acp/omp/search-transport.ts";
import {
  isSearchRouteCompleted,
  SEARCH_COMPLETING_ADAPTER_MARKER,
  SEARCH_ROUTE_CITATIONS,
  SEARCH_ROUTE_TABLE,
  webSearchSeamState,
} from "@acp/omp/search-routes.ts";
import { decideRestrictedTool, RESTRICTED_TOOL_INVENTORY_TABLE } from "@acp/omp/tool-inventory.ts";
import {
  composeRestrictedToolCall,
  type ToolCallObservation,
} from "@acp/omp/tool-enforcement-wiring.ts";
import { evaluateApprovalRecordAuthority } from "@acp/omp/record-evaluator.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import {
  createSearchReplacementToolDefinition,
  registerSearchReplacement,
} from "@acp/omp/extension/search-replacement.ts";
import {
  SEARCH_COMPLETING_ADAPTER_MARKER as MARKER_VIA_BARREL,
  SEARCH_ROUTE_TABLE as TABLE_VIA_BARREL,
} from "@acp/omp/extension/_daemon/mod.ts";

globalThis.fetch = (() => {
  throw new Error("network contact forbidden in mock-only suites");
}) as typeof fetch;

const UNRESTRICTED: FetchEgressPolicy = { posture: "unrestricted" };
const ENFORCING: FetchEgressPolicy = {
  posture: "enforcing",
  proxyEndpoint: "http://127.0.0.1:9099",
};
const GEMINI: SearchCredentialPresence = { geminiKey: true, openrouterKey: false };
const BOTH: SearchCredentialPresence = { geminiKey: true, openrouterKey: true };
const NEITHER: SearchCredentialPresence = { geminiKey: false, openrouterKey: false };

// 14a/14b fixture shapes reused verbatim from the row-14 suites.
const ownedRecord = {
  origin: "owned-extension",
  modulePath: "/opt/air/src/acp/omp/extension/index.ts",
  baseRoot: "/opt/air",
  canonicalTarget: {
    acpSessionId: "s1",
    sessionContextGeneration: "g1",
    roles: ["trusted-skills"],
    rootIdentities: [{
      role: "trusted-skills",
      configuredPath: "/opt/air/src/acp/omp/extension",
      canonicalPath: "/opt/air/src/acp/omp/extension",
      readOnly: true,
    }],
    normalizedInput: "/opt/air/src/acp/omp/extension/index.ts",
    canonicalTarget: "/opt/air/src/acp/omp/extension/index.ts",
    rootRelativePath: "index.ts",
    targetType: "file",
    observedSymlinks: [],
  },
} as const satisfies ProvenanceRecord;
const ownedObserved: ProvenanceRecord = { ...ownedRecord, observedResourceGeneration: "gen-0" };
const owned: ProvenanceRecord = ownedRecord;

const NO_RECORDS = evaluateApprovalRecordAuthority(
  { lowerLayer: { approval: {} } },
  "restricted",
  { read: "allow" },
);

function obs(
  toolName: string,
  inputShape: ToolCallObservation["decodedInputShape"],
): ToolCallObservation {
  return {
    toolKey: toolName,
    toolName,
    decodedInputShape: inputShape,
    registryObservation: {
      recordedOrigin: ownedObserved,
      registryEpoch: 7,
      resourceGeneration: "gen-0",
    },
    recordEvaluation: NO_RECORDS,
  };
}

/** Mocked DNS: hostname → answers; unknown hosts resolve to TEST-NET-3. */
function mockDns(table: Record<string, string[]> = {}) {
  return (host: string): Promise<string[]> => {
    if (host in table) return Promise.resolve(table[host]);
    if (/^\d+/.test(host) || host.includes(":")) return Promise.resolve([host]);
    return Promise.resolve(["203.0.113.5"]);
  };
}

interface Issued {
  url: string;
  init?: RequestInit;
}

function transport(responder: (url: string, seen: number) => Response): {
  fetchImpl: FetchTransportFn;
  issued: Issued[];
} {
  const issued: Issued[] = [];
  return {
    issued,
    fetchImpl: (url, init) => {
      issued.push({ url, init });
      return Promise.resolve(responder(url, issued.length - 1));
    },
  };
}

function geminiBody(answer = "Grounded answer.", uri = "https://one.example/a", title = "One"): string {
  return `data: ${
    JSON.stringify({
      candidates: [{
        content: { parts: [{ text: answer }] },
        groundingMetadata: {
          groundingChunks: [{ web: { uri, title } }],
          groundingSupports: [{ segment: { text: "support text" }, groundingChunkIndices: [0] }],
          webSearchQueries: ["grounded query"],
        },
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      modelVersion: "gemini-test-1",
    })
  }\n\n`;
}

function openRouterBody(answer = "Grounded answer.", url = "https://one.example/a"): string {
  return JSON.stringify({
    id: "gen-1",
    model: "routed-model-1",
    choices: [{
      message: {
        content: answer,
        annotations: [{ type: "url_citation", url_citation: { url, title: "One", content: "cited text" } }],
      },
    }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });
}

async function run(
  request: BuiltSearchRequest,
  presence: SearchCredentialPresence,
  fetchImpl: FetchTransportFn,
  posture: FetchEgressPolicy = UNRESTRICTED,
  records: SearchDecisionRecord[] = [],
): Promise<SearchRouteResult> {
  return await runSearchRoute(request, {
    resolveHost: mockDns(),
    credentialPresence: presence,
    posture,
    fetchImpl,
    credential: "SECRET-CRED-1234",
    recordSink: (record) => records.push(record),
  });
}

// ---------------------------------------------------------------------------
// Pinned format-interface mirrors (W8).
// ---------------------------------------------------------------------------

Deno.test("Format mirrors: truncate(240)/formatCount/formatAge pinned shapes", () => {
  assertEquals(formatSearchTruncate("x".repeat(300), 240), "x".repeat(239) + "…");
  assertEquals(formatSearchTruncate("short", 240), "short");
  assertEquals(formatSearchCount("source", 1), "1 source");
  assertEquals(formatSearchCount("source", 3), "3 sources");
  assertEquals(formatSearchCount("box", 2), "2 boxes");
  assertEquals(formatSearchCount("story", 2), "2 stories");
  assertEquals(formatSearchAge(0), "");
  assertEquals(formatSearchAge(30), "just now");
  assertEquals(formatSearchAge(90), "1m ago");
  assertEquals(formatSearchAge(3_600), "1h ago");
  assertEquals(formatSearchAge(90_000), "1d ago");
  assertEquals(formatSearchAge(8 * 86_400), "1w ago");
  assertEquals(formatSearchAge(65 * 86_400), "2mo ago");
});

Deno.test("Layout: formatForLLM pinned layout (answer, ## Sources count, [i] title (age)/url/snippet(240), Citations, queries)", () => {
  const response: SearchResponse = {
    provider: "gemini",
    answer: "Grounded answer.",
    sources: [{ title: "One", url: "https://one.example/a", snippet: "s".repeat(300), ageSeconds: 90_000 }],
    citations: [{ url: "https://one.example/a", title: "One", citedText: "support text" }],
    searchQueries: ["grounded query"],
  };
  const text = formatSearchForLLM(response, []);
  assertEquals(
    text,
    "Grounded answer.\n" +
      "\n## Sources\n1 source\n" +
      "[1] One (1d ago)\n    https://one.example/a\n    " + "s".repeat(239) + "…\n" +
      "\n## Citations\n1 citation\n[1] One\n    https://one.example/a\n    support text\n" +
      "Search queries: 1\n- grounded query",
  );
  assertEquals(
    formatSearchForLLM({ provider: "gemini", answer: "note answer", sources: [] }, ["provider hint"]),
    "Note: provider hint\nnote answer",
  );
  assertEquals(hasRenderableSearchContent({ provider: "gemini", answer: " ", sources: [] }), false);
  assertEquals(
    hasRenderableSearchContent({
      provider: "gemini",
      answer: "",
      sources: [],
      citations: [{ url: "u", title: "t" }],
    }),
    true,
  );
});

Deno.test("Query interface: pinned field names pass through; bounds clamp model-controlled input", () => {
  const parsed = parseSearchToolInput({
    query: "deno runtime",
    recency: "week",
    limit: 5,
    max_tokens: 1024,
    temperature: 0.2,
    num_search_results: 999,
  });
  assert(parsed.ok);
  assertEquals(parsed.query.query, "deno runtime");
  assertEquals(parsed.query.recency, "week");
  assertEquals(parsed.query.limit, 5);
  assertEquals(parsed.query.max_tokens, 1024);
  assertEquals(parsed.query.temperature, 0.2);
  assertEquals(parsed.query.num_search_results, 20, "clamped to the adapter bound");
  assert(!parseSearchToolInput({ query: "" }).ok);
  assert(!parseSearchToolInput({ query: 42 as unknown as string }).ok);
  assert(!parseSearchToolInput({ query: "q", recency: "hour" }).ok);
  assert(!parseSearchToolInput({ query: "q", limit: Number.NaN }).ok);
  assert(!parseSearchToolInput({ query: "x".repeat(5_000) }).ok);
});

Deno.test("Request construction mirrors the pinned observable request shape (W4/W5)", () => {
  const gemini = buildGeminiSearchRequest({ query: "q", max_tokens: 16, temperature: 0.1 }, "KEY");
  assertEquals(
    gemini.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
  );
  assertEquals(gemini.init.headers["x-goog-api-key"], "KEY");
  const geminiBodyJson = JSON.parse(gemini.init.body) as Record<string, unknown>;
  assertEquals(geminiBodyJson.tools, [{ googleSearch: {} }]);
  assertEquals(geminiBodyJson.generationConfig, { maxOutputTokens: 16, temperature: 0.1 });

  const or = buildOpenRouterSearchRequest({ query: "q" }, "KEY");
  assertEquals(or.url, "https://openrouter.ai/api/v1/chat/completions");
  assertEquals(or.init.headers.authorization, "Bearer KEY");
  const orBody = JSON.parse(or.init.body) as Record<string, unknown>;
  assertEquals(orBody.plugins, [{ id: "web", max_results: 5 }]);
  assertEquals(orBody.messages, [{ role: "user", content: "q" }]);
});

// ---------------------------------------------------------------------------
// Envelope + honest-branch shapes (W8), field-by-field.
// ---------------------------------------------------------------------------

Deno.test("Success envelope: pinned { content:[{type:text}], details.response } shape (Gemini SSE parse)", async () => {
  const t = transport(() => new Response(geminiBody(), { status: 200 }));
  const result = await run(buildGeminiSearchRequest({ query: "q" }, "SECRET-CRED-1234"), GEMINI, t.fetchImpl);
  assert(result.ok);
  assertEquals(result.response.provider, "gemini");
  assertEquals(result.response.answer, "Grounded answer.");
  assertEquals(result.response.sources, [{ title: "One", url: "https://one.example/a" }]);
  assertEquals(result.response.citations, [{ url: "https://one.example/a", title: "One", citedText: "support text" }]);
  assertEquals(result.response.searchQueries, ["grounded query"]);
  assertEquals(result.response.usage, { inputTokens: 5, outputTokens: 7, totalTokens: 12 });
  assertEquals(result.response.model, "gemini-test-1");
});

Deno.test("Success envelope: OpenRouter chat-completion parse maps citations to sources", async () => {
  const t = transport(() => new Response(openRouterBody(), { status: 200 }));
  const result = await run(buildOpenRouterSearchRequest({ query: "q" }, "SECRET-CRED-1234"), BOTH, t.fetchImpl);
  assert(result.ok);
  assertEquals(result.response.provider, "openrouter");
  assertEquals(result.response.sources, [{ title: "One", url: "https://one.example/a", snippet: "cited text" }]);
  assertEquals(result.response.usage, { inputTokens: 3, outputTokens: 4, totalTokens: 7 });
});

Deno.test("Empty-vs-error: zero-credential is the no-configured-model branch, provider failures are errors", () => {
  const empty = searchNoModelConfiguredEnvelope();
  assertEquals(empty.content, [{ type: "text", text: "Error: No web search model configured." }]);
  assertEquals(empty.details, { response: { provider: "none", sources: [] }, error: "No web search model configured." });
  // Distinguishable from an adapter completion: no adapterCompleted, provider
  // "none", and the message the pinned zero-available branch emits.
  assertEquals("adapterCompleted" in empty.details, false);
});

Deno.test("Honest failures: 401 auth / 429 rate / malformed JSON / zero-sources / transport throw", async () => {
  const cases: Array<{
    label: string;
    request: BuiltSearchRequest;
    presence: SearchCredentialPresence;
    body: string;
    status: number;
    expectText: string;
  }> = [
    {
      label: "gemini 401",
      request: buildGeminiSearchRequest({ query: "q" }, "SECRET-CRED-1234"),
      presence: GEMINI,
      body: "invalid audience",
      status: 401,
      expectText: "Error: Gemini authorization failed (401). Check API key or base URL.",
    },
    {
      label: "gemini 429",
      request: buildGeminiSearchRequest({ query: "q" }, "SECRET-CRED-1234"),
      presence: GEMINI,
      body: "slow down",
      status: 429,
      expectText: "Error: Gemini Developer API error (429): slow down",
    },
    {
      label: "openrouter malformed JSON",
      request: buildOpenRouterSearchRequest({ query: "q" }, "SECRET-CRED-1234"),
      presence: BOTH,
      body: "<html>not json</html>",
      status: 200,
      expectText: "Error: OpenRouter returned an invalid response:",
    },
  ];
  for (const c of cases) {
    const t = transport(() => new Response(c.body, { status: c.status }));
    const result = await run(c.request, c.presence, t.fetchImpl);
    assertEquals(result.ok, false, c.label);
    if (!result.ok && result.failure.kind === "provider") {
      const envelope = searchFailureEnvelope(c.request.backend, result.failure.error);
      assertEquals(envelope.content[0]?.text.startsWith(c.expectText), true, c.label);
      assertEquals(
        envelope.details.error?.startsWith(c.expectText.replace(/^Error: /, "")),
        true,
        c.label,
      );
      assertEquals(envelope.details.response.provider, c.request.backend, c.label);
    } else {
      throw new Error(`expected provider failure for ${c.label}`);
    }
  }
  // Zero-sources-with-renderable-answer is the honest no-sources refusal
  // (204-style), never an answer-shaped fabrication.
  const answerOnly = `data: ${
    JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer with no sources" }] } }] })
  }\n\n`;
  const t2 = transport(() => new Response(answerOnly, { status: 200 }));
  const r2 = await run(buildGeminiSearchRequest({ query: "q" }, "k"), GEMINI, t2.fetchImpl);
  assertEquals(r2.ok, false);
  if (!r2.ok && r2.failure.kind === "provider") {
    assert((r2.failure.error as Error).message.includes("returned no sources"), r2.failure.kind);
  }
  // searchNoSourcesFailure: the dedicated zero-sources failure (204 branch,
  // W8) is provider-tagged and distinct from the credential-absent envelope.
  const noSources = searchNoSourcesFailure("gemini");
  assertEquals(noSources.provider, "gemini");
  assert(noSources.message.includes("returned no sources"));
  // Transport throw: honest error, single attempt.
  const throwing: FetchTransportFn = () => Promise.reject(new Error("proxy refused"));
  const r3 = await run(buildOpenRouterSearchRequest({ query: "q" }, "k"), BOTH, throwing);
  assertEquals(r3.ok, false);
  if (!r3.ok && r3.failure.kind === "provider") {
    assertEquals((r3.failure.error as Error).message, "proxy refused");
  }
});

Deno.test("No backend switch on failure: a Gemini 401 never touches the OpenRouter endpoint", async () => {
  const t = transport(() => new Response("unauthorized", { status: 401 }));
  const result = await run(buildGeminiSearchRequest({ query: "q" }, "k"), BOTH, t.fetchImpl);
  assertEquals(result.ok, false);
  assertEquals(t.issued.length, 1, "exactly one issued request — no fallback attempt");
  assertEquals(t.issued[0]?.url.includes("openrouter.ai"), false);
  assertEquals(t.issued[0]?.url.includes("generativelanguage"), true);
});

Deno.test("Records/log/envelope scan: credentials, headers, userinfo, query strings, payload absent", async () => {
  const records: SearchDecisionRecord[] = [];
  const t = transport(() => new Response("bad key?token=abc", { status: 401 }));
  const result = await run(
    buildGeminiSearchRequest({ query: "q" }, "SECRET-CRED-1234"),
    GEMINI,
    t.fetchImpl,
    ENFORCING,
    records,
  );
  assertEquals(result.ok, false);
  if (!result.ok && result.failure.kind === "provider") {
    const envelope = JSON.stringify(searchFailureEnvelope("gemini", result.failure.error));
    const recordDump = JSON.stringify(records);
    for (const forbidden of ["SECRET-CRED-1234", "x-goog-api-key", "?token=", "authorization", "contents"]) {
      assertEquals(recordDump.includes(forbidden), false, `record:${forbidden}`);
    }
    // The envelope may carry the pinned honest failure TEXT (e.g. the 401
    // "authorization failed" line) but never credential material, header
    // names, raw query strings, or request payload fields.
    for (const forbidden of ["SECRET-CRED-1234", "x-goog-api-key", "?token=", "Bearer ", "contents"]) {
      assertEquals(envelope.includes(forbidden), false, `envelope:${forbidden}`);
    }
    // The error body itself never carries the credential or a raw URL query.
    const message = (result.failure.error as Error).message;
    assertEquals(message.includes("SECRET-CRED-1234"), false);
    assertEquals(message.includes("?token=abc"), false);
  }
});

// ---------------------------------------------------------------------------
// Route table + seam-data suite (tasks 5.2, second half).
// ---------------------------------------------------------------------------

Deno.test("Route table: statuses use the frozen tiers; citations carry the pinned version+commit", () => {
  for (const row of SEARCH_ROUTE_TABLE) {
    assertEquals(
      ["completed-by-adapter", "candidate-to-verify", "no-supported-mechanism", "blocked-pending-adapter"]
        .includes(row.status),
      true,
      `${row.routeId}:${row.status}`,
    );
    assertEquals(row.mechanism.length > 0, true, row.routeId);
    assertEquals(row.citations.length > 0, true, row.routeId);
    for (const citation of row.citations) {
      assertEquals(citation.ompVersion, "v18.6.1");
      assertEquals(citation.ompCommit, "2a2c6dcbbb558c0f8145f67f28b3370984f2bf60");
      assertEquals(citation.location.length > 0, true);
    }
    if (row.status !== "completed-by-adapter") {
      assertEquals(row.userDecisionRequired, true, row.routeId);
    }
  }
  assertEquals(SEARCH_ROUTE_TABLE.some((row) => (row.status as string) === "supported"), false);
  assertEquals(SEARCH_ROUTE_CITATIONS.map((c) => c.id).join(","), "W1,W2,W3,W4,W5,W6,W7,W8,W9,W10");
  // The recorded citation-location correction (task 1.2) is present, not a
  // silent reinterpretation.
  const w5 = SEARCH_ROUTE_CITATIONS.find((c) => c.id === "W5");
  assertExists(w5);
  assert(w5.fact.includes("CORRECTION"));
});

Deno.test("Route table: frozen tiering — grounded pair completed; scraping candidate; unrelated-secret no-mechanism; native path blocked", () => {
  assertEquals(isSearchRouteCompleted("web_search.grounding.gemini"), true);
  assertEquals(isSearchRouteCompleted("web_search.grounding.openrouter"), true);
  assertEquals(isSearchRouteCompleted("web_search.grounding.grounding-redirect-enrichment"), true);
  const scraping = SEARCH_ROUTE_TABLE.find((r) => r.routeId === "web_search.scraping-engines");
  assertExists(scraping);
  assertEquals(scraping.status, "candidate-to-verify");
  const secret = SEARCH_ROUTE_TABLE.find((r) => r.routeId === "web_search.unsupported-credential-set.backends");
  assertExists(secret);
  assertEquals(secret.status, "no-supported-mechanism");
  const nativePath = SEARCH_ROUTE_TABLE.find((r) => r.routeId === "web_search.native.global-fetch-provider-path");
  assertExists(nativePath);
  assertEquals(nativePath.status, "blocked-pending-adapter");
  assertEquals(isSearchRouteCompleted("web_search.native.global-fetch-provider-path"), false);
});

Deno.test("Marker ≠ allow: the additive 14a delta keeps the pending-adapter outcome at 14a AND 14b", () => {
  const webSearch = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === "web-search");
  assertExists(webSearch);
  assertEquals(webSearch.kind, "allow-gated-pending-adapter");
  assert(webSearch.notes.includes(SEARCH_COMPLETING_ADAPTER_MARKER));
  assert(webSearch.notes.includes("adapt-omp-web-search"));
  assert(webSearch.notes.includes("SEARCH_ROUTE_TABLE"));
  assert(webSearch.notes.includes("NOT a plain allow"));
  // The additive prefix sentence is untouched (row-18 wording preserved).
  assert(
    webSearch.notes.startsWith(
      "Live search preserved through supported configured provider credentials and controlled transport (row 18). ",
    ),
  );
  // 14a still yields the pending-adapter outcome (distinct from allow).
  const decision = decideRestrictedTool({ toolName: "websearch", provenance: owned, inputShape: "query" });
  assertEquals(decision.outcome, "allow-gated-pending-adapter");
  // 14b still blocks at the composition seam with rejected_pending_adapter.
  const composed = composeRestrictedToolCall(obs("websearch", "query"));
  assert("block" in composed && composed.block, "14b still blocks the pending-adapter outcome");
  if ("block" in composed && composed.block) {
    assertEquals(composed.error.code, "rejected_pending_adapter");
    assertEquals(composed.error.tableRowId, "web-search");
  }
});

Deno.test("Credential-absent keeps the seam pending; supported presence gates the marker active", () => {
  assertEquals(webSearchSeamState(NEITHER), { state: "pending-blocked", reason: "no-supported-credential" });
  assertEquals(webSearchSeamState({ geminiKey: false, openrouterKey: true }), {
    state: "adapter-completing",
    backend: "openrouter",
  });
  assertEquals(webSearchSeamState({ geminiKey: true, openrouterKey: false }), {
    state: "adapter-completing",
    backend: "gemini",
  });
});

Deno.test("URL-read + code-search rows byte-identical: row-17 markers kept, code-search untouched", () => {
  const urlRead = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === "url-read");
  const webFetch = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === "web-fetch");
  const codeSearch = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === "code-search");
  assertExists(urlRead);
  assertExists(webFetch);
  assertExists(codeSearch);
  assertEquals(urlRead.notes.includes(FETCH_COMPLETING_ADAPTER_MARKER), true);
  assertEquals(webFetch.notes.includes(FETCH_COMPLETING_ADAPTER_MARKER), true);
  // Row 20 touched neither row's text (the search marker is web-search-only).
  assertEquals(urlRead.notes.includes("adapt-omp-web-search"), false);
  assertEquals(webFetch.notes.includes("adapt-omp-web-search"), false);
  // The code-search row is byte-identical to the pending row 19 shipped.
  assertEquals(
    codeSearch.notes,
    "Public code/documentation search preserved (row 19) without adding LSP or arbitrary " +
      "execution. Local text search stays on the read-class row.",
  );
  assertEquals(codeSearch.kind, "allow-gated-pending-adapter");
});

Deno.test("Cross-table agreement: fetch-routes search-provider row never cited pending against a completed contract here", () => {
  // Row 17's registry stays untouched: its search-provider row keeps the
  // outside-the-replacement pending verdict and points at THIS row.
  const fetchSearchRow = FETCH_ROUTE_TABLE.find((r) => r.routeId === "search-provider.subrequests");
  assertExists(fetchSearchRow);
  assertEquals(fetchSearchRow.status, "blocked-pending-adapter");
  assertEquals(fetchSearchRow.userDecisionRequired, true);
  assert(fetchSearchRow.notes.includes("row 20 (adapt-omp-web-search)"));
  // Agreement: both tables keep the SAME outside-the-replacement verdict for
  // native global-fetch search traffic (no table claims the other's route
  // completed); the completed rows here are mechanism-scoped to the web_search
  // name replacement only.
  const nativeRow = SEARCH_ROUTE_TABLE.find((r) => r.routeId === "web_search.native.global-fetch-provider-path");
  assertExists(nativeRow);
  assertEquals(nativeRow.status, "blocked-pending-adapter");
  for (const row of SEARCH_ROUTE_TABLE.filter((r) => r.status === "completed-by-adapter")) {
    assert(row.mechanism.includes("registerTool name-replacement"), row.routeId);
    // No completed route id collides with a fetch-routes routeId.
    assertEquals(FETCH_ROUTE_TABLE.some((f) => f.routeId === row.routeId), false, row.routeId);
  }
  // The fetch table's completed URL-read set is untouched (row 17 rows only).
  assertEquals(
    FETCH_ROUTE_TABLE.filter((r) => r.status === "completed-by-adapter").map((r) => r.routeId).join("|"),
    "read.url-branch.text|read.url-branch.binary|read.url-branch.secondary-hops|read.url-branch.materialization-consumers",
  );
});

Deno.test("Positive replacement-mechanism fixture (SYNTHETIC, P0 fixture rule): restricted definition serves the adapter", async () => {
  // SYNTHETIC fixture per the P0 fixture rules: a definition built directly
  // over injected seams certifies the adapter's decision path ONLY. It is not
  // native behavior and can never prove the compiled binary invokes the
  // replacement (design §15 user checklist, unverified).
  const records: SearchDecisionRecord[] = [];
  const t = transport(() => new Response(geminiBody(), { status: 200 }));
  const definition = createSearchReplacementToolDefinition({
    policy: ENFORCING,
    resolveHost: mockDns(),
    fetchImpl: t.fetchImpl,
    recordSink: (record) => records.push(record),
    credentialPresence: GEMINI,
    credentialValue: () => "SECRET-REPL-9",
  });
  assertEquals(definition.name, "web_search");
  assertEquals(definition.approval, "read");
  const result = await definition.execute("tc-1", { query: "deno runtime" }, undefined, undefined, {});
  const envelope = result as SearchToolEnvelope;
  assertEquals(envelope.details.response.provider, "gemini");
  assertEquals(envelope.details.adapterCompleted, true);
  assert(envelope.content[0]?.text.includes("Grounded answer."));
  assertEquals(t.issued.length, 1);
  assertEquals(t.issued[0]?.init?.redirect as RequestRedirect, "manual");
  assertEquals((t.issued[0]?.init as RequestInit & { proxy?: string }).proxy, "http://127.0.0.1:9099");
  // Credential-free record posture (records never carry the value).
  assertEquals(JSON.stringify(records).includes("SECRET-REPL-9"), false);
});

Deno.test("Replacement honesty fixtures (SYNTHETIC): credential-absent fail-closed; no provider adoption", async () => {
  const t = transport(() => new Response("never", { status: 200 }));
  const absent = createSearchReplacementToolDefinition({
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: t.fetchImpl,
    credentialPresence: NEITHER,
    credentialValue: () => "",
  });
  const absentResult = await absent.execute("tc-1", { query: "q" }, undefined, undefined, {});
  assertEquals(t.issued.length, 0, "zero transport on the credential-absent path");
  const absentEnvelope = absentResult as SearchToolEnvelope;
  assertEquals(absentEnvelope.content[0]?.text, "Error: No web search model configured.");

  const t2 = transport(() => new Response("never", { status: 200 }));
  const selected = createSearchReplacementToolDefinition({
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: t2.fetchImpl,
    credentialPresence: GEMINI,
    credentialValue: () => "k",
  });
  const switched = await selected.execute("tc-1", { query: "q", provider: "openai" }, undefined, undefined, {});
  assertEquals(t2.issued.length, 0, "an out-of-set provider request never reaches transport");
  const switchedEnvelope = switched as SearchToolEnvelope;
  assert(switchedEnvelope.content[0]?.text.includes("outside the supported configured set"));
});

Deno.test("Restricted-sessions-only registration (14b posture): YOLO/unidentified register nothing", () => {
  assertEquals(registerSearchReplacement(undefined).registered, false);
  assertEquals(registerSearchReplacement("native-yolo").registered, false);
  const restricted = registerSearchReplacement("restricted", {
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: () => Promise.resolve(new Response("")),
    credentialPresence: GEMINI,
    credentialValue: () => "k",
  });
  assertEquals(restricted.registered, true);
  assertEquals(restricted.definition?.name, "web_search");
});

Deno.test("Barrel closure: search surfaces reachable through the declared list only", () => {
  assertEquals(MARKER_VIA_BARREL, SEARCH_COMPLETING_ADAPTER_MARKER);
  assertEquals(TABLE_VIA_BARREL.length, SEARCH_ROUTE_TABLE.length);
});
