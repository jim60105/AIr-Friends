// tests/integration/agent-workspace.integration.test.ts

import { assertEquals } from "@std/assert";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { MemoryHandler } from "@skills/memory-handler.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

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

test("Integration: Agent workspace end-to-end flow", async () => {
  const tempDir = await makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });

    // 1. Create agent workspace
    const agentWorkspacePath = await workspaceManager.getOrCreateAgentWorkspace();
    assertEquals(agentWorkspacePath.includes("agent-workspace"), true);

    // 2. Verify structure
    const readmeContent = await fsp.readFile(`${agentWorkspacePath}/README.md`, "utf8");
    assertEquals(readmeContent.includes("Agent Workspace"), true);

    const indexContent = await fsp.readFile(`${agentWorkspacePath}/notes/_index.md`, "utf8");
    assertEquals(indexContent.includes("Notes Index"), true);

    // 3. Write a test note
    await fsp.writeFile(
      `${agentWorkspacePath}/notes/test-topic.md`,
      "# Test Topic\n\nImportant knowledge about testing patterns\n",
    );

    // 4. Search via memory-search
    const memoryStore = new MemoryStore(workspaceManager, {});
    const handler = new MemoryHandler(memoryStore);

    const workspace: WorkspaceInfo = {
      key: "discord/testuser",
      components: { platform: "discord", userId: "testuser" },
      path: `${tempDir}/workspaces/discord/testuser`,
      tmpPath: `${tempDir}/workspaces/discord/testuser/tmp`,
      isDm: false,
    };

    // Create user workspace
    await fsp.mkdir(workspace.path, { recursive: true });
    await fsp.writeFile(`${workspace.path}/memory.public.jsonl`, "");
    await fsp.writeFile(`${workspace.path}/memory.private.jsonl`, "");

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
    const noteContent = await fsp.readFile(`${agentWorkspacePath}/notes/test-topic.md`, "utf8");
    assertEquals(noteContent.includes("testing patterns"), true);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Integration: Agent workspace persists across sessions", async () => {
  const tempDir = await makeTempDir();
  try {
    // Session 1: Create workspace and write data
    const manager1 = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const path1 = await manager1.getOrCreateAgentWorkspace();
    await fsp.writeFile(`${path1}/notes/persisted.md`, "Persisted data\n");

    // Session 2: New manager, same directory
    const manager2 = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const path2 = await manager2.getOrCreateAgentWorkspace();
    assertEquals(path1, path2);

    // Data should still exist
    const content = await fsp.readFile(`${path2}/notes/persisted.md`, "utf8");
    assertEquals(content, "Persisted data\n");

    // Default files should not be overwritten
    const readme = await fsp.readFile(`${path2}/README.md`, "utf8");
    assertEquals(readme.includes("Agent Workspace"), true);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
