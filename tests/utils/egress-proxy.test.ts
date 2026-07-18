import { assertEquals, assertStringIncludes } from "@std/assert";
import { isEgressTargetAllowed, startEgressProxy } from "@utils/egress-proxy.ts";

Deno.test("isEgressTargetAllowed - rejects loopback/private/link-local/metadata literals", async () => {
  assertEquals(await isEgressTargetAllowed("127.0.0.1"), false);
  assertEquals(await isEgressTargetAllowed("169.254.169.254"), false); // cloud metadata
  assertEquals(await isEgressTargetAllowed("10.0.0.1"), false); // RFC1918
  assertEquals(await isEgressTargetAllowed("192.168.1.1"), false);
  assertEquals(await isEgressTargetAllowed("172.16.5.4"), false);
  assertEquals(await isEgressTargetAllowed("0.0.0.0"), false);
  assertEquals(await isEgressTargetAllowed("::1"), false);
  assertEquals(await isEgressTargetAllowed("[::1]"), false);
});

Deno.test("isEgressTargetAllowed - allows public IP literals", async () => {
  assertEquals(await isEgressTargetAllowed("8.8.8.8"), true);
  assertEquals(await isEgressTargetAllowed("1.1.1.1"), true);
});

Deno.test("egress proxy - refuses CONNECT to a loopback target with 403", async () => {
  const proxy = startEgressProxy(0);
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: proxy.port });
    await conn.write(
      new TextEncoder().encode("CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n"),
    );
    const buf = new Uint8Array(256);
    const n = await conn.read(buf);
    const response = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    assertStringIncludes(response, "403");
    conn.close();
  } finally {
    proxy.close();
  }
});

Deno.test("egress proxy - refuses plain-HTTP request to a metadata endpoint with 403", async () => {
  const proxy = startEgressProxy(0);
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: proxy.port });
    await conn.write(
      new TextEncoder().encode(
        "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
      ),
    );
    const buf = new Uint8Array(256);
    const n = await conn.read(buf);
    const response = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    assertStringIncludes(response, "403");
    conn.close();
  } finally {
    proxy.close();
  }
});

// --- F14 #4: DNS-rebinding — the proxy pins to the validated resolved address ---

import { resolveAndValidateEgress } from "@utils/egress-proxy.ts";

Deno.test("resolveAndValidateEgress - returns a pinned address for public literals, rejects internal", async () => {
  const pub = await resolveAndValidateEgress("8.8.8.8");
  assertEquals(pub.allowed, true);
  assertEquals(pub.address, "8.8.8.8"); // literal IP is pinned as-is
  const loop = await resolveAndValidateEgress("127.0.0.1");
  assertEquals(loop.allowed, false);
  assertEquals(loop.address, undefined);
  const meta = await resolveAndValidateEgress("169.254.169.254");
  assertEquals(meta.allowed, false);
});
