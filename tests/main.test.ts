// tests/main.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { test } from "bun:test";
import { parseCliArgs } from "../src/main.ts";
import { ShutdownHandler } from "../src/shutdown.ts";
import { HealthCheckServer } from "../src/healthcheck.ts";
import { configureLogger, createLogger } from "../src/utils/logger.ts";
import type { AppContext } from "../src/bootstrap.ts";
import { ConnectionState } from "../src/types/platform.ts";

// ShutdownHandler tests
test("ShutdownHandler - initial state", () => {
  const handler = new ShutdownHandler();
  assertEquals(handler.isShutdownInProgress(), false);
});

test("ShutdownHandler - can set context", () => {
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

test("ShutdownHandler - shutdown without context", async () => {
  const handler = new ShutdownHandler();

  // Mock process.exit to prevent the test from exiting
  const originalExit = process.exit;
  let exitCode = -1;
  process.exit = ((code: number) => {
    exitCode = code;
  }) as typeof process.exit;

  try {
    await handler.shutdown();
    assertEquals(exitCode, 0);
    assertEquals(handler.isShutdownInProgress(), true);
  } finally {
    process.exit = originalExit;
  }
});

test("ShutdownHandler - shutdown with context", async () => {
  const handler = new ShutdownHandler();
  let disconnectCalled = false;
  let shutdownCalled = false;

  const mockContext = {
    config: {},
    agentCore: {
      shutdown: () => {
        shutdownCalled = true;
        return Promise.resolve();
      },
    },
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => {
        disconnectCalled = true;
        return Promise.resolve();
      },
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);

  const originalExit = process.exit;
  let exitCode = -1;
  process.exit = ((code: number) => {
    exitCode = code;
  }) as typeof process.exit;

  try {
    await handler.shutdown();
    assertEquals(shutdownCalled, true);
    assertEquals(disconnectCalled, true);
    assertEquals(exitCode, 0);
    assertEquals(handler.isShutdownInProgress(), true);
  } finally {
    process.exit = originalExit;
  }
});

test("ShutdownHandler - shutdown stops memoryMaintenanceScheduler", async () => {
  const handler = new ShutdownHandler();
  let maintenanceStopCalled = false;

  const mockContext = {
    config: {},
    agentCore: {
      shutdown: () => Promise.resolve(),
    },
    platformRegistry: {
      getAllAdapters: () => [],
      disconnectAll: () => Promise.resolve(),
    },
    memoryMaintenanceScheduler: {
      stop: () => {
        maintenanceStopCalled = true;
      },
    },
  } as unknown as AppContext;

  handler.setContext(mockContext);

  const originalExit = process.exit;
  process.exit = ((_code: number) => {}) as typeof process.exit;

  try {
    await handler.shutdown();
    assertEquals(maintenanceStopCalled, true);
  } finally {
    process.exit = originalExit;
  }
});

test("ShutdownHandler - shutdown handles errors", async () => {
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

  const originalExit = process.exit;
  let exitCode = -1;
  process.exit = ((code: number) => {
    exitCode = code;
  }) as typeof process.exit;

  try {
    await handler.shutdown();
    assertEquals(exitCode, 1);
  } finally {
    process.exit = originalExit;
  }
});

test("ShutdownHandler - prevents duplicate shutdown", async () => {
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

  const originalExit = process.exit;
  let exitCount = 0;
  process.exit = ((_code: number) => {
    exitCount++;
  }) as typeof process.exit;

  try {
    // Start first shutdown
    const promise1 = handler.shutdown();
    // Try to start second shutdown
    const promise2 = handler.shutdown();

    await Promise.all([promise1, promise2]);
    // Should only exit once
    assertEquals(exitCount, 1);
  } finally {
    process.exit = originalExit;
  }
});

// HealthCheckServer tests
test("HealthCheckServer - can be instantiated", () => {
  const server = new HealthCheckServer(8081);
  assertExists(server);
});

test("HealthCheckServer - can set context", () => {
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

test("HealthCheckServer - start and stop", async () => {
  const server = new HealthCheckServer(8083);

  // Start server
  server.start();

  // Give it a moment to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Stop server
  await server.stop();
});

test("HealthCheckServer - handles /health endpoint", async () => {
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

test("HealthCheckServer - handles /healthz endpoint", async () => {
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

test("HealthCheckServer - handles /ready endpoint without context", async () => {
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

test("HealthCheckServer - handles /ready endpoint with connected platforms", async () => {
  const server = new HealthCheckServer(8087);
  const mockContext = {
    config: {
      agent: { skillsDir: "/nonexistent-skills-dir" },
      workspace: { repoPath: "/tmp" },
    },
    agentCore: {
      getSkillRegistry: () => ({
        getAvailableSkills: () => [],
      }),
    },
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

    const data = await response.json();
    assertEquals(data.platforms, true);
    assertEquals(typeof data.skillReadiness, "object");
    assertEquals(typeof data.skillReadiness.allReady, "boolean");
    // Overall ready depends on both platforms AND skill readiness (binary availability)
    assertEquals(data.ready, data.platforms && data.skillReadiness.allReady);
  } finally {
    await server.stop();
  }
});

test("HealthCheckServer - handles /readyz endpoint", async () => {
  const server = new HealthCheckServer(8088);
  const mockContext = {
    config: {
      agent: { skillsDir: "/nonexistent-skills-dir" },
      workspace: { repoPath: "/tmp" },
    },
    agentCore: {
      getSkillRegistry: () => ({
        getAvailableSkills: () => [],
      }),
    },
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

test("HealthCheckServer - returns 404 for unknown paths", async () => {
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

test("HealthCheckServer - health status reflects platform state", async () => {
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

test("HealthCheckServer - health status shows unhealthy for errors", async () => {
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
test("configureLogger - sets log level from config", () => {
  configureLogger({ level: "DEBUG" });
  const logger = createLogger("test");
  assertExists(logger);
});

test("configureLogger - uses default level", () => {
  configureLogger({});
  const logger = createLogger("test");
  assertExists(logger);
});

test("configureLogger - handles format parameter", () => {
  configureLogger({ level: "INFO", format: "json" });
  const logger = createLogger("test");
  assertExists(logger);
});

test("configureLogger - handles invalid log level", () => {
  configureLogger({ level: "INVALID" });
  const logger = createLogger("test");
  assertExists(logger);
});

test("createLogger - creates logger with default config", () => {
  const logger = createLogger("test-module");
  assertExists(logger);
});

test("createLogger - uses environment variable", () => {
  const originalEnv = process.env["LOG_LEVEL"];

  try {
    process.env["LOG_LEVEL"] = "WARN";
    const logger = createLogger("test-env");
    assertExists(logger);
  } finally {
    if (originalEnv !== undefined) {
      process.env["LOG_LEVEL"] = originalEnv;
    } else {
      delete process.env["LOG_LEVEL"];
    }
  }
});

// parseCliArgs tests - the argument behavior kept from @std/flags
test("parseCliArgs - defaults for no arguments", () => {
  assertEquals(parseCliArgs([]), {
    config: undefined,
    help: false,
    yolo: false,
    dryRun: false,
  });
});

test("parseCliArgs - accepts the long config option", () => {
  assertEquals(parseCliArgs(["--config", "./my-config.yaml"]).config, "./my-config.yaml");
  assertEquals(parseCliArgs(["--config=./my-config.yaml"]).config, "./my-config.yaml");
});

test("parseCliArgs - accepts the short config alias", () => {
  assertEquals(parseCliArgs(["-c", "./my-config.yaml"]).config, "./my-config.yaml");
  assertEquals(parseCliArgs(["-c=./my-config.yaml"]).config, "./my-config.yaml");
  assertEquals(parseCliArgs(["-c="]).config, undefined);
});

test("parseCliArgs - bare config option keeps its empty-string value", () => {
  assertEquals(parseCliArgs(["--config"]).config, "");
  assertEquals(parseCliArgs(["-c"]).config, "");
});

test("parseCliArgs - config option never consumes the next flag", () => {
  const args = parseCliArgs(["--config", "--yolo"]);
  assertEquals(args.config, "");
  assertEquals(args.yolo, true);
});

test("parseCliArgs - help flag", () => {
  assertEquals(parseCliArgs(["--help"]).help, true);
  assertEquals(parseCliArgs(["-h"]).help, true);
  assertEquals(parseCliArgs(["--help=false"]).help, false);
  assertEquals(parseCliArgs(["--help", "false"]).help, false);
});

test("parseCliArgs - boolean flags", () => {
  assertEquals(parseCliArgs(["--yolo"]).yolo, true);
  assertEquals(parseCliArgs(["--yolo=true"]).yolo, true);
  assertEquals(parseCliArgs(["--yolo=false"]).yolo, false);
  assertEquals(parseCliArgs(["--yolo", "false"]).yolo, false);
  assertEquals(parseCliArgs(["--dry-run"]).dryRun, true);
  assertEquals(parseCliArgs(["--dry-run=false"]).dryRun, false);
});

test("parseCliArgs - unknown flags and positionals are tolerated", () => {
  assertEquals(parseCliArgs(["--unknown", "positional", "--dry-run"]), {
    config: undefined,
    help: false,
    yolo: false,
    dryRun: true,
  });
});

test("parseCliArgs - arguments after -- are positionals", () => {
  const args = parseCliArgs(["--yolo", "--", "--dry-run"]);
  assertEquals(args.yolo, true);
  assertEquals(args.dryRun, false);
});
