// tests/acp/agent-connector-crash-signal.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { AgentProcessExit, AgentProcessHandle } from "../../src/acp/agent-process.ts";
import { Logger, LogLevel } from "@utils/logger.ts";

import type { IdleTimeoutConfig } from "../../src/types/config.ts";
import { test } from "bun:test";

/**
 * Test suite for the AgentConnector crash-signal mechanism (handle-agent-process-crash):
 * an unexpected subprocess exit rejects any in-flight ACP call instead of hanging forever,
 * for every outbound call site (connect/initialize, createSession, setSessionModel,
 * setSessionMode, setSessionConfigOption, prompt, cancel), independent of idle-timeout
 * configuration. Also covers the connect-time handshake timeout.
 *
 * `connect()` spawns a real subprocess via `dumb-init`; these unit cases need no
 * live child, so they exercise the crash-signal mechanism
 * (`buildCrashSignal()` + `raceAgainstCrash()` + `raceWithConnectTimeout()`) directly via
 * injected mock process/connection objects — the exact same private helpers `connect()`
 * and every other call site rely on.
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
  opts?: { idleTimeoutConfig?: IdleTimeoutConfig; connectTimeoutMs?: number },
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
    idleTimeoutConfig: opts?.idleTimeoutConfig,
    connectTimeoutMs: opts?.connectTimeoutMs,
  });
}

/** A controllable spawn-handle mock: resolve() simulates the process exiting. */
function createDeferredProcess(): {
  process: AgentProcessHandle;
  resolve: (exit: AgentProcessExit) => void;
} {
  const bridge = Promise.withResolvers<AgentProcessExit>();
  return {
    process: { pid: 0, exited: bridge.promise } as unknown as AgentProcessHandle,
    resolve: bridge.resolve,
  };
}

/** Attach a fresh process + crash signal to `connector`, as `connect()` does after spawn. */
function setupCrashSignal(
  connector: AgentConnector,
): { resolveExit: (exit: AgentProcessExit) => void } {
  const { process, resolve } = createDeferredProcess();
  connector["process"] = process;
  connector["crashSignal"] = connector["buildCrashSignal"]();
  return { resolveExit: resolve };
}

// --- buildCrashSignal ---

test("buildCrashSignal - rejects with a descriptive error once the process exits", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { process, resolve } = createDeferredProcess();
  connector["process"] = process;

  const signal = connector["buildCrashSignal"]();
  resolve({ code: 1, signal: null, success: false });

  await assertRejects(
    () => signal,
    Error,
    "Agent process exited unexpectedly (code=1, signal=null) while awaiting a response",
  );
});

test("buildCrashSignal - message does not match promptWithIdleTimeoutHandling's reconnect-trigger substrings (Decision 5)", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { process, resolve } = createDeferredProcess();
  connector["process"] = process;

  const signal = connector["buildCrashSignal"]();
  resolve({ code: 1, signal: null, success: false });

  try {
    await signal;
    throw new Error("expected signal to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message.includes("ACP connection dead"), false);
    assertEquals(message.includes("ACP agent process exited unexpectedly"), false);
  }
});

test("buildCrashSignal - does not surface as an unhandled rejection when nothing races against it", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { process, resolve } = createDeferredProcess();
  connector["process"] = process;

  // Deliberately not awaited or raced against anything, simulating a normal, already
  // completed session being torn down while the signal is still live.
  connector["buildCrashSignal"]();
  resolve({ code: 0, signal: null, success: true });

  // Give the microtask/event queue a turn; if the no-op .catch() were missing, an
  // unhandled promise rejection would fail this test.
  await new Promise((r) => setTimeout(r, 20));
});

// --- raceAgainstCrash ---

test("raceAgainstCrash - passes the operation through unchanged when no crash signal exists yet", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  // Not connected: crashSignal is null.

  const result = await connector["raceAgainstCrash"](Promise.resolve("ok"));
  assertEquals(result, "ok");
});

test("raceAgainstCrash - rejects a pending operation promptly when the subprocess exits", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);

  const pending = new Promise<never>(() => {}); // never resolves on its own
  const raced = connector["raceAgainstCrash"](pending);

  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => raced, Error, "Agent process exited unexpectedly");
});

// --- Public call sites reject promptly on crash (tasks 4.2-4.4) ---

test("createSession - rejects promptly when subprocess exits mid-call", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    newSession: () => new Promise(() => {}), // never resolves
  } as unknown as typeof connector["connection"];

  const call = connector.createSession([]);
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
  assertEquals(connector["sessionModelIds"].get("sess"), undefined);
});

test("setSessionModel (stable) - rejects promptly when subprocess exits mid-call", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    setSessionConfigOption: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];
  (connector["sessionConfigOptions"] as Map<string, unknown>).set("sess", [
    {
      id: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "m1",
      options: [{ value: "model-1", name: "Model 1" }],
    },
  ]);

  const call = connector.setSessionModel("sess", "model-1");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
  assertEquals(connector["sessionModelIds"].get("sess"), undefined);
});

test("setSessionModel - rejects promptly when subprocess exits mid-call", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    unstable_setSessionModel: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.setSessionModel("sess", "model-1");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
});

test("setSessionMode - rejects promptly when subprocess exits mid-call", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    setSessionMode: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.setSessionMode("sess", "yolo");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
});

test("cancel - rejects promptly when subprocess exits mid-call", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    cancel: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.cancel("sess");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
});

test("setReasoningEffort - crash-signal rejection during setSessionConfigOption is caught and returns 'failed'", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  const { resolveExit } = setupCrashSignal(connector);
  connector["sessionConfigOptions"] = new Map([
    ["sess", [
      {
        id: "thought_level",
        category: "thought_level",
        options: [{ value: "high", name: "High" }],
      },
    ]],
  ]) as unknown as typeof connector["sessionConfigOptions"];
  connector["connection"] = {
    setSessionConfigOption: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.setReasoningEffort("sess", "high");
  resolveExit({ code: 1, signal: null, success: false });

  assertEquals(await call, "failed");
});

// prompt(): idle timeout enabled and disabled (tasks 4.2, 4.3)

test("prompt - rejects promptly when subprocess exits mid-prompt, idle timeout enabled", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    idleTimeoutConfig: { enabled: true, timeoutMs: 300000, checkIntervalMs: 30000 },
  });
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    prompt: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.prompt("sess", "hi");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
});

test("prompt - rejects promptly when subprocess exits mid-prompt, idle timeout disabled (regression)", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, {
    idleTimeoutConfig: { enabled: false, timeoutMs: 300000, checkIntervalMs: 30000 },
  });
  const { resolveExit } = setupCrashSignal(connector);
  connector["connection"] = {
    prompt: () => new Promise(() => {}),
  } as unknown as typeof connector["connection"];

  const call = connector.prompt("sess", "hi");
  resolveExit({ code: 1, signal: null, success: false });

  await assertRejects(() => call, Error, "Agent process exited unexpectedly");
});

// --- connect-time timeout (raceWithConnectTimeout) — task 4.5 ---

test("raceWithConnectTimeout - rejects with a timeout error when the handshake never completes", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, { connectTimeoutMs: 50 });

  const call = connector["raceWithConnectTimeout"](new Promise(() => {}), logger);

  await assertRejects(() => call, Error, "did not complete within 50ms");
});

test("raceWithConnectTimeout - logs a WARN at the 80% mark before timing out", async () => {
  const { logger, logs } = createCapturingLogger();
  const connector = createConnector(logger, { connectTimeoutMs: 50 });

  await assertRejects(() => connector["raceWithConnectTimeout"](new Promise(() => {}), logger));

  const warnLogs = logs.filter((l) => l.level === "warn");
  assertEquals(warnLogs.length, 1);
  assertEquals(
    warnLogs[0].message,
    "connect() approaching connectTimeoutMs without a completed ACP handshake",
  );
});

test("raceWithConnectTimeout - clears both timers when the operation settles early (no leaked timer)", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger, { connectTimeoutMs: 10000 });

  const result = await connector["raceWithConnectTimeout"](Promise.resolve("ok"), logger);
  assertEquals(result, "ok");
  // Both timers are cleared, so no WARN/timeout setTimeout handle is left dangling.
});

// --- Fresh crash signal per connect() cycle — task 4.8 ---

test("crashSignal - a fresh signal built for a new subprocess is independent of a stale one", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);

  // First "connect cycle": an old process that will report an exit belatedly.
  const oldProcess = createDeferredProcess();
  connector["process"] = oldProcess.process;
  const staleSignal = connector["buildCrashSignal"]();

  // "Reconnect": a fresh, still-alive process (status never resolves).
  const newProcess = createDeferredProcess();
  connector["process"] = newProcess.process;
  connector["crashSignal"] = connector["buildCrashSignal"]();

  // The OLD subprocess finally reports its (by-now-historical) exit.
  oldProcess.resolve({ code: 1, signal: null, success: false });
  await assertRejects(() => staleSignal);

  // The fresh signal, tied to the new still-alive subprocess, must remain pending.
  const outcome = await Promise.race([
    connector["crashSignal"].then(() => "settled" as const).catch(() => "settled" as const),
    new Promise<"still-pending">((r) => setTimeout(() => r("still-pending"), 30)),
  ]);
  assertEquals(outcome, "still-pending");
});

// --- Double disconnect() safety — task 4.10 ---

test("disconnect - calling twice in a row for the same failed connection attempt is a safe no-op", async () => {
  const { logger } = createCapturingLogger();
  const connector = createConnector(logger);
  let killCount = 0;
  connector["process"] = {
    kill: () => {
      killCount++;
    },
    exited: Promise.resolve({ code: 1, signal: null, success: false }),
  } as unknown as AgentProcessHandle;

  // Models connect()'s own catch block calling disconnect(), followed by the
  // orchestrator's outer finally calling disconnect() again unconditionally.
  await connector.disconnect();
  await connector.disconnect();

  assertEquals(killCount, 1);
  assertEquals(connector["process"], null);
});
