// tests/utils/gelf-transport.test.ts

import { assertEquals } from "@std/assert";
import { test } from "bun:test";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import * as net from "node:net";
import { GelfTransport } from "../../src/utils/gelf-transport.ts";
import type { LogEntry } from "../../src/types/logger.ts";

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Reads the first chunk of data the socket receives. */
function readOnce(socket: net.Socket): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  socket.once("data", resolve);
  socket.once("error", reject);
  return promise;
}

interface TcpSink {
  server: net.Server;
  port: number;
  accept(): Promise<net.Socket>;
  close(): Promise<void>;
}

/** Starts a loopback TCP listener whose connections can be awaited one at a time. */
async function startTcpServer(port = 0): Promise<TcpSink> {
  const waiting: net.Socket[] = [];
  const pending: Array<(socket: net.Socket) => void> = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => {});
    const resolve = pending.shift();
    if (resolve) resolve(socket);
    else waiting.push(socket);
  });
  const listening = Promise.withResolvers<number>();
  server.once("error", listening.reject);
  server.listen(port, "127.0.0.1", () => {
    server.off("error", listening.reject);
    listening.resolve((server.address() as net.AddressInfo).port);
  });
  return {
    server,
    port: await listening.promise,
    accept: () => {
      const socket = waiting.shift();
      if (socket) return Promise.resolve(socket);
      const { promise, resolve } = Promise.withResolvers<net.Socket>();
      pending.push(resolve);
      return promise;
    },
    close: () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      return promise;
    },
  };
}

interface UdpSink {
  port: number;
  next(): Promise<Buffer>;
  /** Collects datagrams until `idleMs` passes without a new one. */
  collect(idleMs: number): Promise<Buffer[]>;
  close(): void;
}

/** Starts a loopback UDP receiver that queues datagrams for the test. */
async function startUdpServer(): Promise<UdpSink> {
  const socket: UdpSocket = createSocket("udp4");
  const received: Buffer[] = [];
  const pending: Array<(data: Buffer) => void> = [];
  socket.on("message", (message) => {
    const resolve = pending.shift();
    if (resolve) resolve(message);
    else received.push(message);
  });
  socket.on("error", () => {});
  const listening = Promise.withResolvers<number>();
  socket.bind(0, "127.0.0.1", () => listening.resolve(socket.address().port));
  const port = await listening.promise;
  const next = (): Promise<Buffer> => {
    const queued = received.shift();
    if (queued) return Promise.resolve(queued);
    const { promise, resolve } = Promise.withResolvers<Buffer>();
    pending.push(resolve);
    return promise;
  };
  return {
    port,
    next,
    collect: async (idleMs: number) => {
      const out: Buffer[] = [];
      const deadline = delay(idleMs).then(() => null);
      while (true) {
        const item = await Promise.race([next(), deadline]);
        if (item === null) return out;
        out.push(item);
      }
    },
    close: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

test("GelfTransport - converts LogEntry to correct GELF format", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
    hostname: "test-host",
  });

  const entry: LogEntry = {
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "INFO",
    module: "TestModule",
    message: "Test message",
    context: { userId: "123", action: "login" },
  };

  transport.send(entry);
  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "test-host");
  assertEquals(gelf.short_message, "Test message");
  assertEquals(gelf.level, 6); // INFO = Syslog Informational
  assertEquals(gelf._module, "TestModule");
  assertEquals(gelf._log_level, "INFO");
  assertEquals(gelf._userId, "123");
  assertEquals(gelf._action, "login");

  await server.stop();
});

test("GelfTransport - maps log levels to correct syslog levels", async () => {
  const receivedMessages: Record<string, number> = {};

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text());
      receivedMessages[body._log_level] = body.level;
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  for (const level of ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const) {
    transport.send({
      timestamp: new Date().toISOString(),
      level,
      module: "Test",
      message: `${level} message`,
    });
  }

  await delay(500);

  assertEquals(receivedMessages["DEBUG"], 7);
  assertEquals(receivedMessages["INFO"], 6);
  assertEquals(receivedMessages["WARN"], 4);
  assertEquals(receivedMessages["ERROR"], 3);
  assertEquals(receivedMessages["FATAL"], 2);

  await server.stop();
});

test("GelfTransport - handles send failure gracefully", async () => {
  const transport = new GelfTransport({
    enabled: true,
    endpoint: "http://127.0.0.1:1/gelf", // Unreachable endpoint
  });

  // Should not throw
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "This should not throw",
  });

  // Wait for fetch to fail
  await delay(500);
  // If we reach here, no exception was thrown ✓
});

test("GelfTransport - uses default hostname when not specified", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Default hostname test",
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.host, "air-friends");

  await server.stop();
});

test("GelfTransport - stringifies object values in context", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Object context test",
    context: { nested: { a: 1, b: "two" } },
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf._nested, JSON.stringify({ a: 1, b: "two" }));

  await server.stop();
});

test("GelfTransport - includes messageTemplate as custom field", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Session ses_abc model set to gpt-4",
    messageTemplate: "Session {sessionId} model set to {modelId}",
    context: { sessionId: "ses_abc", modelId: "gpt-4" },
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.short_message, "Session ses_abc model set to gpt-4");
  assertEquals(gelf._messageTemplate, "Session {sessionId} model set to {modelId}");
  assertEquals(gelf._sessionId, "ses_abc");
  assertEquals(gelf._modelId, "gpt-4");

  await server.stop();
});

test("GelfTransport - omits messageTemplate when not present", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Simple message without template",
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.short_message, "Simple message without template");
  assertEquals(gelf._messageTemplate, undefined);

  await server.stop();
});

// =============================================================================
// TCP Protocol Tests
// =============================================================================

test("GelfTransport TCP - sends correct GELF message over TCP", async () => {
  const listener = await startTcpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `tcp://127.0.0.1:${listener.port}`,
    protocol: "tcp",
    hostname: "tcp-test-host",
  });

  const entry: LogEntry = {
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "INFO",
    module: "TcpTest",
    message: "TCP test message",
    context: { userId: "456", action: "post" },
  };

  const connPromise = listener.accept();
  transport.send(entry);

  const conn = await connPromise;
  const received = (await readOnce(conn)).toString();

  // Must be null-byte terminated
  assertEquals(received.endsWith("\0"), true);

  // Parse the JSON (strip trailing null byte)
  const gelf = JSON.parse(received.slice(0, -1));
  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "tcp-test-host");
  assertEquals(gelf.short_message, "TCP test message");
  assertEquals(gelf.level, 6); // INFO = Syslog Informational
  assertEquals(gelf._module, "TcpTest");
  assertEquals(gelf._log_level, "INFO");
  assertEquals(gelf._userId, "456");
  assertEquals(gelf._action, "post");

  transport.close();
  conn.destroy();
  await listener.close();
});

test("GelfTransport TCP - handles TCP connection failure gracefully", async () => {
  const transport = new GelfTransport({
    enabled: true,
    endpoint: "tcp://127.0.0.1:1", // Unreachable endpoint
    protocol: "tcp",
  });

  // Should not throw
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "This should not throw",
  });

  // Wait for async TCP connection attempts to settle
  await delay(500);

  transport.close();
});

test("GelfTransport TCP - reconnects after connection is closed", async () => {
  const listener1 = await startTcpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `tcp://127.0.0.1:${listener1.port}`,
    protocol: "tcp",
  });

  // First message
  const connPromise1 = listener1.accept();
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "First message",
  });

  const conn1 = await connPromise1;
  const received1 = (await readOnce(conn1)).toString();
  const gelf1 = JSON.parse(received1.slice(0, -1));
  assertEquals(gelf1.short_message, "First message");

  // Simulate connection loss from the server side; the transport's close handler must
  // invalidate its cached socket, not an explicit `close()` call.
  conn1.destroy();
  await listener1.close();
  // Let the client socket observe the remote close before the next send reuses it.
  await delay(50);

  // Start a new server on the same port
  const listener2 = await startTcpServer(listener1.port);

  // Second message should create a new connection (reconnect)
  const connPromise2 = listener2.accept();
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Second message after reconnect",
  });

  const conn2 = await connPromise2;
  const received2 = (await readOnce(conn2)).toString();
  const gelf2 = JSON.parse(received2.slice(0, -1));
  assertEquals(gelf2.short_message, "Second message after reconnect");

  transport.close();
  conn2.destroy();
  await listener2.close();
});

test("GelfTransport TCP - parses various endpoint formats", async () => {
  // Test with http:// format
  const listener1 = await startTcpServer();

  const transport1 = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${listener1.port}`,
    protocol: "tcp",
  });

  const connPromise1 = listener1.accept();
  transport1.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "HTTP format endpoint",
  });

  const conn1 = await connPromise1;
  const received1 = (await readOnce(conn1)).toString();
  const gelf1 = JSON.parse(received1.slice(0, -1));
  assertEquals(gelf1.short_message, "HTTP format endpoint");

  transport1.close();
  conn1.destroy();
  await listener1.close();

  // Test with tcp:// format
  const listener2 = await startTcpServer();

  const transport2 = new GelfTransport({
    enabled: true,
    endpoint: `tcp://127.0.0.1:${listener2.port}`,
    protocol: "tcp",
  });

  const connPromise2 = listener2.accept();
  transport2.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "TCP format endpoint",
  });

  const conn2 = await connPromise2;
  const received2 = (await readOnce(conn2)).toString();
  const gelf2 = JSON.parse(received2.slice(0, -1));
  assertEquals(gelf2.short_message, "TCP format endpoint");

  transport2.close();
  conn2.destroy();
  await listener2.close();
});

test("GelfTransport TCP - close() is idempotent", () => {
  const transport = new GelfTransport({
    enabled: true,
    endpoint: "tcp://127.0.0.1:12201",
    protocol: "tcp",
  });

  // Multiple close calls should not throw
  transport.close();
  transport.close();
  transport.close();
});

// =============================================================================
// GELF Payload Specification Compliance Tests
// =============================================================================

test("GelfTransport - filters _id from additional fields", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
    hostname: "spec-test",
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "_id filtering test",
    context: { id: "should-be-filtered", other: "kept" },
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf._other, "kept");
  assertEquals(gelf._id, undefined);

  await server.stop();
});

test("GelfTransport - validates additional field names", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Field name validation test",
    context: {
      validKey: "v1",
      "with.dot": "v2",
      "with-dash": "v3",
      under_score: "v4",
      "invalid key": "bad1",
      "invalid!char": "bad2",
    },
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf._validKey, "v1");
  assertEquals(gelf["_with.dot"], "v2");
  assertEquals(gelf["_with-dash"], "v3");
  assertEquals(gelf._under_score, "v4");
  assertEquals(gelf["_invalid key"], undefined);
  assertEquals(gelf["_invalid!char"], undefined);

  await server.stop();
});

test("GelfTransport - converts boolean values to strings", async () => {
  let receivedBody: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("", { status: 202 });
    },
  });

  const port = server.port;
  const transport = new GelfTransport({
    enabled: true,
    endpoint: `http://127.0.0.1:${port}/gelf`,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Boolean conversion test",
    context: { active: true, deleted: false },
  });

  await delay(200);

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf._active, "true");
  assertEquals(gelf._deleted, "false");

  await server.stop();
});

// =============================================================================
// UDP Protocol Tests
// =============================================================================

async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  let totalLength = 0;
  for (const p of parts) totalLength += p.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

test("GelfTransport UDP - sends correct GELF message via UDP", async () => {
  const listener = await startUdpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `udp://127.0.0.1:${listener.port}`,
    protocol: "udp",
    compress: false,
    hostname: "udp-test-host",
  });

  const entry: LogEntry = {
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "WARN",
    module: "UdpTest",
    message: "UDP test message",
    context: { region: "us-east" },
  };

  transport.send(entry);

  const data = await listener.next();
  const gelf = JSON.parse(new TextDecoder().decode(data));

  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "udp-test-host");
  assertEquals(gelf.short_message, "UDP test message");
  assertEquals(gelf.level, 4); // WARN = Syslog Warning
  assertEquals(gelf._module, "UdpTest");
  assertEquals(gelf._log_level, "WARN");
  assertEquals(gelf._region, "us-east");

  transport.close();
  listener.close();
});

test("GelfTransport UDP - applies GZIP compression by default", async () => {
  const listener = await startUdpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `udp://127.0.0.1:${listener.port}`,
    protocol: "udp",
    // compress defaults to true for UDP
    hostname: "gzip-test",
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "GZIP default test",
  });

  const data = await listener.next();

  // Verify GZIP magic bytes
  assertEquals(data[0], 0x1f);
  assertEquals(data[1], 0x8b);

  // Decompress and verify the JSON content
  const decompressed = await gzipDecompress(data);
  const gelf = JSON.parse(new TextDecoder().decode(decompressed));
  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "gzip-test");
  assertEquals(gelf.short_message, "GZIP default test");

  transport.close();
  listener.close();
});

test("GelfTransport UDP - sends uncompressed when compress is false", async () => {
  const listener = await startUdpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `udp://127.0.0.1:${listener.port}`,
    protocol: "udp",
    compress: false,
  });

  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Uncompressed UDP test",
  });

  const data = await listener.next();

  // First byte should be '{' (0x7b) — raw JSON, not GZIP
  assertEquals(data[0], 0x7b);

  const gelf = JSON.parse(new TextDecoder().decode(data));
  assertEquals(gelf.short_message, "Uncompressed UDP test");

  transport.close();
  listener.close();
});

test("GelfTransport UDP - chunks large messages", async () => {
  const listener = await startUdpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `udp://127.0.0.1:${listener.port}`,
    protocol: "udp",
    compress: false,
    hostname: "chunk-test",
  });

  // Create a message large enough to exceed 8192 bytes
  transport.send({
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "INFO",
    module: "Test",
    message: "Chunked message test",
    context: { bigdata: "x".repeat(10000) },
  });

  // Collect multiple chunks with an idle timeout
  const chunks = await listener.collect(1000);

  // Must have received more than one chunk
  assertEquals(chunks.length > 1, true, `Expected >1 chunks, got ${chunks.length}`);

  // Verify chunk headers and extract message ID
  const expectedMessageId = chunks[0].subarray(2, 10);
  const sequenceCount = chunks[0][11];
  assertEquals(sequenceCount, chunks.length);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // Magic bytes
    assertEquals(chunk[0], 0x1e);
    assertEquals(chunk[1], 0x0f);
    // Message ID is the same across all chunks
    assertEquals(new Uint8Array(chunk.subarray(2, 10)), new Uint8Array(expectedMessageId));
    // Sequence count is the same across all chunks
    assertEquals(chunk[11], sequenceCount);
  }

  // Reassemble in sequence order
  const ordered = chunks.toSorted((a, b) => a[10] - b[10]);
  const dataParts: Uint8Array[] = ordered.map((c) => c.subarray(12));
  let totalLen = 0;
  for (const p of dataParts) totalLen += p.length;
  const reassembled = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of dataParts) {
    reassembled.set(p, offset);
    offset += p.length;
  }

  // Parse the reassembled JSON
  const gelf = JSON.parse(new TextDecoder().decode(reassembled));
  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "chunk-test");
  assertEquals(gelf.short_message, "Chunked message test");
  assertEquals(gelf._bigdata, "x".repeat(10000));

  transport.close();
  listener.close();
});

test("GelfTransport UDP - handles UDP send failure gracefully", async () => {
  const transport = new GelfTransport({
    enabled: true,
    endpoint: "udp://unresolvable.invalid:1", // Guaranteed to fail the name lookup
    protocol: "udp",
  });

  // Should not throw
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "This should not throw",
  });

  await delay(500);

  transport.close();
});

test("GelfTransport UDP - close() cleans up UDP connection", async () => {
  const listener = await startUdpServer();

  const transport = new GelfTransport({
    enabled: true,
    endpoint: `udp://127.0.0.1:${listener.port}`,
    protocol: "udp",
    compress: false,
  });

  // Send a message to establish the internal UDP socket
  transport.send({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "Test",
    message: "Establish connection",
  });

  await listener.next();

  // First close should not throw
  transport.close();
  // Idempotent — second close should also not throw
  transport.close();

  listener.close();
});
