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

Deno.test("MemoryHandler - handleMemorySave saves memory in DM as private", async () => {
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  // Create workspace directory with both memory files
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    {
      content: "Test memory content",
      importance: "normal",
    },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");
  // Visibility should be auto-determined as "private" in DM context
  assertEquals((result.data as { visibility: string }).visibility, "private");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave saves memory in guild as public", async () => {
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  // Create workspace directory
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    {
      content: "Test memory content",
      importance: "normal",
    },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");
  // Visibility should be auto-determined as "public" in non-DM context
  assertEquals((result.data as { visibility: string }).visibility, "public");

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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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

Deno.test("MemoryHandler - handleMemorySearch searches memories in DM context", async () => {
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  // Create workspace directory with both memory files
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Add a memory (will be saved as private in DM context)
  await handler.handleMemorySave(
    {
      content: "User likes hiking in mountains",
      importance: "normal",
    },
    context,
  );

  // Search for it (DM context searches private only)
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  // Create workspace directory with both memory files
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Add a memory first (auto private in DM)
  const saveResult = await handler.handleMemorySave(
    {
      content: "Test memory to patch",
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

Deno.test("MemoryHandler - handleMemorySave ignores agent-provided visibility in DM", async () => {
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  // Create workspace directory with both memory files
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Even if agent passes visibility: "public", DM context forces private
  const result = await handler.handleMemorySave(
    { content: "test", visibility: "public" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { visibility: string }).visibility, "private");

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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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

Deno.test("MemoryHandler - handleMemorySave ignores agent-provided visibility in non-DM", async () => {
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false, // Not a DM
  };

  // Create workspace directory
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  // Even if agent passes visibility: "private", non-DM context forces public
  const result = await handler.handleMemorySave(
    { content: "test", visibility: "private" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { visibility: string }).visibility, "public");

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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
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
    "At least one of 'enabled', 'visibility', 'importance', 'tier', 'category', 'decay', 'relatedTo', or 'supersedes' must be provided",
  );

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

// ============ Relationship Fields Tests ============

Deno.test("MemoryHandler - handleMemoryPatch accepts relatedTo parameter", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const saveResult = await handler.handleMemorySave(
    { content: "Test memory", importance: "normal" },
    context,
  );
  const memoryId = (saveResult.data as { id: string }).id;

  const patchResult = await handler.handleMemoryPatch(
    { memory_id: memoryId, relatedTo: ["mem_1", "mem_2"] },
    context,
  );

  assertEquals(patchResult.success, true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch rejects invalid relatedTo", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id", relatedTo: "not-an-array" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'relatedTo' parameter. Must be an array of strings");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch accepts supersedes parameter", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const saveResult = await handler.handleMemorySave(
    { content: "Test memory", importance: "normal" },
    context,
  );
  const memoryId = (saveResult.data as { id: string }).id;

  const patchResult = await handler.handleMemoryPatch(
    { memory_id: memoryId, supersedes: ["mem_old"] },
    context,
  );

  assertEquals(patchResult.success, true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave accepts relatedTo and supersedes", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    {
      content: "Summary memory",
      importance: "high",
      relatedTo: ["mem_r1"],
      supersedes: ["mem_s1", "mem_s2"],
    },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as {
    id: string;
    relatedTo?: string[];
    supersedes?: string[];
  };
  assertEquals(data.relatedTo, ["mem_r1"]);
  assertEquals(data.supersedes, ["mem_s1", "mem_s2"]);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave rejects invalid relatedTo", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "test", relatedTo: "not-array" },
    context,
  );
  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'relatedTo' parameter. Must be an array of strings");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave rejects invalid supersedes", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "test", supersedes: [123, 456] },
    context,
  );
  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'supersedes' parameter. Must be an array of strings");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryPatch rejects invalid supersedes", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryPatch(
    { memory_id: "test_id", supersedes: "not-an-array" },
    context,
  );
  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'supersedes' parameter. Must be an array of strings");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySave without relatedTo/supersedes omits them from response", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemorySave(
    { content: "plain memory" },
    context,
  );
  assertEquals(result.success, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.relatedTo, undefined);
  assertEquals(data.supersedes, undefined);

  await Deno.remove(tempDir, { recursive: true });
});

// ============ Agent Workspace Search Tests ============

Deno.test("MemoryHandler - handleMemorySearch searches agent workspace notes", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  // Create workspace and memory files
  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  // Create agent workspace with a note
  const agentWorkspacePath = `${tempDir}/agent-workspace`;
  await Deno.mkdir(`${agentWorkspacePath}/notes`, { recursive: true });
  await Deno.writeTextFile(
    `${agentWorkspacePath}/notes/cooking.md`,
    "# Cooking Notes\n\nBest pasta recipe uses fresh tomatoes\n",
  );
  await Deno.writeTextFile(`${agentWorkspacePath}/notes/_index.md`, "# Notes Index\n");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "channel123",
    userId: "123",
    agentWorkspacePath,
  };

  const result = await handler.handleMemorySearch(
    { query: "pasta" },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as { memories: unknown[]; agentNotes: unknown[] };
  assertEquals(Array.isArray(data.agentNotes), true);
  assertEquals(data.agentNotes.length > 0, true);

  const note = data.agentNotes[0] as { filePath: string; matchedLines: unknown[] };
  assertEquals(note.filePath, "notes/cooking.md");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemorySearch returns empty agentNotes when no workspace", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "channel123",
    userId: "123",
    // No agentWorkspacePath
  };

  const result = await handler.handleMemorySearch(
    { query: "test" },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as { memories: unknown[]; agentNotes?: unknown[] };
  // agentNotes should be undefined when no workspace path provided
  assertEquals(data.agentNotes, undefined);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - memory-stats - returns statistics", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  // Add some memories
  await memoryStore.addMemory(workspace, "Test public", { visibility: "public" });
  await memoryStore.addMemory(workspace, "Test private", { visibility: "private" });

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "channel123",
    userId: "123",
  };

  const result = await handler.handleMemoryStats({}, context);

  assertEquals(result.success, true);
  const data2 = result.data as {
    public: { total: number };
    private: { total: number } | null;
    summary: { totalMemories: number };
  };
  assertEquals(data2.public.total, 1);
  assertEquals(data2.private !== null, true);
  assertEquals(data2.private!.total, 1);
  assertEquals(data2.summary.totalMemories, 2);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - memory-stats - respects DM privacy", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "channel123",
    userId: "123",
  };

  const result = await handler.handleMemoryStats({}, context);

  assertEquals(result.success, true);
  const data2 = result.data as {
    public: { total: number };
    private: null;
    summary: { totalMemories: number };
  };
  assertEquals(data2.private, null);

  await Deno.remove(tempDir, { recursive: true });
});

// ============ Memory Export Tests ============

Deno.test("MemoryHandler - handleMemoryExport returns empty file when no memories", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  let sentFileName = "";
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ fileName: string }>) => {
      sentFileName = files[0].fileName;
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "public_channel_456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { count: number }).count, 0);
  assertEquals(sentFileName, "memory-export.md");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport sends file via DM in markdown format", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  // Add a public memory
  await memoryStore.addMemory(workspace, "Public memory", {
    visibility: "public",
    importance: "normal",
  });

  let sentChannelId = "";
  let sentFileName = "";
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (userId: string) => Promise.resolve(`dm_${userId}`),
    sendFile: (channelId: string, files: Array<{ fileName: string }>) => {
      sentChannelId = channelId;
      sentFileName = files[0].fileName;
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "public_channel_456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(sentChannelId, "dm_123");
  assertEquals(sentFileName, "memory-export.md");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport sends file via DM in json format", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: true,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  let sentFileName = "";
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ fileName: string }>) => {
      sentFileName = files[0].fileName;
      return Promise.resolve({ success: true, messageId: "file_msg_456" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "json" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(sentFileName, "memory-export.json");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport always includes both public and private memories", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  // Add both public and private memories
  await memoryStore.addMemory(workspace, "Public memory", {
    visibility: "public",
    importance: "normal",
  });
  await memoryStore.addMemory(workspace, "Private memory", {
    visibility: "private",
    importance: "high",
  });

  let sentFileContent: Uint8Array | null = null;
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ content: Uint8Array }>) => {
      const content = files[0].content;
      sentFileContent = content;
      return Promise.resolve({ success: true, messageId: "file_msg_789" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "public_channel_456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { count: number }).count, 2);

  // Verify both memories are in the file
  const fileText = new TextDecoder().decode(sentFileContent!);
  assertEquals(fileText.includes("Public memory"), true);
  assertEquals(fileText.includes("Private memory"), true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport filters by importance", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  await memoryStore.addMemory(workspace, "Normal memory", {
    visibility: "public",
    importance: "normal",
  });
  await memoryStore.addMemory(workspace, "High memory", {
    visibility: "public",
    importance: "high",
  });

  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: () => {
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown", importance: "high" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { count: number }).count, 1);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport filters enabled_only", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const saveResult = await memoryStore.addMemory(workspace, "Enabled memory", {
    visibility: "public",
    importance: "normal",
  });
  await memoryStore.addMemory(workspace, "To be disabled memory", {
    visibility: "public",
    importance: "normal",
  });

  // Disable the first memory
  await memoryStore.patchMemory(workspace, saveResult.id, { enabled: false });

  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: () => {
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  // Default enabled_only=true should exclude disabled
  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { count: number }).count, 1);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport includes disabled when enabled_only is false", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const saveResult = await memoryStore.addMemory(workspace, "Memory one", {
    visibility: "public",
    importance: "normal",
  });
  await memoryStore.addMemory(workspace, "Memory two", {
    visibility: "public",
    importance: "normal",
  });

  // Disable one
  await memoryStore.patchMemory(workspace, saveResult.id, { enabled: false });

  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: () => {
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  // enabled_only=false should include disabled
  const result = await handler.handleMemoryExport(
    { format: "markdown", enabled_only: false },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as { count: number }).count, 2);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport validates format parameter", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "csv" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'format' parameter. Must be 'markdown' or 'json'");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport validates importance parameter", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown", importance: "critical" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'importance' parameter. Must be 'high', 'normal', or 'all'");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport returns error when getDmChannelId fails", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve(null),
    sendFile: () => Promise.resolve({ success: true, messageId: "file_msg_123" }),
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Failed to create DM channel. Cannot send export file.");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport returns error when sendFile fails", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: () => Promise.resolve({ success: false, error: "DM channel closed" }),
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "DM channel closed");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport json format contains correct fields", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  await memoryStore.addMemory(workspace, "JSON test memory", {
    visibility: "public",
    importance: "high",
  });

  let sentFileContent: Uint8Array | null = null;
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ content: Uint8Array }>) => {
      const content = files[0].content;
      sentFileContent = content;
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "json" },
    context,
  );

  assertEquals(result.success, true);

  // Verify JSON structure
  const fileText = new TextDecoder().decode(sentFileContent!);
  const parsed = JSON.parse(fileText);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].content, "JSON test memory");
  assertEquals(parsed[0].importance, "high");
  assertEquals(parsed[0].visibility, "public");
  assertEquals(parsed[0].enabled, true);
  assertEquals(typeof parsed[0].id, "string");
  assertEquals(typeof parsed[0].createdAt, "string");
  assertEquals(typeof parsed[0].lastModifiedAt, "string");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport markdown shows lastModifiedAt when different", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  const saveResult = await memoryStore.addMemory(workspace, "Modified memory", {
    visibility: "public",
    importance: "normal",
  });

  // Small delay to ensure different timestamps
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Patch it to create a different lastModifiedAt
  await memoryStore.patchMemory(workspace, saveResult.id, { importance: "high" });

  let sentFileContent: Uint8Array | null = null;
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ content: Uint8Array }>) => {
      const content = files[0].content;
      sentFileContent = content;
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown", enabled_only: true },
    context,
  );

  assertEquals(result.success, true);

  // Verify markdown includes "Last Modified" since it differs from created
  const fileText = new TextDecoder().decode(sentFileContent!);
  assertEquals(fileText.includes("**Last Modified**"), true);
  assertEquals(fileText.includes("Modified memory"), true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport handles unexpected error gracefully", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  // Mock adapter that throws on getDmChannelId
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: () => {
      throw new Error("Unexpected network error");
    },
    sendFile: () => Promise.resolve({ success: true, messageId: "file_msg_123" }),
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleMemoryExport(
    { format: "markdown" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Unexpected network error");

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("MemoryHandler - handleMemoryExport defaults to markdown and all importance", async () => {
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
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: `${tempDir}/workspaces/discord/123`,
    tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
    isDm: false,
  };

  await Deno.mkdir(workspace.path, { recursive: true });
  await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
  await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

  await memoryStore.addMemory(workspace, "Normal mem", {
    visibility: "public",
    importance: "normal",
  });
  await memoryStore.addMemory(workspace, "High mem", {
    visibility: "public",
    importance: "high",
  });

  let sentFileName = "";
  const mockAdapter = {
    ...createMockPlatformAdapter(),
    getDmChannelId: (_userId: string) => Promise.resolve("dm_123"),
    sendFile: (_channelId: string, files: Array<{ fileName: string }>) => {
      sentFileName = files[0].fileName;
      return Promise.resolve({ success: true, messageId: "file_msg_123" });
    },
  } as unknown as PlatformAdapter;

  const context: SkillContext = {
    workspace,
    platformAdapter: mockAdapter,
    channelId: "456",
    userId: "123",
  };

  // Call with empty params (all defaults)
  const result = await handler.handleMemoryExport({}, context);

  assertEquals(result.success, true);
  assertEquals(sentFileName, "memory-export.md"); // Default markdown
  assertEquals((result.data as { count: number }).count, 2); // All importance

  await Deno.remove(tempDir, { recursive: true });
});
