import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MemoryMaintenanceScheduler } from "@core/memory-maintenance-scheduler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { isValidPlatform } from "../../src/types/events.ts";
import type { MemoryMaintenanceConfig } from "../../src/types/config.ts";

function createConfig(overrides?: Partial<MemoryMaintenanceConfig>): MemoryMaintenanceConfig {
  return {
    enabled: true,
    model: "gpt-5-mini",
    minMemoryCount: 50,
    intervalMs: 30,
    ...overrides,
  };
}

Deno.test("MemoryMaintenanceScheduler - disabled config does not start scheduler", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ enabled: false }));
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt, null);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - scheduleNext sets correct interval", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 100 }));
  scheduler.setCallback(async () => {});

  const before = Date.now();
  scheduler.start();
  const next = scheduler.getStatus().nextScheduledAt;
  assertEquals(next instanceof Date, true);

  const delta = (next as Date).getTime() - before;
  assertEquals(delta >= 80 && delta <= 200, true);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - prevents concurrent execution", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  let running = false;
  let overlapDetected = false;
  let callCount = 0;

  scheduler.setCallback(async () => {
    if (running) overlapDetected = true;
    running = true;
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    running = false;
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 140));
  scheduler.stop();
  await new Promise((resolve) => setTimeout(resolve, 60));

  assertEquals(overlapDetected, false);
  assertEquals(callCount >= 2, true);
});

Deno.test("MemoryMaintenanceScheduler - reschedules after error", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  let callCount = 0;

  scheduler.setCallback(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.reject(new Error("expected"));
    }
    return Promise.resolve();
  });
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 140));
  scheduler.stop();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assertEquals(callCount >= 2, true);
});

Deno.test("MemoryMaintenanceScheduler - stop clears timer", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig());
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(scheduler.getStatus().nextScheduledAt instanceof Date, true);
  scheduler.stop();
  assertEquals(scheduler.getStatus().nextScheduledAt, null);
});

Deno.test("MemoryMaintenanceScheduler - start is no-op when already started", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 100 }));
  scheduler.setCallback(async () => {});
  scheduler.start();

  const nextFirst = scheduler.getStatus().nextScheduledAt;
  // Calling start again should be a no-op
  scheduler.start();
  const nextSecond = scheduler.getStatus().nextScheduledAt;

  assertEquals(nextFirst, nextSecond);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - getStatus returns correct running state", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  let resolveCallback: () => void;
  const callbackPromise = new Promise<void>((resolve) => {
    resolveCallback = resolve;
  });

  scheduler.setCallback(async () => {
    assertEquals(scheduler.getStatus().isRunning, true);
    resolveCallback();
    await new Promise((r) => setTimeout(r, 30));
  });
  scheduler.start();

  await callbackPromise;
  scheduler.stop();
  await new Promise((r) => setTimeout(r, 50));

  assertEquals(scheduler.getStatus().isRunning, false);
  assertEquals(scheduler.getStatus().lastExecutedAt instanceof Date, true);
});

Deno.test("MemoryMaintenanceScheduler - execute without callback", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 20 }));
  // No callback set
  scheduler.start();

  await new Promise((resolve) => setTimeout(resolve, 60));
  scheduler.stop();

  // Should not throw - lastExecutedAt should be set even without callback
  assertEquals(scheduler.getStatus().lastExecutedAt instanceof Date, true);
});

// === State Restoration Tests ===

Deno.test("MemoryMaintenanceScheduler - uses restored schedule time within valid range", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 5000 }));
  scheduler.setCallback(async () => {});

  const futureTime = new Date(Date.now() + 2000);
  scheduler.start({ memoryMaintenance: futureTime.toISOString() });

  assertEquals(
    scheduler.getStatus().nextScheduledAt?.toISOString(),
    futureTime.toISOString(),
  );
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - executes immediately when restored time is past", async () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 5000 }));
  let executed = false;
  scheduler.setCallback(() => {
    executed = true;
    return Promise.resolve();
  });

  scheduler.start({ memoryMaintenance: new Date(Date.now() - 60000).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assertEquals(executed, true);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - reschedules when restored time exceeds max", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 200 }));
  scheduler.setCallback(async () => {});

  scheduler.start({ memoryMaintenance: new Date(Date.now() + 999999999).toISOString() });

  const delta = scheduler.getStatus().nextScheduledAt!.getTime() - Date.now();
  assertEquals(delta <= 300, true);
  scheduler.stop();
});

Deno.test("MemoryMaintenanceScheduler - persists next time via stateStore", () => {
  const scheduler = new MemoryMaintenanceScheduler(createConfig({ intervalMs: 100 }));
  const saved: { key: string; nextAt: Date }[] = [];
  scheduler.setStateStore({
    save: (key: string, nextAt: Date) => {
      saved.push({ key, nextAt });
      return Promise.resolve();
    },
  } as never);
  scheduler.setCallback(async () => {});
  scheduler.start();

  assertEquals(saved.length >= 1, true);
  assertEquals(saved[0].key, "memoryMaintenance");
  scheduler.stop();
});

// --- Email workspace enumeration (email-platform-surfaces) ---
//
// The callback `bootstrap.ts` registers on this scheduler enumerates every user and
// channel workspace and admits a key only when `isValidPlatform` accepts its platform
// segment. Email joins that enumeration through the union alone: a sender's
// `email/{e_<sha256>}` workspace must be admitted and its memory counted, while a
// non-platform directory stays rejected by the same gate.

/** One canonical email user id (the message store's owner-name shape). */
const EMAIL_OWNER = `e_${"ef".repeat(32)}`;

Deno.test("memory maintenance enumeration admits the email workspace and counts its memory", async () => {
  const repoPath = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath, workspacesDir: "workspaces" });
    const store = new MemoryStore(manager, {});

    // An email sender's workspace, created exactly as an email event creates it.
    const emailWorkspace = await manager.getOrCreateWorkspace({
      platform: "email",
      channelId: `mail:${EMAIL_OWNER}:th-1`,
      userId: EMAIL_OWNER,
      messageId: "msg-1",
      isDm: false,
      guildId: "",
      content: "hello",
      timestamp: new Date(),
    });
    for (const content of ["memory one", "memory two", "memory three"]) {
      await store.addMemory(emailWorkspace, content);
    }

    // A workspace whose directory name is not a platform: enumerated by the walk, but
    // the platform gate is what must reject it.
    const unknownWorkspace = join(repoPath, "workspaces", "telegram", "u1");
    await Deno.mkdir(unknownWorkspace, { recursive: true });
    await Deno.writeTextFile(join(unknownWorkspace, "memory.public.jsonl"), "{}\n");

    const listed = await manager.listWorkspaces();
    assertEquals(listed.includes(`email/${EMAIL_OWNER}`), true, listed.join(", "));
    assertEquals(listed.includes("telegram/u1"), true, listed.join(", "));

    // Replay of the maintenance callback's enumeration gate.
    const admitted: Array<{ workspaceKey: string; count: number }> = [];
    for (const workspaceKey of listed) {
      const [platform, userId] = workspaceKey.split("/");
      if (!isValidPlatform(platform) || !userId) continue;
      const workspaceInfo = await manager.getOrCreateWorkspace({
        platform,
        userId,
        channelId: "internal",
        messageId: "maintenance_check",
        isDm: true,
        guildId: "",
        content: "",
        timestamp: new Date(),
      });
      admitted.push({
        workspaceKey,
        count: await store.countEnabledMemories(workspaceInfo),
      });
    }

    const emailEntry = admitted.find((entry) => entry.workspaceKey === `email/${EMAIL_OWNER}`);
    assertEquals(emailEntry?.count, 3, "maintenance sees the email workspace's memory");
    // … and reaches `processMemoryMaintenance` for any operator threshold at or below
    // the sender's memory count, which is the callback's own decision.
    const maintained = admitted.filter((entry) => entry.count >= 2).map((entry) =>
      entry.workspaceKey
    );
    assertEquals(maintained.includes(`email/${EMAIL_OWNER}`), true, maintained.join(", "));
    assertEquals(
      admitted.some((entry) => entry.workspaceKey === "telegram/u1"),
      false,
      "a non-platform directory is still rejected by the gate",
    );
  } finally {
    await Deno.remove(repoPath, { recursive: true });
  }
});

Deno.test("bootstrap - the maintenance callback keeps enumerating through the platform gate", () => {
  // Static wiring anchors (the house pattern for bootstrap ordering): the maintenance
  // enumeration cannot drift away from the platform gate or drop channel workspaces
  // without failing here.
  const source = Deno.readTextFileSync(
    new URL("../../src/bootstrap.ts", import.meta.url),
  );
  for (
    const anchor of [
      "memoryMaintenanceScheduler.setCallback(async () => {",
      "const workspaceKeys = await workspaceManager.listWorkspaces();",
      "if (!isValidPlatform(platform) || !userId) {",
      "await orchestrator.processMemoryMaintenance(workspaceKey, config.memoryMaintenance!);",
      "const channelKeys = await workspaceManager.listChannelWorkspaces();",
      "if (!isValidPlatform(platform) || !channelId) {",
      "await orchestrator.processChannelMemoryMaintenance(",
    ]
  ) {
    assertEquals(source.includes(anchor), true, `maintenance wiring anchor missing: ${anchor}`);
  }
});
