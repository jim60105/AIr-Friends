// tests/integration/agent-workspace.integration.test.ts

import { assertEquals } from "@std/assert";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { MemoryHandler } from "@skills/memory-handler.ts";
import type { SkillContext } from "@skills/types.ts";
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

Deno.test("Integration: Agent workspace end-to-end flow", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });

    // 1. Create agent workspace
    const agentWorkspacePath = await workspaceManager.getOrCreateAgentWorkspace();
    assertEquals(agentWorkspacePath.includes("agent-workspace"), true);

    // 2. Verify structure
    const readmeContent = await Deno.readTextFile(`${agentWorkspacePath}/README.md`);
    assertEquals(readmeContent.includes("Agent Workspace"), true);

    const indexContent = await Deno.readTextFile(`${agentWorkspacePath}/notes/_index.md`);
    assertEquals(indexContent.includes("Notes Index"), true);

    // 3. Write a test note
    await Deno.writeTextFile(
      `${agentWorkspacePath}/notes/test-topic.md`,
      "# Test Topic\n\nImportant knowledge about testing patterns\n",
    );

    // 4. Search via memory-search
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const handler = new MemoryHandler(memoryStore);

    const workspace: WorkspaceInfo = {
      key: "discord/testuser",
      components: { platform: "discord", userId: "testuser" },
      path: `${tempDir}/workspaces/discord/testuser`,
      isDm: false,
    };

    // Create user workspace
    await Deno.mkdir(workspace.path, { recursive: true });
    await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
    await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

    const context: SkillContext = {
      workspace,
      platformAdapter: createMockPlatformAdapter(),
      channelId: "ch1",
      userId: "testuser",
      agentWorkspacePath,
    };

    const result = await handler.handleMemorySearch(
      { query: "testing patterns" },
      context,
    );

    assertEquals(result.success, true);
    const data = result.data as { memories: unknown[]; agentNotes: unknown[] };
    assertEquals(data.agentNotes.length > 0, true);

    // 5. Verify idempotency
    const path2 = await workspaceManager.getOrCreateAgentWorkspace();
    assertEquals(agentWorkspacePath, path2);

    // Note file should still exist
    const noteContent = await Deno.readTextFile(
      `${agentWorkspacePath}/notes/test-topic.md`,
    );
    assertEquals(noteContent.includes("testing patterns"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Integration: Agent workspace persists across sessions", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Session 1: Create workspace and write data
    const manager1 = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const path1 = await manager1.getOrCreateAgentWorkspace();
    await Deno.writeTextFile(`${path1}/notes/persisted.md`, "Persisted data\n");

    // Session 2: New manager, same directory
    const manager2 = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const path2 = await manager2.getOrCreateAgentWorkspace();
    assertEquals(path1, path2);

    // Data should still exist
    const content = await Deno.readTextFile(`${path2}/notes/persisted.md`);
    assertEquals(content, "Persisted data\n");

    // Default files should not be overwritten
    const readme = await Deno.readTextFile(`${path2}/README.md`);
    assertEquals(readme.includes("Agent Workspace"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
