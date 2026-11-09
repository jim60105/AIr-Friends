// tests/acp/agent-connector-process-monitor.test.ts

import { assert, assertEquals } from "@std/assert";
import { AgentConnector } from "@acp/agent-connector.ts";
import { Logger, LogLevel } from "@utils/logger.ts";

import {
  type AgentProcessExit,
  type AgentProcessHandle,
  createAgentProcess,
} from "../../src/acp/agent-process.ts";
import {
  killProcessTree,
  listDescendantPids,
  processAlive,
} from "../../src/utils/process-lifecycle.ts";
import fsp from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IdleTimeoutConfig } from "../../src/types/config.ts";
import { test } from "bun:test";

/**
 * Test suite for AgentConnector process exit monitoring and intentionalShutdown flag.
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
    agentType: "opencode",
    idleTimeoutConfig,
  });
}

// A1. monitorProcessExit tests

test("monitorProcessExit - no ERROR when process === null (already disconnected)", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  // process is null by default, calling monitorProcessExit should be a no-op
  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);
});

test("monitorProcessExit - logs ERROR when process exits and intentionalShutdown is false", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  // Create a mock process that resolves immediately (simulating unexpected exit)
  const mockStatus = Promise.resolve({ code: 1, signal: null, success: false });
  connector["process"] = { exited: mockStatus } as unknown as AgentProcessHandle;
  connector["intentionalShutdown"] = false;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 1);
  assertEquals(errorLogs[0].message, "Agent process exited unexpectedly");
});

test("monitorProcessExit - logs DEBUG (not ERROR) when intentionalShutdown is true", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  const mockStatus = Promise.resolve({ code: 0, signal: null, success: true });
  connector["process"] = { exited: mockStatus } as unknown as AgentProcessHandle;
  connector["intentionalShutdown"] = true;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);

  const debugLogs = logs.filter((l) => l.level === "debug");
  assertEquals(debugLogs.length, 1);
  assertEquals(debugLogs[0].message, "Agent process exited after intentional shutdown");
});

test("monitorProcessExit - catch branch silently ignores process.status errors", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger);

  const mockStatus = Promise.reject(new Error("process already killed"));
  connector["process"] = { exited: mockStatus } as unknown as AgentProcessHandle;

  connector["monitorProcessExit"](logger);

  await new Promise((r) => setTimeout(r, 50));

  // No error should be logged for the rejected status
  const errorLogs = logs.filter((l) => l.level === "error");
  assertEquals(errorLogs.length, 0);
});

// A3. isProcessAlive tests

test("isProcessAlive - returns false when process is null", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  const alive = await connector["isProcessAlive"]();
  assertEquals(alive, false);
});

test("isProcessAlive - returns false when process has exited", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  // Process that already resolved (exited)
  const mockStatus = Promise.resolve({ code: 0, signal: null, success: true });
  connector["process"] = { exited: mockStatus } as unknown as AgentProcessHandle;

  const alive = await connector["isProcessAlive"]();
  assertEquals(alive, false);
});

test("isProcessAlive - returns true when process is still running", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  // Process that never resolves (still running)
  const mockStatus = Promise.withResolvers<AgentProcessExit>().promise;
  connector["process"] = { exited: mockStatus } as unknown as AgentProcessHandle;

  const alive = await connector["isProcessAlive"]();
  assertEquals(alive, true);
});

// A4. clearIdleMonitor tests

test("clearIdleMonitor - clears interval and sets to null", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  const intervalId = setInterval(() => {}, 10000);
  connector["currentIdleMonitorIntervalId"] = intervalId;

  connector["clearIdleMonitor"]();
  assertEquals(connector["currentIdleMonitorIntervalId"], null);
});

test("clearIdleMonitor - safe to call multiple times", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  connector["clearIdleMonitor"]();
  connector["clearIdleMonitor"]();
  assertEquals(connector["currentIdleMonitorIntervalId"], null);
});

// A8. idle timeout config getter tests

test("idleTimeoutMs - uses config value when provided", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 60000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutMs"], 60000);
});

test("idleTimeoutMs - uses default when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleTimeoutMs"], 5 * 60 * 1000);
});

test("idleCheckIntervalMs - uses config value when provided", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 300000,
    checkIntervalMs: 10000,
  });

  assertEquals(connector["idleCheckIntervalMs"], 10000);
});

test("idleCheckIntervalMs - uses default when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleCheckIntervalMs"], 30 * 1000);
});

test("idleTimeoutEnabled - defaults to true when not configured", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["idleTimeoutEnabled"], true);
});

test("idleTimeoutEnabled - returns false when enabled is false", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: false,
    timeoutMs: 300000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutEnabled"], false);
});

test("idleTimeoutEnabled - returns true when enabled is true", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    enabled: true,
    timeoutMs: 300000,
    checkIntervalMs: 30000,
  });

  assertEquals(connector["idleTimeoutEnabled"], true);
});

// intentionalShutdown flag reset tests

test("intentionalShutdown - defaults to false", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  assertEquals(connector["intentionalShutdown"], false);
});

test("intentionalShutdown - can be set and read", () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  connector["intentionalShutdown"] = true;
  assertEquals(connector["intentionalShutdown"], true);

  connector["intentionalShutdown"] = false;
  assertEquals(connector["intentionalShutdown"], false);
});

// Escalated disconnect reaps the agent process tree (real descendant processes).

const SIGKILL_WARNING = "Agent process did not exit within SIGTERM timeout, sending SIGKILL";

/**
 * The agent ignores SIGTERM and starts a grandchild that ignores it too, so a
 * wrapper-only SIGKILL would leave both running (the Go record's
 * `sigkillSurvivors`).
 */
const IGNORE_TERM_PARENT_FIXTURE = `
process.on("SIGTERM", () => {});
Bun.spawn(["sh", "-c", "trap '' TERM; sleep 600"], { stdout: "ignore", stderr: "ignore" });
setInterval(() => {}, 1000);
`;

/** The agent exits on SIGTERM: the connector must not escalate. */
const EXIT_ON_TERM_FIXTURE = `
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

/** One real agent process tree; the returned fixture dir is removed by teardown. */
async function startFixture(
  fixtureSource: string,
  expectedDescendants: number,
): Promise<{
  connector: AgentConnector;
  logs: LogEntry[];
  pid: number;
  descendants: number[];
  fixtureDir: string;
}> {
  const fixtureDir = await fsp.mkdtemp(join(tmpdir(), "agent-connector-tree-"));
  let handle: AgentProcessHandle | undefined;
  try {
    const fixture = join(fixtureDir, "fixture.ts");
    await fsp.writeFile(fixture, fixtureSource);
    const { logger, logs } = createCapturingLogger();
    const connector = createConnector(logger);
    handle = createAgentProcess({
      command: process.execPath,
      args: ["run", "--no-env-file", fixture],
      cwd: fixtureDir,
      env: { PATH: process.env["PATH"] ?? "" },
    });
    connector["process"] = handle;
    const descendants = await waitForDescendants(handle.pid, expectedDescendants);
    return { connector, logs, pid: handle.pid, descendants, fixtureDir };
  } catch (error) {
    // A readiness failure must not leak the spawned tree or the temp root.
    if (handle !== undefined) await killProcessTree(handle.pid, "SIGKILL").catch(() => {});
    await fsp.rm(fixtureDir, { recursive: true }).catch(() => {});
    throw error;
  }
}

test("Escalated Disconnect Reaps The Agent Process Tree - child ignoring SIGTERM", async () => {
  // The wrapper's child is the agent fixture; beneath it is the SIGTERM-
  // ignoring `sh -c` command (`sleep` may replace the shell via exec).
  const fixture = await startFixture(IGNORE_TERM_PARENT_FIXTURE, 2);
  try {
    // Wrapper -> agent fixture -> sh -> sleep: all but the wrapper ignore
    // SIGTERM, so only the escalated SIGKILL can reap them.
    await fixture.connector.disconnect();

    await waitForGone([fixture.pid, ...fixture.descendants], 1_000);
    assertEquals(await processAlive(fixture.pid), false);
    for (const pid of fixture.descendants) {
      assertEquals(await processAlive(pid), false, `descendant ${pid} survived the escalation`);
    }
    assert(
      fixture.logs.some((entry) => entry.level === "warn" && entry.message === SIGKILL_WARNING),
      "the 2-second grace period must have expired before escalation",
    );
  } finally {
    await killProcessTree(fixture.pid, "SIGKILL").catch(() => {});
    // The wrapper may already be gone; the recorded descendants must still die.
    for (const pid of fixture.descendants) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await fsp.rm(fixture.fixtureDir, { recursive: true }).catch(() => {});
  }
});

test("Escalated Disconnect Reaps The Agent Process Tree - graceful exit is not escalated", async () => {
  const fixture = await startFixture(EXIT_ON_TERM_FIXTURE, 1);
  try {
    await fixture.connector.disconnect();

    assertEquals(await processAlive(fixture.pid), false);
    assertEquals(
      fixture.logs.some((entry) => entry.level === "warn" && entry.message === SIGKILL_WARNING),
      false,
      "a SIGTERM exit inside the grace period must never escalate",
    );
    for (const pid of fixture.descendants) {
      assertEquals(await processAlive(pid), false, `descendant ${pid} must exit with the agent`);
    }
  } finally {
    await killProcessTree(fixture.pid, "SIGKILL").catch(() => {});
    // The wrapper may already be gone; the recorded descendants must still die.
    for (const pid of fixture.descendants) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await fsp.rm(fixture.fixtureDir, { recursive: true }).catch(() => {});
  }
});

/**
 * Real delay: a spawned kernel process's arrival and death are OS events, not
 * timers under test control, so these barriers poll the kernel within a bounded
 * deadline (the sanctioned exception; no guessed single sleep).
 */
async function waitForDescendants(pid: number, expected: number): Promise<number[]> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const descendants = await listDescendantPids(pid);
    if (descendants.ok && descendants.pids.length >= expected) return descendants.pids;
    await delay(10);
  }
  throw new Error(`wrapper ${pid} never reached ${expected} descendants`);
}

/** Bounded wait until every PID is gone; throws naming the survivors. */
async function waitForGone(pids: number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive: number[] = [];
    for (const pid of pids) {
      if (await processAlive(pid)) alive.push(pid);
    }
    if (alive.length === 0) return;
    await delay(20);
  }
  const survivors: number[] = [];
  for (const pid of pids) {
    if (await processAlive(pid)) survivors.push(pid);
  }
  throw new Error(`processes still alive after teardown: ${survivors.join(", ")}`);
}

/** A small real delay for bounded kernel polling. */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
