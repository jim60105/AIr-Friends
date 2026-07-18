import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  configureEgressAllowHosts,
  isEgressTargetAllowed,
  isMetadataAddress,
  startEgressProxy,
} from "@utils/egress-proxy.ts";

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

import {
  resolveAndValidateEgress,
  rewriteForwardHead,
  tunnelConnections,
} from "@utils/egress-proxy.ts";

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

// --- Tunnel teardown: FIN propagation so client pools never reuse a dead tunnel ---

/** Create a connected loopback TCP pair (client side, server side). */
async function tcpPair(): Promise<[Deno.Conn, Deno.Conn]> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const [a, b] = await Promise.all([
    Deno.connect({ hostname: "127.0.0.1", port }),
    listener.accept(),
  ]);
  listener.close();
  return [a, b];
}

Deno.test("tunnelConnections - upstream close propagates EOF to the client promptly", async () => {
  // client <-> proxyClientSide tunneled to proxyUpstreamSide <-> upstreamServer
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const buf = new Uint8Array(64);

  // Bytes flow client -> upstream and upstream -> client through the tunnel.
  await client.write(enc.encode("hello"));
  let n = await upstreamServer.read(buf);
  assertEquals(dec.decode(buf.subarray(0, n ?? 0)), "hello");
  await upstreamServer.write(enc.encode("world"));
  n = await client.read(buf);
  assertEquals(dec.decode(buf.subarray(0, n ?? 0)), "world");

  // Upstream closes (e.g. keep-alive idle timeout). The client MUST observe EOF quickly —
  // before the fix the FIN was never forwarded and this read hung until the pool reused a
  // dead tunnel. Guard with a timer so a regression fails instead of hanging the test.
  upstreamServer.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const eof = await Promise.race([
    client.read(buf),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), 2000);
    }),
  ]);
  clearTimeout(timer);
  assertEquals(eof, null, "client must see EOF once upstream closed");

  client.close();
  await tunnel;
});

Deno.test("tunnelConnections - relays a large payload without dropping bytes", async () => {
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  // 4 MiB of a repeating pattern, larger than the 16 KiB tunnel buffer and the socket
  // buffers, so writes are forced into short (partial) writes under backpressure. If the
  // pipe ignores a short-write return value the received stream is truncated/corrupted.
  const SIZE = 4 * 1024 * 1024;
  const payload = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) payload[i] = i & 0xff;

  const received = new Uint8Array(SIZE);
  const drain = (async () => {
    let off = 0;
    while (off < SIZE) {
      const n = await upstreamServer.read(received.subarray(off));
      if (n === null) break;
      off += n;
    }
    return off;
  })();

  await writeFullConn(client, payload);
  client.closeWrite();
  const total = await drain;

  assertEquals(total, SIZE, "every byte must arrive");
  for (let i = 0; i < SIZE; i++) {
    if (received[i] !== (i & 0xff)) {
      throw new Error(`byte ${i} corrupted: got ${received[i]}, want ${i & 0xff}`);
    }
  }

  upstreamServer.close();
  client.close();
  await tunnel;
});

/** Test-local write-all (mirrors the proxy's own short-write handling). */
async function writeFullConn(conn: Deno.Conn, data: Uint8Array): Promise<void> {
  let off = 0;
  while (off < data.length) {
    off += await conn.write(data.subarray(off));
  }
}

// --- Plain-HTTP forwarding: origin-form rewrite + forced Connection: close ---

Deno.test("rewriteForwardHead - rewrites request line and forces Connection: close", () => {
  const head = "GET http://example.com/a?b=1 HTTP/1.1\r\n" +
    "Host: example.com\r\n" +
    "Connection: keep-alive\r\n" +
    "Proxy-Connection: keep-alive\r\n" +
    "X-Foo: bar\r\n" +
    "\r\n";
  assertEquals(
    rewriteForwardHead(head, "GET", "/a?b=1"),
    "GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\nX-Foo: bar\r\nConnection: close\r\n\r\n",
  );
});

Deno.test("rewriteForwardHead - adds Connection: close when absent and preserves body bytes", () => {
  const head = "POST http://example.com/submit HTTP/1.1\r\n" +
    "Host: example.com\r\n" +
    "Content-Length: 4\r\n" +
    "\r\n" +
    "data";
  assertEquals(
    rewriteForwardHead(head, "POST", "/submit"),
    "POST /submit HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata",
  );
});

// --- Operator-trusted egress allowlist (allow-trusted-egress-hosts) ---

Deno.test("egressAllowHosts - allowlisted private literal is exempt, neighbor stays rejected", async () => {
  configureEgressAllowHosts(["192.168.1.10"]);
  try {
    assertEquals(await isEgressTargetAllowed("192.168.1.10"), true);
    const pinned = await resolveAndValidateEgress("192.168.1.10");
    assertEquals(pinned.allowed, true);
    assertEquals(pinned.address, "192.168.1.10");
    // Exact match, not a range grant: the neighbor address is still rejected.
    assertEquals(await isEgressTargetAllowed("192.168.10.11"), false);
    assertEquals(await isEgressTargetAllowed("10.0.0.1"), false);
  } finally {
    configureEgressAllowHosts([]);
  }
});

Deno.test("egressAllowHosts - metadata addresses stay blocked even when allowlisted", async () => {
  configureEgressAllowHosts(["169.254.169.254", "169.254.170.2"]);
  try {
    assertEquals(await isEgressTargetAllowed("169.254.169.254"), false);
    assertEquals(await isEgressTargetAllowed("169.254.170.2"), false);
  } finally {
    configureEgressAllowHosts([]);
  }
});

Deno.test("egressAllowHosts - IPv6 literal entry matches bracketed request form", async () => {
  // Uppercase entry with brackets exercises trim/lowercase/bracket-strip normalization too.
  configureEgressAllowHosts(["  [FD12:3456::10]  "]);
  try {
    assertEquals(await isEgressTargetAllowed("[fd12:3456::10]"), true);
    assertEquals(await isEgressTargetAllowed("fd12:3456::10"), true);
    // Different ULA address is still rejected.
    assertEquals(await isEgressTargetAllowed("[fd12:3456::11]"), false);
  } finally {
    configureEgressAllowHosts([]);
  }
});

Deno.test("egressAllowHosts - malformed entries (scheme/port/path, empty) never match", async () => {
  configureEgressAllowHosts([
    "http://192.168.1.10:7860",
    "192.168.1.10:7860",
    "192.168.1.10/api",
    "a:b:c", // colon-bearing garbage that is not a valid IPv6 literal
    "",
    "   ",
  ]);
  try {
    assertEquals(await isEgressTargetAllowed("192.168.1.10"), false);
  } finally {
    configureEgressAllowHosts([]);
  }
});

Deno.test("egressAllowHosts - empty allowlist keeps the default-deny posture", async () => {
  configureEgressAllowHosts([]);
  assertEquals(await isEgressTargetAllowed("192.168.1.10"), false);
  assertEquals(await isEgressTargetAllowed("127.0.0.1"), false);
  assertEquals(await isEgressTargetAllowed("8.8.8.8"), true);
});

Deno.test("isMetadataAddress - covers IPv4, IPv4-mapped, and IPv6 metadata forms", () => {
  assertEquals(isMetadataAddress("169.254.169.254"), true);
  assertEquals(isMetadataAddress("169.254.170.2"), true);
  assertEquals(isMetadataAddress("100.100.100.200"), true);
  assertEquals(isMetadataAddress("::ffff:169.254.169.254"), true);
  assertEquals(isMetadataAddress("::ffff:a9fe:a9fe"), true);
  assertEquals(isMetadataAddress("fd00:ec2::254"), true);
  assertEquals(isMetadataAddress("fd00:0ec2:0000:0000:0000:0000:0000:0254"), true);
  assertEquals(isMetadataAddress("8.8.8.8"), false);
  assertEquals(isMetadataAddress("169.254.169.253"), false);
  assertEquals(isMetadataAddress("fd12:3456::10"), false);
});

// --- Full proxy path with an allowlisted loopback upstream (integration) ---

Deno.test("egress proxy - plain-HTTP forward to an allowlisted loopback upstream succeeds", async () => {
  // A minimal loopback HTTP upstream. Allowlisting 127.0.0.1 is the only way to exercise
  // the full proxy path against a real listener in tests.
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const upstreamPort = (upstream.addr as Deno.NetAddr).port;
  const serve = (async () => {
    const conn = await upstream.accept();
    const buf = new Uint8Array(4096);
    await conn.read(buf);
    await conn.write(
      new TextEncoder().encode(
        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
      ),
    );
    conn.close();
  })();

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = startEgressProxy(0);
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: proxy.port });
    await conn.write(
      new TextEncoder().encode(
        `GET http://127.0.0.1:${upstreamPort}/health HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\n\r\n`,
      ),
    );
    let response = "";
    const buf = new Uint8Array(1024);
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      response += new TextDecoder().decode(buf.subarray(0, n));
      if (response.includes("ok")) break;
    }
    assertStringIncludes(response, "200 OK");
    assertStringIncludes(response, "ok");
    conn.close();
  } finally {
    proxy.close();
    upstream.close();
    configureEgressAllowHosts([]);
    await serve;
  }
});

Deno.test("egress proxy - CONNECT to an allowlisted loopback upstream establishes a tunnel", async () => {
  // Echo upstream: whatever arrives through the tunnel is sent back.
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const upstreamPort = (upstream.addr as Deno.NetAddr).port;
  const serve = (async () => {
    const conn = await upstream.accept();
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    if (n !== null) await conn.write(buf.subarray(0, n));
    conn.close();
  })();

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = startEgressProxy(0);
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: proxy.port });
    await conn.write(
      new TextEncoder().encode(
        `CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\n\r\n`,
      ),
    );
    const buf = new Uint8Array(256);
    let n = await conn.read(buf);
    const established = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    assertStringIncludes(established, "200 Connection Established");
    await conn.write(new TextEncoder().encode("ping"));
    n = await conn.read(buf);
    assertEquals(new TextDecoder().decode(buf.subarray(0, n ?? 0)), "ping");
    conn.close();
  } finally {
    proxy.close();
    upstream.close();
    configureEgressAllowHosts([]);
    await serve;
  }
});
