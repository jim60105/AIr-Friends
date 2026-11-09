// tests/core/workspace-manager.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { WorkspaceError } from "../../src/types/errors.ts";
import type { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { MemoryFileType } from "../../src/types/workspace.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { isNotFoundError, makeTempDir } from "../../src/utils/fs-compat.ts";

/** Assert a filesystem operation rejects with a not-found (`ENOENT`) error. */
async function assertNotFoundRejects(fn: () => PromiseLike<unknown>): Promise<void> {
  const error = await assertRejects(fn);
  assertEquals(isNotFoundError(error), true, "expected a not-found (ENOENT) rejection");
}

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
  const tempDir = await makeTempDir();
  try {
    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    await fn(manager, tempDir);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
}

test("WorkspaceManager - should compute correct workspace key", async () => {
  await withTestWorkspace((manager) => {
    const event = createTestEvent();
    const key = manager.getWorkspaceKeyFromEvent(event);
    assertEquals(key, "discord/user456");
    return Promise.resolve();
  });
});

test("WorkspaceManager - should sanitize path components", async () => {
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

test("WorkspaceManager - should create workspace directory", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Directory should exist
    const stat = await fsp.stat(workspace.path);
    assertEquals(stat.isDirectory(), true);

    // Memory files should NOT exist yet (lazy creation)
    const memoryPath = `${workspace.path}/${MemoryFileType.PUBLIC}`;
    await assertNotFoundRejects(() => fsp.stat(memoryPath));
  });
});

test("WorkspaceManager - should not eagerly create memory files (lazy creation)", async () => {
  await withTestWorkspace(async (manager) => {
    // Non-DM workspace should NOT have memory files yet
    const nonDmEvent = createTestEvent({ isDm: false });
    const nonDmWorkspace = await manager.getOrCreateWorkspace(nonDmEvent);

    // Neither memory file should exist
    await assertNotFoundRejects(() => fsp.stat(`${nonDmWorkspace.path}/${MemoryFileType.PUBLIC}`));
    await assertNotFoundRejects(() => fsp.stat(`${nonDmWorkspace.path}/${MemoryFileType.PRIVATE}`));

    // DM workspace should also NOT have memory files yet
    const dmEvent = createTestEvent({ isDm: true, userId: "dm-user" });
    const dmWorkspace = await manager.getOrCreateWorkspace(dmEvent);

    await assertNotFoundRejects(() => fsp.stat(`${dmWorkspace.path}/${MemoryFileType.PUBLIC}`));
    await assertNotFoundRejects(() => fsp.stat(`${dmWorkspace.path}/${MemoryFileType.PRIVATE}`));
  });
});

test("WorkspaceManager - should create tmp directory in workspace", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent({ isDm: false });
    const workspace = await manager.getOrCreateWorkspace(event);

    // tmpPath should be set
    assertEquals(workspace.tmpPath, `${workspace.path}/tmp`);

    // tmp directory should exist
    const tmpStat = await fsp.stat(workspace.tmpPath);
    assertEquals(tmpStat.isDirectory(), true);
  });
});

test("WorkspaceManager - should prevent path traversal", async () => {
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

test("WorkspaceManager - should return memory file path for all contexts", async () => {
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

test("WorkspaceManager - should read and write files within workspace", async () => {
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

test("WorkspaceManager - should append to files", async () => {
  await withTestWorkspace(async (manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    await manager.appendWorkspaceFile(workspace, "log.txt", "line1\n");
    await manager.appendWorkspaceFile(workspace, "log.txt", "line2\n");

    const content = await manager.readWorkspaceFile(workspace, "log.txt");
    assertEquals(content, "line1\nline2\n");
  });
});

test("WorkspaceManager - should list workspaces", async () => {
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

// ============ Agent Workspace Tests ============

test("WorkspaceManager - getOrCreateAgentWorkspace creates directory structure", async () => {
  await withTestWorkspace(async (manager, tempDir) => {
    const path = await manager.getOrCreateAgentWorkspace();

    // Verify path is absolute and within repoPath
    assertEquals(path.startsWith(tempDir), true);
    assertEquals(path.endsWith("agent-workspace"), true);

    // Verify directory structure
    const stat = await fsp.stat(path);
    assertEquals(stat.isDirectory(), true);

    const notesStat = await fsp.stat(`${path}/notes`);
    assertEquals(notesStat.isDirectory(), true);

    const journalStat = await fsp.stat(`${path}/journal`);
    assertEquals(journalStat.isDirectory(), true);

    // Verify default files
    const readme = await fsp.readFile(`${path}/README.md`, "utf8");
    assertEquals(readme.includes("Agent Workspace"), true);

    const index = await fsp.readFile(`${path}/notes/_index.md`, "utf8");
    assertEquals(index.includes("Notes Index"), true);
  });
});

test("WorkspaceManager - getOrCreateAgentWorkspace is idempotent", async () => {
  await withTestWorkspace(async (manager, _tempDir) => {
    const path1 = await manager.getOrCreateAgentWorkspace();

    // Write custom content to README
    await fsp.writeFile(`${path1}/README.md`, "Custom content");

    // Call again
    const path2 = await manager.getOrCreateAgentWorkspace();
    assertEquals(path1, path2);

    // Existing files should NOT be overwritten
    const readme = await fsp.readFile(`${path2}/README.md`, "utf8");
    assertEquals(readme, "Custom content");
  });
});

test("WorkspaceManager - agent workspace path is within repoPath boundary", async () => {
  await withTestWorkspace(async (manager, tempDir) => {
    const path = await manager.getOrCreateAgentWorkspace();
    assertEquals(path.startsWith(tempDir), true);
  });
});
