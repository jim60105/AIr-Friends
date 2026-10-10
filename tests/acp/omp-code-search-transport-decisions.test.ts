/**
 * Mock-only decision tests for the public-code-search transport adapter
 * (row 21, `adapt-omp-public-code-search`, tasks 5.1).
 *
 * Mocked endpoint transport + mocked DNS + synthetic redirect chains;
 * NOTHING contacts the network (globalThis.fetch is replaced by a throwing
 * stub for the whole file; every host resolution goes through the mocked
 * resolver). These suites certify ADAPTER DECISIONS ONLY: they can never
 * clear the P0 transport-bypass record, the D4 premise-false finding, or
 * prove the native binary invokes the reserved mechanism (design §15,
 * user-owned).
 */

import { assert, assertEquals } from "@std/assert";
import {
  type FetchEgressPolicy,
  type FetchTransportFn,
  MAX_REDIRECT_HOPS,
} from "@acp/omp/fetch-transport.ts";
import {
  buildCodeSearchRequest,
  CODE_SEARCH_ENDPOINT,
  type CodeSearchCredentialPresence,
  type CodeSearchDecisionRecord,
  decideCodeSearchRoute,
  runCodeSearchRoute,
} from "@acp/omp/code-search-transport.ts";

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

/** SYNTHETIC P0 fixture: the future row-7-registered dedicated read-only
 *  code-search credential PRESENT (presence boolean only — injected directly,
 *  never via an env name; no such name exists today, design D2). */
const TOKEN_PRESENT: CodeSearchCredentialPresence = { dedicatedCodeSearchToken: true };
const TOKEN_ABSENT: CodeSearchCredentialPresence = { dedicatedCodeSearchToken: false };

/** Mocked DNS: hostname → answers; unknown hosts resolve to TEST-NET-3. */
function mockDns(table: Record<string, string[]> = {}) {
  const full: Record<string, string[]> = {
    "api.github.com": ["140.82.112.6"],
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
  readonly issued: Array<{ url: string; init?: RequestInit }>;
}

function mockTransport(responder: (url: string, seen: number) => Response): MockTransport {
  const issued: Array<{ url: string; init?: RequestInit }> = [];
  return {
    issued,
    fetchImpl: (url, init) => {
      issued.push({ url, init });
      return Promise.resolve(responder(url, issued.length - 1));
    },
  };
}

function decisionDeps(
  presence: CodeSearchCredentialPresence,
  posture: FetchEgressPolicy,
  dns: Record<string, string[]> = {},
) {
  return { resolveHost: mockDns(dns), credentialPresence: presence, posture };
}

const SEARCH_URL = CODE_SEARCH_ENDPOINT + "?q=hello+world";

// ---------------------------------------------------------------------------
// Credential scope (D2): fail-closed before any transport, always.
// ---------------------------------------------------------------------------

Deno.test("Credential absent: blocked pending-adapter with userDecisionRequired and ZERO transport", async () => {
  const records: CodeSearchDecisionRecord[] = [];
  const t = mockTransport(() => new Response("never", { status: 200 }));
  const decision = await decideCodeSearchRoute(
    { url: SEARCH_URL, hopKind: "search-endpoint", hopsFollowed: 0 },
    decisionDeps(TOKEN_ABSENT, ENFORCING),
  );
  assertEquals(decision.decision, "block");
  if (decision.decision === "block") {
    assertEquals("userDecisionRequired" in decision && decision.userDecisionRequired, true);
    assertEquals(decision.reason, "no-supported-credential");
    records.push(decision.record);
  }
  // The credential-scope record is pre-transport: no host, hop 0, fixed reason.
  assertEquals(records[0], { hopIndex: 0, decision: "block", reason: "no-supported-credential" });
  assertEquals("host" in records[0]!, false);
  assertEquals(t.issued.length, 0);
});

Deno.test("Executor with absent credential: fail-closed block, no mocked transport call", async () => {
  const t = mockTransport(() => new Response("never", { status: 200 }));
  const records: CodeSearchDecisionRecord[] = [];
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "hello world", limit: 10 }, "SECRET-VALUE-1"),
    {
      ...decisionDeps(TOKEN_ABSENT, UNRESTRICTED),
      fetchImpl: t.fetchImpl,
      recordSink: (r) => records.push(r),
      credential: "SECRET-VALUE-1",
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok && result.failure.kind === "blocked") {
    assertEquals(
      JSON.stringify(result.failure.record),
      '{"hopIndex":0,"decision":"block","reason":"no-supported-credential"}',
    );
  }
  assertEquals(t.issued.length, 0);
});

Deno.test("Unrelated-subsystem credential never satisfies the predicate (D2)", async () => {
  // SYNTHETIC P0 fixture: an environment whose ONLY credential is registered
  // for another subsystem (git backup) — presence stays false because the
  // predicate is registered-purpose-scoped, and the decision still blocks.
  // The decision core reads no env at all: the injected presence is the only
  // input, so a GITHUB_TOKEN-only environment maps to `false` here.
  const decision = await decideCodeSearchRoute(
    { url: SEARCH_URL, hopKind: "search-endpoint", hopsFollowed: 0 },
    decisionDeps(TOKEN_ABSENT, ENFORCING),
  );
  assertEquals(decision.decision, "block");
  // Source-level pin: the transport module contains no NEVER_PASS name and
  // no process.env read (the list lives test-side; design D2).
  const source = await Deno.readTextFile(
    new URL("../../src/acp/omp/code-search-transport.ts", import.meta.url),
  );
  for (
    const forbidden of [
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "COPILOT_GITHUB_TOKEN",
      "GIT_BACKUP_AUTH_PASSWORD",
      "process.env",
    ]
  ) {
    // Doc comments MAY name the refusal; executable lines never may. The
    // honest pin: every occurrence lives on a comment line only.
    const offending = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .filter((line) => line.includes(forbidden));
    assertEquals(offending.length, 0, `${forbidden}: ${offending.join(" | ")}`);
  }
});

Deno.test("Credential present (synthetic): the hop delegates to row 17's decision", async () => {
  const decision = await decideCodeSearchRoute(
    { url: SEARCH_URL, hopKind: "search-endpoint", hopsFollowed: 0 },
    decisionDeps(TOKEN_PRESENT, UNRESTRICTED),
  );
  assertEquals(decision.decision, "allow-direct");
});

// ---------------------------------------------------------------------------
// Both postures (row 17 verbatim): public endpoint allowed.
// ---------------------------------------------------------------------------

Deno.test("Public search endpoint allowed under both postures; enforcing names the proxy route", async () => {
  const unrestricted = await decideCodeSearchRoute(
    { url: SEARCH_URL, hopKind: "search-endpoint", hopsFollowed: 0 },
    decisionDeps(TOKEN_PRESENT, UNRESTRICTED),
  );
  assertEquals(unrestricted.decision, "allow-direct");
  const enforcing = await decideCodeSearchRoute(
    { url: SEARCH_URL, hopKind: "search-endpoint", hopsFollowed: 0 },
    decisionDeps(TOKEN_PRESENT, ENFORCING),
  );
  assertEquals(enforcing.decision, "allow-via-proxy");
  if (enforcing.decision === "allow-via-proxy") {
    assertEquals(enforcing.proxyEndpoint, "http://127.0.0.1:9099");
  }
});

// ---------------------------------------------------------------------------
// Private-target blocks (endpoint AND enrichment), class named, zero issued.
// ---------------------------------------------------------------------------

const PRIVATE_TARGETS: Array<[string, string, string]> = [
  ["loopback", "https://127.0.0.1/search", "loopback"],
  ["rfc1918-a", "https://10.1.2.3/search", "rfc1918"],
  ["rfc1918-b", "https://172.16.9.9/search", "rfc1918"],
  ["rfc1918-c", "https://192.168.1.1/search", "rfc1918"],
  ["link-local", "https://169.254.1.1/search", "link-local"],
  ["unspecified", "https://0.0.0.0/search", "unspecified"],
  ["multicast", "https://224.0.0.1/search", "multicast"],
  ["unique-local", "https://[fd00::1234]/search", "unique-local"],
  ["metadata-v4", "https://169.254.169.254/search", "cloud-metadata"],
  ["metadata-v6", "https://[fd00:ec2::254]/search", "cloud-metadata"],
  ["metadata-name", "https://metadata.google.internal/search", "cloud-metadata"],
];

for (const [label, url, expectedClass] of PRIVATE_TARGETS) {
  Deno.test(`Private endpoint target blocked with class named (${label})`, async () => {
    const decision = await decideCodeSearchRoute(
      { url, hopKind: "search-endpoint", hopsFollowed: 0 },
      decisionDeps(TOKEN_PRESENT, ENFORCING),
    );
    assertEquals(decision.decision, "block", label);
    if (decision.decision === "block") {
      const reason = decision.reason;
      assert(reason === "disallowed-address" || reason === "cloud-metadata", label);
      assertEquals(decision.addressClass, expectedClass, label);
      assertEquals(decision.record.host.length > 0, true, label);
    }
  });

  Deno.test(`Enrichment target blocked with class named (${label})`, async () => {
    const decision = await decideCodeSearchRoute(
      { url, hopKind: "enrichment", hopsFollowed: 0 },
      decisionDeps(TOKEN_PRESENT, ENFORCING),
    );
    assertEquals(decision.decision, "block", label);
    if (decision.decision === "block") {
      const reason = decision.reason;
      assert(reason === "disallowed-address" || reason === "cloud-metadata", label);
      assertEquals(decision.addressClass, expectedClass, label);
    }
  });
}

Deno.test("Private-target executor issues zero requests", async () => {
  const t = mockTransport(() => new Response("never", { status: 200 }));
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "SECRET-VALUE-2"),
    {
      ...decisionDeps(TOKEN_PRESENT, ENFORCING, { "api.github.com": ["10.0.0.5"] }),
      fetchImpl: t.fetchImpl,
      credential: "SECRET-VALUE-2",
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok && result.failure.kind === "blocked") {
    assertEquals(result.failure.record.decision, "block");
  }
  assertEquals(t.issued.length, 0);
});

// ---------------------------------------------------------------------------
// Manual redirect revalidation (row-17 semantics through the executor).
// ---------------------------------------------------------------------------

Deno.test("Redirect Location into private space blocks at the hop (never issued)", async () => {
  const t = mockTransport((_url, seen) =>
    seen === 0
      ? new Response(null, {
        status: 302,
        headers: { location: "https://10.9.9.9/redirected" },
      })
      : new Response("must-never-run", { status: 200 })
  );
  const records: CodeSearchDecisionRecord[] = [];
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "SECRET-VALUE-3"),
    {
      ...decisionDeps(TOKEN_PRESENT, UNRESTRICTED),
      fetchImpl: t.fetchImpl,
      recordSink: (r) => records.push(r),
      credential: "SECRET-VALUE-3",
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok && result.failure.kind === "blocked") {
    const record = result.failure.record;
    assert("host" in record);
    assertEquals(record.reason, "disallowed-address");
    assertEquals(record.addressClass, "rfc1918");
    assertEquals(record.hopIndex, 2);
  }
  // Only the initial hop was issued; the private Location never was.
  assertEquals(t.issued.length, 1);
  assertEquals(records.length, 2);
});

Deno.test("Six-hop redirect chain blocks with the hop-limit reason after <=5 followed hops", async () => {
  let n = 0;
  const t = mockTransport(() => {
    n += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `https://r${n}.example.com/next` },
    });
  });
  const records: CodeSearchDecisionRecord[] = [];
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "SECRET-VALUE-4"),
    {
      ...decisionDeps(TOKEN_PRESENT, UNRESTRICTED),
      fetchImpl: t.fetchImpl,
      recordSink: (r) => records.push(r),
      credential: "SECRET-VALUE-4",
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok && result.failure.kind === "blocked") {
    assertEquals(result.failure.record.reason, "hop-limit-exceeded");
  }
  // initial + at most MAX_REDIRECT_HOPS followed-hop issues, never more.
  assertEquals(t.issued.length <= MAX_REDIRECT_HOPS + 1, true);
  assertEquals(t.issued.length >= 2, true);
});

Deno.test("No unguarded retry: every issued attempt carries a prior decision record", async () => {
  const t = mockTransport((_url, seen) =>
    seen < 3
      ? new Response(null, { status: 302, headers: { location: `https://h${seen}.example.com/x` } })
      : new Response('{"total_count":0,"items":[]}', { status: 200 })
  );
  const records: CodeSearchDecisionRecord[] = [];
  await runCodeSearchRoute(buildCodeSearchRequest({ query: "q" }, "SECRET-VALUE-5"), {
    ...decisionDeps(TOKEN_PRESENT, ENFORCING),
    fetchImpl: t.fetchImpl,
    recordSink: (r) => records.push(r),
    credential: "SECRET-VALUE-5",
  });
  // One decision per issue (redirect hops decided BEFORE each issue).
  const hopDecisions = records.filter((r) => "host" in r);
  assertEquals(hopDecisions.length, t.issued.length);
  for (const init of t.issued.map((i) => i.init)) {
    assertEquals(init?.redirect, "manual");
  }
  // Enforcing posture: every issued attempt routes through the proxy.
  for (const init of t.issued.map((i) => i.init)) {
    assertEquals((init as RequestInit & { proxy?: string })?.proxy, "http://127.0.0.1:9099");
  }
});

Deno.test("Cross-origin redirect strips the credential header (single controlled attempt path)", async () => {
  const t = mockTransport((_url, seen) =>
    seen === 0
      ? new Response(null, { status: 302, headers: { location: "https://mirror.example.com/x" } })
      : new Response('{"total_count":0,"items":[]}', { status: 200 })
  );
  const result = await runCodeSearchRoute(
    buildCodeSearchRequest({ query: "q" }, "SECRET-VALUE-6"),
    {
      ...decisionDeps(TOKEN_PRESENT, UNRESTRICTED),
      fetchImpl: t.fetchImpl,
      credential: "SECRET-VALUE-6",
    },
  );
  assertEquals(result.ok, true);
  const second = t.issued[1];
  const headers = second?.init?.headers as Headers | undefined;
  assertEquals(headers?.get("authorization"), null);
  const first = t.issued[0]?.init?.headers as Headers | undefined;
  assertEquals(first?.get("authorization"), "Bearer SECRET-VALUE-6");
});

// Restore fetch for any later importer (each suite file runs isolated here).
globalThis.fetch = realFetch;
