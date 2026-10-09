/**
 * Mock-only shapes/output tests for the URL-fetch transport adapter and the
 * trusted-extension `read` replacement (row 19,
 * `control-omp-url-fetch-transport`, tasks 5.2).
 *
 * Mocked transport + mocked DNS + synthetic redirect chains; zero network.
 * Route-table rows carry POSITIVE replacement-mechanism fixtures explicitly
 * labeled as synthetic route data under the P0 fixture rules — they are not
 * native behavior.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  extensionHintFor,
  formatFetchDecisionLog,
  fetchShapedRoute,
  MAX_BINARY_BYTES,
  MAX_TEXT_OUTPUT_CHARS,
  runSecondaryFetch,
  type FetchEgressPolicy,
  type FetchTransportFn,
} from "@acp/omp/fetch-transport.ts";
import {
  FETCH_COMPLETING_ADAPTER_MARKER,
  FETCH_ROUTE_TABLE,
  isRouteCompleted,
} from "@acp/omp/fetch-routes.ts";
import {
  RESTRICTED_TOOL_INVENTORY_TABLE,
  decideRestrictedTool,
} from "@acp/omp/tool-inventory.ts";
import { composeRestrictedToolCall, type ToolCallObservation } from "@acp/omp/tool-enforcement-wiring.ts";
import { evaluateApprovalRecordAuthority } from "@acp/omp/record-evaluator.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import {
  createReadReplacementToolDefinition,
  formatNativeShapedUrlRead,
  parseReadUrlBranch,
  type ReadDelegationContext,
} from "@acp/omp/extension/read-replacement.ts";
import {
  FETCH_COMPLETING_ADAPTER_MARKER as MARKER_VIA_BARREL,
  FETCH_ROUTE_TABLE as TABLE_VIA_BARREL,
} from "@acp/omp/extension/_daemon/mod.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("network contact forbidden in mock-only suites");
}) as typeof fetch;

const UNRESTRICTED: FetchEgressPolicy = { posture: "unrestricted" };
const ENFORCING: FetchEgressPolicy = { posture: "enforcing", proxyEndpoint: "http://127.0.0.1:9099" };

// 14a/14b fixture shapes reused verbatim from the row-14 suites.
// (14a's suites pass the bare record; 14b's compose adds the observed
// generation and matches it against the registry observation.)
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
    registryObservation: { recordedOrigin: ownedObserved, registryEpoch: 7, resourceGeneration: "gen-0" },
    recordEvaluation: NO_RECORDS,
  };
}

function mockDns(table: Record<string, string[]> = {}) {
  return async (host: string): Promise<string[]> => {
    if (host in table) return table[host];
    if (/^\d+/.test(host) || host.includes(":")) return [host];
    return ["203.0.113.5"];
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
    fetchImpl: async (url, init) => {
      issued.push({ url, init });
      return responder(url, issued.length - 1);
    },
  };
}

function response(
  body: BodyInit,
  contentType: string,
  extraHeaders: Record<string, string> = {},
  status = 200,
): Response {
  return new Response(body, { status, headers: { "content-type": contentType, ...extraHeaders } });
}

function deps(fetchImpl: FetchTransportFn, policy: FetchEgressPolicy = UNRESTRICTED) {
  return { resolveHost: mockDns(), policy, fetchImpl };
}

// ---------------------------------------------------------------------------
// Route-table shapes (D3).
// ---------------------------------------------------------------------------

Deno.test("Route table: statuses use P0 tiers, citations carry pinned version+commit", () => {
  const seenStatuses = new Set(FETCH_ROUTE_TABLE.map((row) => row.status));
  for (const status of seenStatuses) {
    assertEquals(
      ["completed-by-adapter", "partial-seam-not-selected", "blocked-pending-adapter"].includes(status),
      true,
      status,
    );
  }
  for (const row of FETCH_ROUTE_TABLE) {
    assertEquals(row.mechanism.length > 0, true, row.routeId);
    assertEquals(row.citations.length > 0, true, row.routeId);
    for (const citation of row.citations) {
      assertEquals(citation.ompVersion, "v18.6.1");
      assertEquals(citation.ompCommit, "2a2c6dcbbb558c0f8145f67f28b3370984f2bf60");
      assertEquals(citation.location.length > 0, true);
    }
  }
  // No row claims `supported` for native-binary behavior.
  assertEquals(FETCH_ROUTE_TABLE.some((row) => (row.status as string) === "supported"), false);
});

Deno.test("Route table: URL-read routes completed; search + native routes blocked with userDecisionRequired", () => {
  for (const rowId of [
    "read.url-branch.text",
    "read.url-branch.binary",
    "read.url-branch.secondary-hops",
    "read.url-branch.materialization-consumers",
  ]) {
    assertEquals(isRouteCompleted(rowId), true, rowId);
  }
  for (const rowId of ["search-provider.subrequests", "code-search.subrequests", "native.fetchBinary.direct"]) {
    const row = FETCH_ROUTE_TABLE.find((r) => r.routeId === rowId);
    assertExists(row, rowId);
    assertEquals(row.status, "blocked-pending-adapter", rowId);
    assertEquals(row.userDecisionRequired, true, rowId);
  }
  const seam = FETCH_ROUTE_TABLE.find((r) => r.routeId === "enrichment.reader-providers");
  assertExists(seam);
  assertEquals(seam.status, "partial-seam-not-selected");
});

Deno.test("Seam marker: URL-read rows name this change + route table and stay distinguishable from allow", () => {
  const urlRead = RESTRICTED_TOOL_INVENTORY_TABLE.find((row) => row.id === "url-read");
  const webFetch = RESTRICTED_TOOL_INVENTORY_TABLE.find((row) => row.id === "web-fetch");
  assertExists(urlRead);
  assertExists(webFetch);
  for (const gate of [urlRead, webFetch]) {
    assertEquals(gate.kind, "allow-gated-pending-adapter");
    assertEquals(gate.notes.includes("control-omp-url-fetch-transport"), true, gate.id);
    assertEquals(gate.notes.includes("FETCH_ROUTE_TABLE"), true, gate.id);
    assertEquals(gate.notes.includes(FETCH_COMPLETING_ADAPTER_MARKER), true, gate.id);
  }
  // The marker never converts the row into a plain allow: 14a still yields
  // the pending-adapter outcome (a distinct discriminated shape) and 14b
  // still blocks at the composition seam.
  const decision = decideRestrictedTool({ toolName: "read", provenance: owned, inputShape: "url" });
  assertEquals(decision.outcome, "allow-gated-pending-adapter");
  if (decision.outcome === "allow-gated-pending-adapter") {
    assertEquals(decision.tableRowId, "url-read");
  }
  const composed = composeRestrictedToolCall(obs("read", "url"));
  assert("block" in composed && composed.block, "14b still blocks the pending-adapter outcome");
  if ("block" in composed && composed.block) {
    assertEquals(composed.error.code, "rejected_pending_adapter");
    assertEquals(composed.error.tableRowId, "url-read");
  }
});

Deno.test("Seam marker: web-search and code-search rows carry no marker (byte-identical pending rows)", () => {
  for (const gateId of ["web-search", "code-search"]) {
    const gate = RESTRICTED_TOOL_INVENTORY_TABLE.find((g) => g.id === gateId);
    assertExists(gate, gateId);
    assertEquals(gate.kind, "allow-gated-pending-adapter");
    assertEquals(gate.notes.includes("control-omp-url-fetch-transport"), false, gateId);
    assertEquals(gate.notes.includes("COMPLETING-ADAPTER"), false, gateId);
  }
});

Deno.test("Barrel closure: fetch surfaces reachable through the declared list only", () => {
  assertEquals(MARKER_VIA_BARREL, FETCH_COMPLETING_ADAPTER_MARKER);
  assertEquals(TABLE_VIA_BARREL.length, FETCH_ROUTE_TABLE.length);
});

// ---------------------------------------------------------------------------
// Synthetic positive replacement-mechanism fixtures (P0 fixture rules).
// ---------------------------------------------------------------------------

const SYNTHETIC_FIXTURE_LABEL =
  "SYNTHETIC ROUTE DATA (P0 fixture rules): mocked transport+DNS; certifies adapter decisions only, " +
  "never native-binary invocation";

Deno.test(`Replacement positive fixtures — ${SYNTHETIC_FIXTURE_LABEL}`, async () => {
  const t = transport((url) =>
    url.endsWith(".png")
      ? response(new Uint8Array([137, 80, 78, 71]), "image/png")
      : response("<html>public page</html>", "text/html")
  );
  const definition = createReadReplacementToolDefinition({
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: t.fetchImpl,
  });
  const delegation: ReadDelegationContext = {
    invokeTool: async (params) => ({ delegatedTo: "captured-native", path: params["path"] }),
  };

  const html = await definition.execute(
    "tc-1",
    { path: "https://public.example/page" },
    undefined,
    undefined,
    delegation,
  ) as { contentBlocks: Array<{ type: string; text?: string }>; details: { adapterCompleted: boolean } };
  assertEquals(html.details.adapterCompleted, true);
  const htmlText = html.contentBlocks[0]?.text ?? "";
  assertEquals(htmlText.includes("URL: https://public.example/page"), true);
  assertEquals(htmlText.includes("Content-Type: text/html"), true);
  assertEquals(htmlText.includes("Method: fetch"), true);
  assertEquals(htmlText.includes("---"), true);
  assertEquals(htmlText.includes("public page"), true);

  const png = await definition.execute(
    "tc-2",
    { path: "https://public.example/asset.png" },
    undefined,
    undefined,
    delegation,
  ) as { contentBlocks: Array<{ type: string }>; details: { adapterCompleted: boolean; method: string } };
  assertEquals(png.details.method, "binary");
  assertEquals(png.contentBlocks.some((b) => b.type === "image"), true);
  // Native loadPage/fetchBinary were never reachable in this environment
  // (globalThis.fetch throws); every issued request carries manual redirect.
  for (const request of t.issued) {
    assertEquals((request.init?.redirect ?? "manual"), "manual");
  }
});

Deno.test("Native delegation is 100% verbatim for every non-URL input", async () => {
  const t = transport(() => response("x", "text/html"));
  const definition = createReadReplacementToolDefinition({
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: t.fetchImpl,
  });
  const seen: Array<Record<string, unknown>> = [];
  const delegation: ReadDelegationContext = {
    invokeTool: async (params) => {
      seen.push(params);
      return { ok: true };
    },
  };
  for (const path of [
    "src/main.ts",
    "src/main.ts:12-20",
    "~/notes.md",
    "./relative/file.txt",
    "/absolute/path.txt",
    "src/main.ts:50-100",
    "notes.md:raw",
    "weird:file",
    "host:8080",
    "C:\\path\\file.txt",
  ]) {
    await definition.execute("tc", { path }, undefined, undefined, delegation);
  }
  assertEquals(seen.length, 10);
  assertEquals(seen.map((p) => p["path"]), [
    "src/main.ts",
    "src/main.ts:12-20",
    "~/notes.md",
    "./relative/file.txt",
    "/absolute/path.txt",
    "src/main.ts:50-100",
    "notes.md:raw",
    "weird:file",
    "host:8080",
    "C:\\path\\file.txt",
  ]);
  // Zero transport calls: delegation never touched the adapter.
  assertEquals(t.issued.length, 0);
});

Deno.test("Delegation context missing → fail closed (no silent native bypass)", async () => {
  const definition = createReadReplacementToolDefinition({
    policy: UNRESTRICTED,
    resolveHost: mockDns(),
    fetchImpl: transport(() => response("x", "text/html")).fetchImpl,
  });
  let threw = "";
  try {
    await definition.execute("tc", { path: "src/main.ts" }, undefined, undefined, {});
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertEquals(threw.includes("failing closed"), true);
});

Deno.test("URL-shaped 14a decision is never the plain-allow shape and is distinguishable", () => {
  const urlDecision = decideRestrictedTool({ toolName: "read", provenance: owned, inputShape: "url" });
  const skillDecision = decideRestrictedTool({
    toolName: "skill",
    provenance: owned,
    inputShape: "path-target",
  });
  assertEquals(urlDecision.outcome, "allow-gated-pending-adapter");
  assertEquals(skillDecision.outcome, "allow-gated");
});

Deno.test("Internal/custom schemes are rejected as 14a alternate-route denial, never proxied", async () => {
  const t = transport(() => response("must never run", "text/html"));
  const definition = createReadReplacementToolDefinition({
    policy: ENFORCING,
    resolveHost: mockDns(),
    fetchImpl: t.fetchImpl,
  });
  const delegation: ReadDelegationContext = { invokeTool: async () => ({}) };
  for (const path of ["pi-internal://device/camera", "skill://air-friends/topic", "device://x"]) {
    let threw = "";
    try {
      await definition.execute("tc", { path }, undefined, undefined, delegation);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    assertEquals(threw.includes("rejected_alternate_route"), true, path);
    assertEquals(threw.includes("network-read"), true, path);
    assertEquals(threw.includes("internal-uri-scheme"), true, path);
  }
  assertEquals(t.issued.length, 0, "a rejected scheme is never proxied or issued");
});

Deno.test("URL-branch parsing: http(s) with selectors routes URL; collapsed-scheme repaired", () => {
  assertEquals(parseReadUrlBranch("https://example.com/x").kind, "url");
  assertEquals(parseReadUrlBranch("http:/example.com/x").kind, "url"); // collapsed repair
  const selected = parseReadUrlBranch("https://example.com/x:50-100");
  assertEquals(selected.kind, "url");
  if (selected.kind === "url") {
    assertEquals(selected.url, "https://example.com/x");
    assertEquals(selected.selector.kind, "lines");
  }
  const tail = parseReadUrlBranch("https://example.com/x:-5");
  if (tail.kind === "url") assertEquals(tail.selector.kind, "tail");
  const raw = parseReadUrlBranch("https://example.com/x:raw");
  if (raw.kind === "url") assertEquals(raw.selector.kind, "raw");
  // host:port has no path segment → NOT a selector, still a URL without one
  const port = parseReadUrlBranch("http://example.com:8080");
  assertEquals(port.kind, "url");
  if (port.kind === "url") assertEquals(port.url, "http://example.com:8080");
});

// ---------------------------------------------------------------------------
// Output shapes.
// ---------------------------------------------------------------------------

Deno.test("Native-shaped URL-read output header is reproduced without native code paths", () => {
  const output = formatNativeShapedUrlRead({
    finalUrl: "https://final.example/page",
    contentType: "text/markdown",
    method: "markdown",
    notes: ["materialized: converted"],
    content: "body",
  });
  const lines = output.split("\n");
  assertEquals(lines[0], "URL: https://final.example/page");
  assertEquals(lines[1], "Content-Type: text/markdown");
  assertEquals(lines[2], "Method: markdown");
  assertEquals(lines[3], "Notes: materialized: converted");
  assertEquals(lines[4], "");
  assertEquals(lines[5], "---");
  assertEquals(lines.slice(7).join("\n"), "body");
});

Deno.test("Text route caps at MAX_OUTPUT_CHARS with a truncation flag; binary caps on bytes", async () => {
  const big = "x".repeat(MAX_TEXT_OUTPUT_CHARS + 10);
  const t = transport(() => response(big, "text/plain"));
  const shaped = await fetchShapedRoute("https://public.example/big", deps(t.fetchImpl));
  assertEquals(shaped.route, "text");
  if (shaped.route === "text") {
    assertEquals(shaped.truncated, true);
    assertEquals(shaped.content.length, MAX_TEXT_OUTPUT_CHARS);
  }

  const declared = new Response(new Uint8Array([1]), {
    status: 200,
    headers: { "content-type": "application/pdf", "content-length": String(MAX_BINARY_BYTES + 1) },
  });
  const refused = await fetchShapedRoute("https://public.example/huge.pdf", deps(
    async () => declared,
  ));
  assertEquals(refused.route, "failed");
  if (refused.route === "failed") assertEquals(refused.reason, "content-length-limit");
});

Deno.test("Binary route returns content-disposition and extension hints (fetchBinary shape)", async () => {
  const t = transport(() =>
    response(new Uint8Array([80, 75, 3, 4]), "application/zip", {
      "content-disposition": 'attachment; filename="report.tar.gz"',
    })
  );
  const shaped = await fetchShapedRoute("https://public.example/download", deps(t.fetchImpl));
  assertEquals(shaped.route, "binary");
  if (shaped.route === "binary") {
    assertEquals(shaped.bytes.byteLength, 4);
    assertEquals(shaped.contentDisposition, 'attachment; filename="report.tar.gz"');
    assertEquals(shaped.extensionHint, ".tar.gz");
  }
  assertEquals(extensionHintFor("https://public.example/files/tool.zip"), ".zip");
});

Deno.test("Secondary hop records distinguish initial/redirect/secondary hop types", async () => {
  const t = transport(() => response("secondary body", "text/markdown"));
  const chain = await runSecondaryFetch("https://llms.example/llms.txt", { hopsFollowed: 0 }, {
    ...deps(t.fetchImpl),
    recordSink: undefined,
  });
  assertEquals(chain.ok, true);
  // The shaped primary and the secondary share the decision function; the
  // record sink observes hop metadata only (credential-free fields).
  const records: string[] = [];
  const t2 = transport(() => response("body", "text/html"));
  await fetchShapedRoute("https://public.example/page", {
    resolveHost: mockDns(),
    policy: UNRESTRICTED,
    fetchImpl: t2.fetchImpl,
    recordSink: (record) => records.push(`${record.host}|${record.hopIndex}|${record.decision}`),
  });
  assertEquals(records, ["public.example|1|allow-direct"]);
});

Deno.test("Decision records and log lines never carry credentials or payload", async () => {
  const collected: string[] = [];
  const t = transport(() =>
    response("<html>" + "secret-payload".repeat(100) + "</html>", "text/html")
  );
  const shaped = await fetchShapedRoute("https://user:pa5sword@public.example/private/doc?q=token", {
    resolveHost: mockDns(),
    policy: ENFORCING,
    fetchImpl: t.fetchImpl,
    recordSink: (record) => collected.push(formatFetchDecisionLog(record)),
  });
  assertEquals(shaped.route, "text", "userinfo survives parse; host stays public");
  assertEquals(collected.length > 0, true);
  for (const line of collected) {
    assertEquals(line.includes("pa5sword"), false, line);
    assertEquals(line.includes("token"), false, line);
    assertEquals(line.includes("secret-payload"), false, line);
    assertEquals(line.includes("private/doc"), false, line);
    assertEquals(line.includes("user"), false, line);
  }
});

// Restore for other importers in this process.
globalThis.fetch = realFetch;
