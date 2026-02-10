// tests/skills/registry.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

// Create a mock platform adapter
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
    getConnectionStatus: () => ({
      state: "connected" as const,
      reconnectAttempts: 0,
    }),
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

Deno.test("SkillRegistry - registers all skills", () => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const skills = registry.getAvailableSkills();

  assertEquals(skills.includes("memory-save"), true);
  assertEquals(skills.includes("memory-search"), true);
  assertEquals(skills.includes("memory-patch"), true);
  assertEquals(skills.includes("send-reply"), true);
  assertEquals(skills.includes("fetch-context"), true);
  assertEquals(skills.includes("react-message"), true);

  // Cleanup
  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - hasSkill checks skill existence", () => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  assertEquals(registry.hasSkill("memory-save"), true);
  assertEquals(registry.hasSkill("unknown-skill"), false);

  // Cleanup
  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - executeSkill executes known skill", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    isDm: true,
  };

  // Create workspace directory
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await registry.executeSkill(
    "memory-save",
    {
      content: "Test memory",
      visibility: "public",
      importance: "normal",
    },
    context,
  );

  assertEquals(result.success, true);

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - executeSkill returns error for unknown skill", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await registry.executeSkill("unknown-skill", {}, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Unknown skill: unknown-skill");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - getReplyHandler returns reply handler", () => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const replyHandler = registry.getReplyHandler();
  assertExists(replyHandler);

  // Cleanup
  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - getReactionHandler returns handler", () => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const reactionHandler = registry.getReactionHandler();
  assertExists(reactionHandler);

  // Cleanup
  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test("SkillRegistry - executeSkill handles handler exceptions", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const registry = new SkillRegistry(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Try to save memory without workspace directory (should cause error)
  const result = await registry.executeSkill(
    "memory-save",
    {
      content: "Test memory",
      visibility: "public",
      importance: "normal",
    },
    context,
  );

  // Should handle the error gracefully
  assertEquals(result.success, false);
  assertEquals(typeof result.error, "string");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
