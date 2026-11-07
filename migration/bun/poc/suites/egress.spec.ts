/**
 * Egress proxy suite: drives the `node:net` port of the validating egress proxy under Bun
 * (migration design section 4.6, P0-5). Every title starts with the criterion ID the gate
 * matches, and the run stays independent of the network: upstreams listen on loopback and
 * every hostname answer comes from the fake DNS fixture.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash, type Hash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import * as net from "node:net";
import { startFakeDns, type FakeDns } from "../egress/fake-dns.ts";
import {
  configureEgressAllowHosts,
  isEgressTargetAllowed,
  isMetadataAddress,
  resolveAndValidateEgress,
  rewriteForwardHead,
  setEgressResolver,
  startEgressProxy,
  tunnelConnections,
  type EgressProxyHandle,
} from "../egress/egress-proxy.ts";

const MIB = 1024 * 1024;
const TRANSFER_BYTES = 32 * MIB;
const CHUNK_BYTES = 64 * 1024;
const CANNED_RESPONSE = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";

const proxies: EgressProxyHandle[] = [];
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];
const dnsServers: FakeDns[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  for (const proxy of proxies.splice(0)) proxy.close();
  for (const dns of dnsServers.splice(0)) dns.stop();
  configureEgressAllowHosts([]);
  setEgressResolver(new Resolver());
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
    track(socket);
    handler(socket);
  });
  servers.push(server);
  const { promise, resolve, reject } = Promise.withResolvers<{ server: net.Server; port: number }>();
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

// --- EGR-01: both families are consulted and any disallowed answer denies ---

test("EGR-01: a loopback AAAA denies a host whose A answers are public", async () => {
  const dns = await startFakeDns((_name, type) => (type === "A" ? ["8.8.8.8"] : ["::1"]));
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  expect(await isEgressTargetAllowed("mixed.test")).toBe(false);
});

test("EGR-01: a private A denies a host whose AAAA answers are public", async () => {
  const dns = await startFakeDns((_name, type) =>
    type === "A" ? ["10.0.0.1"] : ["2001:4860:4860::8888"]
  );
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  expect(await isEgressTargetAllowed("mixed.test")).toBe(false);
});

test("EGR-01: both families are queried and public answers are allowed", async () => {
  const dns = await startFakeDns((_name, type) =>
    type === "A" ? ["8.8.8.8"] : ["2001:4860:4860::8888"]
  );
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  const verdict = await resolveAndValidateEgress("both.test");
  expect(verdict.allowed).toBe(true);
  expect(verdict.address).toBe("8.8.8.8");
  const queries = dns.queries().filter((query) => query.name === "both.test");
  expect(queries.filter((query) => query.type === "A").length).toBe(1);
  expect(queries.filter((query) => query.type === "AAAA").length).toBe(1);
});

test("EGR-01: internal literals are denied and public literals are allowed", async () => {
  const denied = [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.5.4",
    "0.0.0.0",
    "::1",
    "[::1]",
  ];
  for (const host of denied) expect(await isEgressTargetAllowed(host)).toBe(false);
  for (const host of ["8.8.8.8", "1.1.1.1"]) {
    expect(await isEgressTargetAllowed(host)).toBe(true);
  }
  const pinned = await resolveAndValidateEgress("8.8.8.8");
  expect(pinned.address).toBe("8.8.8.8");
});

// --- EGR-02: metadata addresses stay blocked, including for an allowlisted host ---

test("EGR-02: an allowlisted metadata literal is still denied", async () => {
  // A literal takes the fast path in resolveAddresses, so this proves the allowlist cannot
  // exempt the metadata space even without a DNS answer.
  configureEgressAllowHosts(["169.254.169.254", "169.254.170.2"]);
  expect(await isEgressTargetAllowed("169.254.169.254")).toBe(false);
  expect(await isEgressTargetAllowed("169.254.170.2")).toBe(false);
  const verdict = await resolveAndValidateEgress("169.254.169.254");
  expect(verdict.allowed).toBe(false);
  expect(verdict.address).toBeUndefined();
});

test("EGR-02: an allowlisted host resolving to a metadata address is still denied", async () => {
  const dns = await startFakeDns((_name, type) => (type === "A" ? ["169.254.169.254"] : []));
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  configureEgressAllowHosts(["metadata.test"]);
  expect(await isEgressTargetAllowed("metadata.test")).toBe(false);
  const verdict = await resolveAndValidateEgress("metadata.test");
  expect(verdict.allowed).toBe(false);
  expect(verdict.address).toBeUndefined();
});

test("EGR-02: every metadata spelling is identified", () => {
  // Independent test data: the deny list the proxy must carry, in every spelling it accepts.
  const metadata = [
    "169.254.169.254",
    "169.254.170.2",
    "100.100.100.200",
    "192.0.0.192",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "fd00:ec2::254",
    "fd00:0ec2:0000:0000:0000:0000:0000:0254",
  ];
  for (const address of metadata) expect(isMetadataAddress(address)).toBe(true);
  const neighbors = ["8.8.8.8", "169.254.169.253", "fd12:3456::10"];
  for (const address of neighbors) expect(isMetadataAddress(address)).toBe(false);
});

test("EGR-02: a plain-HTTP request to the metadata endpoint is refused with 403", async () => {
  // The metadata host is a literal, so the request never resolves; a proxy that skipped the
  // check would instead answer 502 here, because the container has no route to reach it.
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
  );
  expect(response).toContain("403");
  expect(response).not.toContain("200");
});

test("EGR-02: an allowlisted name resolving to metadata is refused with 403", async () => {
  const dns = await startFakeDns((_name, type) => (type === "A" ? ["169.254.169.254"] : []));
  dnsServers.push(dns);
  setEgressResolver(dns.resolver());
  configureEgressAllowHosts(["metadata.test"]);
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    "GET http://metadata.test/latest/meta-data/ HTTP/1.1\r\nHost: metadata.test\r\n\r\n",
  );
  expect(response).toContain("403");
  const answers = dns.queries().filter((query) => query.name === "metadata.test" && query.type === "A");
  expect(answers.length).toBe(1);
});

// --- EGR-03: the connection uses the validated address with no second resolution ---

test("EGR-03: the tunnel is pinned to the first validated answer", async () => {
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
  const answers = dns.queries().filter((query) => query.name === "rebind.test" && query.type === "A");
  expect(answers.length).toBe(1);
});

// --- EGR-04: a tunnel carries 32 MiB each way byte-identical ---

test("EGR-04: a CONNECT tunnel carries 32 MiB each way through a slow reader", async () => {
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

// --- EGR-05: half-close propagation and peer-failure teardown ---

test("EGR-05: a client half-close is forwarded and the reply still arrives", async () => {
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

test("EGR-05: an upstream close reaches the client within 1 s", async () => {
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
  // the client side is gone too — the production test closes the client the same way.
  client.destroy();
  expect(await withTimeout(tunnel, 2000, "tunnel teardown")).toBeUndefined();
});

test("EGR-05: destroying one side mid-transfer tears down both within 2 s", async () => {
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

// --- EGR-06: plain HTTP is rewritten to one close-delimited request ---

test("EGR-06: an absolute-form request is forwarded in origin form with Connection: close", async () => {
  const received = Promise.withResolvers<string>();
  const { port } = await startServer("127.0.0.1", (socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("latin1");
      if (!text.includes("\r\n\r\n")) return;
      received.resolve(text);
      socket.end(CANNED_RESPONSE);
    });
  });
  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    `GET http://127.0.0.1:${port}/a?b=1 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
      "Connection: keep-alive\r\nProxy-Connection: keep-alive\r\nX-Foo: bar\r\n\r\n",
  );
  const forwarded = await withTimeout(received.promise, 2000, "forwarded head");
  expect(forwarded.startsWith("GET /a?b=1 HTTP/1.1\r\n")).toBe(true);
  expect(forwarded).toContain("\r\nConnection: close\r\n");
  expect(forwarded.toLowerCase()).not.toContain("proxy-connection");
  expect(forwarded.toLowerCase()).not.toContain("keep-alive");
  expect(response).toContain("HTTP/1.1 200 OK");
  expect(response).toContain("ok");
});

test("EGR-06: a pipelined second request is not answered", async () => {
  const firstHead = Promise.withResolvers<string>();
  const { port } = await startServer("127.0.0.1", (socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("latin1");
      const headEnd = text.indexOf("\r\n\r\n");
      if (headEnd === -1) return;
      firstHead.resolve(text.slice(0, headEnd));
      socket.end(CANNED_RESPONSE);
    });
  });
  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startProxy();
  const request = `GET http://127.0.0.1:${port}/one HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n` +
    `GET http://127.0.0.1:${port}/two HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`;
  const response = await roundTrip(proxy, request);
  const forwarded = await withTimeout(firstHead.promise, 2000, "forwarded head");
  expect(forwarded).toContain("\r\nConnection: close");
  const statusLines = response.split("\r\n").filter((line) => line.startsWith("HTTP/1.1 "));
  expect(statusLines.length).toBe(1);
  expect(statusLines[0]).toContain("200 OK");
});

test("EGR-06: rewriteForwardHead drops connection headers and keeps body bytes", () => {
  const withHeaders = "GET http://example.com/a?b=1 HTTP/1.1\r\n" +
    "Host: example.com\r\n" +
    "Connection: keep-alive\r\n" +
    "Proxy-Connection: keep-alive\r\n" +
    "X-Foo: bar\r\n" +
    "\r\n";
  expect(rewriteForwardHead(withHeaders, "GET", "/a?b=1")).toBe(
    "GET /a?b=1 HTTP/1.1\r\nHost: example.com\r\nX-Foo: bar\r\nConnection: close\r\n\r\n",
  );
  const withBody = "POST http://example.com/submit HTTP/1.1\r\n" +
    "Host: example.com\r\n" +
    "Content-Length: 4\r\n" +
    "\r\n" +
    "data";
  expect(rewriteForwardHead(withBody, "POST", "/submit")).toBe(
    "POST /submit HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata",
  );
});

// --- EGR-07: allowlist exemption, neighbor rejection and malformed-entry rules ---

test("EGR-07: an allowlisted private literal is exempt while its neighbor is denied", async () => {
  configureEgressAllowHosts(["192.168.1.10"]);
  expect(await isEgressTargetAllowed("192.168.1.10")).toBe(true);
  const pinned = await resolveAndValidateEgress("192.168.1.10");
  expect(pinned.allowed).toBe(true);
  expect(pinned.address).toBe("192.168.1.10");
  expect(await isEgressTargetAllowed("192.168.10.11")).toBe(false);
  expect(await isEgressTargetAllowed("10.0.0.1")).toBe(false);
});

test("EGR-07: a bracketed IPv6 allowlist entry matches both spellings", async () => {
  configureEgressAllowHosts(["  [FD12:3456::10]  "]);
  expect(await isEgressTargetAllowed("[fd12:3456::10]")).toBe(true);
  expect(await isEgressTargetAllowed("fd12:3456::10")).toBe(true);
  expect(await isEgressTargetAllowed("[fd12:3456::11]")).toBe(false);
});

test("EGR-07: malformed entries never match a destination host", async () => {
  configureEgressAllowHosts([
    "http://192.168.1.10:7860",
    "192.168.1.10:7860",
    "192.168.1.10/api",
    "a:b:c",
    "",
    "   ",
  ]);
  expect(await isEgressTargetAllowed("192.168.1.10")).toBe(false);
});

test("EGR-07: an empty allowlist keeps the default-deny posture", async () => {
  configureEgressAllowHosts([]);
  expect(await isEgressTargetAllowed("192.168.1.10")).toBe(false);
  expect(await isEgressTargetAllowed("127.0.0.1")).toBe(false);
  expect(await isEgressTargetAllowed("8.8.8.8")).toBe(true);
});

// --- EGR-08: refusal responses ---

test("EGR-08: a CONNECT to a non-allowlisted loopback target is refused with 403", async () => {
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    "CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n",
  );
  expect(response).toContain("403");
});

test("EGR-08: an absolute-form request with an unsupported scheme is refused with 403", async () => {
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    "GET ftp://example.com/file HTTP/1.1\r\nHost: example.com\r\n\r\n",
  );
  expect(response).toContain("403");
});

test("EGR-08: a request line without a target is refused with 400", async () => {
  const proxy = await startProxy();
  const response = await roundTrip(proxy, "PING\r\n\r\n");
  expect(response).toContain("400");
});

test("EGR-08: a CONNECT to an allowlisted closed port returns 502", async () => {
  const { server, port } = await startServer("127.0.0.1", () => {});
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  configureEgressAllowHosts(["127.0.0.1"]);
  const proxy = await startProxy();
  const response = await roundTrip(
    proxy,
    `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
  );
  expect(response).toContain("502");
});
