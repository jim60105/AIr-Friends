/**
 * Mock-only decision tests for the URL-fetch transport adapter (row 19,
 * `control-omp-url-fetch-transport`, tasks 5.1).
 *
 * Mocked fetch transport + mocked DNS + synthetic redirect chains; NOTHING
 * contacts the network (globalThis.fetch is replaced by a throwing stub for
 * the whole file). These suites certify ADAPTER DECISIONS ONLY: they can
 * never clear the P0 transport-bypass record (S3/S4) or prove the native
 * binary invokes the replacement (design §15, user-owned).
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { isDisallowedAddress, resolveHostAnswers } from "@utils/ssrf.ts";
import {
  decideFetchHop,
  deriveFetchEgressPolicy,
  type FetchDecisionRecord,
  type FetchEgressPolicy,
  fetchEgressPolicyFromAgentEnv,
  type FetchTransportFn,
  MAX_REDIRECT_HOPS,
  runFetchChain,
  runSecondaryFetch,
} from "@acp/omp/fetch-transport.ts";
import { runtimeResolveHost } from "@acp/omp/extension/read-replacement.ts";

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

/** Mocked DNS: hostname → answers; unknown hosts resolve to TEST-NET-3. */
function mockDns(table: Record<string, string[]> = {}) {
  return (host: string): Promise<string[]> => {
    if (host in table) {
      const answers = table[host];
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

function mockTransport(
  responder: (url: string, seen: number) => Response,
): MockTransport {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    requests,
    fetchImpl: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(responder(url, requests.length - 1));
    },
  };
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function textResponse(body = "hello public page"): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

// ---------------------------------------------------------------------------
// Posture derivation (consumed values; never redefined).
// ---------------------------------------------------------------------------

Deno.test("Posture: egressProxy && !unrestrictedEgress with running proxy = enforcing", () => {
  assertEquals(
    deriveFetchEgressPolicy({
      egressProxy: true,
      unrestrictedEgress: false,
      runningProxyUrl: "http://127.0.0.1:9099",
    }),
    { posture: "enforcing", proxyEndpoint: "http://127.0.0.1:9099" },
  );
});

Deno.test("Posture: unrestrictedEgress opt-in = operator unrestricted", () => {
  assertEquals(
    deriveFetchEgressPolicy({
      egressProxy: true,
      unrestrictedEgress: true,
      runningProxyUrl: undefined,
    }),
    { posture: "unrestricted" },
  );
});

Deno.test("Posture: configured-but-unreachable proxy and bare posture fail closed", () => {
  assertEquals(
    deriveFetchEgressPolicy({
      egressProxy: true,
      unrestrictedEgress: false,
      runningProxyUrl: undefined,
    }).posture,
    "unresolved",
  );
  assertEquals(
    deriveFetchEgressPolicy({
      egressProxy: false,
      unrestrictedEgress: false,
      runningProxyUrl: undefined,
    }).posture,
    "unresolved",
  );
});

Deno.test("Posture (env read): loopback proxy URL = enforcing; absent = unrestricted; junk = unresolved", () => {
  assertEquals(
    fetchEgressPolicyFromAgentEnv({ HTTPS_PROXY: "http://127.0.0.1:9099" }),
    { posture: "enforcing", proxyEndpoint: "http://127.0.0.1:9099" },
  );
  assertEquals(fetchEgressPolicyFromAgentEnv({}), { posture: "unrestricted" });
  assertEquals(
    fetchEgressPolicyFromAgentEnv({ HTTP_PROXY: "http://evil.example:1" }).posture,
    "unresolved",
  );
});

// ---------------------------------------------------------------------------
// Public targets: allowed under BOTH postures (enforcing names the proxy).
// ---------------------------------------------------------------------------

for (const [name, policy] of [["enforcing", ENFORCING], ["unrestricted", UNRESTRICTED]] as const) {
  Deno.test(`Public https target allowed under ${name} posture`, async () => {
    const decision = await decideFetchHop(
      { url: "https://public.example/page", hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns(), policy },
    );
    if (name === "enforcing") {
      assertEquals(decision.decision, "allow-via-proxy");
      assertExists("proxyEndpoint" in decision && decision.proxyEndpoint);
      assertEquals(
        "proxyEndpoint" in decision ? decision.proxyEndpoint : "",
        ENFORCING.proxyEndpoint,
      );
    } else {
      assertEquals(decision.decision, "allow-direct");
    }
    assertEquals(decision.record.host, "public.example");
    assertEquals(decision.record.hopIndex, 1);
  });
}

// ---------------------------------------------------------------------------
// Private/metadata targets blocked under enforcing with the class named.
// ---------------------------------------------------------------------------

const BLOCKED_TARGETS: ReadonlyArray<[string, string, string]> = [
  // [hostname, mocked answer, expected class]
  ["loopback.example", "127.0.0.1", "loopback"],
  ["loopback6.example", "::1", "loopback"],
  ["rfc1918-a.example", "10.1.2.3", "rfc1918"],
  ["rfc1918-b.example", "172.16.9.9", "rfc1918"],
  ["rfc1918-c.example", "192.168.0.5", "rfc1918"],
  ["linklocal.example", "169.254.1.1", "link-local"],
  ["linklocal6.example", "fe80::1", "link-local"],
  ["ula.example", "fd00::42", "unique-local"],
  ["unspecified.example", "0.0.0.0", "unspecified"],
  ["unspec6.example", "::", "unspecified"],
  ["multicast.example", "224.0.0.7", "multicast"],
  ["multicast6.example", "ff02::2", "multicast"],
  ["metadata.example", "169.254.169.254", "cloud-metadata"],
];

for (const [host, address, addressClass] of BLOCKED_TARGETS) {
  Deno.test(`Block ${host} (${address}) names class ${addressClass}`, async () => {
    const decision = await decideFetchHop(
      { url: `https://${host}/`, hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns({ [host]: [address] }), policy: ENFORCING },
    );
    assertEquals(decision.decision, "block");
    if (decision.decision === "block") {
      assertEquals(
        decision.reason,
        addressClass === "cloud-metadata" ? "cloud-metadata" : "disallowed-address",
      );
      assertEquals(decision.addressClass, addressClass);
    }
  });
}

Deno.test("Divergence: nothing ssrf.ts rejects is ever allowed by the adapter", async () => {
  const probeAddresses = [
    "127.0.0.1",
    "127.9.9.9",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.7.7",
    "169.254.10.10",
    "0.0.0.0",
    "224.1.1.1",
    "240.0.0.1",
    "100.64.0.9",
    "::1",
    "::",
    "fe80::abcd",
    "fc00::1",
    "fd12::34",
    "ff02::1",
    "::ffff:127.0.0.1",
    "169.254.169.254",
  ];
  for (const addr of probeAddresses) {
    // The shared classifier rejects it…
    assertEquals(isDisallowedAddress(addr), true, `ssrf rejects ${addr}`);
    // …and the adapter never allows a host answering with it, under either
    // posture.
    for (const policy of [ENFORCING, UNRESTRICTED]) {
      const decision = await decideFetchHop(
        { url: "https://divergence.example/", hopType: "initial", hopsFollowed: 0 },
        { resolveHost: mockDns({ "divergence.example": [addr] }), policy },
      );
      assertEquals(decision.decision, "block", `${addr}/${policy.posture}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Schemes.
// ---------------------------------------------------------------------------

for (
  const schemeUrl of [
    "pi-internal://device/x",
    "file:///etc/passwd",
    "ftp://example/x",
    "gopher://x",
  ]
) {
  Deno.test(`Non-http scheme blocked and never proxied: ${schemeUrl}`, async () => {
    const transport = mockTransport(() => textResponse());
    const decision = await decideFetchHop(
      { url: schemeUrl, hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns(), policy: ENFORCING },
    );
    assertEquals(decision.decision, "block");
    if (decision.decision === "block") assertEquals(decision.reason, "disallowed-scheme");
    const chain = await runFetchChain(schemeUrl, {
      resolveHost: mockDns(),
      policy: ENFORCING,
      fetchImpl: transport.fetchImpl,
    });
    assertEquals(chain.ok, false);
    assertEquals(
      transport.requests.length,
      0,
      "a blocked scheme is never issued, let alone proxied",
    );
  });
}

// ---------------------------------------------------------------------------
// Manual hop loop.
// ---------------------------------------------------------------------------

Deno.test("Six-hop chain blocks with hop-limit after at most five followed hops", async () => {
  // Six redirecting public hops (h1..h6 all respond redirect; the chain must
  // stop before ISSUING the request whose hop index would be 6 — h6's
  // Location decision blocks, so hop7 is never even requested).
  const hopUrl = (n: number) => `https://hop${n}.example/r`;
  const table: Record<string, string[]> = {};
  for (let n = 1; n <= 7; n++) table[`hop${n}.example`] = ["203.0.113.5"];
  const transport = mockTransport((_url, seen) => redirectResponse(hopUrl(seen + 2)));
  const records: FetchDecisionRecord[] = [];
  const chain = await runFetchChain(hopUrl(1), {
    resolveHost: mockDns(table),
    policy: UNRESTRICTED,
    fetchImpl: transport.fetchImpl,
    recordSink: (r) => records.push(r),
  });
  assertEquals(chain.ok, false);
  if (!chain.ok) {
    assertEquals(chain.block.reason, "hop-limit-exceeded");
  }
  assertEquals(MAX_REDIRECT_HOPS, 5);
  // Requests issued: initial + five followed redirects = 6 max; h7's
  // request (the sixth followed hop) is never issued.
  assertEquals(transport.requests.length, 6);
  assertEquals(transport.requests[transport.requests.length - 1]?.url, hopUrl(6));
  const limitRecords = records.filter((r) => r.reason === "hop-limit-exceeded");
  assertEquals(limitRecords.length, 1);
});

Deno.test("Production resolver shape: literal-IP hosts pass through to the classifier (B1)", async () => {
  // The replacement's runtimeResolveHost mirrors ssrf.ts's literal
  // short-circuit; literals must reach the SHARED classifier instead of
  // failing as dns-unresolved (parity + honest block classes). Static
  // import: the production DNS seam ships inside the replacement module.
  const metadata = await decideFetchHop(
    { url: "http://169.254.169.254/latest", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: runtimeResolveHost, policy: UNRESTRICTED },
  );
  assertEquals(metadata.decision, "block");
  if (metadata.decision === "block") {
    assertEquals(metadata.reason, "cloud-metadata");
    assertEquals(metadata.addressClass, "cloud-metadata");
  }
  const loopback6 = await decideFetchHop(
    { url: "http://[::1]:80/x", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: runtimeResolveHost, policy: UNRESTRICTED },
  );
  assertEquals(loopback6.decision, "block");
  if (loopback6.decision === "block") {
    assertEquals(loopback6.reason, "disallowed-address");
    assertEquals(loopback6.addressClass, "loopback");
  }
  const publicLiteral = await decideFetchHop(
    { url: "https://93.184.216.34/spec", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: runtimeResolveHost, policy: UNRESTRICTED },
  );
  assertEquals(publicLiteral.decision, "allow-direct");
});

Deno.test("Native redirect:follow shape is never emitted on any issued hop", async () => {
  const transport = mockTransport((_url, seen) =>
    seen === 0 ? redirectResponse("https://final.example/page") : textResponse("final")
  );
  const chain = await runFetchChain("https://start.example/page", {
    resolveHost: mockDns({ "start.example": ["203.0.113.10"], "final.example": ["203.0.113.11"] }),
    policy: UNRESTRICTED,
    fetchImpl: transport.fetchImpl,
  });
  assertEquals(chain.ok, true);
  assertEquals(transport.requests.length, 2);
  for (const request of transport.requests) {
    assertEquals(request.init?.redirect ?? "manual", "manual");
    assertNotEquals(request.init?.redirect, "follow");
  }
});

Deno.test("Enforcing posture issues every allowed hop against the proxy endpoint", async () => {
  const transport = mockTransport(() => textResponse());
  const chain = await runFetchChain("https://public.example/page", {
    resolveHost: mockDns(),
    policy: ENFORCING,
    fetchImpl: transport.fetchImpl,
  });
  assertEquals(chain.ok, true);
  const init = transport.requests[0]?.init as Record<string, unknown> | undefined;
  assertExists(init);
  assertEquals(init["proxy"], ENFORCING.proxyEndpoint);
});

Deno.test("Public → private Location blocks AT the hop; the private request is never issued", async () => {
  const transport = mockTransport((_url, seen) =>
    seen === 0 ? redirectResponse("https://internal.example/secret") : textResponse("must not run")
  );
  const chain = await runFetchChain("https://public.example/page", {
    resolveHost: mockDns({
      "public.example": ["203.0.113.7"],
      "internal.example": ["10.1.1.1"],
    }),
    policy: ENFORCING,
    fetchImpl: transport.fetchImpl,
  });
  assertEquals(chain.ok, false);
  if (!chain.ok) {
    assertEquals(chain.block.reason, "disallowed-address");
    assertEquals(chain.block.addressClass, "rfc1918");
    assertEquals(chain.block.record.hopIndex, 2);
  }
  // Exactly one request issued (the public hop 1); the private hop never is.
  assertEquals(transport.requests.length, 1);
});

Deno.test("Hop to link-local/ULA/metadata after a public hop blocks at that hop", async () => {
  for (
    const [addr, addressClass] of [["169.254.5.5", "link-local"], ["fd00::9", "unique-local"], [
      "169.254.169.254",
      "cloud-metadata",
    ]] as const
  ) {
    const transport = mockTransport(() => redirectResponse("https://late.example/x"));
    const chain = await runFetchChain("https://public.example/page", {
      resolveHost: mockDns({ "public.example": ["203.0.113.7"], "late.example": [addr] }),
      policy: ENFORCING,
      fetchImpl: transport.fetchImpl,
    });
    assertEquals(chain.ok, false, addr);
    if (!chain.ok) {
      assertEquals(
        chain.block.reason,
        addressClass === "cloud-metadata" ? "cloud-metadata" : "disallowed-address",
      );
      assertEquals(chain.block.addressClass, addressClass);
    }
    assertEquals(transport.requests.length, 1);
  }
});

Deno.test("Secondary URL (markdown/feed alternate) private target blocked like a model URL", async () => {
  const transport = mockTransport(() => textResponse("must never issue"));
  const chain = await runSecondaryFetch(
    "https://markdown-alternate.example/doc.md",
    { hopsFollowed: 2 },
    {
      resolveHost: mockDns({ "markdown-alternate.example": ["192.168.4.4"] }),
      policy: ENFORCING,
      fetchImpl: transport.fetchImpl,
    },
  );
  assertEquals(chain.ok, false);
  if (!chain.ok) {
    assertEquals(chain.block.reason, "disallowed-address");
    assertEquals(chain.block.addressClass, "rfc1918");
  }
  assertEquals(transport.requests.length, 0);
});

Deno.test("Secondary probes share the hop budget — probes never multiply it", async () => {
  const transport = mockTransport(() => textResponse("ok"));
  const deps = {
    resolveHost: mockDns(),
    policy: UNRESTRICTED,
    fetchImpl: transport.fetchImpl,
  };
  const chain = await runSecondaryFetch("https://llms.example/llms.txt", { hopsFollowed: 6 }, deps);
  assertEquals(chain.ok, false);
  if (!chain.ok) assertEquals(chain.block.reason, "hop-limit-exceeded");
  assertEquals(transport.requests.length, 0);
});

// ---------------------------------------------------------------------------
// D6: unrestricted posture allows every public case, no proxy, no extra
// denial beyond the shared rule set.
// ---------------------------------------------------------------------------

Deno.test("D6: unrestricted fixtures allow every public case with no proxy requirement", async () => {
  const publicCases = [
    "https://plain.example/a",
    "https://other.example/b?q=1",
    "https://deep.example/x/y/z.bin",
  ];
  for (const url of publicCases) {
    const transport = mockTransport(() => textResponse("public body"));
    const chain = await runFetchChain(url, {
      resolveHost: mockDns(),
      policy: UNRESTRICTED,
      fetchImpl: transport.fetchImpl,
    });
    assertEquals(chain.ok, true, url);
    const init = transport.requests[0]?.init as Record<string, unknown> | undefined;
    assertExists(init);
    assertEquals("proxy" in init, false, `${url} must route direct`);
  }
  // The ONLY denials remaining are the shared rule set: private/metadata
  // (proved above) and the hop bound — plus DNS failure, which ssrf.ts
  // itself fails closed on.
  const dnsFail = await decideFetchHop(
    { url: "https://nx.example/", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: mockDns({ "nx.example": [] }), policy: UNRESTRICTED },
  );
  assertEquals(dnsFail.decision, "block");
  if (dnsFail.decision === "block") assertEquals(dnsFail.reason, "dns-unresolved");
});

Deno.test("D6: no YOLO-only denial — posture affects routing only", async () => {
  const urls = [
    "https://public.example/a",
    "https://private-lan.example/a",
    "https://meta.example/latest",
  ];
  for (const url of urls) {
    const enforcing = await decideFetchHop(
      { url, hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns(), policy: ENFORCING },
    );
    const unrestricted = await decideFetchHop(
      { url, hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns(), policy: UNRESTRICTED },
    );
    assertEquals(
      enforcing.decision === "block",
      unrestricted.decision === "block",
      `${url}: the same blocks stand under both postures`,
    );
    if (enforcing.decision === "block" && unrestricted.decision === "block") {
      assertEquals(enforcing.reason, unrestricted.reason);
    }
  }
});

Deno.test("HTTP_PROXY presence is non-enforcement: the verdict is env-independent", async () => {
  // With and without HTTP_PROXY in the ambient environment, an IDENTICAL
  // injected policy yields an IDENTICAL decision: the decision core never
  // reads env; only the policy-construction seam does, and HTTP_PROXY
  // presence alone selects routing, never admission.
  const decide = async () =>
    await decideFetchHop(
      { url: "https://public.example/x", hopType: "initial", hopsFollowed: 0 },
      { resolveHost: mockDns(), policy: { posture: "unrestricted" } },
    );
  Deno.env.set("HTTP_PROXY", "http://127.0.0.1:9099");
  try {
    const withProxy = await decide();
    Deno.env.delete("HTTP_PROXY");
    const withoutProxy = await decide();
    assertEquals(withProxy.decision, withoutProxy.decision);
    assertEquals(withProxy.record, withoutProxy.record);
  } finally {
    Deno.env.delete("HTTP_PROXY");
  }
});

Deno.test("Resolver answering with non-address strings fails closed", async () => {
  const decision = await decideFetchHop(
    { url: "https://weird.example/", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: () => Promise.resolve(["not-an-ip.example"]), policy: UNRESTRICTED },
  );
  assertEquals(decision.decision, "block");
  if (decision.decision === "block") assertEquals(decision.reason, "dns-invalid-answer");
});

Deno.test("Unresolved posture blocks every hop with egress-policy-unresolved", async () => {
  const transport = mockTransport(() => textResponse());
  const chain = await runFetchChain("https://public.example/", {
    resolveHost: mockDns(),
    policy: { posture: "unresolved" },
    fetchImpl: transport.fetchImpl,
  });
  assertEquals(chain.ok, false);
  if (!chain.ok) assertEquals(chain.block.reason, "egress-policy-unresolved");
  assertEquals(transport.requests.length, 0);
});

// --- C3 D4: the shared collection rule (resolveHostAnswers) drives the
// adapter seam exactly like the production runtime face — fixture
// node:dns/promises pairs only, no Deno global involved. ------------------

Deno.test("Collection rule at the seam: one family no-record keeps the other's answer", async () => {
  const face = {
    resolve4: () => Promise.resolve(["93.184.216.34"]),
    resolve6: () => Promise.reject(new Error("ENOTFOUND")),
  };
  const decision = await decideFetchHop(
    { url: "https://v4only.example/page", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: (host) => resolveHostAnswers(host, face), policy: UNRESTRICTED },
  );
  // The no-record family never discards the valid family: the hop decides
  // on the surviving public answer, not dns-unresolved.
  assertEquals(decision.decision, "allow-direct");
});

Deno.test("Collection rule at the seam: all-family failure blocks dns-unresolved with zero dispatch", async () => {
  const face = {
    resolve4: () => Promise.reject(new Error("ENOTFOUND")),
    resolve6: () => Promise.reject(new Error("ENOTFOUND")),
  };
  const transport = mockTransport(() => textResponse());
  const chain = await runFetchChain("https://dead.example/", {
    resolveHost: (host) => resolveHostAnswers(host, face),
    policy: UNRESTRICTED,
    fetchImpl: transport.fetchImpl,
  });
  assertEquals(chain.ok, false);
  if (!chain.ok) assertEquals(chain.block.reason, "dns-unresolved");
  // No unvalidated-DNS fallback and no endpoint dispatch on empty answers.
  assertEquals(transport.requests.length, 0);
});

Deno.test("Collection rule at the seam: private answers keep their true class denial", async () => {
  const face = {
    resolve4: () => Promise.resolve(["10.0.0.5"]),
    resolve6: () => Promise.resolve([]),
  };
  const decision = await decideFetchHop(
    { url: "https://private.example/", hopType: "initial", hopsFollowed: 0 },
    { resolveHost: (host) => resolveHostAnswers(host, face), policy: UNRESTRICTED },
  );
  assertEquals(decision.decision, "block");
  if (decision.decision === "block") {
    assertEquals(decision.reason, "disallowed-address");
    assertEquals(decision.addressClass, "rfc1918");
  }
});

// Restore fetch for any later importer (each suite file runs isolated here).
globalThis.fetch = realFetch;
