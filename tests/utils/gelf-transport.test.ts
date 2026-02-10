// tests/utils/gelf-transport.test.ts

import { assertEquals } from "@std/assert";
import { GelfTransport } from "../../src/utils/gelf-transport.ts";
import type { LogEntry } from "../../src/types/logger.ts";

Deno.test("GelfTransport - converts LogEntry to correct GELF format", async () => {
  let receivedBody: string | null = null;

  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    receivedBody = await req.text();
    return new Response("", { status: 202 });
  });

  const port = server.addr.port;
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
  await new Promise((resolve) => setTimeout(resolve, 200));

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.version, "1.1");
  assertEquals(gelf.host, "test-host");
  assertEquals(gelf.short_message, "Test message");
  assertEquals(gelf.level, 6); // INFO = Syslog Informational
  assertEquals(gelf._module, "TestModule");
  assertEquals(gelf._log_level, "INFO");
  assertEquals(gelf._userId, "123");
  assertEquals(gelf._action, "login");

  await server.shutdown();
});

Deno.test("GelfTransport - maps log levels to correct syslog levels", async () => {
  const receivedMessages: Record<string, number> = {};

  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const body = JSON.parse(await req.text());
    receivedMessages[body._log_level] = body.level;
    return new Response("", { status: 202 });
  });

  const port = server.addr.port;
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

  await new Promise((resolve) => setTimeout(resolve, 500));

  assertEquals(receivedMessages["DEBUG"], 7);
  assertEquals(receivedMessages["INFO"], 6);
  assertEquals(receivedMessages["WARN"], 4);
  assertEquals(receivedMessages["ERROR"], 3);
  assertEquals(receivedMessages["FATAL"], 2);

  await server.shutdown();
});

Deno.test("GelfTransport - handles send failure gracefully", async () => {
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
  await new Promise((resolve) => setTimeout(resolve, 500));
  // If we reach here, no exception was thrown ✓
});

Deno.test("GelfTransport - uses default hostname when not specified", async () => {
  let receivedBody: string | null = null;

  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    receivedBody = await req.text();
    return new Response("", { status: 202 });
  });

  const port = server.addr.port;
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

  await new Promise((resolve) => setTimeout(resolve, 200));

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf.host, "air-friends");

  await server.shutdown();
});

Deno.test("GelfTransport - stringifies object values in context", async () => {
  let receivedBody: string | null = null;

  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    receivedBody = await req.text();
    return new Response("", { status: 202 });
  });

  const port = server.addr.port;
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

  await new Promise((resolve) => setTimeout(resolve, 200));

  const gelf = JSON.parse(receivedBody!);
  assertEquals(gelf._nested, JSON.stringify({ a: 1, b: "two" }));

  await server.shutdown();
});
