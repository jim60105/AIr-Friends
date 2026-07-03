// tests/utils/ssrf.test.ts
//
// F6 SSRF-guard tests for validateFetchUrl / safeFetch. Literal IPs are used to avoid
// real DNS, plus a loopback HTTP server exercises the manual-redirect re-validation
// and hop-limit logic.

import { assertEquals, assertRejects } from "@std/assert";
import {
  isDisallowedAddress,
  MAX_REDIRECT_HOPS,
  safeFetch,
  SsrfValidationError,
  validateFetchUrl,
} from "@utils/ssrf.ts";

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
