// tests/core/memory-store.test.ts

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
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

    // High importance defaults the tier to core
    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 1);
    assertEquals(core[0].content, "Important fact");
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

    // Verify it is in the core tier
    let core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 1);

    // Disable it
    await store.disableMemory(workspace, memory.id);

    // Should no longer be in the core tier
    core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 0);
  });
});

Deno.test("MemoryStore - should patch memory importance", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Add a normal importance memory
    const memory = await store.addMemory(workspace, "Initially normal");

    let loaded = await store.loadAllMemories(workspace, "public");
    assertEquals(loaded[0].importance, "normal");

    // Upgrade to high importance
    await store.patchMemory(workspace, memory.id, { importance: "high" });

    // The patch changes importance; the storage tier only changes when patched
    loaded = await store.loadAllMemories(workspace, "public");
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].importance, "high");
    assertEquals(loaded[0].tier, "archive");
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

Deno.test("MemoryStore - should preserve memory order by timestamp", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "First memory", { importance: "high" });
    await new Promise((r) => setTimeout(r, 10)); // Small delay
    await store.addMemory(workspace, "Second memory", { importance: "high" });

    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 2);
    assertEquals(core[0].content, "First memory");
    assertEquals(core[1].content, "Second memory");
  });
});

Deno.test("MemoryStore - DM should get both private and public core memories", async () => {
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

    // In DM context, getCoreTierMemories should return BOTH
    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 2);
    const contents = core.map((m) => m.content);
    assertEquals(contents.includes("Public important"), true);
    assertEquals(contents.includes("Private important"), true);
  });
});

Deno.test("MemoryStore - non-DM should only get public core memories", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Public important", {
      visibility: "public",
      importance: "high",
    });

    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 1);
    assertEquals(core[0].content, "Public important");
    assertEquals(core[0].visibility, "public");
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
    await store.addMemory(workspace, "Active memory");
    const disabled = await store.addMemory(workspace, "Disabled memory");
    await store.disableMemory(workspace, disabled.id);

    const count = await store.countEnabledMemories(workspace);
    assertEquals(count, 1);
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

Deno.test("MemoryStore - getMemoryStats - returns correct statistics", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Normal memory 1");
    await store.addMemory(workspace, "Normal memory 2");
    await store.addMemory(workspace, "High memory", { importance: "high" });
    const toDisable = await store.addMemory(workspace, "Will disable");
    await store.disableMemory(workspace, toDisable.id);

    const stats = await store.getMemoryStats(workspace, false);

    assertEquals(stats.public.total, 4);
    assertEquals(stats.public.enabled, 3);
    assertEquals(stats.public.disabled, 1);
    assertEquals(stats.public.highImportance, 1);
    assertEquals(stats.public.normalImportance, 2);
    assertEquals(stats.private, null);
    assertEquals(stats.summary.totalMemories, 4);
    assertEquals(stats.summary.totalEnabled, 3);
    assertEquals(stats.summary.totalDisabled, 1);
  });
});

Deno.test("MemoryStore - getMemoryStats - empty workspace returns all zeros", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const stats = await store.getMemoryStats(workspace, false);

    assertEquals(stats.public.total, 0);
    assertEquals(stats.public.enabled, 0);
    assertEquals(stats.public.disabled, 0);
    assertEquals(stats.public.highImportance, 0);
    assertEquals(stats.public.normalImportance, 0);
    assertEquals(stats.private, null);
    assertEquals(stats.summary.totalMemories, 0);
  });
});

Deno.test("MemoryStore - getMemoryStats - excludes private when not DM", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Public memory");

    const stats = await store.getMemoryStats(workspace, false);
    assertEquals(stats.private, null);
    assertEquals(stats.summary.totalMemories, 1);
  });
});

Deno.test("MemoryStore - getMemoryStats - includes private in DM", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    await store.addMemory(workspace, "Public memory", { visibility: "public" });
    await store.addMemory(workspace, "Private memory", { visibility: "private" });
    await store.addMemory(workspace, "Private high", { visibility: "private", importance: "high" });

    const stats = await store.getMemoryStats(workspace, true);

    assertEquals(stats.public.total, 1);
    assertEquals(stats.public.enabled, 1);
    assertEquals(stats.private !== null, true);
    assertEquals(stats.private!.total, 2);
    assertEquals(stats.private!.enabled, 2);
    assertEquals(stats.private!.highImportance, 1);
    assertEquals(stats.private!.normalImportance, 1);
    assertEquals(stats.summary.totalMemories, 3);
    assertEquals(stats.summary.totalEnabled, 3);
  });
});

Deno.test("MemoryStore - resolves relatedTo and supersedes from entry", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Summary of old memories", {
      supersedes: ["mem_old1", "mem_old2"],
      relatedTo: ["mem_related1"],
    });

    const memories = await store.loadAllMemories(workspace, "public");
    const resolved = memories.find((m) => m.id === memory.id)!;
    assertEquals(resolved.supersedes, ["mem_old1", "mem_old2"]);
    assertEquals(resolved.relatedTo, ["mem_related1"]);
  });
});

Deno.test("MemoryStore - merges relatedTo from multiple patches", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Test memory");

    await store.patchMemory(workspace, memory.id, { relatedTo: ["mem_a"] });
    await store.patchMemory(workspace, memory.id, { relatedTo: ["mem_b", "mem_a"] });

    const memories = await store.loadAllMemories(workspace, "public");
    const resolved = memories.find((m) => m.id === memory.id)!;
    assertEquals(resolved.relatedTo.sort(), ["mem_a", "mem_b"]);
  });
});

Deno.test("MemoryStore - merges supersedes from entry and patch", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Summary", {
      supersedes: ["mem_old1"],
    });

    await store.patchMemory(workspace, memory.id, { supersedes: ["mem_old2", "mem_old1"] });

    const memories = await store.loadAllMemories(workspace, "public");
    const resolved = memories.find((m) => m.id === memory.id)!;
    assertEquals(resolved.supersedes.sort(), ["mem_old1", "mem_old2"]);
  });
});

Deno.test("MemoryStore - defaults to empty arrays when relatedTo/supersedes absent", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Plain memory");

    const memories = await store.loadAllMemories(workspace, "public");
    assertEquals(memories[0].relatedTo, []);
    assertEquals(memories[0].supersedes, []);
  });
});

Deno.test("MemoryStore - getMemoryStats - reflects patches correctly", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const mem1 = await store.addMemory(workspace, "Memory 1");
    await store.addMemory(workspace, "Memory 2");
    await store.disableMemory(workspace, mem1.id);

    const stats = await store.getMemoryStats(workspace, false);
    assertEquals(stats.public.total, 2);
    assertEquals(stats.public.enabled, 1);
    assertEquals(stats.public.disabled, 1);
  });
});

Deno.test("MemoryStore - path helpers return the files the store writes to", async () => {
  await withTestMemoryStore(true, async (store, workspace, manager) => {
    const publicMemory = await store.addMemory(workspace, "Public content");
    const privateMemory = await store.addMemory(workspace, "Private content", {
      visibility: "private",
    });

    const publicPath = store.getMemoryFilePathFor(workspace, "public");
    const privatePath = store.getMemoryFilePathFor(workspace, "private");
    assertEquals(publicPath, join(workspace.path, "memory.public.jsonl"));
    assertEquals(privatePath, join(workspace.path, "memory.private.jsonl"));
    assert((await Deno.readTextFile(publicPath)).includes(publicMemory.id));
    assert((await Deno.readTextFile(privatePath)).includes(privateMemory.id));

    const channelWorkspace = await manager.getOrCreateChannelWorkspace("discord", "channel123");
    const channelMemory = await store.addChannelMemory(channelWorkspace, "Channel content");

    const channelPath = store.getChannelMemoryFilePathFor(channelWorkspace);
    assertEquals(channelPath, join(channelWorkspace.path, "memory.channel.jsonl"));
    assert((await Deno.readTextFile(channelPath)).includes(channelMemory.id));
  });
});
