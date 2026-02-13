// tests/core/memory-store.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { MemoryError } from "../../src/types/errors.ts";
import { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { WorkspaceInfo } from "../../src/types/workspace.ts";

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

async function withTestMemoryStore(
  isDm: boolean,
  fn: (store: MemoryStore, workspace: WorkspaceInfo, manager: WorkspaceManager) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const store = new MemoryStore(manager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const event = createTestEvent({ isDm });
    const workspace = await manager.getOrCreateWorkspace(event);

    await fn(store, workspace, manager);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("MemoryStore - should add public memory", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Test memory content");

    assertEquals(memory.type, "memory");
    assertEquals(memory.content, "Test memory content");
    assertEquals(memory.enabled, true);
    assertEquals(memory.visibility, "public");
    assertEquals(memory.importance, "normal");
    assertEquals(memory.id.startsWith("mem_"), true);
  });
});

Deno.test("MemoryStore - should add high importance memory", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Important fact", {
      importance: "high",
    });

    assertEquals(memory.importance, "high");

    // Should be in important memories
    const important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 1);
    assertEquals(important[0].content, "Important fact");
  });
});

Deno.test("MemoryStore - should allow private memory write in any context", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Private memory write succeeds because both files always exist
    const memory = await store.addMemory(workspace, "Private content", {
      visibility: "private",
    });

    assertEquals(memory.visibility, "private");
    assertEquals(memory.content, "Private content");
  });
});

Deno.test("MemoryStore - should add private memory in DM", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Private secret", {
      visibility: "private",
    });

    assertEquals(memory.visibility, "private");
    assertEquals(memory.content, "Private secret");
  });
});

Deno.test("MemoryStore - should patch memory to disable", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Add a memory
    const memory = await store.addMemory(workspace, "To be disabled", {
      importance: "high",
    });

    // Verify it's in important memories
    let important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 1);

    // Disable it
    await store.disableMemory(workspace, memory.id);

    // Should no longer be in important memories
    important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 0);
  });
});

Deno.test("MemoryStore - should patch memory importance", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Add a normal importance memory
    const memory = await store.addMemory(workspace, "Initially normal");

    // Verify not in important memories
    let important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 0);

    // Upgrade to high importance
    await store.patchMemory(workspace, memory.id, { importance: "high" });

    // Should now be in important memories
    important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 1);
  });
});

Deno.test("MemoryStore - should fail to patch non-existent memory", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await assertRejects(
      async () => {
        await store.patchMemory(workspace, "mem_nonexistent", { enabled: false });
      },
      MemoryError,
      "not found",
    );
  });
});

Deno.test("MemoryStore - should search memories by keyword", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Favorite color is blue");
    await store.addMemory(workspace, "Favorite food is pizza");
    await store.addMemory(workspace, "Birthday is January 1st");

    const results = await store.searchMemories(workspace, ["favorite"]);
    assertEquals(results.length, 2);
  });
});

Deno.test("MemoryStore - should not return disabled memories in search", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Soon to be disabled");
    await store.disableMemory(workspace, memory.id);

    const results = await store.searchMemories(workspace, ["disabled"]);
    assertEquals(results.length, 0);
  });
});

Deno.test("MemoryStore - should preserve memory order by timestamp", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "First memory", { importance: "high" });
    await new Promise((r) => setTimeout(r, 10)); // Small delay
    await store.addMemory(workspace, "Second memory", { importance: "high" });

    const important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 2);
    assertEquals(important[0].content, "First memory");
    assertEquals(important[1].content, "Second memory");
  });
});

Deno.test("MemoryStore - DM should get both private and public important memories", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    // Add a public memory
    await store.addMemory(workspace, "Public important", {
      visibility: "public",
      importance: "high",
    });

    // Add a private memory
    await store.addMemory(workspace, "Private important", {
      visibility: "private",
      importance: "high",
    });

    // In DM context, getImportantMemories should return BOTH
    const important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 2);
    const contents = important.map((m) => m.content);
    assertEquals(contents.includes("Public important"), true);
    assertEquals(contents.includes("Private important"), true);
  });
});

Deno.test("MemoryStore - non-DM should only get public important memories", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Public important", {
      visibility: "public",
      importance: "high",
    });

    const important = await store.getImportantMemories(workspace);
    assertEquals(important.length, 1);
    assertEquals(important[0].content, "Public important");
    assertEquals(important[0].visibility, "public");
  });
});

Deno.test("MemoryStore - DM search should search both private and public memory", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    // Add one public and one private memory
    await store.addMemory(workspace, "Public favorite color is blue", {
      visibility: "public",
    });
    await store.addMemory(workspace, "Private favorite color is red", {
      visibility: "private",
    });

    // In DM, search should find BOTH memories
    const results = await store.searchMemories(workspace, ["favorite"]);
    assertEquals(results.length, 2);
    const visibilities = results.map((r) => r.visibility).sort();
    assertEquals(visibilities, ["private", "public"]);
  });
});

Deno.test("MemoryStore - non-DM search should only search public memory", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Public favorite food is pizza", {
      visibility: "public",
    });

    const results = await store.searchMemories(workspace, ["favorite"]);
    assertEquals(results.length, 1);
    assertEquals(results[0].visibility, "public");
  });
});

Deno.test("MemoryStore - countEnabledMemories returns correct count", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Memory A");
    await store.addMemory(workspace, "Memory B");

    const count = await store.countEnabledMemories(workspace);
    assertEquals(count, 2);
  });
});

Deno.test("MemoryStore - countEnabledMemories excludes disabled memories", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const active = await store.addMemory(workspace, "Active memory");
    const disabled = await store.addMemory(workspace, "Disabled memory");
    await store.disableMemory(workspace, disabled.id);

    const count = await store.countEnabledMemories(workspace);
    assertEquals(count, 1);

    const results = await store.searchMemories(workspace, ["memory"]);
    assertEquals(results.some((m) => m.id === active.id), true);
    assertEquals(results.some((m) => m.id === disabled.id), false);
  });
});

Deno.test("MemoryStore - countEnabledMemories includes private memories for DM workspace", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    await store.addMemory(workspace, "Public memory", { visibility: "public" });
    await store.addMemory(workspace, "Private memory", { visibility: "private" });

    const count = await store.countEnabledMemories(workspace);
    assertEquals(count, 2);
  });
});
