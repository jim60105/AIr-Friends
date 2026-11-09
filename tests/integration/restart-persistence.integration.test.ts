// tests/integration/restart-persistence.integration.test.ts
//
// Process-level proof for P0-8 (design D1): the state a daemon process
// persists survives a restart on the same data directory. Each test writes
// through live store/manager instances, drops every reference, then opens
// fresh instances on the same directory and asserts what they return.
//
// "Restart" here is in-process: the stores keep no data in module-level
// state, so fresh instances are the same observation a new process makes. The
// four test names are the four `restart-persistence` spec scenarios.

import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { ReminderStore } from "../../src/core/reminder-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import { ErrorCode, WorkspaceError } from "../../src/types/errors.ts";
import type { ReminderEntry } from "../../src/types/reminder.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import { makeTempDir } from "../../src/utils/fs-compat.ts";
import { createSkillJwt, verifySkillJwt } from "../../src/utils/skill-jwt.ts";
import { resolveSkillApiSecret } from "../../src/utils/skill-secret.ts";

/** The configured reminder file name (`reminders.persistPath` default). */
const REMINDER_PERSIST_PATH = "reminders.jsonl";

/**
 * Minimal application config whose workspace points at one temporary data
 * directory. Only the workspace section is consumed by these tests.
 */
function createTestConfig(dataDir: string): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: dataDir, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "all",
    channels: [],
  };
}

/** One DM event identifying a user's workspace. */
function createEvent(userId: string): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "test-channel",
    userId,
    messageId: `message-${userId}`,
    isDm: true,
    guildId: "",
    content: "hello",
    timestamp: new Date(),
  };
}

/**
 * Fresh store instances over the config's data directory. Each phase calls
 * this, so nothing is shared between the "before" and "after" instances.
 */
function openStores(config: Config): {
  workspaceManager: WorkspaceManager;
  memoryStore: MemoryStore;
  reminderStore: ReminderStore;
} {
  const workspaceManager = new WorkspaceManager({
    repoPath: config.workspace.repoPath,
    workspacesDir: config.workspace.workspacesDir,
  });
  return {
    workspaceManager,
    memoryStore: new MemoryStore(workspaceManager, {
      workingTierLimit: config.memory.workingTierLimit,
    }),
    reminderStore: new ReminderStore(REMINDER_PERSIST_PATH),
  };
}

/** Runs `fn` on a fresh temporary data directory and removes it afterwards. */
async function withDataDir(fn: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await makeTempDir({ prefix: "air-friends-restart-" });
  try {
    await fn(dataDir);
  } finally {
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

test("Memory and reminder", async () => {
  await withDataDir(async (dataDir) => {
    const config = createTestConfig(dataDir);
    const event = createEvent("alice");
    const memoryContent = "Alice prefers jasmine tea over coffee.";
    let memoryId = "";
    let reminderId = "";
    let scheduledAt = "";

    {
      const { workspaceManager, memoryStore, reminderStore } = openStores(config);
      const workspace = await workspaceManager.getOrCreateWorkspace(event);

      const memory = await memoryStore.addMemory(workspace, memoryContent, { importance: "high" });
      memoryId = memory.id;

      scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const reminder: ReminderEntry = {
        type: "reminder",
        id: `rem_${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        scheduledAt,
        message: "Water the plants",
        platform: "discord",
        userId: "alice",
        enabled: true,
      };
      reminderId = reminder.id;
      await reminderStore.addReminder(workspace, reminder);
    }

    {
      const { workspaceManager, memoryStore, reminderStore } = openStores(config);
      const workspace = await workspaceManager.getOrCreateWorkspace(event);

      const memories = await memoryStore.loadAllMemories(workspace, "public");
      const restoredMemory = memories.find((memory) => memory.id === memoryId);
      assert(restoredMemory !== undefined);
      assertEquals(restoredMemory.content, memoryContent);
      assertEquals(restoredMemory.importance, "high");

      assertEquals(await reminderStore.getActiveCount(workspace), 1);
      const reminders = await reminderStore.loadReminders(workspace);
      const restoredReminder = reminders.find((reminder) => reminder.id === reminderId);
      assert(restoredReminder !== undefined);
      assertEquals(restoredReminder.scheduledAt, scheduledAt);
      assertEquals(restoredReminder.enabled, true);
    }
  });
});

test("Workspace file", async () => {
  await withDataDir(async (dataDir) => {
    const config = createTestConfig(dataDir);
    const event = createEvent("bob");
    const relativePath = "notes/restart.md";
    const content = "# Restart note\n\nPersisted across a new process.\n";

    {
      const { workspaceManager } = openStores(config);
      const workspace = await workspaceManager.getOrCreateWorkspace(event);
      await workspaceManager.writeWorkspaceFile(workspace, relativePath, content);
    }

    {
      const { workspaceManager } = openStores(config);
      const workspace: WorkspaceInfo = await workspaceManager.getOrCreateWorkspace(event);
      assertEquals(await workspaceManager.readWorkspaceFile(workspace, relativePath), content);
    }
  });
});

test("Token minted before restart", async () => {
  await withDataDir(async (dataDir) => {
    const secretPath = join(dataDir, "skill-secret");
    const previousSecret = process.env["AGENT_SKILL_API_SECRET"];
    delete process.env["AGENT_SKILL_API_SECRET"];

    try {
      let token = "";
      let secretBefore = "";

      {
        const generated = await resolveSkillApiSecret(secretPath);
        assert(generated.ok);
        if (generated.ok) {
          assertEquals(generated.source, "generated");
          secretBefore = generated.secret;
          token = await createSkillJwt(secretBefore, {
            sub: "session-before-restart",
            channel: "discord/account/alice",
            jti: "caller-token-before-restart",
          });
        }
      }

      {
        const loaded = await resolveSkillApiSecret(secretPath);
        assert(loaded.ok);
        if (loaded.ok) {
          assertEquals(loaded.source, "file");
          assertEquals(loaded.secret, secretBefore);
          assertEquals(
            await verifySkillJwt(token, loaded.secret, {
              sessionId: "session-before-restart",
              channelId: "discord/account/alice",
              callerToken: "caller-token-before-restart",
            }),
            { valid: true },
          );
        }
      }
    } finally {
      if (previousSecret !== undefined) process.env["AGENT_SKILL_API_SECRET"] = previousSecret;
      else delete process.env["AGENT_SKILL_API_SECRET"];
    }
  });
});

test("Cross-user path after restart", async () => {
  await withDataDir(async (dataDir) => {
    const config = createTestConfig(dataDir);
    const aliceEvent = createEvent("alice");
    const bobEvent = createEvent("bob");
    let bobFilePath = "";

    {
      const { workspaceManager } = openStores(config);
      const alice = await workspaceManager.getOrCreateWorkspace(aliceEvent);
      const bob = await workspaceManager.getOrCreateWorkspace(bobEvent);
      await workspaceManager.writeWorkspaceFile(bob, "secret.md", "Bob's private note\n");
      bobFilePath = join(bob.path, "secret.md");
      // The boundary itself exists before the restart and must still be the
      // boundary a skill handler enforces afterwards.
      workspaceManager.validateFileAccess(bobFilePath, bob);
      assert(alice.path !== bob.path);
    }

    {
      const { workspaceManager } = openStores(config);
      const alice = await workspaceManager.getOrCreateWorkspace(aliceEvent);
      await workspaceManager.getOrCreateWorkspace(bobEvent);

      let thrown: unknown;
      try {
        workspaceManager.validateFileAccess(bobFilePath, alice);
      } catch (error) {
        thrown = error;
      }
      assert(thrown instanceof WorkspaceError);
      assertEquals(thrown.code, ErrorCode.WORKSPACE_ACCESS_DENIED);
    }
  });
});
