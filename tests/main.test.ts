// tests/main.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { ShutdownHandler } from "../src/shutdown.ts";
import { HealthCheckServer } from "../src/healthcheck.ts";
import { configureLogger, createLogger } from "../src/utils/logger.ts";
import type { AppContext } from "../src/bootstrap.ts";
import { ConnectionState } from "../src/types/platform.ts";

// ShutdownHandler tests
Deno.test("ShutdownHandler - initial state", () => {
  const handler = new ShutdownHandler();
  assertEquals(handler.isShutdownInProgress(), false);
});

Deno.test("ShutdownHandler - can set context", () => {
  const handler = new ShutdownHandler();
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => Promise.resolve(),
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);
  assertEquals(handler.isShutdownInProgress(), false);
});

Deno.test("ShutdownHandler - shutdown without context", async () => {
  const handler = new ShutdownHandler();

  // Mock Deno.exit to prevent test from exiting
  const originalExit = Deno.exit;
  let exitCode = -1;
  Deno.exit = ((code: number) => {
    exitCode = code;
  }) as typeof Deno.exit;

  try {
    await handler.shutdown();
    assertEquals(exitCode, 0);
    assertEquals(handler.isShutdownInProgress(), true);
  } finally {
    Deno.exit = originalExit;
  }
});

Deno.test("ShutdownHandler - shutdown with context", async () => {
  const handler = new ShutdownHandler();
  let disconnectCalled = false;
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => {
        disconnectCalled = true;
        return Promise.resolve();
      },
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);

  const originalExit = Deno.exit;
  let exitCode = -1;
  Deno.exit = ((code: number) => {
    exitCode = code;
  }) as typeof Deno.exit;

  try {
    await handler.shutdown();
    assertEquals(disconnectCalled, true);
    assertEquals(exitCode, 0);
    assertEquals(handler.isShutdownInProgress(), true);
  } finally {
    Deno.exit = originalExit;
  }
});

Deno.test("ShutdownHandler - shutdown handles errors", async () => {
  const handler = new ShutdownHandler();
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => Promise.reject(new Error("Disconnect failed")),
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);

  const originalExit = Deno.exit;
  let exitCode = -1;
  Deno.exit = ((code: number) => {
    exitCode = code;
  }) as typeof Deno.exit;

  try {
    await handler.shutdown();
    assertEquals(exitCode, 1);
  } finally {
    Deno.exit = originalExit;
  }
});

Deno.test("ShutdownHandler - prevents duplicate shutdown", async () => {
  const handler = new ShutdownHandler();
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => Promise.resolve(),
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);

  const originalExit = Deno.exit;
  let exitCount = 0;
  Deno.exit = ((_code: number) => {
    exitCount++;
  }) as typeof Deno.exit;

  try {
    // Start first shutdown
    const promise1 = handler.shutdown();
    // Try to start second shutdown
    const promise2 = handler.shutdown();

    await Promise.all([promise1, promise2]);
    // Should only exit once
    assertEquals(exitCount, 1);
  } finally {
    Deno.exit = originalExit;
  }
});

// HealthCheckServer tests
Deno.test("HealthCheckServer - can be instantiated", () => {
  const server = new HealthCheckServer(8081);
  assertExists(server);
});

Deno.test("HealthCheckServer - can set context", () => {
  const server = new HealthCheckServer(8082);
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      getStatus: () => new Map(),
      isAllConnected: () => true,
    },
  } as unknown as AppContext;

  server.setContext(mockContext);
  // No error means success
  assertExists(server);
});

Deno.test("HealthCheckServer - start and stop", async () => {
  const server = new HealthCheckServer(8083);

  // Start server
  server.start();

  // Give it a moment to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Stop server
  await server.stop();
});

Deno.test("HealthCheckServer - handles /health endpoint", async () => {
  const server = new HealthCheckServer(8084);
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      getStatus: () =>
        new Map([
          ["discord", {
            state: ConnectionState.CONNECTED,
            reconnectAttempts: 0,
          }],
        ]),
      isAllConnected: () => true,
    },
  } as unknown as AppContext;

  server.setContext(mockContext);
  server.start();

  try {
    const response = await fetch("http://localhost:8084/health");
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.status);
    assertExists(data.timestamp);
    assertExists(data.uptime);
    assertExists(data.checks);
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - handles /healthz endpoint", async () => {
  const server = new HealthCheckServer(8085);
  server.start();

  try {
    const response = await fetch("http://localhost:8085/healthz");
    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.status);
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - handles /ready endpoint without context", async () => {
  const server = new HealthCheckServer(8086);
  server.start();

  try {
    const response = await fetch("http://localhost:8086/ready");
    assertEquals(response.status, 503);

    const data = await response.json();
    assertEquals(data.ready, false);
  } finally {
    await server.stop();
  }
});

Deno.test(
  "HealthCheckServer - handles /ready endpoint with connected platforms",
  async () => {
    const server = new HealthCheckServer(8087);
    const mockContext = {
      config: {},
      agentCore: {},
      platformRegistry: {
        getAllAdapters: () => [],
        getStatus: () => new Map(),
        isAllConnected: () => true,
      },
    } as unknown as AppContext;

    server.setContext(mockContext);
    server.start();

    try {
      const response = await fetch("http://localhost:8087/ready");
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(data.ready, true);
    } finally {
      await server.stop();
    }
  },
);

Deno.test("HealthCheckServer - handles /readyz endpoint", async () => {
  const server = new HealthCheckServer(8088);
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      getStatus: () => new Map(),
      isAllConnected: () => false,
    },
  } as unknown as AppContext;

  server.setContext(mockContext);
  server.start();

  try {
    const response = await fetch("http://localhost:8088/readyz");
    assertEquals(response.status, 503);

    const data = await response.json();
    assertEquals(data.ready, false);
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - returns 404 for unknown paths", async () => {
  const server = new HealthCheckServer(8089);
  server.start();

  try {
    const response = await fetch("http://localhost:8089/unknown");
    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Not Found");
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - health status reflects platform state", async () => {
  const server = new HealthCheckServer(8090);
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      getStatus: () =>
        new Map([
          ["discord", {
            state: ConnectionState.CONNECTED,
            reconnectAttempts: 0,
          }],
          ["misskey", {
            state: ConnectionState.RECONNECTING,
            reconnectAttempts: 2,
            lastError: "Connection timeout",
          }],
        ]),
      isAllConnected: () => false,
    },
  } as unknown as AppContext;

  server.setContext(mockContext);
  server.start();

  try {
    const response = await fetch("http://localhost:8090/health");
    const data = await response.json();

    assertEquals(data.status, "degraded");
    assertEquals(data.checks.length, 2);

    const discordCheck = data.checks.find((c: { name: string }) => c.name === "platform:discord");
    assertEquals(discordCheck.status, "pass");

    const misskeyCheck = data.checks.find((c: { name: string }) => c.name === "platform:misskey");
    assertEquals(misskeyCheck.status, "warn");
    assertEquals(misskeyCheck.message, "Connection timeout");
  } finally {
    await server.stop();
  }
});

Deno.test("HealthCheckServer - health status shows unhealthy for errors", async () => {
  const server = new HealthCheckServer(8091);
  const mockContext = {
    config: {},
    agentCore: {},
    platformRegistry: {
      getAllAdapters: () => [],
      getStatus: () =>
        new Map([
          ["discord", {
            state: ConnectionState.ERROR,
            reconnectAttempts: 5,
            lastError: "Auth failed",
          }],
        ]),
      isAllConnected: () => false,
    },
  } as unknown as AppContext;

  server.setContext(mockContext);
  server.start();

  try {
    const response = await fetch("http://localhost:8091/health");
    assertEquals(response.status, 503);

    const data = await response.json();
    assertEquals(data.status, "unhealthy");

    const check = data.checks[0];
    assertEquals(check.status, "fail");
    assertEquals(check.message, "Auth failed");
  } finally {
    await server.stop();
  }
});

// Logger tests
Deno.test("configureLogger - sets log level from config", () => {
  configureLogger({ level: "DEBUG" });
  const logger = createLogger("test");
  assertExists(logger);
});

Deno.test("configureLogger - uses default level", () => {
  configureLogger({});
  const logger = createLogger("test");
  assertExists(logger);
});

Deno.test("configureLogger - handles format parameter", () => {
  configureLogger({ level: "INFO", format: "json" });
  const logger = createLogger("test");
  assertExists(logger);
});

Deno.test("configureLogger - handles invalid log level", () => {
  configureLogger({ level: "INVALID" });
  const logger = createLogger("test");
  assertExists(logger);
});

Deno.test("createLogger - creates logger with default config", () => {
  const logger = createLogger("test-module");
  assertExists(logger);
});

Deno.test("createLogger - uses environment variable", () => {
  const originalEnv = Deno.env.get("LOG_LEVEL");

  try {
    Deno.env.set("LOG_LEVEL", "WARN");
    const logger = createLogger("test-env");
    assertExists(logger);
  } finally {
    if (originalEnv) {
      Deno.env.set("LOG_LEVEL", originalEnv);
    } else {
      Deno.env.delete("LOG_LEVEL");
    }
  }
});
