// tests/integration/memory-v2.integration.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { WorkspaceInfo } from "../../src/types/workspace.ts";

function createTestEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platform: "discord" as Platform,
    channelId: "channel123",
    userId: "user456",
    messageId: "msg789",
    isDm: true,
    guildId: "guild001",
    content: "test message",
    timestamp: new Date(),
    ...overrides,
  };
}

async function withTestMemoryStore(
  fn: (store: MemoryStore, workspace: WorkspaceInfo) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "air-friends-memv2-" });
  try {
    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const store = new MemoryStore(manager, {
      searchLimit: 10,
      maxChars: 2000,
      workingTierLimit: 5,
    });
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);
    await fn(store, workspace);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test({
  name: "Integration: Save memory with tier/category/scope/decay",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      const memory = await store.addMemory(workspace, "TypeScript is preferred", {
        tier: "working",
        category: "preference",
        scope: "user",
        decay: 0.9,
      });

      assertExists(memory.id);
      assertEquals(memory.tier, "working");
      assertEquals(memory.category, "preference");
      assertEquals(memory.scope, "user");
      assertEquals(memory.decay, 0.9);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: Search memories with category filter",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      await store.addMemory(workspace, "Likes dark mode", {
        category: "preference",
        tier: "archive",
      });
      await store.addMemory(workspace, "Met at conference 2024", {
        category: "episode",
        tier: "archive",
      });

      const preferences = await store.searchMemories(
        workspace,
        ["dark", "conference"],
        {},
        "preference",
      );
      assertEquals(preferences.length, 1);
      assertEquals(preferences[0].category, "preference");
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: Patch decay value",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      const memory = await store.addMemory(workspace, "Some fact", {
        tier: "archive",
        decay: 0.5,
      });

      await store.patchMemory(workspace, memory.id, { decay: 0.3 });

      const all = await store.loadAllMemories(workspace, "public");
      const patched = all.find((m) => m.id === memory.id);
      assertExists(patched);
      assertEquals(patched.decay, 0.3);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: getCoreTierMemories returns correct entries",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      await store.addMemory(workspace, "Core fact", {
        tier: "core",
        importance: "high",
      });
      await store.addMemory(workspace, "Working note", {
        tier: "working",
      });
      await store.addMemory(workspace, "Archive item", {
        tier: "archive",
      });

      const coreMemories = await store.getCoreTierMemories(workspace);
      assertEquals(coreMemories.length, 1);
      assertEquals(coreMemories[0].content, "Core fact");
      assertEquals(coreMemories[0].tier, "core");
      assertEquals(coreMemories[0].decay, 1.0);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: getRecentWorkingMemories returns bounded results",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      // Add more than workingTierLimit (5) working memories
      for (let i = 0; i < 8; i++) {
        await store.addMemory(workspace, `Working memory ${i}`, {
          tier: "working",
        });
      }
      // Add non-working memories that should not be returned
      await store.addMemory(workspace, "Core memory", { tier: "core" });
      await store.addMemory(workspace, "Archive memory", { tier: "archive" });

      const working = await store.getRecentWorkingMemories(workspace);
      assertEquals(working.length, 5); // bounded by workingTierLimit
      for (const m of working) {
        assertEquals(m.tier, "working");
      }
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: Backward compat - save without tier, read back with defaults",
  async fn() {
    await withTestMemoryStore(async (store, workspace) => {
      // Save with only legacy fields (no tier/category/scope/decay)
      const normalMem = await store.addMemory(workspace, "Legacy normal entry", {
        importance: "normal",
      });
      const highMem = await store.addMemory(workspace, "Legacy high entry", {
        importance: "high",
      });

      // Verify defaults are applied
      assertEquals(normalMem.tier, "archive");
      assertEquals(normalMem.category, "fact");
      assertEquals(normalMem.scope, "user");
      assertEquals(normalMem.decay, 0.5);

      assertEquals(highMem.tier, "core");
      assertEquals(highMem.category, "fact");
      assertEquals(highMem.scope, "user");
      assertEquals(highMem.decay, 1.0);

      // Verify they can be loaded back correctly
      const all = await store.loadAllMemories(workspace, "public");
      const normal = all.find((m) => m.id === normalMem.id);
      const high = all.find((m) => m.id === highMem.id);

      assertExists(normal);
      assertEquals(normal.tier, "archive");
      assertEquals(normal.decay, 0.5);

      assertExists(high);
      assertEquals(high.tier, "core");
      assertEquals(high.decay, 1.0);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
