// tests/core/workspace-manager.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { WorkspaceError } from "../../src/types/errors.ts";
import type { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { MemoryFileType } from "../../src/types/workspace.ts";

function createTestEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platform: "discord" as Platform,
    channelId: "channel123",
    userId: "user456",
    messageId: "msg789",
    isDm: false,
    guildId: "guild001",
    content: "test message",
    timestamp: new Date(),
    ...overrides,
  };
}

async function withTestWorkspace(
  fn: (manager: WorkspaceManager, tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    await fn(manager, tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("WorkspaceManager - should compute correct workspace key", async () => {
  await withTestWorkspace((manager) => {
    const event = createTestEvent();
    const key = manager.getWorkspaceKeyFromEvent(event);
    assertEquals(key, "discord/user456");
    return Promise.resolve();
  });
});

Deno.test("WorkspaceManager - should sanitize path components", async () => {
  await withTestWorkspace((manager) => {
    const event = createTestEvent({
      userId: "../../../etc",
      channelId: "passwd",
    });
    const key = manager.getWorkspaceKeyFromEvent(event);
    // Should not contain path traversal
    assertEquals(key.includes(".."), false);
    return Promise.resolve();
  });
});

Deno.test("WorkspaceManager - should create workspace directory", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Directory should exist
    const stat = await Deno.stat(workspace.path);
    assertEquals(stat.isDirectory, true);

    // Public memory file should exist
    const memoryPath = `${workspace.path}/${MemoryFileType.PUBLIC}`;
    const memoryStat = await Deno.stat(memoryPath);
    assertEquals(memoryStat.isFile, true);
  });
});

Deno.test("WorkspaceManager - should always create both memory files", async () => {
  await withTestWorkspace(async (manager) => {
    // Non-DM workspace should also have private memory file
    const nonDmEvent = createTestEvent({ isDm: false });
    const nonDmWorkspace = await manager.getOrCreateWorkspace(nonDmEvent);

    // Both memory files should exist
    const publicStat = await Deno.stat(
      `${nonDmWorkspace.path}/${MemoryFileType.PUBLIC}`,
    );
    assertEquals(publicStat.isFile, true);

    const privateStat = await Deno.stat(
      `${nonDmWorkspace.path}/${MemoryFileType.PRIVATE}`,
    );
    assertEquals(privateStat.isFile, true);

    // DM workspace should also have both
    const dmEvent = createTestEvent({ isDm: true, userId: "dm-user" });
    const dmWorkspace = await manager.getOrCreateWorkspace(dmEvent);

    const dmPublicStat = await Deno.stat(
      `${dmWorkspace.path}/${MemoryFileType.PUBLIC}`,
    );
    assertEquals(dmPublicStat.isFile, true);

    const dmPrivateStat = await Deno.stat(
      `${dmWorkspace.path}/${MemoryFileType.PRIVATE}`,
    );
    assertEquals(dmPrivateStat.isFile, true);
  });
});

Deno.test("WorkspaceManager - should prevent path traversal", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    await assertRejects(
      async () => {
        await manager.readWorkspaceFile(workspace, "../../../etc/passwd");
      },
      WorkspaceError,
    );
  });
});

Deno.test("WorkspaceManager - should return memory file path for all contexts", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent({ isDm: false });
    const workspace = await manager.getOrCreateWorkspace(event);

    // Both public and private paths should be valid strings
    const publicPath = manager.getMemoryFilePath(workspace, MemoryFileType.PUBLIC);
    assertEquals(typeof publicPath, "string");
    assertEquals(publicPath.endsWith(MemoryFileType.PUBLIC), true);

    const privatePath = manager.getMemoryFilePath(workspace, MemoryFileType.PRIVATE);
    assertEquals(typeof privatePath, "string");
    assertEquals(privatePath.endsWith(MemoryFileType.PRIVATE), true);
  });
});

Deno.test("WorkspaceManager - should read and write files within workspace", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Write a file
    const testContent = "Hello, World!";
    await manager.writeWorkspaceFile(workspace, "test.txt", testContent);

    // Read the file back
    const content = await manager.readWorkspaceFile(workspace, "test.txt");
    assertEquals(content, testContent);
  });
});

Deno.test("WorkspaceManager - should append to files", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    await manager.appendWorkspaceFile(workspace, "log.txt", "line1\n");
    await manager.appendWorkspaceFile(workspace, "log.txt", "line2\n");

    const content = await manager.readWorkspaceFile(workspace, "log.txt");
    assertEquals(content, "line1\nline2\n");
  });
});

Deno.test("WorkspaceManager - should list workspaces", async () => {
  await withTestWorkspace(async (manager) => {
    // Create multiple workspaces (per-user, not per-channel)
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user1", channelId: "ch1" }));
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user1", channelId: "ch2" }));
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user2", channelId: "ch1" }));

    const workspaces = await manager.listWorkspaces("discord");
    // user1/ch1 and user1/ch2 map to same workspace (discord/user1)
    assertEquals(workspaces.length, 2);
    assertEquals(workspaces.includes("discord/user1"), true);
    assertEquals(workspaces.includes("discord/user2"), true);
  });
});
