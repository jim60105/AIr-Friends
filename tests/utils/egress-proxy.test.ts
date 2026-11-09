// tests/utils/egress-proxy.test.ts
//
// F14 egress-proxy suite: SSRF range validation, DNS pinning, allowlist semantics, tunnel
// lifecycle and the plain-HTTP rewrite. Every upstream listens on loopback, and hostname
// lookups go through the fake DNS server in `tests/helpers/fake-dns.ts`.

import { afterEach, expect, test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { createHash, type Hash } from "node:crypto";
import * as net from "node:net";
import {
  configureEgressAllowHosts,
  type EgressProxyHandle,
  isEgressTargetAllowed,
  isMetadataAddress,
  resolveAndValidateEgress,
  rewriteForwardHead,
  setEgressResolver,
  startEgressProxy,
  stopEgressProxy,
  tunnelConnections,
} from "@utils/egress-proxy.ts";
import { type FakeDns, startFakeDns } from "../helpers/fake-dns.ts";

const MIB = 1024 * 1024;
const TRANSFER_BYTES = 32 * MIB;
const CHUNK_BYTES = 64 * 1024;
const CANNED_RESPONSE = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";

const proxies: EgressProxyHandle[] = [];
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];
const dnsServers: FakeDns[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  for (const proxy of proxies.splice(0)) proxy.close();
  for (const dns of dnsServers.splice(0)) dns.stop();
  configureEgressAllowHosts([]);
  setEgressResolver(undefined);
  await stopEgressProxy();
});

function track(socket: net.Socket): net.Socket {
  sockets.push(socket);
  return socket;
}

/** Starts an allow-half-open TCP listener on `host` and resolves with its bound port. */
function startServer(
  host: string,
  handler: (socket: net.Socket) => void,
  port = 0,
): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => {});
    track(socket);
    handler(socket);
  });
  servers.push(server);
  const { promise, resolve, reject } = Promise.withResolvers<
    { server: net.Server; port: number }
  >();
  const onError = (err: Error) => {
    server.off("error", onError);
    reject(err);
  };
  server.once("error", onError);
  server.listen(port, host, () => {
    server.off("error", onError);
    resolve({ server, port: (server.address() as net.AddressInfo).port });
  });
  return promise;
}

function connectTo(port: number, host = "127.0.0.1"): Promise<net.Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
  const socket = track(net.connect({ host, port, allowHalfOpen: true }));
  const onConnect = () => {
    cleanup();
    resolve(socket);
  };
  const onError = (err: Error) => {
    cleanup();
    reject(err);
  };
  function cleanup() {
    socket.off("connect", onConnect);
    socket.off("error", onError);
  }
  socket.once("connect", onConnect);
  socket.once("error", onError);
  return promise;
}

/** Writes all bytes, waiting for `drain` while the socket buffers. */
function writeAll(socket: net.Socket, data: string | Uint8Array): Promise<void> {
  if (socket.destroyed) return Promise.reject(new Error("socket destroyed"));
  const bytes = typeof data === "string" ? Buffer.from(data, "latin1") : data;
  if (socket.write(bytes)) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onDrain = () => {
    cleanup();
    resolve();
  };
  const onError = (err: Error) => {
    cleanup();
    reject(err);
  };
  const onClose = () => {
    cleanup();
    resolve();
  };
  function cleanup() {
    socket.off("drain", onDrain);
    socket.off("error", onError);
    socket.off("close", onClose);
  }
  socket.once("drain", onDrain);
  socket.once("error", onError);
  socket.once("close", onClose);
  return promise;
}

/** Reads until `predicate` holds or the socket ends; resolves with everything decoded. */
function readUntil(socket: net.Socket, predicate: (text: string) => boolean): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const decoder = new TextDecoder();
  let text = "";
  const finish = () => {
    cleanup();
    resolve(text);
  };
  const onData = (chunk: Buffer) => {
    text += decoder.decode(chunk, { stream: true });
    if (predicate(text)) finish();
  };
  const onEnd = () => finish();
  const onClose = () => finish();
  const onError = (err: Error) => {
    cleanup();
    reject(err);
  };
  function cleanup() {
    socket.off("data", onData);
    socket.off("end", onEnd);
    socket.off("close", onClose);
    socket.off("error", onError);
  }
  socket.on("data", onData);
  socket.once("end", onEnd);
  socket.once("close", onClose);
  socket.once("error", onError);
  return promise;
}

/** Hashes everything a socket receives until it ends. */
function drainHash(
  socket: net.Socket,
  options: { pauseAfterFirstMs?: number } = {},
): Promise<{ bytes: number; sha256: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ bytes: number; sha256: string }>();
  const hash: Hash = createHash("sha256");
  let bytes = 0;
  let paused = false;
  const finish = () => {
    cleanup();
    resolve({ bytes, sha256: hash.digest("hex") });
  };
  const onData = (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
    if (options.pauseAfterFirstMs !== undefined && !paused) {
      paused = true;
      socket.pause();
      setTimeout(() => socket.resume(), options.pauseAfterFirstMs);
    }
  };
  const onEnd = () => finish();
  const onClose = () => finish();
  const onError = (err: Error) => {
    cleanup();
    reject(err);
  };
  function cleanup() {
    socket.off("data", onData);
    socket.off("end", onEnd);
    socket.off("close", onClose);
    socket.off("error", onError);
  }
  socket.on("data", onData);
  socket.once("end", onEnd);
  socket.once("close", onClose);
  socket.once("error", onError);
  return promise;
}

/** Fails the test instead of hanging when an operation exceeds its budget. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: guard, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** A connected loopback TCP pair, both sides half-open capable. */
async function tcpPair(): Promise<[net.Socket, net.Socket]> {
  const accepted = Promise.withResolvers<net.Socket>();
  const { server, port } = await startServer("127.0.0.1", (socket) => accepted.resolve(socket));
  const client = await connectTo(port);
  const serverSide = await accepted.promise;
  server.close();
  return [client, serverSide];
}

async function startProxy(): Promise<EgressProxyHandle> {
  const proxy = await startEgressProxy(0);
  proxies.push(proxy);
  return proxy;
}

/** Sends one raw request through the proxy and reads until the proxy closes the socket. */
async function roundTrip(proxy: EgressProxyHandle, request: string): Promise<string> {
  const socket = await connectTo(proxy.port);
  const response = readUntil(socket, () => false);
  await writeAll(socket, request);
  return response;
}

/** A deterministic `TRANSFER_BYTES` payload and the SHA-256 of what is sent. */
function payload(seed: number): { chunks: Buffer[]; sha256: string } {
  const block = Buffer.alloc(CHUNK_BYTES);
  for (let i = 0; i < CHUNK_BYTES; i++) block[i] = (i + seed) & 0xff;
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  for (let sent = 0; sent < TRANSFER_BYTES; sent += CHUNK_BYTES) {
    chunks.push(block);
    hash.update(block);
  }
  return { chunks, sha256: hash.digest("hex") };
}

test("isEgressTargetAllowed - rejects loopback/private/link-local/metadata literals", async () => {
  assertEquals(await isEgressTargetAllowed("127.0.0.1"), false);
  assertEquals(await isEgressTargetAllowed("169.254.169.254"), false); // cloud metadata
  assertEquals(await isEgressTargetAllowed("10.0.0.1"), false); // RFC1918
  assertEquals(await isEgressTargetAllowed("192.168.1.1"), false);
  assertEquals(await isEgressTargetAllowed("172.16.5.4"), false);
  assertEquals(await isEgressTargetAllowed("0.0.0.0"), false);
  assertEquals(await isEgressTargetAllowed("::1"), false);
  assertEquals(await isEgressTargetAllowed("[::1]"), false);
});

test("isEgressTargetAllowed - allows public IP literals", async () => {
  assertEquals(await isEgressTargetAllowed("8.8.8.8"), true);
  assertEquals(await isEgressTargetAllowed("1.1.1.1"), true);
});

test("egress proxy - refuses CONNECT to a loopback target with 403", async () => {
  const proxy = await startEgressProxy(0);
  try {
    const conn = await connectTo(proxy.port);
    const response = readUntil(conn, () => false);
    await writeAll(
      conn,
      "CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n",
    );
    assertStringIncludes(await withTimeout(response, 2000, "403 response"), "403");
    conn.destroy();
  } finally {
    proxy.close();
  }
});

test("egress proxy - refuses plain-HTTP request to a metadata endpoint with 403", async () => {
  const proxy = await startEgressProxy(0);
  try {
    const conn = await connectTo(proxy.port);
    const response = readUntil(conn, () => false);
    await writeAll(
      conn,
      new TextEncoder().encode(
        "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
      ),
    );
    assertStringIncludes(await withTimeout(response, 2000, "403 response"), "403");
    conn.destroy();
  } finally {
    proxy.close();
  }
});

// --- F14 #4: DNS-rebinding — the proxy pins to the validated resolved address ---

test("resolveAndValidateEgress - returns a pinned address for public literals, rejects internal", async () => {
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

test("tunnelConnections - upstream close propagates EOF to the client promptly", async () => {
  // client <-> proxyClientSide tunneled to proxyUpstreamSide <-> upstreamServer
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  // Bytes flow client -> upstream and upstream -> client through the tunnel.
  const seenByUpstream = readUntil(upstreamServer, (text) => text.includes("hello"));
  await writeAll(client, "hello");
  assertEquals(await withTimeout(seenByUpstream, 2000, "upstream data"), "hello");
  const seenByClient = readUntil(client, (text) => text.includes("world"));
  await writeAll(upstreamServer, "world");
  assertEquals(await withTimeout(seenByClient, 2000, "client data"), "world");

  // Upstream closes (e.g. keep-alive idle timeout). The client MUST observe EOF quickly —
  // before the fix the FIN was never forwarded and this read hung until the pool reused a
  // dead tunnel. Guard with a timer so a regression fails instead of hanging the test.
  const clientEof = readUntil(client, () => false);
  upstreamServer.destroy();
  assertEquals(
    await withTimeout(clientEof, 2000, "client end of stream"),
    "",
    "client must see EOF once upstream closed",
  );

  client.destroy();
  await withTimeout(tunnel, 2000, "tunnel teardown");
});

test("tunnelConnections - relays a large payload without dropping bytes", async () => {
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  // 4 MiB of a repeating pattern, larger than the 16 KiB tunnel buffer and the socket
  // buffers, so writes are forced into backpressure. If the pipe drops a remainder the
  // received stream is truncated/corrupted.
  const SIZE = 4 * 1024 * 1024;
  const sent = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) sent[i] = i & 0xff;
  const expected = createHash("sha256").update(sent).digest("hex");

  const received = drainHash(upstreamServer);
  for (let offset = 0; offset < SIZE; offset += CHUNK_BYTES) {
    await writeAll(client, sent.subarray(offset, offset + CHUNK_BYTES));
  }
  client.end();
  const seen = await withTimeout(received, 30000, "large transfer");
  assertEquals(seen.bytes, SIZE, "every byte must arrive");
  assertEquals(seen.sha256, expected, "payload must arrive byte-exact");

  upstreamServer.destroy();
  client.destroy();
  await withTimeout(tunnel, 2000, "tunnel teardown");
});

// --- Spec regressions: rebinding, dual-family denial, half-close and backpressure ---

test("egress proxy - regression - rebinding answer is not followed", async () => {
  const hits = { first: 0, second: 0 };
  const first = await startServer("127.0.0.1", (socket) => {
    hits.first += 1;
    socket.destroy();
  });
  await startServer(
    "127.0.0.2",
    (socket) => {
      hits.second += 1;
      socket.destroy();
    },
    first.port,
  );
  const dns = await startFakeDns((name, type, queryIndex) => {
    if (name !== "rebind.test" || type !== "A") return [];
    return queryIndex === 0 ? ["127.0.0.1"] : ["127.0.0.2"];
  });
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  configureEgressAllowHosts(["rebind.test"]);
  const proxy = await startProxy();
  const socket = await connectTo(proxy.port);
  const established = readUntil(socket, (text) => text.includes("\r\n\r\n"));
  await writeAll(
    socket,
    `CONNECT rebind.test:${first.port} HTTP/1.1\r\nHost: rebind.test:${first.port}\r\n\r\n`,
  );
  expect(await withTimeout(established, 2000, "CONNECT response")).toContain(
    "200 Connection Established",
  );
  expect(hits.first).toBe(1);
  expect(hits.second).toBe(0);
  const answers = dns.queries().filter((query) =>
    query.name === "rebind.test" && query.type === "A"
  );
  expect(answers.length).toBe(1);
});

test("egress proxy - regression - disallowed AAAA behind a public A is refused with 403", async () => {
  const dns = await startFakeDns((_name, type) => (type === "A" ? ["8.8.8.8"] : ["::1"]));
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  const proxy = await startProxy();
  const response = await withTimeout(
    roundTrip(proxy, "CONNECT mixed.test:443 HTTP/1.1\r\nHost: mixed.test:443\r\n\r\n"),
    2000,
    "403 response",
  );
  expect(response).toContain("403");
});

test("egress proxy - regression - client half-close is forwarded and the reply still arrives", async () => {
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  const clientText = readUntil(client, () => false);
  const seenByUpstream = readUntil(upstreamServer, () => false);
  await writeAll(client, "hello");
  client.end();
  expect(await withTimeout(seenByUpstream, 2000, "upstream end of stream")).toBe("hello");

  await writeAll(upstreamServer, "world");
  upstreamServer.end();
  expect(await withTimeout(clientText, 2000, "client reply")).toBe("world");
  expect(await withTimeout(tunnel, 2000, "tunnel teardown")).toBeUndefined();
});

test("egress proxy - regression - upstream close reaches the client within 1 second", async () => {
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  const seenByUpstream = readUntil(upstreamServer, (text) => text.includes("hello"));
  await writeAll(client, "hello");
  expect(await withTimeout(seenByUpstream, 2000, "upstream data")).toContain("hello");

  const clientEof = readUntil(client, () => false);
  upstreamServer.destroy();
  expect(await withTimeout(clientEof, 1000, "client end of stream")).toBe("");
  // A half-close keeps the client's own direction open, so the tunnel is done only once
  // the client side is gone too.
  client.destroy();
  expect(await withTimeout(tunnel, 2000, "tunnel teardown")).toBeUndefined();
});

test("egress proxy - regression - peer destroyed mid-transfer tears down both sides within 2 seconds", async () => {
  const [client, proxyClientSide] = await tcpPair();
  const [proxyUpstreamSide, upstreamServer] = await tcpPair();
  const tunnel = tunnelConnections(proxyClientSide, proxyUpstreamSide);

  // The upstream stops reading: a peer that dies mid-transfer leaves queued data behind and
  // its close becomes a reset, which is what a tunnel has to notice. Both sockets are
  // allow-half-open, so the client's signal is end of stream or a reset, not a close event.
  const clientTeardown = readUntil(client, () => false).catch((error: Error) => error.message);
  const writer = (async () => {
    const block = Buffer.alloc(CHUNK_BYTES, 7);
    for (let sent = 0; sent < 8 * MIB; sent += CHUNK_BYTES) await writeAll(client, block);
  })().catch(() => {
    // The teardown ends the writer early; that is the behavior under test.
  });

  await delay(50);
  upstreamServer.destroy();
  expect(await withTimeout(tunnel, 2000, "tunnel teardown")).toBeUndefined();
  const teardown = await withTimeout(clientTeardown, 2000, "client teardown");
  expect(teardown === "" || teardown.includes("ECONNRESET")).toBe(true);
  await writer;
});

test("egress proxy - regression - coalesced binary request body is forwarded byte-exact", async () => {
  // The request head and body arrive in one TCP read, with body bytes that are invalid
  // UTF-8. A text round-trip would corrupt them; the forwarder must preserve raw bytes.
  const body = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x01]);
  const forwarded = Promise.withResolvers<Buffer>();
  const { port } = await startServer("127.0.0.1", (socket) => {
    const chunks: Buffer[] = [];
    let total = 0;
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      const all = Buffer.concat(chunks, total);
      const separator = all.indexOf("\r\n\r\n");
      if (separator === -1 || all.length < separator + 4 + body.length) return;
      forwarded.resolve(all);
      socket.end(CANNED_RESPONSE);
    });
  });

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startProxy();
  const socket = await connectTo(proxy.port);
  const response = readUntil(socket, () => false);
  const head = `POST http://127.0.0.1:${port}/upload HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${port}\r\nContent-Length: ${body.length}\r\n` +
    "Connection: keep-alive\r\nX-Raw: \u00e9\r\n\r\n";
  await writeAll(socket, Buffer.concat([Buffer.from(head, "latin1"), body]));

  const received = await withTimeout(forwarded.promise, 2000, "forwarded request");
  const separator = received.indexOf("\r\n\r\n");
  const forwardedHead = received.subarray(0, separator + 4);
  assertStringIncludes(forwardedHead.toString("latin1"), "Connection: close");
  // The 0xE9 header byte must survive as-is; UTF-8 re-encoding would emit C3 A9.
  assertEquals(forwardedHead.includes(0xe9), true, "latin1 header byte preserved");
  assertEquals(
    forwardedHead.includes(Buffer.from([0xc3, 0xa9])),
    false,
    "header must not be re-encoded as UTF-8",
  );
  assertEquals(
    received.subarray(separator + 4).toString("hex"),
    body.toString("hex"),
    "body bytes must arrive unchanged",
  );
  assertStringIncludes(await withTimeout(response, 2000, "proxy response"), "200 OK");
});

test("egress proxy - regression - half-close received during validation is forwarded", async () => {
  // The client sends CONNECT and immediately half-closes its write side while DNS is still
  // pending. Once validated, the proxy must forward that FIN so an upstream that waits for
  // EOF before replying is not left hanging.
  const query = Promise.withResolvers<void>();
  const dns = Promise.withResolvers<string[]>();
  setEgressResolver({
    resolve4: () => {
      query.resolve();
      return dns.promise;
    },
    resolve6: () => Promise.resolve([]),
  });
  const upstreamEnded = Promise.withResolvers<void>();
  const { port } = await startServer("127.0.0.1", (socket) => {
    socket.on("data", () => {});
    socket.once("end", () => {
      upstreamEnded.resolve();
      socket.end("world");
    });
  });
  configureEgressAllowHosts(["delay.test"]);
  const proxy = await startProxy();
  const socket = await connectTo(proxy.port);
  const response = readUntil(socket, (text) => text.includes("world"));
  await writeAll(
    socket,
    `CONNECT delay.test:${port} HTTP/1.1\r\nHost: delay.test:${port}\r\n\r\n`,
  );
  await withTimeout(query.promise, 2000, "dns query");
  socket.end();
  dns.resolve(["127.0.0.1"]);
  await withTimeout(upstreamEnded.promise, 2000, "upstream EOF");
  assertStringIncludes(await withTimeout(response, 2000, "tunnel reply"), "world");
});

test("egress proxy - regression - CONNECT tunnel carries 32 MiB each way through a slow reader", async () => {
  const outbound = payload(0);
  const inbound = payload(97);
  const upstreamDone = Promise.withResolvers<{ bytes: number; sha256: string }>();
  let upstreamSettled = false;
  const { port: upstreamPort } = await startServer("127.0.0.1", (socket) => {
    const hash = createHash("sha256");
    let bytes = 0;
    let sending = false;
    const finish = () => {
      if (upstreamSettled) return;
      upstreamSettled = true;
      upstreamDone.resolve({ bytes, sha256: hash.digest("hex") });
    };
    socket.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
      if (sending) return;
      sending = true;
      // Start the reverse transfer only after the client has spoken, so the tunnel's
      // 200 response head can never be coalesced with relayed payload bytes.
      void (async () => {
        for (const part of inbound.chunks) await writeAll(socket, part);
        socket.end();
      })();
    });
    socket.once("end", finish);
    socket.once("close", finish);
  });

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startProxy();
  const socket = await connectTo(proxy.port);
  const established = readUntil(socket, (text) => text.includes("\r\n\r\n"));
  await writeAll(
    socket,
    `CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\n\r\n`,
  );
  expect(await withTimeout(established, 2000, "CONNECT response")).toContain(
    "200 Connection Established",
  );

  const received = drainHash(socket, { pauseAfterFirstMs: 200 });
  for (const part of outbound.chunks) await writeAll(socket, part);
  socket.end();

  const seenByUpstream = await withTimeout(upstreamDone.promise, 60000, "upstream transfer");
  const seenByClient = await withTimeout(received, 60000, "client transfer");
  expect(seenByUpstream.bytes).toBe(TRANSFER_BYTES);
  expect(seenByUpstream.sha256).toBe(outbound.sha256);
  expect(seenByClient.bytes).toBe(TRANSFER_BYTES);
  expect(seenByClient.sha256).toBe(inbound.sha256);
});

// --- Plain-HTTP forwarding: origin-form rewrite + forced Connection: close ---

test("rewriteForwardHead - rewrites request line and forces Connection: close", () => {
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

test("rewriteForwardHead - adds Connection: close when absent and preserves body bytes", () => {
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

test("egressAllowHosts - allowlisted private literal is exempt, neighbor stays rejected", async () => {
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

test("egressAllowHosts - metadata addresses stay blocked even when allowlisted", async () => {
  configureEgressAllowHosts(["169.254.169.254", "169.254.170.2"]);
  try {
    assertEquals(await isEgressTargetAllowed("169.254.169.254"), false);
    assertEquals(await isEgressTargetAllowed("169.254.170.2"), false);
  } finally {
    configureEgressAllowHosts([]);
  }
});

test("egressAllowHosts - IPv6 literal entry matches bracketed request form", async () => {
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

test("egressAllowHosts - malformed entries (scheme/port/path, empty) never match", async () => {
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

test("egressAllowHosts - empty allowlist keeps the default-deny posture", async () => {
  configureEgressAllowHosts([]);
  assertEquals(await isEgressTargetAllowed("192.168.1.10"), false);
  assertEquals(await isEgressTargetAllowed("127.0.0.1"), false);
  assertEquals(await isEgressTargetAllowed("8.8.8.8"), true);
});

test("isMetadataAddress - covers IPv4, IPv4-mapped, and IPv6 metadata forms", () => {
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

test("egress proxy - plain-HTTP forward to an allowlisted loopback upstream succeeds", async () => {
  // A minimal loopback HTTP upstream. Allowlisting 127.0.0.1 is the only way to exercise
  // the full proxy path against a real listener in tests.
  const { port: upstreamPort } = await startServer("127.0.0.1", (socket) => {
    socket.once("data", () => socket.end(CANNED_RESPONSE));
  });

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startEgressProxy(0);
  try {
    const conn = await connectTo(proxy.port);
    const response = readUntil(conn, (text) => text.includes("ok"));
    await writeAll(
      conn,
      `GET http://127.0.0.1:${upstreamPort}/health HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${upstreamPort}\r\n\r\n`,
    );
    const text = await withTimeout(response, 2000, "proxy response");
    assertStringIncludes(text, "200 OK");
    assertStringIncludes(text, "ok");
    conn.destroy();
  } finally {
    proxy.close();
    configureEgressAllowHosts([]);
  }
});

test("egress proxy - CONNECT to an allowlisted loopback upstream establishes a tunnel", async () => {
  // Echo upstream: whatever arrives through the tunnel is sent back.
  const { port: upstreamPort } = await startServer("127.0.0.1", (socket) => {
    socket.once("data", (chunk) => socket.write(chunk));
  });

  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startEgressProxy(0);
  try {
    const conn = await connectTo(proxy.port);
    const established = readUntil(conn, (text) => text.includes("\r\n\r\n"));
    await writeAll(
      conn,
      `CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\n\r\n`,
    );
    assertStringIncludes(
      await withTimeout(established, 2000, "CONNECT response"),
      "200 Connection Established",
    );
    const echoed = readUntil(conn, (text) => text.includes("ping"));
    await writeAll(conn, "ping");
    assertEquals(await withTimeout(echoed, 2000, "echo"), "ping");
    conn.destroy();
  } finally {
    proxy.close();
    configureEgressAllowHosts([]);
  }
});
