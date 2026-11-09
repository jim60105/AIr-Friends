// tests/core/agent-process-pool.test.ts
// Unit tests for the shared ACP process pool: lazy spawn/reuse, global
// execution-lease serialization, queue priority + starvation guard, queue
// deadline cancellation, and per-session JWT + active pointer file hygiene.

import { assert, assertEquals } from "@std/assert";
import {
  isNotFoundError,
  makeTempDir,
  makeTempDirSync,
  pathExists as exists,
} from "../../src/utils/fs-compat.ts";
import { AgentProcessPool } from "../../src/core/agent-process-pool.ts";
import { poolEntryKey } from "../../src/core/agent-process-pool.ts";
import {
  type ChildQuiescenceVerdict,
  listDescendantPids,
  processAlive,
} from "../../src/utils/process-lifecycle.ts";
import type { WorkspaceTmpUnreclaimableSink } from "../../src/core/workspace-manager.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import { AgentConnector } from "../../src/acp/agent-connector.ts";
import { createAgentProcess } from "../../src/acp/agent-process.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import type { Config } from "../../src/types/config.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mockOmpNativeCache } from "../mocks/omp-mock-session.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { afterAll, test } from "bun:test";

/**
 * One per-run deployment root. The pooled mode roots carry the reserved `natives` link, so a
 * fixed path would make a later run refuse the previous run's link to a by-then-deleted payload.
 */
const TEST_REPO_ROOT = makeTempDirSync({ prefix: "air-pool-test-repo-" });
afterAll(() => {
  try {
    fs.rmSync(TEST_REPO_ROOT, { recursive: true });
  } catch {
    // Already gone.
  }
});

/** Minimal stub standing in for AgentConnector (no real `opencode` subprocess). */
class StubConnector {
  connectCount = 0;
  disconnected = false;
  get isConnected(): boolean {
    return !this.disconnected;
  }
  async connect(): Promise<void> {
    await Promise.resolve();
    this.connectCount++;
  }
  async disconnect(): Promise<void> {
    await Promise.resolve();
    this.disconnected = true;
  }
  getProcessPid(): number | undefined {
    // No real subprocess pid -> the pool skips the child-process drain.
    return undefined;
  }
}

function makeConfig(): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "oc1",
      geminiApiKey: "gm1",
      // The shipped `omp` pool prepares each mode root's reserved `natives` entry from the ONE
      // shared prepared payload; mock suites select the synthetic process-scoped one.
      ompNativeCache: mockOmpNativeCache(),
      sharedProcess: {
        enabled: true,
        jwtDir: "data/skill-jwt",
        // Tests in this file assert dispatch, ordering, reuse and lease behaviour — never
        // deadline cancellation, which has its own test and sets its own 100ms value. The
        // shared 100ms default was tight enough that a queued session aged past it while the
        // lease holder's release I/O ran under CI `--parallel` load, and it was cancelled
        // pre-dispatch: run 38184832785 (order == ["A_start", "A_end"]), run 35964700442
        // (order == []), run 38845840234 (the third OMP run resolved `null` instead of
        // `acp-yolo-1`). A wide margin keeps those assertions meaningful: no session in this
        // file ages out of the queue before dispatch.
        queueDeadlineMs: 2000,
      },
    },
    memory: {
      recentMessageLimit: 20,
      workingTierLimit: 20,
    },
    workspace: {
      repoPath: TEST_REPO_ROOT,
      workspacesDir: "workspaces",
    },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  };
}

function makeWorkspace(key: string): WorkspaceInfo {
  const [platform, userId] = key.split("/");
  return {
    key,
    components: { platform: platform as "discord", userId },
    path: `/tmp/test/workspaces/${key}`,
    tmpPath: `/tmp/test/workspaces/${key}/tmp`,
    isDm: false,
  };
}

/**
 * Wait (bounded) for the pool's post-session release path (pointer clear, JWT
 * delete, child-process drain) to fully finish, then stop the pool. Keeps Deno's
 * leak detector quiet: no pending timers or file operations at test end.
 */
async function stopPool(pool: AgentProcessPool): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !pool.isIdle()) {
    await new Promise((r) => setTimeout(r, 20));
  }
  await pool.stop();
}

function makeConnectorOptions(): AgentConnectorOptions {
  return {
    agentConfig: {
      command: "opencode",
      args: ["acp"],
      cwd: "/tmp/test/channel-cwd/discord:123",
      env: { SKILL_JWT_DIR: "/tmp/test/data/skill-jwt" },
    },
    clientConfig: {
      workingDir: "/tmp/test/workspaces/discord/123",
      platform: "discord",
      userId: "123",
      channelId: "discord/123",
      isDM: false,
    },
    skillRegistry: {},
    logger: {},
    agentType: "opencode",
  };
}

function registerSession(
  registry: SessionRegistry,
  overrides: {
    platform?: string;
    channelId?: string;
    userId?: string;
    workspace?: WorkspaceInfo;
    isDm?: boolean;
    triggerEvent?: NormalizedEvent;
  } = {},
): string {
  return registry.register({
    platform: overrides.platform ?? "discord",
    channelId: overrides.channelId ?? "discord/123",
    userId: overrides.userId ?? "123",
    isDm: overrides.isDm ?? false,
    workspace: overrides.workspace ?? makeWorkspace("discord/123"),
    triggerEvent: overrides.triggerEvent,
  });
}

test("pool - lazy-spawns once and reuses the process for the same pool key", async () => {
  const registry = new SessionRegistry(1000);
  const factoryCalls: AgentConnectorOptions[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    (options) => {
      factoryCalls.push(options);
      return new StubConnector() as unknown as AgentConnector;
    },
  );

  const sid1 = registerSession(registry);
  const sid2 = registerSession(registry);

  const r1 = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sid1,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      await Promise.resolve();
      return "acp-1";
    },
  );
  const r2 = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sid2,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      await Promise.resolve();
      return "acp-2";
    },
  );

  assertEquals(r1.acpSessionId, "acp-1");
  assertEquals(r2.acpSessionId, "acp-2");
  // The shared process is spawned ONCE and reused for both sessions.
  assertEquals(factoryCalls.length, 1);
  await stopPool(pool);
});

test("pool - serializes sessions from different pool keys (global execution lease)", async () => {
  const registry = new SessionRegistry(1000);
  const running: string[] = [];
  const order: string[] = [];
  const config = makeConfig();
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );

  const sidA = registerSession(registry, { channelId: "discord/1" });
  const sidB = registerSession(registry, { channelId: "discord/2" });

  const p1 = pool.run(
    {
      poolKey: "discord:discord/1",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidA,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/1",
    },
    async () => {
      running.push("A");
      order.push("A_start");
      await new Promise((r) => setTimeout(r, 50));
      running.pop();
      order.push("A_end");
      return "acp-A";
    },
  );
  const p2 = pool.run(
    {
      poolKey: "discord:discord/2",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidB,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/2",
    },
    async () => {
      running.push("B");
      order.push("B_start");
      await new Promise((r) => setTimeout(r, 20));
      running.pop();
      order.push("B_end");
      return "acp-B";
    },
  );

  const [r1, r2] = await Promise.all([p1, p2]);
  // Exactly one runner executes at a time (the global lease).
  assertEquals(order, ["A_start", "A_end", "B_start", "B_end"]);
  assertEquals(r1.acpSessionId, "acp-A");
  assertEquals(r2.acpSessionId, "acp-B");
  await stopPool(pool);
});

test("pool - interactive sessions take queue priority over maintenance (starvation guard)", async () => {
  const registry = new SessionRegistry(1000);
  const order: string[] = [];
  const config = makeConfig();
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
    100,
  );

  const sidBlocker = registerSession(registry, { channelId: "discord/7" });
  const sidMaint = registerSession(registry, { channelId: "" });
  const sidInt = registerSession(registry, { channelId: "discord/1" });

  // An in-flight blocker session holds the lease, so both queued jobs must
  // wait; when the lease frees, the interactive job must run before the
  // maintenance job (interactive-over-maintenance queue priority).
  const pBlocker = pool.run(
    {
      poolKey: "discord:discord/7",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidBlocker,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/7",
    },
    async () => {
      // The two follow-up pool.run() calls enqueue their sessions SYNCHRONOUSLY
      // in the test's current task, strictly before this runner is reached
      // (executeInFlight invokes the runner only in a later microtask, after
      // JWT/pointer I/O). One microtask yield therefore holds the lease until
      // both sessions are queued — no wall-clock timer needed.
      await Promise.resolve();
      return "acp-blocker";
    },
  );
  // Queue the maintenance job FIRST, then the interactive session.
  const pMaint = pool.run(
    {
      poolKey: "memory-maintenance:discord/999",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "memory_maintenance",
      shellSessionId: sidMaint,
      priority: "maintenance",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/999",
    },
    async () => {
      await Promise.resolve();
      order.push("maintenance");
      return "acp-maint";
    },
  );
  const pInt = pool.run(
    {
      poolKey: "discord:discord/7",
      agentType: "omp",
      permissionMode: "native-yolo",
      sessionType: "message",
      shellSessionId: sidInt,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/1",
    },
    async () => {
      await Promise.resolve();
      order.push("interactive");
      return "acp-int";
    },
  );

  const [rBlocker, rMaint, rInt] = await Promise.all([pBlocker, pMaint, pInt]);
  // Interactive runs first despite the maintenance job having been queued second.
  assertEquals(order, ["interactive", "maintenance"]);
  assertEquals(rBlocker.acpSessionId, "acp-blocker");
  assertEquals(rInt.acpSessionId, "acp-int");
  assertEquals(rMaint.acpSessionId, "acp-maint");
  await stopPool(pool);
});

test("pool - queue deadline cancels still-queued sessions", async () => {
  const registry = new SessionRegistry(1000);
  const config = makeConfig();
  // Short reclaim idle time so the pool's reclaim timer FIRES (completes) during
  // the test, keeping Deno's leak detector quiet (a cleared timer counts as
  // "never completed").
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "data/skill-jwt",
    queueDeadlineMs: 100,
    reclaimIdleMs: 30,
  };
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
    30, // fast sweep interval
  );

  // Block the lease with a long-running interactive session.
  const sidBlocker = registerSession(registry, { channelId: "discord/1" });
  const pBlocker = pool.run(
    {
      poolKey: "discord:discord/1",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidBlocker,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/1",
    },
    async () => {
      await new Promise((r) => setTimeout(r, 120));
      return "acp-blocker";
    },
  );

  // A second interactive session stays queued past the 100ms deadline (config).
  const sidQueued = registerSession(registry, { channelId: "discord/2" });
  let runnerCalled = false;
  const pQueued = pool.run(
    {
      poolKey: "discord:discord/2",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidQueued,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/2",
    },
    async () => {
      runnerCalled = true;
      await Promise.resolve();
      throw new Error("should not run — cancelled by deadline");
    },
  );

  const [rBlocker, rQueued] = await Promise.all([pBlocker, pQueued]);
  assertEquals(rBlocker.acpSessionId, "acp-blocker");
  // The classification alone cannot prove the runner never started: a runner
  // error maps to the same deadline-cancelled result, so assert it directly.
  assertEquals(runnerCalled, false);
  assertEquals(rQueued.cancelledByDeadline, true);
  assertEquals(rQueued.acpSessionId, null);
  // The cancelled session is removed from the registry.
  assertEquals(registry.get(sidQueued), undefined);
  // Wait for the pool's idle-reclaim timer (30ms) to fire and complete, then
  // stop the pool.
  await new Promise((r) => setTimeout(r, 60));
  await pool.stop();
});

test("pool - issues per-session JWT and writes the active pointer while the lease is held", async () => {
  const config = makeConfig();
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "/tmp/pool-test-jwt",
    queueDeadlineMs: 600000,
  };
  const registry = new SessionRegistry(1000);
  const jwtDir = "/tmp/pool-test-jwt";
  await fsp.mkdir(jwtDir, { recursive: true });

  let jwtWhileRunning: string | null = null;
  let pointerWhileRunning: string | null = null;
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );

  const sid = registerSession(registry, { channelId: "discord/123" });
  const result = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sid,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      // Snapshot the JWT + pointer while this session holds the lease.
      jwtWhileRunning = await fsp.readFile(`${jwtDir}/${sid}.jwt`, "utf8");
      const raw = await fsp.readFile(`${jwtDir}/active.json`, "utf8");
      pointerWhileRunning = JSON.parse(raw).sessionId;
      await new Promise((r) => setTimeout(r, 20));
      return "acp-1";
    },
  );

  // During the in-flight lease: JWT file exists and the pointer names this session.
  assert(jwtWhileRunning !== null);
  assertEquals(pointerWhileRunning, sid);
  assertEquals(result.acpSessionId, "acp-1");

  // After the session ends: the JWT file is deleted and the pointer is cleared.
  // The release path (drain + pointer clear + JWT delete) completes BEFORE the
  // caller-visible result settles, so no polling is needed here — direct
  // assertions after `await pool.run()` are the contract under test.
  assertEquals(await exists(`${jwtDir}/${sid}.jwt`), false);
  // The cleared pointer is an empty file (owner-validated clear writes "").
  const pointerRaw = await fsp.readFile(`${jwtDir}/active.json`, "utf8");
  const pointer = pointerRaw.trim() ? (JSON.parse(pointerRaw) as { sessionId?: string }) : {};
  assertEquals(pointer.sessionId, undefined);

  await stopPool(pool);
  await fsp.rm(jwtDir, { recursive: true });
});

test("pool - relative jwtDir config writes JWT + pointer at the resolved absolute path", async () => {
  // Writer agreement (fix-pooled-skill-env-absolute-paths): a RELATIVE config
  // value must land at the same absolute location skill scripts read via
  // `$SKILL_JWT_DIR`. Uses the gitignored data/ root; cleaned up in `finally`.
  const config = makeConfig();
  const jwtDirRel = `data/af-pool-test-jwt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: jwtDirRel,
    queueDeadlineMs: 600000,
  };
  const resolvedJwtDir = resolve(jwtDirRel);
  const registry = new SessionRegistry(1000);
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );
  try {
    const sid = registerSession(registry, { channelId: "discord/789" });
    // The pool deletes the JWT file and clears the pointer at lease release, so
    // snapshots must be taken INSIDE the runner. The out-param object keeps the
    // declared property types readable after the closure returns.
    const leaseState: {
      snapshot: { jwtOk: boolean; pointerSessionId: string | undefined } | null;
    } = { snapshot: null };
    await pool.run(
      {
        poolKey: "discord:discord/789",
        agentType: "opencode",
        permissionMode: "restricted",
        sessionType: "message",
        shellSessionId: sid,
        priority: "interactive",
        connectorOptions: makeConnectorOptions(),
        sessionCwd: "/tmp/test/workspaces/discord/789",
      },
      async () => {
        // While the lease is held, the pool must have written the files at the
        // RESOLVED (absolute) location, not the raw relative config string.
        let jwtOk = false;
        try {
          const content = await fsp.readFile(`${resolvedJwtDir}/${sid}.jwt`, "utf8");
          jwtOk = content.trim().length > 0;
        } catch {
          jwtOk = false;
        }
        const pointerRaw = await fsp.readFile(`${resolvedJwtDir}/active.json`, "utf8");
        leaseState.snapshot = {
          jwtOk,
          pointerSessionId: (JSON.parse(pointerRaw) as { sessionId?: string }).sessionId,
        };
        return "acp-rel";
      },
    );
    assertEquals(leaseState.snapshot?.jwtOk, true);
    assertEquals(leaseState.snapshot?.pointerSessionId, sid);
  } finally {
    await stopPool(pool);
    await fsp.rm(resolvedJwtDir, { recursive: true }).catch(() => {});
  }
});

test("pool - JWT renewals during the lease never resurrect the JWT file after release", async () => {
  const config = makeConfig();
  const jwtDir = "/tmp/pool-test-jwt-renew";
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir,
    queueDeadlineMs: 600000,
  };
  const registry = new SessionRegistry(1000);
  await fsp.mkdir(jwtDir, { recursive: true });

  // Fast renewal interval so several renewals fire (and overlap) during the lease.
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
    30,
    15,
  );

  const sid = registerSession(registry, { channelId: "discord/123" });
  await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sid,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      // Hold the lease long enough for many overlapping renewal ticks.
      await new Promise((r) => setTimeout(r, 120));
      return "acp-1";
    },
  );

  // Release deletes the JWT; no pending renewal may rewrite it afterwards.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      await fsp.stat(`${jwtDir}/${sid}.jwt`);
      await new Promise((r) => setTimeout(r, 20));
    } catch (error) {
      if (isNotFoundError(error)) break;
      throw error;
    }
  }
  // Wait past several more renewal ticks: the file must stay deleted.
  await new Promise((r) => setTimeout(r, 150));
  let exists = true;
  try {
    await fsp.stat(`${jwtDir}/${sid}.jwt`);
  } catch (error) {
    if (isNotFoundError(error)) exists = false;
    else throw error;
  }
  assert(!exists, "JWT file was resurrected by a late renewal after release");

  await stopPool(pool);
  await fsp.rm(jwtDir, { recursive: true });
});

test("pool - poolEntryKey helper", () => {
  assertEquals(poolEntryKey("discord:123", "opencode", "restricted"), "discord:123");
  assertEquals(poolEntryKey("discord:123", "opencode", "native-yolo"), "discord:123");
  assertEquals(poolEntryKey("discord:123", "omp", "restricted"), "discord:123:restricted");
  assertEquals(poolEntryKey("discord:123", "omp", "native-yolo"), "discord:123:native-yolo");
});

test("pool - OMP same-mode reuse and cross-mode separation with dual-mode coexistence", async () => {
  const registry = new SessionRegistry(1000);
  const spawnedConfigs: AgentConnectorOptions[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    (opts) => {
      spawnedConfigs.push(opts);
      return new StubConnector() as unknown as AgentConnector;
    },
  );

  const sidRestricted1 = registerSession(registry, { channelId: "discord/123" });
  const sidRestricted2 = registerSession(registry, { channelId: "discord/123" });
  const sidYolo1 = registerSession(registry, { channelId: "discord/123" });

  // 1. First restricted OMP request spawns a process
  const r1 = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidRestricted1,
      priority: "interactive",
      connectorOptions: {
        ...makeConnectorOptions(),
        agentType: "omp",
      },
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    () => Promise.resolve("acp-restr-1"),
  );
  assertEquals(r1.acpSessionId, "acp-restr-1");
  assertEquals(spawnedConfigs.length, 1);

  // 2. Second restricted OMP request reuses the live restricted process (no second spawn)
  const r2 = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidRestricted2,
      priority: "interactive",
      connectorOptions: {
        ...makeConnectorOptions(),
        agentType: "omp",
      },
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    () => Promise.resolve("acp-restr-2"),
  );
  assertEquals(r2.acpSessionId, "acp-restr-2");
  assertEquals(spawnedConfigs.length, 1);

  // 3. Native-YOLO OMP request for same channel spawns a SEPARATE process
  const r3 = await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "native-yolo",
      sessionType: "message",
      shellSessionId: sidYolo1,
      priority: "interactive",
      connectorOptions: {
        ...makeConnectorOptions(),
        agentType: "omp",
      },
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    () => Promise.resolve("acp-yolo-1"),
  );
  assertEquals(r3.acpSessionId, "acp-yolo-1");
  assertEquals(spawnedConfigs.length, 2);

  await stopPool(pool);
});

test("pool - OMP lease preservation across mode-split entries", async () => {
  const registry = new SessionRegistry(1000);
  const config = makeConfig();
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );

  const sidRestr = registerSession(registry, { channelId: "discord/123" });
  const sidYolo = registerSession(registry, { channelId: "discord/123" });

  const executionOrder: string[] = [];
  let restrictedInFlight = false;
  let yoloRanConcurrently = false;

  const pRestricted = pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidRestr,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      restrictedInFlight = true;
      executionOrder.push("restricted-start");
      await new Promise((r) => setTimeout(r, 40));
      executionOrder.push("restricted-end");
      restrictedInFlight = false;
      return "acp-restr";
    },
  );

  const pYolo = pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "native-yolo",
      sessionType: "message",
      shellSessionId: sidYolo,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      if (restrictedInFlight) {
        yoloRanConcurrently = true;
      }
      executionOrder.push("yolo-start");
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push("yolo-end");
      return "acp-yolo";
    },
  );

  await Promise.all([pRestricted, pYolo]);
  assert(
    !yoloRanConcurrently,
    "Native-YOLO session must not run concurrently with restricted session",
  );
  assertEquals(executionOrder, [
    "restricted-start",
    "restricted-end",
    "yolo-start",
    "yolo-end",
  ]);

  await stopPool(pool);
});

test("pool - OpenCode byte-identity regression", async () => {
  const registry = new SessionRegistry(1000);
  const spawned: AgentConnectorOptions[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    (opts) => {
      spawned.push(opts);
      return new StubConnector() as unknown as AgentConnector;
    },
  );

  const sid1 = registerSession(registry, { channelId: "discord/channel-1" });
  const sid2 = registerSession(registry, { channelId: "discord/channel-1" });

  await pool.run(
    {
      poolKey: "discord:channel-1",
      agentType: "opencode",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sid1,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/channel-1",
    },
    () => Promise.resolve("acp-1"),
  );

  // OpenCode ignores permissionMode in pool identity: second run with different mode reuses the process
  await pool.run(
    {
      poolKey: "discord:channel-1",
      agentType: "opencode",
      permissionMode: "native-yolo",
      sessionType: "message",
      shellSessionId: sid2,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/channel-1",
    },
    () => Promise.resolve("acp-2"),
  );

  assertEquals(
    spawned.length,
    1,
    "OpenCode with different resolved modes must reuse the single process",
  );
  await stopPool(pool);
});

test("pool - per-mode reclaim independence for OMP", async () => {
  const registry = new SessionRegistry(1000);
  const config = makeConfig();
  // Configure fast reclaim idle ms
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "data/skill-jwt",
    reclaimIdleMs: 50,
  };

  const disconnectedPids: string[] = [];
  class TrackingConnector extends StubConnector {
    constructor(public id: string) {
      super();
    }
    override async disconnect(): Promise<void> {
      await super.disconnect();
      disconnectedPids.push(this.id);
    }
  }

  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    (opts) => new TrackingConnector(opts.agentConfig?.cwd ?? "conn") as unknown as AgentConnector,
  );

  const sidRestr = registerSession(registry, { channelId: "discord/123" });
  const sidYolo = registerSession(registry, { channelId: "discord/123" });

  // Run restricted session and finish it (refcount goes to 0 -> reclaim scheduled)
  await pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "restricted",
      sessionType: "message",
      shellSessionId: sidRestr,
      priority: "interactive",
      connectorOptions: {
        ...makeConnectorOptions(),
        agentConfig: { ...makeConnectorOptions().agentConfig!, cwd: "restr" },
      },
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    () => Promise.resolve("restr-done"),
  );

  // Start YOLO session and keep it running while restricted gets reclaimed
  const yoloPromise = pool.run(
    {
      poolKey: "discord:discord/123",
      agentType: "omp",
      permissionMode: "native-yolo",
      sessionType: "message",
      shellSessionId: sidYolo,
      priority: "interactive",
      connectorOptions: {
        ...makeConnectorOptions(),
        agentConfig: { ...makeConnectorOptions().agentConfig!, cwd: "yolo" },
      },
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      // Hold YOLO lease past the 50ms reclaim time of restricted
      await new Promise((r) => setTimeout(r, 100));
      return "yolo-done";
    },
  );

  await yoloPromise;

  // Restricted entry must have been reclaimed (disconnected), but YOLO entry was leased
  assert(disconnectedPids.includes("restr"), "Restricted process should be reclaimed");
  assertEquals(disconnectedPids.includes("yolo"), false, "Leased YOLO entry must remain untouched");

  await stopPool(pool);
});

/**
 * A pool whose child drain is held open by the test, so the ordering between the
 * drain, the caller-visible result and the next queued session is observable
 * without racing a real process tree (design D2 "pooled completion waits for
 * child release").
 */
class BlockingDrainPool extends AgentProcessPool {
  readonly drainEntered = Promise.withResolvers<void>();
  readonly allowDrain = Promise.withResolvers<void>();
  drainCalls = 0;
  protected override async awaitProducerQuiescence(
    _wrapperPid: number,
  ): Promise<ChildQuiescenceVerdict> {
    this.drainCalls++;
    this.drainEntered.resolve();
    await this.allowDrain.promise;
    return { status: "quiescent", drained: "no-child" };
  }
}

/**
 * A stub connector that reports a live wrapper PID, so the lease's release path
 * takes the drain branch (an absent PID means "no producer", which never drains).
 */
class PidStubConnector extends StubConnector {
  constructor(private readonly pid: number) {
    super();
  }
  override getProcessPid(): number | undefined {
    return this.pid;
  }
}

/** A pool-level workspace sink that records every retained workspace. */
class RecordingTmpSink implements WorkspaceTmpUnreclaimableSink {
  readonly marks: { tmpPath: string; reason: string }[] = [];
  markTmpUseUncertain(tmpPath: string, reason: string): void {
    this.marks.push({ tmpPath, reason });
  }
}

/** A pool whose drain verdict is scripted, so release-time uncertainty is observable. */
class UncertainDrainPool extends AgentProcessPool {
  verdict: ChildQuiescenceVerdict = { status: "uncertain", reason: "enumeration-failed" };
  protected override awaitProducerQuiescence(
    _wrapperPid: number,
  ): Promise<ChildQuiescenceVerdict> {
    return Promise.resolve(this.verdict);
  }
}

/**
 * The session id the pool's active pointer currently names, or `undefined` when
 * the pointer is cleared (the owner-validated release writes an empty file).
 */
async function readPointerSession(jwtDir: string): Promise<string | undefined> {
  const raw = (await fsp.readFile(`${jwtDir}/active.json`, "utf8")).trim();
  if (raw === "") return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || !("sessionId" in parsed)) return undefined;
  const value = parsed.sessionId;
  return typeof value === "string" ? value : undefined;
}

/** Run options for one pooled session on the given channel. */
function poolRunOptions(overrides: {
  channelId: string;
  shellSessionId: string;
  workspacePath?: string;
}): Parameters<AgentProcessPool["run"]>[0] {
  return {
    poolKey: `discord:${overrides.channelId}`,
    agentType: "opencode",
    permissionMode: "restricted",
    sessionType: "message",
    shellSessionId: overrides.shellSessionId,
    priority: "interactive",
    connectorOptions: makeConnectorOptions(),
    sessionCwd: `/tmp/test/workspaces/${overrides.channelId}`,
    workspacePath: overrides.workspacePath,
  };
}

test("pool - the caller-visible result and the next queued session wait for the child drain", async function () {
  const config = makeConfig();
  const jwtDir = await makeTempDir();
  config.agent.sharedProcess = { enabled: true, jwtDir, queueDeadlineMs: 600000 };
  const registry = new SessionRegistry(1000);
  const pool = new BlockingDrainPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    // The drain seam is only reached for a lease whose wrapper PID is
    // observable; the seam replaces the observation entirely.
    () => new PidStubConnector(123_456) as unknown as AgentConnector,
  );
  const events: string[] = [];
  let settled = false;
  try {
    const sidA = registerSession(registry, { channelId: "discord/1" });
    const runA = pool.run(
      poolRunOptions({ channelId: "discord/1", shellSessionId: sidA }),
      () => {
        events.push("A:runner-end");
        return Promise.resolve("acp-A");
      },
    ).then((result) => {
      settled = true;
      return result;
    });

    // The release path is now blocked inside the drain, holding the lease.
    await pool.drainEntered.promise;

    // While the drain runs: this session's own pointer and JWT must still be
    // present (a late tool child still needs them), the public result must not
    // have settled, and the workspace's staged files are untouched.
    assertEquals(await readPointerSession(jwtDir), sidA);
    assertEquals(await exists(`${jwtDir}/${sidA}.jwt`), true);
    assertEquals(settled, false, "the result must not settle during the drain");

    // A queued sibling must not start while the first session still holds the
    // lease (global serialization survives the new settlement order).
    const sidB = registerSession(registry, { channelId: "discord/2" });
    const runB = pool.run(
      poolRunOptions({ channelId: "discord/2", shellSessionId: sidB }),
      async () => {
        events.push("B:start");
        // B holds the lease here: its own pointer must be visible, which is
        // why the post-A assertion below accepts B's pointer as well as "".
        assertEquals(await readPointerSession(jwtDir), sidB);
        return "acp-B";
      },
    );
    await Promise.resolve();
    assertEquals(events.includes("A:runner-end"), true);
    assertEquals(events.includes("B:start"), false, "the queued session must not start early");

    pool.allowDrain.resolve();
    const resultA = await runA;

    assertEquals(resultA, { acpSessionId: "acp-A", cancelledByDeadline: false });
    assertEquals(settled, true);
    // The release completed BEFORE the result became visible to the caller.
    // B's release/acquire may legitimately have advanced by now (the pointer
    // is either cleared or B's), so the assertion is that A's is GONE.
    assertEquals(await exists(`${jwtDir}/${sidA}.jwt`), false);
    assert(
      (await readPointerSession(jwtDir)) !== sidA,
      "A's pointer must be cleared once A settled",
    );

    const resultB = await runB;
    assertEquals(resultB, { acpSessionId: "acp-B", cancelledByDeadline: false });
    assertEquals(events, ["A:runner-end", "B:start"]);
    assertEquals(pool.drainCalls, 2);
  } finally {
    pool.allowDrain.resolve();
    await stopPool(pool);
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("pool - a pointer-clear failure still deletes the JWT, keeps the result and frees the queue", async function () {
  const config = makeConfig();
  const jwtDir = await makeTempDir();
  config.agent.sharedProcess = { enabled: true, jwtDir, queueDeadlineMs: 600000 };
  const registry = new SessionRegistry(1000);
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );
  // The pointer clear writes through the shared `node:fs/promises` object, so
  // replacing its `rename` fails ONLY the owner-validated release write.
  const originalRename = fsp.rename;
  try {
    const sidA = registerSession(registry, { channelId: "discord/7" });
    const resultA = await pool.run(
      poolRunOptions({ channelId: "discord/7", shellSessionId: sidA }),
      () => {
        // Acquisition already wrote the pointer: from here on, fail only the
        // owner-validated CLEAR (the release step), never the acquire write.
        fsp.rename =
          ((from: Parameters<typeof fsp.rename>[0], to: Parameters<typeof fsp.rename>[1]) => {
            if (String(to).endsWith("/active.json")) {
              return Promise.reject(
                Object.assign(new Error("mock pointer clear failure"), { code: "EACCES" }),
              );
            }
            return originalRename(from, to);
          }) as typeof fsp.rename;
        return Promise.resolve("acp-A");
      },
    );
    fsp.rename = originalRename;

    // The computed result is unchanged by the release failure …
    assertEquals(resultA, { acpSessionId: "acp-A", cancelledByDeadline: false });
    // … the JWT deletion still ran (the failing pointer clear never skipped it) …
    assertEquals(await exists(`${jwtDir}/${sidA}.jwt`), false);

    // … and the refcount was released: the queued sibling still runs.
    const sidB = registerSession(registry, { channelId: "discord/8" });
    const resultB = await pool.run(
      poolRunOptions({ channelId: "discord/8", shellSessionId: sidB }),
      () => Promise.resolve("acp-B"),
    );
    assertEquals(resultB, { acpSessionId: "acp-B", cancelledByDeadline: false });
  } finally {
    fsp.rename = originalRename;
    await stopPool(pool);
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("pool - a failed run plus a failed release keeps the primary classification and still deletes the JWT", async function () {
  const config = makeConfig();
  const jwtDir = await makeTempDir();
  config.agent.sharedProcess = { enabled: true, jwtDir, queueDeadlineMs: 600000 };
  const registry = new SessionRegistry(1000);
  const pool = new AgentProcessPool(
    config,
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );
  const originalRename = fsp.rename;
  try {
    const sid = registerSession(registry, { channelId: "discord/9" });
    const result = await pool.run(
      poolRunOptions({ channelId: "discord/9", shellSessionId: sid }),
      () => {
        fsp.rename =
          ((from: Parameters<typeof fsp.rename>[0], to: Parameters<typeof fsp.rename>[1]) => {
            if (String(to).endsWith("/active.json")) {
              return Promise.reject(
                Object.assign(new Error("mock pointer clear failure"), { code: "EACCES" }),
              );
            }
            return originalRename(from, to);
          }) as typeof fsp.rename;
        throw new Error("runner failed");
      },
    );
    fsp.rename = originalRename;

    // The runner failure stays the reported classification (never the release
    // failure), and the session's credential file is still removed.
    assertEquals(result, { acpSessionId: null, cancelledByDeadline: true });
    assertEquals(await exists(`${jwtDir}/${sid}.jwt`), false);
  } finally {
    fsp.rename = originalRename;
    await stopPool(pool);
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("pool - a runner rejecting with `undefined` is still classified as a failed session", async function () {
  const registry = new SessionRegistry(1000);
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );
  try {
    const sid = registerSession(registry, { channelId: "discord/3" });
    const result = await pool.run(
      poolRunOptions({ channelId: "discord/3", shellSessionId: sid }),
      // `undefined` is a valid rejection reason, so it must never double as
      // the "no failure" sentinel.
      () => Promise.reject(undefined),
    );
    assertEquals(result, { acpSessionId: null, cancelledByDeadline: true });
  } finally {
    await stopPool(pool);
    registry.stop();
  }
});

test("pool - an uncertain drain verdict retains the owning workspace after the release", async function () {
  const repoPath = await makeTempDir();
  const jwtDir = await makeTempDir();
  const registry = new SessionRegistry(1000);
  try {
    const manager = new WorkspaceManager({ repoPath, workspacesDir: "workspaces" });
    const workspacePath = join(repoPath, "workspaces", "discord", "u1");
    const tmpPath = join(workspacePath, "tmp");
    const staged = join(tmpPath, "owner-session", "staged.json");
    await fsp.mkdir(join(tmpPath, "owner-session"), { recursive: true });
    await fsp.writeFile(staged, "staged payload");

    for (const reason of ["enumeration-failed", "survivors-remain"] as const) {
      const config = makeConfig();
      config.agent.sharedProcess = { enabled: true, jwtDir, queueDeadlineMs: 600000 };
      const pool = new UncertainDrainPool(
        config,
        registry,
        "test-secret-0123456789abcdef0123456789",
        () => new PidStubConnector(123_456) as unknown as AgentConnector,
        30_000,
        undefined,
        manager,
      );
      pool.verdict = { status: "uncertain", reason };
      try {
        const sid = registerSession(registry, { channelId: "discord/u1" });
        const result = await pool.run(
          poolRunOptions({
            channelId: "discord/u1",
            shellSessionId: sid,
            workspacePath,
          }),
          () => Promise.resolve("acp-uncertain"),
        );

        // The computed result and the pointer/JWT release are unaffected …
        assertEquals(result, { acpSessionId: "acp-uncertain", cancelledByDeadline: false });
        assertEquals(await exists(`${jwtDir}/${sid}.jwt`), false);
        // … and the owning workspace keeps its protection for this lifetime:
        // a subsequent idle release must not touch the staged payload.
        assertEquals(manager.isTmpUseUncertain(tmpPath), true);
        manager.acquireTmpUse(tmpPath);
        assertEquals(manager.releaseTmpUse(tmpPath)?.reason, "uncertain-teardown");
        assertEquals(manager.getTmpUseCount(tmpPath), 0);
        assertEquals(await exists(staged), true);
      } finally {
        await stopPool(pool);
      }
    }
  } finally {
    registry.stop();
    await fsp.rm(repoPath, { recursive: true });
    await fsp.rm(jwtDir, { recursive: true });
  }
});

test("pool - a failed acquisition retains the workspace only once a producer generation started", async function () {
  const registry = new SessionRegistry(1000);
  const sink = new RecordingTmpSink();
  let disconnectCalls = 0;
  try {
    for (const generations of [0, 1]) {
      sink.marks.length = 0;
      const connector = {
        isConnected: false,
        connect: () => Promise.reject(new Error("connect failed")),
        disconnect: () => {
          disconnectCalls++;
          return Promise.resolve();
        },
        getProcessPid: () => undefined,
        getProcessEvidence: () => ({ generations, pid: undefined }),
      };
      const pool = new AgentProcessPool(
        makeConfig(),
        registry,
        "test-secret-0123456789abcdef0123456789",
        () => connector as unknown as AgentConnector,
        30_000,
        undefined,
        sink,
      );
      try {
        const workspacePath = "/tmp/test/workspaces/discord/9";
        const sid = registerSession(registry, { channelId: "discord/9" });
        const disconnectCallsBefore = disconnectCalls;
        const result = await pool.run(
          poolRunOptions({
            channelId: "discord/9",
            shellSessionId: sid,
            workspacePath,
          }),
          () => Promise.reject(new Error("the runner must never start")),
        );

        // The acquisition failure keeps the existing caller classification.
        assertEquals(result, { acpSessionId: null, cancelledByDeadline: true });
        if (generations === 0) {
          // No producer ever started: nothing may be retained.
          assertEquals(sink.marks, []);
        } else {
          // A wrapper generation started and was never drained: the owning
          // workspace keeps its cleanup protection for this bot lifetime.
          assertEquals(sink.marks, [{
            tmpPath: `${workspacePath}/tmp`,
            reason: "connect-failed",
          }]);
        }
        // Best-effort teardown was still attempted in THIS case, without
        // masking the acquisition error.
        assertEquals(disconnectCalls, disconnectCallsBefore + 1);
      } finally {
        await stopPool(pool);
      }
    }
  } finally {
    registry.stop();
  }
});

// Pool stop terminates every pooled agent (real wrapper + descendant processes).

/**
 * The pooled agent ignores SIGTERM and keeps a SIGTERM-ignoring child running,
 * so only the connector's escalated tree teardown can reap it.
 */
const IGNORE_TERM_POOL_FIXTURE = `
process.on("SIGTERM", () => {});
Bun.spawn(["sh", "-c", "trap '' TERM; sleep 600"], { stdout: "ignore", stderr: "ignore" });
setInterval(() => {}, 1000);
`;

/**
 * A pooled connector that owns a REAL agent process tree and defers to the
 * production connector's disconnect when the pool stops it.
 */
class FixtureConnector {
  disconnected = false;
  constructor(private readonly connector: AgentConnector) {}
  get isConnected(): boolean {
    return !this.disconnected;
  }
  connect(): Promise<void> {
    return Promise.resolve();
  }
  async disconnect(): Promise<void> {
    await this.connector.disconnect();
    this.disconnected = true;
  }
  getProcessPid(): number | undefined {
    // Release must not drain: the tree stays intact until pool.stop().
    return undefined;
  }
}

test("Pool Stop Terminates Every Pooled Agent - two live pool entries", async () => {
  const registry = new SessionRegistry(1000);
  const fixtureDir = await fsp.mkdtemp(join(tmpdir(), "pool-stop-tree-"));
  const fixture = join(fixtureDir, "fixture.ts");
  await fsp.writeFile(fixture, IGNORE_TERM_POOL_FIXTURE);
  const logger = new Logger("test", { level: LogLevel.ERROR });
  const connectors: FixtureConnector[] = [];
  const wrappers: number[] = [];
  const descendantsBeforeStop: number[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    (options) => {
      const handle = createAgentProcess({
        command: process.execPath,
        args: ["run", "--no-env-file", fixture],
        cwd: fixtureDir,
        env: { PATH: process.env["PATH"] ?? "" },
      });
      const connector = new AgentConnector({ ...options, logger });
      connector["process"] = handle;
      const fixtureConnector = new FixtureConnector(connector);
      connectors.push(fixtureConnector);
      wrappers.push(handle.pid);
      return fixtureConnector as unknown as AgentConnector;
    },
  );
  try {
    const sidA = registerSession(registry, { channelId: "discord/1" });
    const sidB = registerSession(registry, { channelId: "discord/2" });
    await pool.run(
      poolRunOptions({ channelId: "discord/1", shellSessionId: sidA }),
      () => Promise.resolve("acp-A"),
    );
    await pool.run(
      poolRunOptions({ channelId: "discord/2", shellSessionId: sidB }),
      () => Promise.resolve("acp-B"),
    );

    // Two live entries in different pool keys, each with its own live tree.
    assertEquals(wrappers.length, 2);
    for (const pid of wrappers) {
      const descendants = await waitForPoolDescendants(pid, 2);
      assert(descendants.length > 0, `entry ${pid} must own a live descendant tree`);
      descendantsBeforeStop.push(...descendants);
    }

    await pool.stop();

    // `stop()` resolved only after EVERY connector's disconnect finished.
    assert(
      connectors.every((connector) => connector.disconnected),
      "stop must await each pooled connector's disconnect",
    );
    await waitForPoolGone([...wrappers, ...descendantsBeforeStop], 1_000);
    for (const pid of [...wrappers, ...descendantsBeforeStop]) {
      assertEquals(await processAlive(pid), false, `pooled process ${pid} survived stop`);
    }
  } finally {
    for (
      const pid of [...wrappers, ...descendantsBeforeStop, ...(await descendantsOrEmpty(wrappers))]
    ) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    registry.stop();
    await fsp.rm(fixtureDir, { recursive: true }).catch(() => {});
  }
});

test("Pool Stop Terminates Every Pooled Agent - stop with no entries", async () => {
  const registry = new SessionRegistry(1000);
  let factoryCalls = 0;
  try {
    const pool = new AgentProcessPool(
      makeConfig(),
      registry,
      "test-secret-0123456789abcdef0123456789",
      () => {
        factoryCalls++;
        return new StubConnector() as unknown as AgentConnector;
      },
    );
    await pool.stop();
    assertEquals(factoryCalls, 0, "stopping an empty pool must not spawn anything");
  } finally {
    registry.stop();
  }
});

test(
  "Pool Stop Terminates Every Pooled Agent - an in-flight acquisition is disconnected before stop resolves",
  async () => {
    const registry = new SessionRegistry(1000);
    const connectGate = Promise.withResolvers<void>();
    const events: string[] = [];
    const pool = new AgentProcessPool(
      makeConfig(),
      registry,
      "test-secret-0123456789abcdef0123456789",
      () => {
        events.push("spawned");
        return {
          isConnected: true,
          connect: async () => {
            events.push("connecting");
            await connectGate.promise;
            events.push("connected");
          },
          disconnect: () => {
            events.push("disconnected");
            return Promise.resolve();
          },
          getProcessPid: () => undefined,
          getProcessEvidence: () => ({ generations: 1, pid: undefined }),
        } as unknown as AgentConnector;
      },
    );
    try {
      const sid = registerSession(registry, { channelId: "discord/4" });
      const runResult = pool.run(
        poolRunOptions({ channelId: "discord/4", shellSessionId: sid }),
        () => Promise.resolve("acp"),
      );
      await waitUntil(() => events.includes("connecting"));

      let stopSettled = false;
      const stopPromise = pool.stop().finally(() => {
        stopSettled = true;
      });
      // With `connect()` still pending, stop must NOT resolve: the acquisition
      // it is waiting for could otherwise publish a live agent after the
      // disconnect pass. A timer turn lets a non-waiting stop settle.
      await delay(0);
      assertEquals(stopSettled, false);

      connectGate.resolve();
      await stopPromise;

      // The barrier disconnects the late connector instead of publishing it,
      // and stop resolves only after it is gone.
      assertEquals(events, ["spawned", "connecting", "connected", "disconnected"]);
      assertEquals(await runResult, { acpSessionId: null, cancelledByDeadline: true });
    } finally {
      connectGate.resolve();
      registry.stop();
    }
  },
);

/**
 * Real delay: a spawned kernel process's arrival and death are OS events, not
 * timers under test control, so these barriers poll the kernel within a bounded
 * deadline (the sanctioned exception; no guessed single sleep).
 */
async function waitForPoolDescendants(pid: number, expected: number): Promise<number[]> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const descendants = await listDescendantPids(pid);
    if (descendants.ok && descendants.pids.length >= expected) return descendants.pids;
    await delay(10);
  }
  throw new Error(`pooled wrapper ${pid} never reached ${expected} descendants`);
}

/** Bounded wait until every PID is gone; throws naming the survivors. */
async function waitForPoolGone(pids: number[], timeoutMs: number): Promise<void> {
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
  throw new Error(`pooled processes still alive after stop: ${survivors.join(", ")}`);
}

/** Bounded wait for an observable state (no wall-clock guess about its duration). */
async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("condition never became true");
    await delay(1);
  }
}

/** Best-effort descendant snapshot for teardown when a wrapper already exited. */
async function descendantsOrEmpty(pids: number[]): Promise<number[]> {
  const descendants: number[] = [];
  for (const pid of pids) {
    const found = await listDescendantPids(pid);
    if (found.ok) descendants.push(...found.pids);
  }
  return descendants;
}

/** A small real delay for bounded kernel polling. */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
