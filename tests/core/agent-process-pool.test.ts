// tests/core/agent-process-pool.test.ts
// Unit tests for the shared ACP process pool: lazy spawn/reuse, global
// execution-lease serialization, queue priority + starvation guard, queue
// deadline cancellation, and per-session JWT + active pointer file hygiene.

import { assert, assertEquals } from "@std/assert";
import { AgentProcessPool } from "../../src/core/agent-process-pool.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { Config } from "../../src/types/config.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import { resolve } from "@std/path";

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
      sharedProcess: {
        enabled: true,
        jwtDir: "data/skill-jwt",
        queueDeadlineMs: 100,
      },
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
      workingTierLimit: 20,
    },
    workspace: {
      repoPath: "/tmp/test",
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
  pool.stop();
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

Deno.test("pool - lazy-spawns once and reuses the process for the same pool key", async () => {
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

Deno.test("pool - serializes sessions from different pool keys (global execution lease)", async () => {
  const registry = new SessionRegistry(1000);
  const running: string[] = [];
  const order: string[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
    registry,
    "test-secret-0123456789abcdef0123456789",
    () => new StubConnector() as unknown as AgentConnector,
  );

  const sidA = registerSession(registry, { channelId: "discord/1" });
  const sidB = registerSession(registry, { channelId: "discord/2" });

  const p1 = pool.run(
    {
      poolKey: "discord:discord/1",
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

Deno.test("pool - interactive sessions take queue priority over maintenance (starvation guard)", async () => {
  const registry = new SessionRegistry(1000);
  const order: string[] = [];
  const pool = new AgentProcessPool(
    makeConfig(),
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
      sessionType: "message",
      shellSessionId: sidBlocker,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/7",
    },
    async () => {
      // Shorter than the 100ms queue deadline so the sweeper does not cancel
      // the queued sessions before they are served.
      await new Promise((r) => setTimeout(r, 50));
      return "acp-blocker";
    },
  );
  // Queue the maintenance job FIRST, then the interactive session.
  const pMaint = pool.run(
    {
      poolKey: "memory-maintenance:discord/999",
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
      poolKey: "discord:discord/1",
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

Deno.test("pool - queue deadline cancels still-queued sessions", async () => {
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
  const pQueued = pool.run(
    {
      poolKey: "discord:discord/2",
      sessionType: "message",
      shellSessionId: sidQueued,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/2",
    },
    async () => {
      await Promise.resolve();
      throw new Error("should not run — cancelled by deadline");
    },
  );

  const [rBlocker, rQueued] = await Promise.all([pBlocker, pQueued]);
  assertEquals(rBlocker.acpSessionId, "acp-blocker");
  assertEquals(rQueued.cancelledByDeadline, true);
  assertEquals(rQueued.acpSessionId, null);
  // The cancelled session is removed from the registry.
  assertEquals(registry.get(sidQueued), undefined);
  // Wait for the pool's idle-reclaim timer (30ms) to fire and complete, then
  // stop the pool.
  await new Promise((r) => setTimeout(r, 60));
  pool.stop();
});

Deno.test("pool - issues per-session JWT and writes the active pointer while the lease is held", async () => {
  const config = makeConfig();
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "/tmp/pool-test-jwt",
    queueDeadlineMs: 600000,
  };
  const registry = new SessionRegistry(1000);
  const jwtDir = "/tmp/pool-test-jwt";
  await Deno.mkdir(jwtDir, { recursive: true });

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
      sessionType: "message",
      shellSessionId: sid,
      priority: "interactive",
      connectorOptions: makeConnectorOptions(),
      sessionCwd: "/tmp/test/workspaces/discord/123",
    },
    async () => {
      // Snapshot the JWT + pointer while this session holds the lease.
      jwtWhileRunning = await Deno.readTextFile(`${jwtDir}/${sid}.jwt`);
      const raw = await Deno.readTextFile(`${jwtDir}/active.json`);
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
  // The pool resolves `run()` when the session completes; the release/cleanup path
  // (pointer clear + JWT delete + drain) runs in a `finally` right after, so poll
  // for the deletion with a bounded wait.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      await Deno.stat(`${jwtDir}/${sid}.jwt`);
      await new Promise((r) => setTimeout(r, 20));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) break;
      throw error;
    }
  }
  try {
    await Deno.stat(`${jwtDir}/${sid}.jwt`);
    // If the file still exists, fail.
    throw new Error("JWT file should be deleted at session end");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  // The cleared pointer is an empty file (owner-validated clear writes "").
  const pointerRaw = await Deno.readTextFile(`${jwtDir}/active.json`);
  const pointer = pointerRaw.trim() ? (JSON.parse(pointerRaw) as { sessionId?: string }) : {};
  assertEquals(pointer.sessionId, undefined);

  await stopPool(pool);
  await Deno.remove(jwtDir, { recursive: true });
});

Deno.test("pool - relative jwtDir config writes JWT + pointer at the resolved absolute path", async () => {
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
          const content = await Deno.readTextFile(`${resolvedJwtDir}/${sid}.jwt`);
          jwtOk = content.trim().length > 0;
        } catch {
          jwtOk = false;
        }
        const pointerRaw = await Deno.readTextFile(`${resolvedJwtDir}/active.json`);
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
    await Deno.remove(resolvedJwtDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("pool - JWT renewals during the lease never resurrect the JWT file after release", async () => {
  const config = makeConfig();
  const jwtDir = "/tmp/pool-test-jwt-renew";
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir,
    queueDeadlineMs: 600000,
  };
  const registry = new SessionRegistry(1000);
  await Deno.mkdir(jwtDir, { recursive: true });

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
      await Deno.stat(`${jwtDir}/${sid}.jwt`);
      await new Promise((r) => setTimeout(r, 20));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) break;
      throw error;
    }
  }
  // Wait past several more renewal ticks: the file must stay deleted.
  await new Promise((r) => setTimeout(r, 150));
  let exists = true;
  try {
    await Deno.stat(`${jwtDir}/${sid}.jwt`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) exists = false;
    else throw error;
  }
  assert(!exists, "JWT file was resurrected by a late renewal after release");

  await stopPool(pool);
  await Deno.remove(jwtDir, { recursive: true });
});
