// tests/skills/reminder-handler.test.ts

import { assertEquals } from "@std/assert";
import { ReminderHandler } from "../../src/skills/reminder-handler.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { ResolvedReminder } from "../../src/types/reminder.ts";
import type { RemindersConfig } from "../../src/types/config.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const createMockPlatformAdapter = (): PlatformAdapter => {
  return {
    platform: "discord",
    capabilities: {
      canFetchHistory: true,
      canSearchMessages: true,
      supportsDm: true,
      supportsGuild: true,
      supportsReactions: true,
      maxMessageLength: 2000,
    },
    getConnectionStatus: () => ({ state: "connected" as const, reconnectAttempts: 0 }),
    onEvent: () => {},
    offEvent: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendReply: () => Promise.resolve({ success: true }),
    fetchRecentMessages: () => Promise.resolve([]),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

const makeWorkspace = (
  tempDir: string,
  isDm = true,
  platform = "discord" as const,
  userId = "u1",
): WorkspaceInfo => {
  const path = `${tempDir}/workspaces/${platform}/${userId}`;
  return {
    key: `${platform}/${userId}`,
    components: { platform, userId },
    path,
    tmpPath: `${path}/tmp`,
    isDm,
  };
};

Deno.test("handleSetReminder - success in DM context sets reminder and returns id", async () => {
  const tempDir = await Deno.makeTempDir();
  const config: RemindersConfig = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  };

  let added: Record<string, unknown> | null = null;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: (_ws: unknown, entry: unknown) => {
      added = entry as Record<string, unknown>;
      return Promise.resolve();
    },
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;

  const handler = new ReminderHandler(mockStore, config);

  const workspace = makeWorkspace(tempDir, true, "discord", "u1");
  await Deno.mkdir(workspace.path, { recursive: true });

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "ch1",
    userId: "u1",
  };

  const scheduledAt = new Date(Date.now() + 5000).toISOString();
  const res = await handler.handleSetReminder({ scheduledAt, message: "remind me" }, context);

  assertEquals(res.success, true);
  assertEquals(typeof (res.data as Record<string, unknown>)?.reminderId, "string");
  // ensure store received entry
  assertEquals((added as unknown as Record<string, unknown>)?.message, "remind me");
});

Deno.test("handleSetReminder - non-DM context returns DM-only error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;

  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, false, "discord", "u1");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c",
    userId: "u1",
  };

  const res = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 2000).toISOString(),
    message: "x",
  }, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});

Deno.test("handleSetReminder - second call same session returns only one per session error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;

  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u2");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "sess",
    userId: "u2",
  };

  const scheduledAt = new Date(Date.now() + 5000).toISOString();
  const r1 = await handler.handleSetReminder({ scheduledAt, message: "one" }, context);
  assertEquals(r1.success, true);
  const r2 = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 6000).toISOString(),
    message: "two",
  }, context);
  assertEquals(r2.success, false);
  assertEquals(typeof r2.error, "string");
});

Deno.test("handleSetReminder - after clearSessionState new session can set again", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;

  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u3");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "s2",
    userId: "u3",
  };

  const scheduledAt = new Date(Date.now() + 4000).toISOString();
  const r1 = await handler.handleSetReminder({ scheduledAt, message: "m" }, context);
  assertEquals(r1.success, true);
  handler.clearSessionState(workspace.key, context.channelId);
  const r2 = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 6000).toISOString(),
    message: "m2",
  }, context);
  assertEquals(r2.success, true);
});

Deno.test("handleSetReminder - missing scheduledAt returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u4");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c4",
    userId: "u4",
  };

  const res = await handler.handleSetReminder({ message: "hi" }, context);
  assertEquals(res.success, false);
  assertEquals(res.error, "Missing required parameter: scheduledAt");
});

Deno.test("handleSetReminder - invalid ISO format returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u5");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c5",
    userId: "u5",
  };

  const res = await handler.handleSetReminder({ scheduledAt: "not-a-date", message: "x" }, context);
  assertEquals(res.success, false);
  assertEquals(res.error, "Invalid scheduledAt format. Must be a valid ISO 8601 timestamp.");
});

Deno.test("handleSetReminder - past time (too close) returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 10000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u6");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c6",
    userId: "u6",
  };

  const res = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 5000).toISOString(),
    message: "x",
  }, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});

Deno.test("handleSetReminder - empty message returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u7");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c7",
    userId: "u7",
  };

  const res = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 5000).toISOString(),
    message: "   ",
  }, context);
  assertEquals(res.success, false);
  assertEquals(res.error, "Missing or empty required parameter: message");
});

Deno.test("handleSetReminder - max reminders exceeded returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 1,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(1),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u8");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c8",
    userId: "u8",
  };

  const res = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 5000).toISOString(),
    message: "ok",
  }, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});

// ========== handleCancelReminder tests ==========
Deno.test("handleCancelReminder - success in DM context", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;

  const existing = [{
    id: "r1",
    userId: "u9",
    enabled: true,
    scheduledAt: new Date(Date.now() + 5000).toISOString(),
    createdAt: new Date().toISOString(),
    message: "m",
    platform: "discord",
    type: "reminder",
  }];
  let cancelledId: string | null = null;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(1),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve(existing as unknown as ResolvedReminder[]),
    cancelReminder: (_ws: unknown, id: string) => {
      cancelledId = id;
      return Promise.resolve();
    },
  } as unknown as ReminderStore;

  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u9");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "cc",
    userId: "u9",
  };

  const res = await handler.handleCancelReminder({ reminderId: "r1" }, context);
  assertEquals(res.success, true);
  assertEquals(cancelledId, "r1");
});

Deno.test("handleCancelReminder - non-DM context returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, false, "discord", "u10");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c10",
    userId: "u10",
  };

  const res = await handler.handleCancelReminder({ reminderId: "rX" }, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});

Deno.test("handleCancelReminder - missing reminderId returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u11");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c11",
    userId: "u11",
  };

  const res = await handler.handleCancelReminder({}, context);
  assertEquals(res.success, false);
  assertEquals(res.error, "Missing required parameter: reminderId");
});

Deno.test("handleCancelReminder - non-existent reminder ID returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u12");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c12",
    userId: "u12",
  };

  const res = await handler.handleCancelReminder({ reminderId: "doesnotexist" }, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});

Deno.test("handleCancelReminder - already disabled reminder returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;

  const existing = [{
    id: "r2",
    userId: "u13",
    enabled: false,
    scheduledAt: new Date(Date.now() + 5000).toISOString(),
    createdAt: new Date().toISOString(),
    message: "m",
    platform: "discord",
    type: "reminder",
  }];
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve(existing as unknown as ResolvedReminder[]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u13");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c13",
    userId: "u13",
  };

  const res = await handler.handleCancelReminder({ reminderId: "r2" }, context);
  assertEquals(res.success, false);
  assertEquals(res.error, "Reminder is already cancelled or has been delivered.");
});

// ========== handleListReminders tests ==========
Deno.test("handleListReminders - lists active reminders in DM", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;

  const now = new Date();
  const existing = [
    {
      id: "lr1",
      userId: "u14",
      enabled: true,
      scheduledAt: new Date(now.getTime() + 5000).toISOString(),
      createdAt: now.toISOString(),
      message: "a",
      platform: "discord",
      type: "reminder",
    },
    {
      id: "lr2",
      userId: "u14",
      enabled: true,
      scheduledAt: new Date(now.getTime() - 5000).toISOString(),
      createdAt: now.toISOString(),
      message: "b",
      platform: "discord",
      type: "reminder",
    },
  ];

  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(1),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve(existing as unknown as ResolvedReminder[]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u14");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c14",
    userId: "u14",
  };

  const res = await handler.handleListReminders({}, context);
  assertEquals(res.success, true);
  const reminders = (res.data as Record<string, unknown>)?.reminders as Array<unknown>;
  assertEquals(reminders.length, 1);
  assertEquals((reminders[0] as Record<string, unknown>).id, "lr1");
});

Deno.test("handleListReminders - returns empty when no reminders", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, true, "discord", "u15");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c15",
    userId: "u15",
  };

  const res = await handler.handleListReminders({}, context);
  assertEquals(res.success, true);
  assertEquals((res.data as Record<string, unknown>)?.count, 0);
  assertEquals(Array.isArray((res.data as Record<string, unknown>)?.reminders), true);
});

Deno.test("handleListReminders - non-DM context returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  const config = {
    enabled: true,
    maxRemindersPerUser: 3,
    minIntervalMs: 1000,
    persistPath: tempDir,
    checkIntervalMs: 1000,
  } as RemindersConfig;
  const mockStore: ReminderStore = {
    getActiveCount: () => Promise.resolve(0),
    addReminder: () => Promise.resolve(),
    loadReminders: () => Promise.resolve([]),
    cancelReminder: () => Promise.resolve(),
  } as unknown as ReminderStore;
  const handler = new ReminderHandler(mockStore, config);
  const workspace = makeWorkspace(tempDir, false, "discord", "u16");
  await Deno.mkdir(workspace.path, { recursive: true });
  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "c16",
    userId: "u16",
  };

  const res = await handler.handleListReminders({}, context);
  assertEquals(res.success, false);
  assertEquals(typeof res.error, "string");
});
