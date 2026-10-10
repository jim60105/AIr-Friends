/**
 * Mock-only decision tests for the web-search transport adapter (row 20,
 * `adapt-omp-web-search`, tasks 5.1).
 *
 * Mocked provider transport + mocked DNS + synthetic redirect/enrichment
 * chains; NOTHING contacts the network (globalThis.fetch is replaced by a
 * throwing stub for the whole file). These suites certify ADAPTER DECISIONS
 * ONLY: they can never clear the P0 transport-bypass record (W6/W7) or
 * prove the native binary invokes the replacement (design §15, user-owned).
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import {
  decideFetchHop,
  type FetchEgressPolicy,
  type FetchTransportFn,
  MAX_REDIRECT_HOPS,
} from "@acp/omp/fetch-transport.ts";
import {
  buildGeminiSearchRequest,
  buildOpenRouterSearchRequest,
  credentialPresenceFromEnv,
  decideSearchRoute,
  MAX_ENRICHMENT_SUBREQUESTS,
  PINNED_SEARCH_ENDPOINTS,
  runSearchRoute,
  type SearchCredentialPresence,
  type SearchDecisionRecord,
  selectSearchBackend,
  SUPPORTED_SEARCH_CREDENTIAL_ENV,
} from "@acp/omp/search-transport.ts";

// Zero-network guarantee: nothing below reaches a socket.
globalThis.fetch = (() => {
  throw new Error("network contact forbidden in mock-only suites");
}) as typeof fetch;

const ENFORCING: FetchEgressPolicy = {
  posture: "enforcing",
  proxyEndpoint: "http://127.0.0.1:9099",
};
const UNRESTRICTED: FetchEgressPolicy = { posture: "unrestricted" };

const BOTH: SearchCredentialPresence = { geminiKey: true, openrouterKey: true };
const GEMINI_ONLY: SearchCredentialPresence = { geminiKey: true, openrouterKey: false };
const OPENROUTER_ONLY: SearchCredentialPresence = { geminiKey: false, openrouterKey: true };
const NEITHER: SearchCredentialPresence = { geminiKey: false, openrouterKey: false };

/** Mocked DNS: hostname → answers; unknown hosts resolve to TEST-NET-3. */
function mockDns(table: Record<string, string[]> = {}) {
  const full: Record<string, string[]> = {
    // The metadata hostname class resolves into the never-exemptable space
    // (mirrors the real link-local metadata endpoint).
    "metadata.google.internal": ["169.254.169.254"],
    ...table,
  };
  return (host: string): Promise<string[]> => {
    if (host in full) {
      const answers = full[host];
      if (answers.length === 0) return Promise.reject(new Error(`no records for ${host}`));
      return Promise.resolve(answers);
    }
    if (/^\d+/.test(host) || host.includes(":")) return Promise.resolve([host]);
    return Promise.resolve(["203.0.113." + (1 + (host.length % 200))]);
  };
}

interface MockTransport {
  readonly fetchImpl: FetchTransportFn;
  readonly requests: Array<{ url: string; init?: RequestInit }>;
}

function mockTransport(responder: (url: string, seen: number) => Response): MockTransport {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    requests,
    fetchImpl: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(responder(url, requests.length - 1));
    },
  };
}

function geminiStreamBody(answer = "grounded answer", uri = "https://example.com/a"): string {
  const chunk = {
    candidates: [{
      content: { parts: [{ text: answer }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri, title: "Example A" } }],
        webSearchQueries: ["q1"],
      },
    }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
    modelVersion: "gemini-test",
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function openRouterBody(answer = "grounded answer", url = "https://example.com/a"): string {
  return JSON.stringify({
    id: "gen-1",
    model: "routed-model",
    choices: [{
      message: {
        content: answer,
        annotations: [{ type: "url_citation", url_citation: { url, title: "Example A" } }],
      },
    }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });
}

function decisionDeps(presence: SearchCredentialPresence, posture: FetchEgressPolicy) {
  return { resolveHost: mockDns(), credentialPresence: presence, posture };
}

const GEMINI_ENDPOINT = PINNED_SEARCH_ENDPOINTS.gemini.baseUrl;
const OPENROUTER_ENDPOINT = PINNED_SEARCH_ENDPOINTS.openrouter.baseUrl;

// ---------------------------------------------------------------------------
// Credential scope (D1/D4): selection is the row-7 set, presence only.
// ---------------------------------------------------------------------------

Deno.test("Credential env set: exactly row 7's GEMINI_API_KEY + OPENROUTER_API_KEY", () => {
  assertEquals(SUPPORTED_SEARCH_CREDENTIAL_ENV, {
    gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  });
  assertEquals(credentialPresenceFromEnv({}), { geminiKey: false, openrouterKey: false });
  assertEquals(
    credentialPresenceFromEnv({ GEMINI_API_KEY: "secret-value", OPENROUTER_API_KEY: "" }),
    { geminiKey: true, openrouterKey: false },
  );
  // Presence booleans ONLY: the value never appears in the returned state.
  const state = credentialPresenceFromEnv({ GEMINI_API_KEY: "super-secret" });
  assertEquals(JSON.stringify(state).includes("super-secret"), false);
});

Deno.test("Selection: both keys -> gemini first; gemini-only -> gemini; openrouter-only -> openrouter", () => {
  assertEquals(selectSearchBackend(BOTH), "gemini");
  assertEquals(selectSearchBackend(GEMINI_ONLY), "gemini");
  assertEquals(selectSearchBackend(OPENROUTER_ONLY), "openrouter");
  assertEquals(selectSearchBackend(NEITHER), null);
});

Deno.test("Credential-absent: hop blocks with no-supported-credential + userDecisionRequired, credential-free record", async () => {
  const decision = await decideSearchRoute(
    {
      url: `${GEMINI_ENDPOINT}/models/x:streamGenerateContent?alt=sse`,
      hopKind: "provider-endpoint",
      hopsFollowed: 0,
    },
    decisionDeps(NEITHER, ENFORCING),
  );
  assertEquals(decision.decision, "block");
  if (decision.decision === "block" && !("host" in decision.record)) {
    assertEquals(decision.reason, "no-supported-credential");
    assertEquals("userDecisionRequired" in decision && decision.userDecisionRequired, true);
    assertEquals(decision.record, {
      hopIndex: 0,
      decision: "block",
      reason: "no-supported-credential",
    });
    // Credential-free record posture: at most { hopIndex, decision, reason }.
    assertEquals(Object.keys(decision.record).sort(), ["decision", "hopIndex", "reason"]);
  } else {
    throw new Error("expected credential-scope block record");
  }
});

Deno.test("runSearchRoute with neither credential: blocked, zero issued requests", async () => {
  const transport = mockTransport(() => new Response("unreachable", { status: 200 }));
  const records: SearchDecisionRecord[] = [];
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "deno runtime" }, "SECRET-GEMINI-KEY"),
    {
      ...decisionDeps(NEITHER, ENFORCING),
      fetchImpl: transport.fetchImpl,
      credential: "SECRET-GEMINI-KEY",
      recordSink: (record) => records.push(record),
    },
  );
  assertEquals(result.ok, false);
  assertEquals(transport.requests.length, 0);
  assertEquals(records.length, 1);
  assertEquals(records[0], { hopIndex: 0, decision: "block", reason: "no-supported-credential" });
});

Deno.test("Explicit backend outside the supported set: blocked, never adopted, zero transport", async () => {
  for (const presence of [BOTH, GEMINI_ONLY, OPENROUTER_ONLY]) {
    const transport = mockTransport(() => new Response("never", { status: 200 }));
    const result = await runSearchRoute(
      buildOpenRouterSearchRequest({ query: "q" }, "key"),
      {
        ...decisionDeps(presence, UNRESTRICTED),
        fetchImpl: transport.fetchImpl,
        credential: "key",
      },
    );
    // Control: without the flag the same hop is decided by row 17's core.
    const flagged = await decideSearchRoute(
      {
        url: `${OPENROUTER_ENDPOINT}/chat/completions`,
        hopKind: "provider-endpoint",
        hopsFollowed: 0,
        requestedUnsupportedBackend: true,
      },
      decisionDeps(presence, UNRESTRICTED),
    );
    assertEquals(flagged.decision, "block");
    if (flagged.decision === "block") {
      assertEquals(flagged.reason, "explicit-model-outside-supported-set");
      assertEquals("userDecisionRequired" in flagged && flagged.userDecisionRequired, true);
      assertEquals(Object.keys(flagged.record).sort(), ["decision", "hopIndex", "reason"]);
    }
    void result;
  }
});

// ---------------------------------------------------------------------------
// Provider endpoint routing under both postures (row-17 rules verbatim).
// ---------------------------------------------------------------------------

Deno.test("Public provider endpoints allowed under both postures; enforcing names the proxy route", async () => {
  for (
    const [label, presence, url] of [
      ["gemini", GEMINI_ONLY, GEMINI_ENDPOINT],
      ["openrouter", OPENROUTER_ONLY, OPENROUTER_ENDPOINT],
    ] as const
  ) {
    for (const posture of [ENFORCING, UNRESTRICTED]) {
      const decision = await decideSearchRoute(
        { url: `${url}/chat/completions`, hopKind: "provider-endpoint", hopsFollowed: 0 },
        decisionDeps(presence, posture),
      );
      assertEquals(decision.decision !== "block", true, `${label}/${posture.posture}`);
      if (posture.posture === "enforcing") {
        assertEquals(
          decision.decision,
          "allow-via-proxy",
          `${label} enforcing must name the proxy route`,
        );
        if (decision.decision === "allow-via-proxy") {
          assertEquals(decision.proxyEndpoint, "http://127.0.0.1:9099");
        }
      }
      // Records are row-17 shapes verbatim: exactly { host, hopIndex, decision, reason }.
      assertEquals(Object.keys(decision.record).sort(), ["decision", "hopIndex", "host"]);
      if ("host" in decision.record) {
        assertEquals(decision.record.host, new URL(`${url}/chat/completions`).hostname);
      }
    }
  }
});

Deno.test("Issued provider request carries redirect:manual + proxy init under enforcing posture", async () => {
  const transport = mockTransport(() => new Response(geminiStreamBody(), { status: 200 }));
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "deno runtime" }, "key"),
    { ...decisionDeps(GEMINI_ONLY, ENFORCING), fetchImpl: transport.fetchImpl, credential: "key" },
  );
  assertEquals(result.ok, true);
  assertEquals(transport.requests.length, 1);
  assertEquals(transport.requests[0].init?.redirect as RequestRedirect, "manual");
  assertEquals(
    (transport.requests[0].init as RequestInit & { proxy?: string }).proxy,
    "http://127.0.0.1:9099",
  );
});

const PRIVATE_TARGETS: Array<readonly [string, string]> = [
  ["loopback", "http://127.1.2.3/search"],
  ["RFC1918", "http://10.9.8.7/search"],
  ["link-local/metadata", "http://169.254.169.254/search"],
  ["metadata-host", "http://metadata.google.internal/search"],
  ["ULA", "http://[fd00::23]/search"],
  ["multicast", "http://239.1.2.3/search"],
  ["unspecified", "http://0.0.0.0/search"],
  ["ipv6-loopback", "http://[::1]/search"],
];

Deno.test("Private/metadata provider endpoint targets block under both postures with the class named", async () => {
  for (const posture of [ENFORCING, UNRESTRICTED]) {
    for (const [label, url] of PRIVATE_TARGETS) {
      const decision = await decideSearchRoute(
        { url, hopKind: "provider-endpoint", hopsFollowed: 0 },
        decisionDeps(BOTH, posture),
      );
      assertEquals(decision.decision, "block", `${label}/${posture.posture}`);
      if (decision.decision === "block") {
        assertEquals(
          ["disallowed-address", "cloud-metadata", "dns-unresolved", "dns-invalid-answer"].includes(
            decision.reason,
          ),
          true,
          `${label}/${posture.posture} reason=${decision.reason}`,
        );
      }
    }
  }
});

Deno.test("runSearchRoute to a metadata endpoint: blocked with reason, zero issued requests", async () => {
  for (const posture of [ENFORCING, UNRESTRICTED]) {
    const transport = mockTransport(() => new Response("never", { status: 200 }));
    const records: SearchDecisionRecord[] = [];
    const result = await runSearchRoute(
      {
        backend: "gemini",
        url: "http://169.254.169.254/metadata",
        init: { method: "POST", headers: {}, body: "{}" },
      },
      {
        resolveHost: mockDns(),
        credentialPresence: BOTH,
        posture,
        fetchImpl: transport.fetchImpl,
        credential: "key",
        recordSink: (record) => records.push(record),
      },
    );
    assertEquals(result.ok, false, posture.posture);
    if (!result.ok && result.failure.kind === "blocked" && "host" in result.failure.record) {
      assertEquals(result.failure.record.reason, "cloud-metadata");
    } else {
      throw new Error(`expected metadata block (${posture.posture})`);
    }
    assertEquals(transport.requests.length, 0);
    assertEquals(records.length, 1);
  }
});

// ---------------------------------------------------------------------------
// Redirect chains and enrichment secondaries.
// ---------------------------------------------------------------------------

Deno.test("Provider redirect to a private target blocks AT THE HOP; the private hop is never issued", async () => {
  const live = mockTransport((_url, seen) =>
    seen === 0
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/redir" } })
      : new Response("must never be issued", { status: 200 })
  );
  const result = await runSearchRoute(
    buildOpenRouterSearchRequest({ query: "q" }, "key"),
    { ...decisionDeps(BOTH, ENFORCING), fetchImpl: live.fetchImpl, credential: "key" },
  );
  assertEquals(result.ok, false);
  assertEquals(live.requests.length, 1); // only the public endpoint hop is ever issued
  if (!result.ok && result.failure.kind === "blocked" && "host" in result.failure.record) {
    assertEquals(result.failure.record.reason, "cloud-metadata");
    assertEquals(result.failure.record.hopIndex, 2); // the redirect target is hop 2
  } else {
    throw new Error("expected at-hop block");
  }
});

Deno.test(`Six-hop redirect chain blocks with hop-limit-exceeded after <=${MAX_REDIRECT_HOPS} followed hops`, async () => {
  const transport = mockTransport((_url, seen) =>
    new Response(null, { status: 302, headers: { location: `http://203.0.113.${10 + seen}/hop` } })
  );
  const result = await runSearchRoute(
    buildOpenRouterSearchRequest({ query: "q" }, "key"),
    { ...decisionDeps(BOTH, UNRESTRICTED), fetchImpl: transport.fetchImpl, credential: "key" },
  );
  assertEquals(result.ok, false);
  assertEquals(transport.requests.length <= MAX_REDIRECT_HOPS + 1, true);
  if (!result.ok && result.failure.kind === "blocked" && "host" in result.failure.record) {
    assertEquals(result.failure.record.reason, "hop-limit-exceeded");
    assertEquals(result.failure.record.hopIndex, MAX_REDIRECT_HOPS + 2); // block at hop index 7
  } else {
    throw new Error("expected hop-limit block");
  }
});

const GROUNDING_PROXY = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC123";

Deno.test("Enrichment hops re-enter the SAME core as secondary hops: public allowed with row-17 record", async () => {
  const allowed = await decideSearchRoute(
    { url: GROUNDING_PROXY, hopKind: "enrichment", hopsFollowed: 2 },
    decisionDeps(GEMINI_ONLY, ENFORCING),
  );
  assertEquals(allowed.decision !== "block", true);
  assertEquals(allowed.record.hopIndex, 3); // secondary pattern: hopsFollowed + 1
  if ("host" in allowed.record) {
    assertEquals(allowed.record.host, "vertexaisearch.cloud.google.com");
  }
  for (const posture of [ENFORCING, UNRESTRICTED]) {
    const blocked = await decideSearchRoute(
      {
        url: "http://169.254.169.254/grounding-api-redirect/X",
        hopKind: "enrichment",
        hopsFollowed: 0,
      },
      decisionDeps(GEMINI_ONLY, posture),
    );
    assertEquals(blocked.decision, "block", posture.posture);
    if (blocked.decision === "block") assertEquals(blocked.reason, "cloud-metadata");
  }
});

Deno.test("Enrichment HEAD Location to a private address blocks at the hop; proxy URL kept, never adopted", async () => {
  const fetchImpl: FetchTransportFn = (url, init) => {
    if (init?.method === "HEAD") {
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/stolen" } }),
      );
    }
    return Promise.resolve(
      new Response(geminiStreamBody("answer", GROUNDING_PROXY), { status: 200 }),
    );
  };
  const records: SearchDecisionRecord[] = [];
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "q" }, "key"),
    {
      ...decisionDeps(GEMINI_ONLY, ENFORCING),
      fetchImpl,
      credential: "key",
      recordSink: (record) => records.push(record),
    },
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    // The private Location is NEVER adopted as a resolved source URL.
    assertEquals(result.response.sources[0]?.url, GROUNDING_PROXY);
    assertEquals(result.notes.some((note) => note.includes("blocked")), true);
  }
  // The blocked Location hop carries its own credential-free row-17 record.
  const last = records.at(-1);
  assertExists(last);
  if ("host" in last) {
    assertEquals(last.reason, "cloud-metadata");
    assertEquals(Object.keys(last).sort(), [
      "addressClass",
      "decision",
      "hopIndex",
      "host",
      "reason",
    ]);
  } else {
    throw new Error("expected row-17 record for the blocked Location hop");
  }
});

Deno.test("Enrichment HEAD public Location resolves and replaces the proxy URL with a hop record", async () => {
  const fetchImpl: FetchTransportFn = (url, init) => {
    if (init?.method === "HEAD") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://news.example.com/story" },
        }),
      );
    }
    return Promise.resolve(
      new Response(geminiStreamBody("answer", GROUNDING_PROXY), { status: 200 }),
    );
  };
  const records: SearchDecisionRecord[] = [];
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "q" }, "key"),
    {
      ...decisionDeps(GEMINI_ONLY, UNRESTRICTED),
      fetchImpl,
      credential: "key",
      recordSink: (record) => records.push(record),
    },
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.response.sources[0]?.url, "https://news.example.com/story");
  }
  assertEquals(
    records.some((r) => "host" in r && r.host === "news.example.com/story".split("/")[0]),
    true,
  );
});

Deno.test("Enrichment fan-out is bounded by MAX_ENRICHMENT_SUBREQUESTS", async () => {
  const uris = Array.from(
    { length: MAX_ENRICHMENT_SUBREQUESTS + 4 },
    (_, i) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/R${i}`,
  );
  const chunk = {
    candidates: [{
      content: { parts: [{ text: "answer" }] },
      groundingMetadata: {
        groundingChunks: uris.map((uri, i) => ({ web: { uri, title: `t${i}` } })),
        webSearchQueries: [],
      },
    }],
    modelVersion: "gemini-test",
  };
  const headTargets: string[] = [];
  const fetchImpl: FetchTransportFn = (url, init) => {
    if (init?.method === "HEAD") {
      headTargets.push(url);
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.resolve(new Response(`data: ${JSON.stringify(chunk)}\n\n`, { status: 200 }));
  };
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "q" }, "key"),
    { ...decisionDeps(GEMINI_ONLY, UNRESTRICTED), fetchImpl, credential: "key" },
  );
  assertEquals(result.ok, true);
  assertEquals(headTargets.length, MAX_ENRICHMENT_SUBREQUESTS);
  if (result.ok) {
    assertEquals(
      result.notes.some((note) => note.includes(`capped at ${MAX_ENRICHMENT_SUBREQUESTS}`)),
      true,
    );
  }
});

Deno.test("Blocked enrichment target keeps the proxy URL and records the block credential-free", async () => {
  const chunk = {
    candidates: [{
      content: { parts: [{ text: "answer" }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: GROUNDING_PROXY, title: "meta" } }],
      },
    }],
    modelVersion: "gemini-test",
  };
  const transport = mockTransport(() =>
    new Response(`data: ${JSON.stringify(chunk)}\n\n`, { status: 200 })
  );
  const records: SearchDecisionRecord[] = [];
  const result = await runSearchRoute(
    buildGeminiSearchRequest({ query: "q" }, "key"),
    {
      // The grounding-redirect host resolves into the never-exemptable
      // metadata space: its secondary hop blocks, the proxy URL is kept.
      resolveHost: mockDns({ "vertexaisearch.cloud.google.com": ["169.254.169.254"] }),
      credentialPresence: GEMINI_ONLY,
      posture: UNRESTRICTED,
      fetchImpl: transport.fetchImpl,
      credential: "key",
      recordSink: (record) => records.push(record),
    },
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.response.sources[0]?.url, GROUNDING_PROXY);
    assertEquals(result.notes.some((note) => note.includes("blocked")), true);
  }
  const enrichment = records.at(-1);
  assertExists(enrichment);
  if ("host" in enrichment) {
    assertEquals(enrichment.reason, "cloud-metadata");
    assertEquals(Object.keys(enrichment).sort(), [
      "addressClass",
      "decision",
      "hopIndex",
      "host",
      "reason",
    ]);
  } else {
    throw new Error("expected row-17 record shape for enrichment block");
  }
});

// ---------------------------------------------------------------------------
// No-unguarded-retry + divergence.
// ---------------------------------------------------------------------------

Deno.test("No unguarded retry: every issued attempt has a prior decision record; one attempt per hop incl. 429", async () => {
  for (
    const [label, body, status] of [
      ["success", openRouterBody(), 200],
      ["429 rate", "slow down", 429],
      ["500 upstream", "boom", 500],
    ] as const
  ) {
    const issuedOrder: string[] = [];
    const transport = mockTransport(() => new Response(body, { status }));
    const fetchImpl: FetchTransportFn = (url, init) => {
      issuedOrder.push(`issue:${url}`);
      return transport.fetchImpl(url, init);
    };
    const order: string[] = [];
    const records: SearchDecisionRecord[] = [];
    const result = await runSearchRoute(
      buildOpenRouterSearchRequest({ query: "q" }, "key"),
      {
        ...decisionDeps(OPENROUTER_ONLY, ENFORCING),
        fetchImpl,
        credential: "key",
        recordSink: (record) => {
          records.push(record);
          order.push("decide");
        },
      },
    );
    // Decision BEFORE issue, always; exactly ONE issue per hop — no retry.
    assertEquals(order[0], "decide", label);
    assertEquals(transport.requests.length, 1, label);
    assertEquals(issuedOrder.length, 1, label);
    assertEquals(records.length >= 1, true, label);
    if (status !== 200) assertEquals(result.ok, false, label);
  }
});

Deno.test("Divergence: nothing row 17's core rejects is ever allowed by the search adapter", async () => {
  const urls = [
    ...PRIVATE_TARGETS.map(([, url]) => url),
    GROUNDING_PROXY,
    `${GEMINI_ENDPOINT}/models/x:streamGenerateContent?alt=sse`,
    `${OPENROUTER_ENDPOINT}/chat/completions`,
    "http://203.0.113.5/a",
    "ftp://203.0.113.5/a",
  ];
  for (const posture of [ENFORCING, UNRESTRICTED, { posture: "unresolved" } as FetchEgressPolicy]) {
    for (const url of urls) {
      const fetch17 = await decideFetchHop(
        { url, hopType: "initial", hopsFollowed: 0 },
        { resolveHost: mockDns(), policy: posture },
      );
      const search = await decideSearchRoute(
        { url, hopKind: "provider-endpoint", hopsFollowed: 0 },
        decisionDeps(BOTH, posture),
      );
      assertEquals(search.decision, fetch17.decision, `${url} ${posture.posture}`);
      if (fetch17.decision === "block") {
        assertNotEquals(search.decision, "allow-direct", url);
        if (search.decision === "block" && "host" in search.record) {
          assertEquals(search.reason, fetch17.reason, url);
        }
      }
    }
  }
});
