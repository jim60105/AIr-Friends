// tests/core/shutdown-signals.test.ts
//
// Signal delivery and process-level error hooks can only be observed in a real
// process, so each test writes a small script to a temporary directory, runs it
// with the current Bun executable, and asserts on the markers it prints. The
// child scripts await the events they assert on instead of sleeping, except
// where only the production restart path's own timer can trigger the signal.

import { assert, assertEquals } from "@std/assert";
import { test } from "bun:test";
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

const SHUTDOWN_MODULE = new URL("../../src/shutdown.ts", import.meta.url).href;
const ERROR_HANDLER_MODULE = new URL("../../src/core/error-handler.ts", import.meta.url).href;
const ERRORS_MODULE = new URL("../../src/types/errors.ts", import.meta.url).href;
const DASHBOARD_SERVER_MODULE = new URL("../../src/dashboard/server.ts", import.meta.url).href;
const COMPLETED_SESSION_STORE_MODULE =
  new URL("../../src/dashboard/completed-session-store.ts", import.meta.url).href;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface ChildRun {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
}

async function runChildScript(body: string): Promise<ChildRun> {
  const directory = await makeTempDir();
  const scriptPath = `${directory}/child.ts`;
  await fsp.writeFile(scriptPath, body);
  try {
    const result = spawnSync(process.execPath, ["run", "--no-env-file", scriptPath], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      killSignal: "SIGKILL",
      env: { ...process.env, LOG_LEVEL: "INFO" },
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

function assertExitedWith(run: ChildRun, expectedCode: number): void {
  const output = `${run.stdout}\n${run.stderr}`;
  assertEquals(run.error, undefined, `child failed: ${run.error?.message}\n${output}`);
  assertEquals(run.signal, null, `child was killed by ${run.signal}\n${output}`);
  assertEquals(run.status, expectedCode, `child exited ${run.status}\n${output}`);
}

function countOccurrences(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

test("Shutdown signals - self-sent SIGTERM runs the shutdown handler once", async () => {
  const run = await runChildScript(`
import { ShutdownHandler } from ${JSON.stringify(SHUTDOWN_MODULE)};

const handler = new ShutdownHandler();
handler.setContext({
  config: {},
  agentCore: {
    shutdown: async () => {
      console.log("MARKER agent-core-stopped");
    },
  },
  platformRegistry: {
    getAllAdapters: () => [],
    disconnectAll: async () => {
      console.log("MARKER platforms-disconnected");
    },
  },
});
handler.registerSignalHandlers();
console.log("MARKER handlers-registered");
process.kill(process.pid, "SIGTERM");
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER handlers-registered"), run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER agent-core-stopped"), 1, run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER platforms-disconnected"), 1, run.stdout);
});

test("Shutdown signals - shutdown handler and global error handler both run on SIGINT", async () => {
  const run = await runChildScript(`
import { ShutdownHandler } from ${JSON.stringify(SHUTDOWN_MODULE)};
import { setupGlobalErrorHandler } from ${JSON.stringify(ERROR_HANDLER_MODULE)};

const { promise: shutdownEvent, resolve: markShutdownEvent } = Promise.withResolvers();
let shutdownEvents = 0;
globalThis.addEventListener("shutdown", () => {
  shutdownEvents += 1;
  console.log("MARKER shutdown-event:" + shutdownEvents);
  markShutdownEvent();
});

const handler = new ShutdownHandler();
handler.setContext({
  config: {},
  agentCore: {
    shutdown: async () => {
      await shutdownEvent;
      console.log("MARKER shutdown-flow");
    },
  },
  platformRegistry: {
    getAllAdapters: () => [],
    disconnectAll: async () => {},
  },
});
handler.registerSignalHandlers();
setupGlobalErrorHandler({ enableGracefulShutdown: true });
console.log("MARKER handlers-registered");
process.kill(process.pid, "SIGINT");
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER handlers-registered"), run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER shutdown-flow"), 1, run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER shutdown-event:"), 1, run.stdout);
});

test("Shutdown signals - duplicate signals dispatch the shutdown event once", async () => {
  const run = await runChildScript(`
import {
  isGracefulShutdownInProgress,
  setupGlobalErrorHandler,
} from ${JSON.stringify(ERROR_HANDLER_MODULE)};

const { promise: firstEvent, resolve: markFirstEvent } = Promise.withResolvers();
let shutdownEvents = 0;
globalThis.addEventListener("shutdown", () => {
  shutdownEvents += 1;
  console.log("MARKER shutdown-event:" + shutdownEvents);
  markFirstEvent();
});

setupGlobalErrorHandler({ enableGracefulShutdown: true });
console.log("MARKER handlers-registered");
process.kill(process.pid, "SIGTERM");
await firstEvent;

// A second signal is only meaningful once its delivery is observed, so a probe
// listener that was registered after the first event reports that delivery.
const { promise: secondSignal, resolve: markSecondSignal } = Promise.withResolvers();
let probeSawSignal = false;
process.on("SIGTERM", () => {
  if (probeSawSignal) return;
  probeSawSignal = true;
  markSecondSignal();
});
process.kill(process.pid, "SIGTERM");
await secondSignal;

console.log("MARKER events:" + shutdownEvents);
console.log("MARKER in-progress:" + isGracefulShutdownInProgress());
process.exit(0);
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER events:1"), run.stdout);
  assert(run.stdout.includes("MARKER in-progress:true"), run.stdout);
});

test("Global error handler - unhandled rejection is logged and the process keeps running", async () => {
  const run = await runChildScript(`
import { setupGlobalErrorHandler } from ${JSON.stringify(ERROR_HANDLER_MODULE)};
import { ConfigError, ErrorCode } from ${JSON.stringify(ERRORS_MODULE)};

setupGlobalErrorHandler();
Promise.reject(new ConfigError(ErrorCode.CONFIG_NOT_FOUND, "config missing"));

const { promise: nextTurn, resolve: endTurn } = Promise.withResolvers();
setImmediate(endTurn);
await nextTurn;
console.log("MARKER still-running");
process.exit(0);
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER still-running"), run.stdout);
  assert(run.stderr.includes("Unhandled promise rejection"), run.stderr);
  assert(run.stderr.includes('"level":"ERROR"'), run.stderr);
  assert(run.stderr.includes('"code":1001'), run.stderr);
  assert(run.stderr.includes('"stack"'), run.stderr);
});

test("Global error handler - uncaught error is fatal, invokes the callback, and keeps running", async () => {
  const run = await runChildScript(`
import { setupGlobalErrorHandler } from ${JSON.stringify(ERROR_HANDLER_MODULE)};

const { promise: fatalSeen, resolve: markFatal } = Promise.withResolvers();
setupGlobalErrorHandler({
  onFatalError: (error) => {
    console.log("MARKER fatal-callback:" + (error instanceof Error ? error.message : String(error)));
    markFatal();
  },
});
setTimeout(() => {
  throw new Error("kaboom");
}, 0);
await fatalSeen;
console.log("MARKER still-running");
process.exit(0);
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER fatal-callback:kaboom"), run.stdout);
  assert(run.stdout.includes("MARKER still-running"), run.stdout);
  assert(run.stderr.includes("Uncaught error"), run.stderr);
  assert(run.stderr.includes('"level":"FATAL"'), run.stderr);
  assert(run.stderr.includes('"message":"kaboom"'), run.stderr);
  assert(run.stderr.includes('"stack"'), run.stderr);
});

test("Web dashboard restart - a confirmed restart stops the dashboard and exits 0", async () => {
  const run = await runChildScript(`
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardServer } from ${JSON.stringify(DASHBOARD_SERVER_MODULE)};
import { CompletedSessionStore } from ${JSON.stringify(COMPLETED_SESSION_STORE_MODULE)};
import { ShutdownHandler } from ${JSON.stringify(SHUTDOWN_MODULE)};

const tempDir = await fsp.mkdtemp(join(tmpdir(), "air-dashboard-"));
const agentWorkspacePath = join(tempDir, "agent-workspace");
await fsp.mkdir(agentWorkspacePath, { recursive: true });

const server = new DashboardServer({
  config: {
    enabled: true,
    port: 0,
    host: "127.0.0.1",
    passphrase: "test-passphrase",
    behindHttpsProxy: false,
    trustedProxies: [],
  },
  appConfig: {
    platforms: {
      discord: { token: "", enabled: false },
      misskey: { host: "", token: "", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
      autoApproveSkills: [],
    },
    memory: {},
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    replyPolicy: "channels",
    channels: [],
  },
  sessionRegistry: {
    getAll: () => [],
    get: () => undefined,
    has: () => false,
    register: () => "",
    generateSessionId: () => "mock",
    markReplySent: () => false,
    unmarkReplySent: () => {},
    incrementReplyCount: () => 0,
    getReplyCount: () => 0,
    incrementEditCount: () => 0,
    getEditCount: () => 0,
    hasReplySent: () => false,
    setAuditWriter: () => {},
    setTerminateCallback: () => {},
    setLastSentMessageId: () => {},
    getLastSentMessageId: () => undefined,
    touch: () => {},
    remove: () => {},
    hasActiveSessionsForWorkspace: () => false,
    activeCount: 0,
    stop: () => {},
  },
  completedSessionStore: new CompletedSessionStore(),
  agentWorkspacePath,
  auditBasePath: join(tempDir, "audit"),
  skillRegistry: {
    getAll: () => [],
    get: () => undefined,
    register: () => {},
    getSkillNames: () => [],
  },
  memoryStore: {
    loadChannelMemories: () => Promise.resolve([]),
    patchChannelMemory: () => Promise.resolve({}),
  },
  workspaceManager: {
    listChannelWorkspaces: () => Promise.resolve([]),
    getOrCreateChannelWorkspace: (platform, channelId) =>
      Promise.resolve({ key: platform + "/" + channelId, platform, channelId, path: "/tmp" }),
  },
});

server.start();
const baseUrl = "http://127.0.0.1:" + server.getPort();

const handler = new ShutdownHandler();
handler.setContext({
  config: {},
  dashboardServer: {
    stop: async () => {
      console.log("MARKER dashboard-stopped");
      await server.stop();
    },
  },
  agentCore: {
    shutdown: async () => {
      console.log("MARKER agent-core-stopped");
    },
  },
  platformRegistry: {
    getAllAdapters: () => [],
    disconnectAll: async () => {
      console.log("MARKER platforms-disconnected");
    },
  },
});
handler.registerSignalHandlers();

const login = await fetch(baseUrl + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passphrase: "test-passphrase" }),
});
const setCookie = login.headers.get("Set-Cookie") ?? "";
const cookie = setCookie.match(/dashboard_session=[^;]+/)?.[0] ?? "";
console.log("MARKER login:" + login.status + " cookie:" + (cookie !== ""));

const restart = await fetch(baseUrl + "/api/restart", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ confirm: true }),
});
console.log("MARKER restart:" + restart.status + " " + (await restart.text()));
`);

  assertExitedWith(run, 0);
  assert(run.stdout.includes("MARKER login:200 cookie:true"), run.stdout);
  assert(run.stdout.includes("MARKER restart:200"), run.stdout);
  assert(run.stdout.includes("Restart initiated"), run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER dashboard-stopped"), 1, run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER agent-core-stopped"), 1, run.stdout);
  assertEquals(countOccurrences(run.stdout, "MARKER platforms-disconnected"), 1, run.stdout);
  assert(
    run.stdout.indexOf("MARKER dashboard-stopped") <
      run.stdout.indexOf("MARKER agent-core-stopped"),
    run.stdout,
  );
});
