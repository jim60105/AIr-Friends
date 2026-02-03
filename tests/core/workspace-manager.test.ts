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
    assertEquals(key, "discord/user456/channel123");
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

Deno.test("WorkspaceManager - should create private memory only for DM", async () => {
  await withTestWorkspace(async (manager) => {
    // Non-DM workspace
    const nonDmEvent = createTestEvent({ isDm: false });
    const nonDmWorkspace = await manager.getOrCreateWorkspace(nonDmEvent);

    // Private memory file should not exist
    try {
      await Deno.stat(`${nonDmWorkspace.path}/${MemoryFileType.PRIVATE}`);
      throw new Error("Private memory should not exist for non-DM");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }

    // DM workspace
    const dmEvent = createTestEvent({ isDm: true, channelId: "dm-channel" });
    const dmWorkspace = await manager.getOrCreateWorkspace(dmEvent);

    // Private memory file should exist
    const privateStat = await Deno.stat(
      `${dmWorkspace.path}/${MemoryFileType.PRIVATE}`,
    );
    assertEquals(privateStat.isFile, true);
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

Deno.test("WorkspaceManager - should return null for private memory in non-DM", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent({ isDm: false });
    const workspace = await manager.getOrCreateWorkspace(event);

    const privatePath = manager.getMemoryFilePath(workspace, MemoryFileType.PRIVATE);
    assertEquals(privatePath, null);
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
    // Create multiple workspaces
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user1", channelId: "ch1" }));
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user1", channelId: "ch2" }));
    await manager.getOrCreateWorkspace(createTestEvent({ userId: "user2", channelId: "ch1" }));

    const workspaces = await manager.listWorkspaces("discord");
    assertEquals(workspaces.length, 3);
    assertEquals(workspaces.includes("discord/user1/ch1"), true);
    assertEquals(workspaces.includes("discord/user1/ch2"), true);
    assertEquals(workspaces.includes("discord/user2/ch1"), true);
  });
});
