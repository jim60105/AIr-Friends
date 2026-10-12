// tests/utils/ssrf.test.ts
//
// F6 SSRF-guard tests for validateFetchUrl / safeFetch. Literal IPs are used to avoid
// real DNS, plus a loopback HTTP server exercises the manual-redirect re-validation
// and hop-limit logic.

import { assertEquals, assertRejects } from "@std/assert";
import {
  isDisallowedAddress,
  MAX_REDIRECT_HOPS,
  resolveHostAnswers,
  safeFetch,
  SsrfValidationError,
  validateFetchUrl,
} from "@utils/ssrf.ts";

// --- C3 D4: the shared A/AAAA collection rule over an injectable
// node:dns/promises face (fixture DNS only — zero resolver contact). -------

type DnsFace = {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
};

function fixtureDns(v4: string[] | Error, v6: string[] | Error): DnsFace {
  // Test seam: one fixture face for the injectable node:dns/promises pair.
  const side = (value: string[] | Error): () => Promise<string[]> => () =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  return { resolve4: side(v4), resolve6: side(v6) };
}

const ENOTFOUND = new Error("ENOTFOUND public.example");

Deno.test("resolveHostAnswers - dual-stack keeps both families", async () => {
  const answers = await resolveHostAnswers(
    "public.example",
    fixtureDns(["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1942"]),
  );
  assertEquals(answers, ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1942"]);
});

Deno.test("resolveHostAnswers - one family no-record never discards the other", async () => {
  // A exists, AAAA has no records: the v4 answer survives (and vice versa).
  const onlyV4 = await resolveHostAnswers(
    "v4only.example",
    fixtureDns(["93.184.216.34"], ENOTFOUND),
  );
  assertEquals(onlyV4, ["93.184.216.34"]);
  const onlyV6 = await resolveHostAnswers("v6only.example", fixtureDns(ENOTFOUND, ["2606::1"]));
  assertEquals(onlyV6, ["2606::1"]);
  // An empty (not failed) family response likewise adds nothing.
  const emptyV6 = await resolveHostAnswers("mixed.example", fixtureDns(["203.0.113.7"], []));
  assertEquals(emptyV6, ["203.0.113.7"]);
});

Deno.test("resolveHostAnswers - all-family failure yields the empty set (fail closed)", async () => {
  const answers = await resolveHostAnswers("dead.example", fixtureDns(ENOTFOUND, ENOTFOUND));
  // The rule itself fabricates nothing: empty means "nothing resolved" and
  // each consumer's fail-closed rule (validateFetchUrl throws
  // SsrfValidationError; the transports block dns-unresolved) fires on it.
  assertEquals(answers, []);
});

Deno.test("resolveHostAnswers - records normalize and deduplicate", async () => {
  const answers = await resolveHostAnswers(
    "dup.example",
    fixtureDns(["203.0.113.9", "203.0.113.9"], ["[2606::9%eth0]", "2606::9"]),
  );
  // Bracketed/zone-id'd answers normalize to the bare address; duplicates
  // across and within families collapse.
  assertEquals(answers, ["203.0.113.9", "2606::9"]);
});

Deno.test("resolveHostAnswers - collected answers reach the single classifier unchanged", async () => {
  // Private/loopback answers are NOT filtered here — the SAME
  // isDisallowedAddress classifies them at every consumer (this function
  // adds no policy of its own).
  const answers = await resolveHostAnswers(
    "private.example",
    fixtureDns(["10.0.0.5", "169.254.169.254"], []),
  );
  assertEquals(answers.length, 2);
  assertEquals(answers.map((a) => isDisallowedAddress(a)), [true, true]);
});

Deno.test("validateFetchUrl - rejects loopback literal", async () => {
  await assertRejects(() => validateFetchUrl("http://127.0.0.1/x"), SsrfValidationError);
});

Deno.test("validateFetchUrl - rejects link-local metadata IP", async () => {
  await assertRejects(
    () => validateFetchUrl("http://169.254.169.254/latest/meta-data"),
    SsrfValidationError,
  );
});

Deno.test("validateFetchUrl - rejects private RFC1918 literals", async () => {
  await assertRejects(() => validateFetchUrl("http://10.0.0.5/"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("http://172.16.3.4/"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("http://192.168.1.1/"), SsrfValidationError);
});

Deno.test("validateFetchUrl - rejects IPv6 loopback and link-local", async () => {
  await assertRejects(() => validateFetchUrl("http://[::1]/"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("http://[fe80::1]/"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("http://[fc00::1]/"), SsrfValidationError);
});

Deno.test("validateFetchUrl - rejects IPv4-mapped loopback", async () => {
  await assertRejects(() => validateFetchUrl("http://[::ffff:127.0.0.1]/"), SsrfValidationError);
});

Deno.test("validateFetchUrl - rejects non-http scheme", async () => {
  await assertRejects(() => validateFetchUrl("file:///etc/passwd"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("gopher://example.com/"), SsrfValidationError);
});

Deno.test("validateFetchUrl - rejects unspecified and multicast", async () => {
  await assertRejects(() => validateFetchUrl("http://0.0.0.0/"), SsrfValidationError);
  await assertRejects(() => validateFetchUrl("http://224.0.0.1/"), SsrfValidationError);
});

Deno.test("validateFetchUrl - accepts a public IPv4 literal", async () => {
  const parsed = await validateFetchUrl("https://8.8.8.8/x");
  assertEquals(parsed.hostname, "8.8.8.8");
});

Deno.test("isDisallowedAddress - classifies literals", () => {
  assertEquals(isDisallowedAddress("127.0.0.1"), true);
  assertEquals(isDisallowedAddress("169.254.169.254"), true);
  assertEquals(isDisallowedAddress("10.1.2.3"), true);
  assertEquals(isDisallowedAddress("::1"), true);
  assertEquals(isDisallowedAddress("8.8.8.8"), false);
  assertEquals(isDisallowedAddress("1.1.1.1"), false);
});

Deno.test("safeFetch - rejects an internal initial URL at the sink", async () => {
  // The sink validates before every request; a loopback initial URL is rejected at hop 0.
  await assertRejects(
    () => safeFetch("http://127.0.0.1:9/"),
    SsrfValidationError,
  );
});

// --- Hermetic redirect / hop-limit tests via loopback servers ---
//
// The production validator rejects loopback, so these tests inject a custom `validate`
// that enforces the REAL SsrfValidationError rules (via validateFetchUrl) EXCEPT it
// permits the specific loopback test-server origin. This exercises the redirect-follow
// and hop-limit machinery hermetically while still proving internal redirect targets
// are rejected by the shared guard.

function allowOnlyOrigin(allowedOrigin: string) {
  return async (u: string): Promise<void> => {
    const parsed = new URL(u);
    if (parsed.origin === allowedOrigin) return; // permit the test server itself
    // Everything else goes through the real guard (which rejects internal targets).
    await validateFetchUrl(u);
  };
}

Deno.test("safeFetch - follows a redirect to a public target then validates it", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/redirect-internal") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("ok", { status: 200 });
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  const origin = `http://127.0.0.1:${port}`;
  try {
    // A redirect whose Location is an internal metadata IP is rejected by the shared guard.
    await assertRejects(
      () =>
        safeFetch(`${origin}/redirect-internal`, undefined, {
          validate: allowOnlyOrigin(origin),
        }),
      SsrfValidationError,
    );

    // A non-redirect response on the permitted origin succeeds.
    const ok = await safeFetch(`${origin}/plain`, undefined, {
      validate: allowOnlyOrigin(origin),
    });
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("safeFetch - aborts after exceeding MAX_REDIRECT_HOPS", async () => {
  const ac = new AbortController();
  // Server that always redirects to itself, forming an infinite loop.
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      return new Response(null, {
        status: 302,
        headers: { location: `${url.origin}/loop` },
      });
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  const origin = `http://127.0.0.1:${port}`;
  try {
    await assertRejects(
      () => safeFetch(`${origin}/loop`, undefined, { validate: allowOnlyOrigin(origin) }),
      SsrfValidationError,
      "redirect hops",
    );
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("MAX_REDIRECT_HOPS - documented bound is 5", () => {
  assertEquals(MAX_REDIRECT_HOPS, 5);
});

// --- F14 D3: DNS-rebinding mitigation via connect-time IP pinning ---

import { pinValidatedUrl } from "@utils/ssrf.ts";

Deno.test("pinValidatedUrl - pins http hostname to the validated IP with Host preserved", () => {
  const { requestUrl, hostHeader } = pinValidatedUrl("http://example.test/path?q=1", [
    "93.184.216.34",
  ]);
  assertEquals(requestUrl, "http://93.184.216.34/path?q=1");
  assertEquals(hostHeader, "example.test");
});

Deno.test("pinValidatedUrl - leaves https hostnames unchanged (TLS SNI limitation)", () => {
  const { requestUrl, hostHeader } = pinValidatedUrl("https://example.test/x", [
    "93.184.216.34",
  ]);
  assertEquals(requestUrl, "https://example.test/x");
  assertEquals(hostHeader, undefined);
});

Deno.test("pinValidatedUrl - leaves literal-IP hosts unchanged", () => {
  const { requestUrl } = pinValidatedUrl("http://93.184.216.34/x", ["93.184.216.34"]);
  assertEquals(requestUrl, "http://93.184.216.34/x");
});

Deno.test("safeFetch - connects to the validated address, not a re-resolution (D3)", async () => {
  const contacted: string[] = [];
  // First (and only) resolution yields a public address; a second resolution WOULD yield
  // loopback, but safeFetch must never re-resolve — it connects to the pinned address.
  let resolveCount = 0;
  const resolve = (_host: string): Promise<string[]> => {
    resolveCount++;
    return Promise.resolve(resolveCount === 1 ? ["93.184.216.34"] : ["127.0.0.1"]);
  };
  const fetchImpl = (url: string): Promise<Response> => {
    contacted.push(new URL(url).hostname);
    return Promise.resolve(new Response("ok", { status: 200 }));
  };
  const resp = await safeFetch("http://example.test/x", undefined, { resolve, fetchImpl });
  assertEquals(resp.status, 200);
  // The connection targeted the validated public IP, never the rebound loopback.
  assertEquals(contacted, ["93.184.216.34"]);
});

Deno.test("safeFetch - rejects when the resolved address is internal", async () => {
  const resolve = (_host: string): Promise<string[]> => Promise.resolve(["127.0.0.1"]);
  const fetchImpl = (): Promise<Response> => Promise.resolve(new Response("ok"));
  await assertRejects(
    () => safeFetch("http://rebind.test/x", undefined, { resolve, fetchImpl }),
    SsrfValidationError,
  );
});
