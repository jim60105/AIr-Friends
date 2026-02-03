// tests/skills/memory-handler.test.ts

import { assertEquals } from "@std/assert";
import { MemoryHandler } from "@skills/memory-handler.ts";
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

Deno.test("MemoryHandler - handleMemorySave saves memory successfully", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
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

  const result = await handler.handleMemorySave(
    {
      content: "Test memory content",
      visibility: "public",
      importance: "normal",
    },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave validates parameters", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Test missing content
  const result1 = await handler.handleMemorySave({}, context);
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Missing or invalid 'content' parameter");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySearch searches memories", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
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

  // Add a memory first
  await handler.handleMemorySave(
    {
      content: "User likes hiking in mountains",
      visibility: "public",
      importance: "normal",
    },
    context,
  );

  // Search for it
  const result = await handler.handleMemorySearch(
    {
      query: "hiking mountains",
      limit: 5,
    },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch patches memory", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
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

  // Add a memory first
  const saveResult = await handler.handleMemorySave(
    {
      content: "Test memory to patch",
      visibility: "public",
      importance: "normal",
    },
    context,
  );

  const memoryId = (saveResult.data as { id: string }).id;

  // Patch it
  const patchResult = await handler.handleMemoryPatch(
    {
      memory_id: memoryId,
      enabled: false,
    },
    context,
  );

  assertEquals(patchResult.success, true);
  assertEquals(typeof patchResult.data, "object");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave validates invalid visibility", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "test", visibility: "invalid" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'visibility' parameter. Must be 'public' or 'private'");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave validates invalid importance", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "test", importance: "critical" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'importance' parameter. Must be 'high' or 'normal'");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave rejects private in non-DM", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: false, // Not a DM
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "test", visibility: "private" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Private memories can only be saved in DM contexts");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySearch validates invalid limit", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySearch(
    { query: "test", limit: -5 },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'limit' parameter. Must be a positive number");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch validates missing memory_id", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch({}, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Missing or invalid 'memory_id' parameter");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch validates invalid enabled", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id", enabled: "yes" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'enabled' parameter. Must be a boolean");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch validates invalid visibility", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id", visibility: "secret" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'visibility' parameter. Must be 'public' or 'private'");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch validates invalid importance", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id", importance: "critical" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'importance' parameter. Must be 'high' or 'normal'");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch requires at least one field", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const handler = new MemoryHandler(memoryStore);

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: `${tempDir}/workspaces/discord/123/456`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(
    result.error,
    "At least one of 'enabled', 'visibility', or 'importance' must be provided",
  );

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
