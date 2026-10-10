/**
 * Mock-only interface-shape + route-table tests for the public-code-search
 * transport adapter (row 21, `adapt-omp-public-code-search`, tasks 5.2).
 *
 * Mocked search responses/transport + mocked DNS; zero network, zero live
 * GitHub traffic. Asserted field-by-field against the pinned observable
 * bounds (C9: limit 10/50, preview 50, nameWithOwner/path attribution +
 * text-match excerpts): excerpt/attribution/limit/empty-vs-error shape,
 * honest-failure no-fabrication and no-backend-switch/no-agent-switch,
 * credential-free records, and the route-table/seam suite (frozen tiering
 * with citations, the marker gate never fires in the current state, marker
 * ≠ allow — including under an ACTIVATED synthetic credential, because the
 * current 14b composition honors no completed-route seam state (recorded
 * batch ownership gap) — URL-read and web-search rows byte-identical,
 * cross-table agreement across the three tables, predecessor pins green,
 * and no route row/fixture naming a promoted secret). Fixtures are labeled
 * synthetic under the P0 fixture rules — they certify adapter decisions
 * only and can never clear the P0 bypass record, the D4 premise-false
 * finding, or prove the native binary invokes the reserved mechanism
 * (design §15, user-owned).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { type FetchEgressPolicy, type FetchTransportFn } from "@acp/omp/fetch-transport.ts";
import { FETCH_ROUTE_TABLE } from "@acp/omp/fetch-routes.ts";
import { SEARCH_ROUTE_TABLE } from "@acp/omp/search-routes.ts";
import {
  buildCodeSearchRequest,
  classifyCodeSearchHttpError,
  CODE_SEARCH_ENRICHMENT_TIMEOUT_MS,
  CODE_SEARCH_LIMIT_DEFAULT,
  CODE_SEARCH_LIMIT_MAX,
  CODE_SEARCH_PREVIEW_LIMIT,
  type CodeSearchCredentialPresence,
  type CodeSearchDecisionRecord,
  codeSearchFailureEnvelope,
  codeSearchNoCredentialEnvelope,
  CodeSearchProviderFailure,
  type CodeSearchResponse,
  codeSearchSuccessEnvelope,
  formatCodeSearchDecisionLog,
  formatCodeSearchForLLM,
  formatCodeSearchProviderFailure,
  MAX_CODE_SEARCH_ENRICHMENT_SUBREQUESTS,
  MAX_CODE_SEARCH_RESULT_CHARS,
  parseCodeSearchInput,
  parseCodeSearchResponse,
  runCodeSearchRoute,
} from "@acp/omp/code-search-transport.ts";
import {
  CODE_SEARCH_COMPLETING_ADAPTER_MARKER,
  CODE_SEARCH_RESERVED_MECHANISM,
  CODE_SEARCH_ROUTE_CITATIONS,
  CODE_SEARCH_ROUTE_TABLE,
  CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME,
  codeSearchSeamState,
  isCodeSearchRouteCompleted,
} from "@acp/omp/code-search-routes.ts";
import { decideRestrictedTool, RESTRICTED_TOOL_INVENTORY_TABLE } from "@acp/omp/tool-inventory.ts";
import {
  composeRestrictedToolCall,
  type ToolCallObservation,
} from "@acp/omp/tool-enforcement-wiring.ts";
import { evaluateApprovalRecordAuthority } from "@acp/omp/record-evaluator.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import { AUDITED_PINNED_LEDGER } from "@acp/omp/compatibility-contracts.ts";
import {
  CODE_SEARCH_COMPLETING_ADAPTER_MARKER as MARKER_VIA_BARREL,
  CODE_SEARCH_ROUTE_TABLE as TABLE_VIA_BARREL,
} from "@acp/omp/extension/_daemon/mod.ts";

// Zero-network guarantee: nothing below reaches a socket.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("network contact forbidden in mock-only suites");
}) as typeof fetch;

const ENFORCING: FetchEgressPolicy = {
  posture: "enforcing",
  proxyEndpoint: "http://127.0.0.1:9099",
};
const UNRESTRICTED: FetchEgressPolicy = { posture: "unrestricted" };

/** SYNTHETIC P0 fixture: dedicated code-search credential PRESENT (injected
 *  presence only — no env name exists; design D2). */
const TOKEN_PRESENT: CodeSearchCredentialPresence = { dedicatedCodeSearchToken: true };
const TOKEN_ABSENT: CodeSearchCredentialPresence = { dedicatedCodeSearchToken: false };

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

function mockDns(table: Record<string, string[]> = {}) {
  return (host: string): Promise<string[]> => {
    if (host in table) return Promise.resolve(table[host]);
    if (/^\d+/.test(host) || host.includes(":")) return Promise.resolve([host]);
    return Promise.resolve(["203.0.113.5"]);
  };
}

interface MockTransport {
  fetchImpl: FetchTransportFn;
  issued: Array<{ url: string; init?: RequestInit }>;
}

function transport(responder: (url: string, seen: number) => Response): MockTransport {
  const issued: Array<{ url: string; init?: RequestInit }> = [];
  return {
    issued,
    fetchImpl: (url, init) => {
      issued.push({ url, init });
      return Promise.resolve(responder(url, issued.length - 1));
    },
  };
}

function githubMatchesPayload(): string {
  return JSON.stringify({
    total_count: 2,
    items: [
      {
        path: "src/acp/omp/fetch-transport.ts",
        repository: { nameWithOwner: "air-friends/air-friends" },
        language: "TypeScript",
        html_url:
          "https://github.com/air-friends/air-friends/blob/master/src/acp/omp/fetch-transport.ts",
        text_matches: [{ fragment: "export async function decideFetchHop(" }],
      },
      {
        path: "README.md",
        repository: { nameWithOwner: "other/repo" },
        text_matches: [{ fragment: "a".repeat(400) }],
      },
    ],
  });
}

const executorDeps = (
  presence: CodeSearchCredentialPresence,
  t: MockTransport,
  posture: FetchEgressPolicy = UNRESTRICTED,
  records?: CodeSearchDecisionRecord[],
) => ({
  resolveHost: mockDns(),
  credentialPresence: presence,
  posture,
  fetchImpl: t.fetchImpl,
  ...(records ? { recordSink: (r: CodeSearchDecisionRecord) => records.push(r) } : {}),
  credential: "ghp_SECRET_MATERIAL_123",
});

// ---------------------------------------------------------------------------
// Input shape (query-parameter pass-through + pinned bounds).
// ---------------------------------------------------------------------------

Deno.test("Query input: pass-through, default limit 10, hard cap at 50 (C9)", () => {
  const ok = parseCodeSearchInput({ query: "decideFetchHop", repo: "a/b", language: "TypeScript" });
  assertEquals(ok.ok, true);
  if (ok.ok) {
    assertEquals(ok.query.query, "decideFetchHop");
    assertEquals(ok.query.repo, "a/b");
    assertEquals(ok.query.language, "TypeScript");
    assertEquals(ok.query.limit, CODE_SEARCH_LIMIT_DEFAULT);
  }
  const capped = parseCodeSearchInput({ query: "x", limit: 9999 });
  assertEquals(capped.ok && capped.query.limit, CODE_SEARCH_LIMIT_MAX);
  const bounded = parseCodeSearchInput({ query: "y".repeat(4097) });
  assertEquals(bounded.ok, false);
  const badLimit = parseCodeSearchInput({ query: "y", limit: Number.NaN });
  assertEquals(badLimit.ok, false);
  // Validation messages never echo the payload.
  if (!bounded.ok) assertEquals(bounded.error.includes("y".repeat(10)), false);
});

Deno.test("Request construction: pinned endpoint, pass-through params, credential header only here", () => {
  const req = buildCodeSearchRequest(
    { query: "func main", repo: "golang/go", language: "Go", limit: 25 },
    "ghp_SECRET_MATERIAL_123",
  );
  const url = new URL(req.url);
  assertEquals(url.origin, "https://api.github.com");
  assertEquals(url.pathname, "/search/code");
  assertEquals(url.searchParams.get("q"), "func main repo:golang/go language:Go");
  assertEquals(url.searchParams.get("per_page"), "25");
  assertEquals(req.init.headers["authorization"], "Bearer ghp_SECRET_MATERIAL_123");
  assertEquals(req.init.headers["accept"], "application/vnd.github.text-match+json");
});

// ---------------------------------------------------------------------------
// Result shape (excerpt/attribution/limits) against the pinned bounds.
// ---------------------------------------------------------------------------

Deno.test("Result mapping: excerpt bounded to 50, nameWithOwner/path/language/source URL", () => {
  const parsed = parseCodeSearchResponse(JSON.parse(githubMatchesPayload()), "decideFetchHop");
  assert(!(parsed instanceof CodeSearchProviderFailure));
  const response = parsed as CodeSearchResponse;
  assertEquals(response.provider, "github-code-search");
  assertEquals(response.query, "decideFetchHop");
  assertEquals(response.items.length, 2);
  const [first, second] = response.items;
  assertEquals(first!.nameWithOwner, "air-friends/air-friends");
  assertEquals(first!.path, "src/acp/omp/fetch-transport.ts");
  assertEquals(first!.language, "TypeScript");
  assertEquals(first!.excerpt, "export async function decideFetchHop(");
  assertEquals(
    first!.sourceUrl,
    "https://github.com/air-friends/air-friends/blob/master/src/acp/omp/fetch-transport.ts",
  );
  // The 400-char excerpt is truncated to the pinned preview bound (C9: 50).
  assertEquals(second!.excerpt.length, CODE_SEARCH_PREVIEW_LIMIT);
  assertEquals(second!.language, undefined);
  // Envelope shape: native-shaped content + details payload (row-18 shape).
  const envelope = codeSearchSuccessEnvelope(response);
  assertEquals(envelope.content.length, 1);
  assertEquals(envelope.content[0]!.type, "text");
  assertEquals(envelope.details.adapterCompleted, true);
  assertEquals(envelope.details.error, undefined);
  assert(
    envelope.content[0]!.text.includes("air-friends/air-friends/src/acp/omp/fetch-transport.ts"),
  );
  assert(envelope.content[0]!.text.includes("(TypeScript)"));
  assert(envelope.content[0]!.text.includes("https://github.com/"));
});

Deno.test("Total result-size bound applies (documented envelope bound)", () => {
  // 450 items x 50-char excerpts would render past the documented total
  // bound (20k); the mapping cuts at the bound and says so honestly.
  const items = Array.from({ length: 450 }, (_, i) => ({
    path: `p/${"x".repeat(60)}${i}.ts`,
    repository: { nameWithOwner: `large/repo${i}` },
    text_matches: [{ fragment: "z".repeat(50) }],
  }));
  const parsed = parseCodeSearchResponse({ items }, "q");
  assert(!(parsed instanceof CodeSearchProviderFailure));
  const response = parsed as CodeSearchResponse;
  let rendered = 0;
  for (const item of response.items) rendered += item.excerpt.length;
  assertEquals(rendered <= MAX_CODE_SEARCH_RESULT_CHARS, true);
  // The item list is cut once the bound is reached; a bound cut is honest.
  assertEquals(response.items.length, 400);
  assertEquals(response.truncated, true);
  assertEquals(formatCodeSearchForLLM(response).includes("(result size bound applied)"), true);
});

Deno.test("Malformed payloads are honest failures, never fabricated items", () => {
  for (const payload of [null, "text", 42, [], {}, { items: "no" }, { items: [7] }]) {
    const parsed = parseCodeSearchResponse(payload, "q");
    assert(parsed instanceof CodeSearchProviderFailure, JSON.stringify(payload));
    assertEquals(parsed.message.includes("invalid response"), true);
  }
  // An item with attribution but no text_matches yields an excerpt-free
  // item (never a fabricated excerpt).
  const parsed = parseCodeSearchResponse(
    { items: [{ path: "a.ts", repository: { nameWithOwner: "o/r" } }] },
    "q",
  );
  assert(!(parsed instanceof CodeSearchProviderFailure));
  assertEquals((parsed as CodeSearchResponse).items[0]!.excerpt, "");
});

// ---------------------------------------------------------------------------
// Empty-vs-error + honest failure mapping (row-18 rules verbatim).
// ---------------------------------------------------------------------------

Deno.test("Zero matches is an honest empty naming the query, distinct from every error", () => {
  const parsed = parseCodeSearchResponse({ total_count: 0, items: [] }, "nonexistent-symbol");
  assert(!(parsed instanceof CodeSearchProviderFailure));
  const response = parsed as CodeSearchResponse;
  assertEquals(response.items.length, 0);
  const envelope = codeSearchSuccessEnvelope(response);
  assert(envelope.content[0]!.text.includes("No code matches found for query: nonexistent-symbol"));
  assertEquals(envelope.details.error, undefined);
  // Every error shape starts `Error:`; the empty does not.
  assertEquals(envelope.content[0]!.text.startsWith("Error:"), false);
});

Deno.test("Provider failures (401/403-rate/429/HTTP/malformed) name the provider, never fabricate", async () => {
  const cases: Array<[number, string, number]> = [
    [401, '{"message":"Bad credentials"}', 401],
    [403, '{"message":"API rate limit exceeded for user ID 1."}', 403],
    [429, '{"message":"secondary rate limit"}', 429],
    [500, '{"message":"server exploded"}', 500],
  ];
  for (const [status, body, expectedStatus] of cases) {
    const t = transport(() => new Response(body, { status }));
    const result = await runCodeSearchRoute(
      buildCodeSearchRequest({ query: "q" }, "ghp_SECRET_MATERIAL_123"),
      executorDeps(TOKEN_PRESENT, t),
    );
    assertEquals(result.ok, false, String(status));
    if (!result.ok && result.failure.kind === "provider") {
      const envelope = codeSearchFailureEnvelope(result.failure.error);
      assert(envelope.content[0]!.text.startsWith("Error:"), String(status));
      assert(/github/i.test(envelope.content[0]!.text), String(status)); // names the provider
      assertEquals(envelope.details.error !== undefined, true);
      assertEquals(envelope.details.response.items.length, 0); // no fabricated content
      assert(result.failure.error instanceof CodeSearchProviderFailure);
      assertEquals(result.failure.error.status, expectedStatus);
    }
  }
  // Malformed success body: honest 502-family failure.
  const malformed = transport(() => new Response("<html>not json</html>", { status: 200 }));
  const malformedResult = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "ghp_SECRET_MATERIAL_123"),
    executorDeps(TOKEN_PRESENT, malformed),
  );
  assertEquals(malformedResult.ok, false);
  if (!malformedResult.ok && malformedResult.failure.kind === "provider") {
    assert(malformedResult.failure.error instanceof CodeSearchProviderFailure);
    assertEquals(malformedResult.failure.error.status, 502);
  }
});

Deno.test("No backend switch / no agent switch: one issued attempt per failure", async () => {
  const t = transport(() => new Response("nope", { status: 401 }));
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "ghp_SECRET_MATERIAL_123"),
    executorDeps(TOKEN_PRESENT, t),
  );
  assertEquals(result.ok, false);
  assertEquals(t.issued.length, 1); // single controlled attempt; no retry, no fallback
});

Deno.test("Failure text scrubs the credential and never echoes query strings", () => {
  const failure = classifyCodeSearchHttpError(
    "github-code-search",
    500,
    `oops https://api.github.com/search/code?q=secret-query-url token=ghp_SECRET_MATERIAL_123`,
    "ghp_SECRET_MATERIAL_123",
  );
  assertEquals(failure.message.includes("ghp_SECRET_MATERIAL_123"), false);
  assertEquals(failure.message.includes("q=secret-query-url"), false);
  assert(failure.message.includes("[redacted]"));
  assert(failure.message.includes("[url-redacted]"));
  assertEquals(formatCodeSearchProviderFailure(failure).includes("ghp_SECRET_MATERIAL_123"), false);
});

// ---------------------------------------------------------------------------
// Credential- and payload-free records (host/hop/decision/reason only).
// ---------------------------------------------------------------------------

Deno.test("Records + rendered log lines carry no credential, header, query, or payload bytes", async () => {
  const records: CodeSearchDecisionRecord[] = [];
  const t = transport(() => new Response(githubMatchesPayload(), { status: 200 }));
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "super-secret-query-term" }, "ghp_SECRET_MATERIAL_123"),
    executorDeps(TOKEN_PRESENT, t, ENFORCING, records),
  );
  assertEquals(result.ok, true);
  const rendered = records.map(formatCodeSearchDecisionLog).join("\n");
  for (
    const forbidden of [
      "ghp_SECRET_MATERIAL_123",
      "super-secret-query-term",
      "decideFetchHop(",
      "authorization",
      "?q=",
    ]
  ) {
    assertEquals(JSON.stringify(records).includes(forbidden), false, forbidden);
    assertEquals(rendered.includes(forbidden), false, forbidden);
  }
  assert(rendered.includes("[air-codesearch-adapter]"));
  assert(rendered.includes("host=api.github.com"));
  // The record shape itself can only carry routing fields.
  for (const record of records) {
    for (const key of Object.keys(record)) {
      assertEquals(
        ["host", "hopIndex", "decision", "reason", "addressClass"].includes(key),
        true,
        key,
      );
    }
  }
});

Deno.test("Credential-absent envelope names the gap and both user decisions", () => {
  const envelope = codeSearchNoCredentialEnvelope();
  assert(envelope.content[0]!.text.startsWith("Error:"));
  assert(envelope.content[0]!.text.includes("read-only code-search credential"));
  assert(envelope.content[0]!.text.includes("accept the gap"));
  assertEquals(envelope.details.response.provider, "none");
});

// ---------------------------------------------------------------------------
// Route-table suite (frozen tiering, citations, reservation).
// ---------------------------------------------------------------------------

Deno.test("Route table: frozen tiering with pinned citations; removal verdict recorded", () => {
  const tiers: Record<string, string> = Object.fromEntries(
    CODE_SEARCH_ROUTE_TABLE.map((r) => [r.routeId, r.status]),
  );
  assertEquals(tiers, {
    "code_search.github-api": "no-supported-mechanism",
    "code_search.native.github-cli-search-code": "no-supported-mechanism",
    "code_search.scraping-handlers": "candidate-to-verify",
    "code_search.url-read-content-path": "completed-by-adapter",
  });
  for (const row of CODE_SEARCH_ROUTE_TABLE) {
    assertEquals(row.citations.length > 0, true, row.routeId);
    for (const c of row.citations) {
      assertEquals(c.ompVersion, "v18.6.1");
      assertEquals(c.ompCommit, "2a2c6dcbbb558c0f8145f67f28b3370984f2bf60");
      assertEquals(c.opencodeTag, "v1.18.21");
      assertEquals(c.opencodeTree, "826d9ad46a22bef0294998e08daa3c4904fea28f");
      assertEquals(c.location.length > 0, true);
    }
    // Every non-completed row carries the user-decision marker.
    if (row.status !== "completed-by-adapter") {
      assertEquals(row.userDecisionRequired, true, row.routeId);
    }
  }
  assertEquals(CODE_SEARCH_ROUTE_CITATIONS.length, 9);
  // Removal verdict + inert permission recorded (C1/C2).
  const removal = CODE_SEARCH_ROUTE_CITATIONS.find((c) => c.id === "C1");
  assertExists(removal);
  assert(removal.fact.includes("2481dde36d9aeb48de9fb21ffd2cfdc1d42804f1"));
  const inert = CODE_SEARCH_ROUTE_CITATIONS.find((c) => c.id === "C2");
  assertExists(inert);
  assert(inert.fact.includes("INERT"));
  // No code-search backend is completed by this change; the reference row
  // belongs to rows 17/18.
  assertEquals(isCodeSearchRouteCompleted("code_search.github-api"), false);
  assertEquals(isCodeSearchRouteCompleted("code_search.url-read-content-path"), false);
  // No row claims `supported`.
  assertEquals(CODE_SEARCH_ROUTE_TABLE.some((r) => (r.status as string) === "supported"), false);
});

Deno.test("Scraping handlers candidate-to-verify but never selected; URL-read reference never claimed", () => {
  const scraping = CODE_SEARCH_ROUTE_TABLE.find((r) =>
    r.routeId === "code_search.scraping-handlers"
  );
  assertExists(scraping);
  assertEquals(scraping.status, "candidate-to-verify");
  assert(scraping.mechanism.includes("NOT selected"));
  assert(
    scraping.notes.includes("URL-read route") || scraping.notes.includes("controlled transport"),
  );
  const reference = CODE_SEARCH_ROUTE_TABLE.find((r) =>
    r.routeId === "code_search.url-read-content-path"
  );
  assertExists(reference);
  assert(reference.mechanism.includes("never claimed by this change"));
});

Deno.test("Reserved mechanism: 6th serial slot, unconsumed; no tool registered in this state", async () => {
  assert(CODE_SEARCH_RESERVED_MECHANISM.startsWith("RESERVED"));
  assert(CODE_SEARCH_RESERVED_MECHANISM.includes("6th serial"));
  const api = CODE_SEARCH_ROUTE_TABLE.find((r) => r.routeId === "code_search.github-api");
  assertExists(api);
  assertEquals(api.mechanism, CODE_SEARCH_RESERVED_MECHANISM);
  // No trusted-extension attachment exists for code search anywhere.
  const dir = new URL("../../src/acp/omp/extension/", import.meta.url);
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  assertEquals(names.some((n) => n.includes("code-search")), false);
  const index = await Deno.readTextFile(new URL("index.ts", dir));
  assertEquals(index.includes("CodeSearch"), false);
  assertEquals(index.includes("code_search"), false);
});

// ---------------------------------------------------------------------------
// Seam marker: gate never fires; marker ≠ allow even with a synthetic
// credential (the 14b composition honors no completed-route seam state yet).
// ---------------------------------------------------------------------------

Deno.test("Marker gate never fires in the current state; predicate exported as data", () => {
  assertEquals(CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME, null);
  assertEquals(codeSearchSeamState(TOKEN_ABSENT), {
    state: "pending-blocked",
    reason: "no-supported-credential",
  });
  // Even the synthetic positive presence stays gated OFF while the approved
  // path registers no credential name (D2: the predicate is data, not env).
  assertEquals(codeSearchSeamState(TOKEN_PRESENT), {
    state: "pending-blocked",
    reason: "no-supported-credential",
  });
});

Deno.test("Marker ≠ allow: 14a stays pending and 14b blocks even under an ACTIVATED synthetic marker", () => {
  const codeSearch = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === "code-search");
  assertExists(codeSearch);
  assertEquals(codeSearch.kind, "allow-gated-pending-adapter");
  assert(codeSearch.notes.includes(CODE_SEARCH_COMPLETING_ADAPTER_MARKER));
  assert(codeSearch.notes.includes("adapt-omp-public-code-search"));
  assert(codeSearch.notes.includes("CODE_SEARCH_ROUTE_TABLE"));
  assert(codeSearch.notes.includes("NOT a plain allow"));
  // 14a's outcome is unchanged by the marker.
  const decision = decideRestrictedTool({
    toolName: "codesearch",
    provenance: owned,
    inputShape: "query",
  });
  assertEquals(decision.outcome, "allow-gated-pending-adapter");
  // 14b blocks the pending outcome (rejected_pending_adapter) — and would do
  // the same even with a supported credential present: the composition does
  // not consult seam state (recorded batch ownership gap; rows 23/24 routing).
  const composed = composeRestrictedToolCall(obs("codesearch", "query"));
  assert("block" in composed && composed.block, "14b still blocks the pending-adapter outcome");
  if ("block" in composed && composed.block) {
    assertEquals(composed.error.code, "rejected_pending_adapter");
    assertEquals(composed.error.tableRowId, "code-search");
  }
});

Deno.test("Predecessor rows byte-identical: url-read/web-fetch/web-search rows never name row 21", () => {
  for (const rowId of ["url-read", "web-fetch", "web-search"]) {
    const row = RESTRICTED_TOOL_INVENTORY_TABLE.find((r) => r.id === rowId);
    assertExists(row, rowId);
    assertEquals(row.notes.includes("adapt-omp-public-code-search"), false, rowId);
    assertEquals(row.notes.includes("CODE_SEARCH_COMPLETING_ADAPTER_MARKER"), false, rowId);
  }
});

Deno.test("Cross-table agreement: three tables never disagree; predecessor rows byte-identical", () => {
  // Row 17's registry: the code-search subrequest row stays pending and
  // points at THIS change; row 18's web-search table keeps its own verdicts.
  const fetchCodeRow = FETCH_ROUTE_TABLE.find((r) => r.routeId === "code-search.subrequests");
  assertExists(fetchCodeRow);
  assertEquals(fetchCodeRow.status, "blocked-pending-adapter");
  assertEquals(fetchCodeRow.userDecisionRequired, true);
  assert(fetchCodeRow.notes.includes("row 21 (adapt-omp-public-code-search)"));
  const fetchSearchRow = FETCH_ROUTE_TABLE.find((r) => r.routeId === "search-provider.subrequests");
  assertExists(fetchSearchRow);
  assertEquals(fetchSearchRow.status, "blocked-pending-adapter");
  // No table claims a route completed that another keeps pending for the
  // same contract state: this change completes NO backend route, so nothing
  // here can disagree with the fetch table's pending verdict.
  assertEquals(
    CODE_SEARCH_ROUTE_TABLE.filter((r) => isCodeSearchRouteCompleted(r.routeId)).length,
    0,
  );
  // Route-id hygiene: prefix disjointness across the three tables.
  const fetchIds = [...new Set(FETCH_ROUTE_TABLE.map((r) => r.routeId))];
  for (const row of CODE_SEARCH_ROUTE_TABLE) {
    assertEquals(fetchIds.includes(row.routeId), false, row.routeId);
    assertEquals(SEARCH_ROUTE_TABLE.some((r) => r.routeId === row.routeId), false, row.routeId);
    assertEquals(row.routeId.startsWith("code_search."), true, row.routeId);
  }
  // Completed sets never collide: fetch keeps its URL-read set, search its
  // grounding set, code search claims none.
  const fetchCompleted = fetchIds.filter((id) =>
    FETCH_ROUTE_TABLE.find((r) => r.routeId === id)?.status === "completed-by-adapter"
  ).join("|");
  assertEquals(
    fetchCompleted,
    "read.url-branch.text|read.url-branch.binary|read.url-branch.secondary-hops|read.url-branch.materialization-consumers",
  );
  assertEquals(
    SEARCH_ROUTE_TABLE.filter((r) => r.status === "completed-by-adapter").map((r) => r.routeId)
      .join("|"),
    "web_search.grounding.gemini|web_search.grounding.openrouter|web_search.grounding.grounding-redirect-enrichment",
  );
});

Deno.test("No route row names a NEVER_PASS secret; the transport module never names one at all", async () => {
  // Test-side list (sandbox-manager.ts NEVER_PASS_ENV is not importable).
  const neverPass = [
    "GITHUB_TOKEN",
    "COPILOT_GITHUB_TOKEN",
    "GH_TOKEN",
    "GIT_BACKUP_AUTH_PASSWORD",
  ];
  for (const row of CODE_SEARCH_ROUTE_TABLE) {
    // No row ever names a NEVER_PASS secret as a mechanism/input.
    for (const name of neverPass) {
      assertEquals(row.mechanism.includes(name), false, `${row.routeId}: ${name}`);
    }
    // Where a row's notes cite the refused secret at all, the citation sits
    // inside refusal prose (NEVER_PASS / refused), never an input claim.
    for (const name of neverPass) {
      if (row.notes.includes(name)) {
        assert(/NEVER_PASS|refused|never/i.test(row.notes), `${row.routeId}: ${name}`);
      }
    }
    // No route names the non-existent token as a route/input; it lives only
    // in frozen citation FACTS (the zero-hits audit).
    assertEquals(row.notes.includes("GREP_APP_API_TOKEN"), false, row.routeId);
  }
  // The decision module's EXECUTABLE lines never name a NEVER_PASS secret,
  // the non-existent token, or process.env (presence is injected ONLY).
  const source = await Deno.readTextFile(
    new URL("../../src/acp/omp/code-search-transport.ts", import.meta.url),
  );
  const executable = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
  for (const name of [...neverPass, "GREP_APP_API_TOKEN", "process.env"]) {
    const offending = executable.filter((line) => line.includes(name));
    assertEquals(offending.length, 0, `${name}: ${offending.join(" | ")}`);
  }
});

Deno.test("P0 ledger pin: the public_code_search subcase stays recorded, owner this change", () => {
  const entry = AUDITED_PINNED_LEDGER.find((e) => e.subcase === "public_code_search");
  assertExists(entry);
  assertEquals(entry.downstreamOwner, "adapt-omp-public-code-search");
  // Restated by reference: the route table's github-api row is tiered
  // no-supported-mechanism — the ledger's GITHUB_TOKEN-shaped mechanism
  // sketch is NOT adopted by this change (its refusal is the C4/C5/D2 audit).
  assertEquals(
    CODE_SEARCH_ROUTE_TABLE.find((r) => r.routeId === "code_search.github-api")?.status,
    "no-supported-mechanism",
  );
});

Deno.test("Barrel closure: code-search route surfaces reachable through the declared list only", () => {
  assertEquals(MARKER_VIA_BARREL, CODE_SEARCH_COMPLETING_ADAPTER_MARKER);
  assertEquals(TABLE_VIA_BARREL.length, CODE_SEARCH_ROUTE_TABLE.length);
});

Deno.test("SYNTHETIC executor fixture (credential present): serving path pins the reserved contract", async () => {
  // SYNTHETIC P0 fixture: the reserved sibling's serving path under injected
  // seams. No tool is registered and the credential-absent block above is
  // the real state; this fixture certifies the pinned decision path ONLY.
  const records: CodeSearchDecisionRecord[] = [];
  const t = transport(() => new Response(githubMatchesPayload(), { status: 200 }));
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "decideFetchHop" }, "ghp_SECRET_MATERIAL_123"),
    executorDeps(TOKEN_PRESENT, t, ENFORCING, records),
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.response.items[0]?.nameWithOwner, "air-friends/air-friends");
    const envelope = codeSearchSuccessEnvelope(result.response);
    assertEquals(envelope.details.adapterCompleted, true);
  }
  assertEquals(t.issued.length, 1);
  assertEquals(t.issued[0]?.init?.redirect as RequestRedirect, "manual");
  assertEquals(
    (t.issued[0]?.init as RequestInit & { proxy?: string })?.proxy,
    "http://127.0.0.1:9099",
  );
  assertEquals(JSON.stringify(records).includes("ghp_SECRET_MATERIAL_123"), false);
});

Deno.test("Reserved enrichment budget constants are pinned, not prose (tasks 4.1)", () => {
  // The reserved sibling's enrichment posture is part of the pinned contract:
  // bounded secondaries sharing row 17's budget, never unbounded fan-out.
  assertEquals(MAX_CODE_SEARCH_ENRICHMENT_SUBREQUESTS, 10);
  assertEquals(CODE_SEARCH_ENRICHMENT_TIMEOUT_MS, 5_000);
});

// Restore fetch for any later importer (each suite file runs isolated here).
globalThis.fetch = realFetch;
