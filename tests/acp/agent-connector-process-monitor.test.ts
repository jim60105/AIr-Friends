// tests/acp/agent-connector-process-monitor.test.ts

import { assertEquals } from "@std/assert";
import { AgentConnector } from "@acp/agent-connector.ts";
import { Logger, LogLevel } from "@utils/logger.ts";

import type { IdleTimeoutConfig } from "../../src/types/config.ts";

/**
 * Test suite for AgentConnector process exit monitoring and promptCompleted flag.
 * Covers monitorProcessExit, isProcessAlive, clearIdleMonitor, and config getters.
 */

interface LogEntry {
  level: string;
  message: string;
  context: unknown;
}

function createCapturingLogger(): { logger: Logger; logs: LogEntry[] } {
  const logs: LogEntry[] = [];
  const logger = new Logger("test", { level: LogLevel.DEBUG });
  logger.error = (message: string, context?: Record<string, unknown>) => {
    logs.push({ level: "error", message, context });
  };
  logger.warn = (message: string, context?: Record<string, unknown>) => {
    logs.push({ level: "warn", message, context });
  };
  logger.info = (message: string, context?: Record<string, unknown>) => {
    logs.push({ level: "info", message, context });
  };
  logger.debug = (message: string, context?: Record<string, unknown>) => {
    logs.push({ level: "debug", message, context });
  };
  return { logger, logs };
}

function createConnector(
  logger: Logger,
  idleTimeoutConfig?: IdleTimeoutConfig,
): AgentConnector {
  return new AgentConnector({
    agentConfig: {
      command: "echo",
      args: ["test"],
      cwd: "/tmp",
    },
    clientConfig: {
      workingDir: "/tmp/workspace",
      platform: "test",
      userId: "user1",
      channelId: "channel1",
      isDM: false,
    },
    skillRegistry: null,
    logger,
    idleTimeoutConfig,
  });
}

// A1. monitorProcessExit tests

Deno.test("monitorProcessExit - no ERROR when process === null (already disconnected)", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  // process is null by default, calling monitorProcessExit should be a no-op
  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);
});

Deno.test("monitorProcessExit - logs ERROR when process exits and promptCompleted is false", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  // Create a mock process that resolves immediately (simulating unexpected exit)
  const mockStatus = Promise.resolve({ code: 1, signal: null, success: false });
  connector["process"] = { status: mockStatus } as unknown as Deno.ChildProcess;
  connector["promptCompleted"] = false;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 1);
  assertEquals(errorLogs[0].message, "Agent process exited unexpectedly");
});

Deno.test("monitorProcessExit - logs DEBUG (not ERROR) when promptCompleted is true", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  const mockStatus = Promise.resolve({ code: 0, signal: null, success: true });
  connector["process"] = { status: mockStatus } as unknown as Deno.ChildProcess;
  connector["promptCompleted"] = true;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);

  const debugLogs = logs.filter((l) => l.level === "debug");
  assertEquals(debugLogs.length, 1);
  assertEquals(debugLogs[0].message, "Agent process exited after prompt completion");
});

Deno.test("monitorProcessExit - catch branch silently ignores process.status errors", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  const mockStatus = Promise.reject(new Error("process already killed"));
  connector["process"] = { status: mockStatus } as unknown as Deno.ChildProcess;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  // No error should be logged for the rejected status
  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);
});

// A3. isProcessAlive tests

Deno.test("isProcessAlive - returns false when process is null", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  const alive = await connector["isProcessAlive"]();
  assertEquals(alive, false);
});

Deno.test({
  name: "isProcessAlive - returns false when process has exited",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { logger } = createCapturingLogger();
    const connector = createConnector(logger);

    // Process that already resolved (exited)
    const mockStatus = Promise.resolve({ code: 0, signal: null, success: true });
    connector["process"] = { status: mockStatus } as unknown as Deno.ChildProcess;

    const alive = await connector["isProcessAlive"]();
    assertEquals(alive, false);
  },
});

Deno.test({
  name: "isProcessAlive - returns true when process is still running",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { logger } = createCapturingLogger();
    const connector = createConnector(logger);

    // Process that never resolves (still running)
    const mockStatus = new Promise<Deno.CommandStatus>(() => {});
    connector["process"] = { status: mockStatus } as unknown as Deno.ChildProcess;

    const alive = await connector["isProcessAlive"]();
    assertEquals(alive, true);
  },
});

// A4. clearIdleMonitor tests

Deno.test("clearIdleMonitor - clears interval and sets to null", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  const intervalId = setInterval(() => {}, 10000);
  connector["currentIdleMonitorIntervalId"] = intervalId;

  connector["clearIdleMonitor"]();
  assertEquals(connector["currentIdleMonitorIntervalId"], null);
});

Deno.test("clearIdleMonitor - safe to call multiple times", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  connector["clearIdleMonitor"]();
  connector["clearIdleMonitor"]();
  assertEquals(connector["currentIdleMonitorIntervalId"], null);
});

// A8. idle timeout config getter tests

Deno.test("idleTimeoutMs - uses config value when provided", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 60000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutMs"], 60000);
});

Deno.test("idleTimeoutMs - uses default when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleTimeoutMs"], 5 * 60 * 1000);
});

Deno.test("idleCheckIntervalMs - uses config value when provided", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 300000,
    checkIntervalMs: 10000,
  });

  assertEquals(connector["idleCheckIntervalMs"], 10000);
});

Deno.test("idleCheckIntervalMs - uses default when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleCheckIntervalMs"], 30 * 1000);
});

Deno.test("idleTimeoutEnabled - defaults to true when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleTimeoutEnabled"], true);
});

Deno.test("idleTimeoutEnabled - returns false when enabled is false", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: false,
    timeoutMs: 300000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutEnabled"], false);
});

Deno.test("idleTimeoutEnabled - returns true when enabled is true", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 300000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutEnabled"], true);
});

// promptCompleted flag reset tests

Deno.test("promptCompleted - defaults to false", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["promptCompleted"], false);
});

Deno.test("promptCompleted - can be set and read", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  connector["promptCompleted"] = true;
  assertEquals(connector["promptCompleted"], true);

  connector["promptCompleted"] = false;
  assertEquals(connector["promptCompleted"], false);
});
