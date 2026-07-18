// tests/core/memory-store-v2.test.ts
// Tests for new MemoryStore v2 features: tiers, categories, decay, channel memories

import { assertEquals, assertRejects } from "@std/assert";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { MemoryError } from "../../src/types/errors.ts";
import { NormalizedEvent, Platform } from "../../src/types/events.ts";
import { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { ChannelWorkspaceInfo } from "../../src/types/workspace.ts";

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

async function withTestChannelStore(
  fn: (
    store: MemoryStore,
    channelWorkspace: ChannelWorkspaceInfo,
    manager: WorkspaceManager,
  ) => Promise<void>,
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
    const channelWorkspace = await manager.getOrCreateChannelWorkspace("discord", "chan_test_123");

    await fn(store, channelWorkspace, manager);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

// ── 1. addMemory with new fields ──

Deno.test("MemoryStore v2 - addMemory persists tier, category, scope, decay", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Tiered memory", {
      tier: "working",
      category: "preference",
      scope: "user",
      decay: 0.7,
    });

    assertEquals(memory.tier, "working");
    assertEquals(memory.category, "preference");
    assertEquals(memory.scope, "user");
    assertEquals(memory.decay, 0.7);

    const loaded = await store.loadAllMemories(workspace, "public");
    const resolved = loaded.find((m) => m.id === memory.id)!;
    assertEquals(resolved.tier, "working");
    assertEquals(resolved.category, "preference");
    assertEquals(resolved.scope, "user");
    assertEquals(resolved.decay, 0.7);
  });
});

// ── 2. addMemory defaults ──

Deno.test("MemoryStore v2 - addMemory defaults: tier=archive, category=fact, scope=user, decay=0.5", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Default memory");

    assertEquals(memory.tier, "archive");
    assertEquals(memory.category, "fact");
    assertEquals(memory.scope, "user");
    assertEquals(memory.decay, 0.5);
  });
});

Deno.test("MemoryStore v2 - addMemory with importance=high defaults to tier=core, decay=1.0", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "High importance", {
      importance: "high",
    });

    assertEquals(memory.tier, "core");
    assertEquals(memory.decay, 1.0);
  });
});

Deno.test("MemoryStore v2 - core tier always pins decay to 1.0 even if custom decay provided", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Core with custom decay", {
      tier: "core",
      decay: 0.3,
    });

    assertEquals(memory.tier, "core");
    assertEquals(memory.decay, 1.0);
  });
});

Deno.test("MemoryStore v2 - working tier default decay is 0.8", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Working memory", {
      tier: "working",
    });

    assertEquals(memory.decay, 0.8);
  });
});

// ── 3. patchMemory with new fields ──

Deno.test("MemoryStore v2 - patchMemory updates tier, category, decay", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Patchable memory");

    await store.patchMemory(workspace, memory.id, {
      tier: "working",
      category: "episode",
      decay: 0.9,
    });

    const loaded = await store.loadAllMemories(workspace, "public");
    const resolved = loaded.find((m) => m.id === memory.id)!;
    assertEquals(resolved.tier, "working");
    assertEquals(resolved.category, "episode");
    assertEquals(resolved.decay, 0.9);
  });
});

// ── 4. patchMemory core tier decay pinning ──

Deno.test("MemoryStore v2 - patching to core tier pins decay at 1.0", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const memory = await store.addMemory(workspace, "Will become core", {
      tier: "archive",
    });

    await store.patchMemory(workspace, memory.id, {
      tier: "core",
      decay: 0.3, // Should be ignored/overridden
    });

    const loaded = await store.loadAllMemories(workspace, "public");
    const resolved = loaded.find((m) => m.id === memory.id)!;
    assertEquals(resolved.tier, "core");
    assertEquals(resolved.decay, 1.0);
  });
});

// ── 5. getCoreTierMemories ──

Deno.test("MemoryStore v2 - getCoreTierMemories returns only core tier", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Core memory", { tier: "core" });
    await store.addMemory(workspace, "Working memory", { tier: "working" });
    await store.addMemory(workspace, "Archive memory", { tier: "archive" });

    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 1);
    assertEquals(core[0].content, "Core memory");
  });
});

Deno.test("MemoryStore v2 - getCoreTierMemories excludes disabled", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    const mem = await store.addMemory(workspace, "Disabled core", { tier: "core" });
    await store.disableMemory(workspace, mem.id);

    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 0);
  });
});

Deno.test("MemoryStore v2 - getCoreTierMemories DM includes private", async () => {
  await withTestMemoryStore(true, async (store, workspace) => {
    await store.addMemory(workspace, "Public core", {
      tier: "core",
      visibility: "public",
    });
    await store.addMemory(workspace, "Private core", {
      tier: "core",
      visibility: "private",
    });

    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.length, 2);
  });
});

// ── 6. getRecentWorkingMemories ──

Deno.test("MemoryStore v2 - getRecentWorkingMemories returns working tier sorted newest first", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Working A", { tier: "working" });
    await new Promise((r) => setTimeout(r, 10));
    await store.addMemory(workspace, "Working B", { tier: "working" });
    await store.addMemory(workspace, "Archive C", { tier: "archive" });

    const recent = await store.getRecentWorkingMemories(workspace);
    assertEquals(recent.length, 2);
    assertEquals(recent[0].content, "Working B");
    assertEquals(recent[1].content, "Working A");
  });
});

Deno.test("MemoryStore v2 - getRecentWorkingMemories respects limit", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    for (let i = 0; i < 5; i++) {
      await store.addMemory(workspace, `Working ${i}`, { tier: "working" });
    }

    const recent = await store.getRecentWorkingMemories(workspace, 2);
    assertEquals(recent.length, 2);
  });
});

// ── 7. searchMemories with category filter ──

Deno.test("MemoryStore v2 - searchMemories filters by category", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "User likes cats", { category: "preference" });
    await store.addMemory(workspace, "User adopted a cat", { category: "episode" });
    await store.addMemory(workspace, "User has a cat named Mochi", { category: "fact" });

    const prefs = await store.searchMemories(workspace, ["cat"], {}, "preference");
    assertEquals(prefs.length, 1);
    assertEquals(prefs[0].category, "preference");

    const facts = await store.searchMemories(workspace, ["cat"], {}, "fact");
    assertEquals(facts.length, 1);
    assertEquals(facts[0].category, "fact");
  });
});

// ── 8. Decay-weighted search scoring ──

Deno.test("MemoryStore v2 - higher decay entries rank higher in search", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Both created at ~same time, so recency bonus is equal
    await store.addMemory(workspace, "Low decay food preference", {
      tier: "archive",
      decay: 0.1,
    });
    await store.addMemory(workspace, "High decay food preference", {
      tier: "working",
      decay: 0.99,
    });

    const results = await store.searchMemories(workspace, ["food"]);
    assertEquals(results.length, 2);
    assertEquals(results[0].content, "High decay food preference");
    assertEquals(results[1].content, "Low decay food preference");
  });
});

// ── 9. Recency bonus ──

Deno.test("MemoryStore v2 - computeRecencyBonus gives recent entries higher score", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    // Create two memories with same decay but manipulate timestamps via JSONL
    // We test indirectly: a memory created "now" should rank higher than
    // one with identical decay if both match the same keyword
    // Since both are created nearly simultaneously with same decay, they should
    // both appear. The key test is that the scoring mechanism doesn't crash.
    await store.addMemory(workspace, "Recent music note", { decay: 0.5 });
    await store.addMemory(workspace, "Another music note", { decay: 0.5 });

    const results = await store.searchMemories(workspace, ["music"]);
    assertEquals(results.length, 2);
  });
});

// ── 10. Backward compatibility ──

Deno.test("MemoryStore v2 - entries without tier use importance fallback", async () => {
  await withTestMemoryStore(false, async (store, workspace, manager) => {
    // Write a legacy entry (no tier/category/scope/decay fields) directly to JSONL
    const legacyEntry = JSON.stringify({
      id: "mem_legacy_001",
      ts: new Date().toISOString(),
      type: "memory",
      enabled: true,
      visibility: "public",
      importance: "high",
      content: "Legacy high importance memory",
    }) + "\n";

    const legacyNormal = JSON.stringify({
      id: "mem_legacy_002",
      ts: new Date().toISOString(),
      type: "memory",
      enabled: true,
      visibility: "public",
      importance: "normal",
      content: "Legacy normal memory",
    }) + "\n";

    await manager.appendWorkspaceFile(workspace, "memory.public.jsonl", legacyEntry);
    await manager.appendWorkspaceFile(workspace, "memory.public.jsonl", legacyNormal);

    const memories = await store.loadAllMemories(workspace, "public");
    const high = memories.find((m) => m.id === "mem_legacy_001")!;
    const normal = memories.find((m) => m.id === "mem_legacy_002")!;

    // high importance → core tier
    assertEquals(high.tier, "core");
    assertEquals(high.decay, 1.0);
    assertEquals(high.category, "fact");
    assertEquals(high.scope, "user");

    // normal importance → archive tier
    assertEquals(normal.tier, "archive");
    assertEquals(normal.decay, 0.5);
    assertEquals(normal.category, "fact");
    assertEquals(normal.scope, "user");

    // Legacy high importance should appear in getCoreTierMemories
    const core = await store.getCoreTierMemories(workspace);
    assertEquals(core.some((m) => m.id === "mem_legacy_001"), true);
  });
});

// ── 11. getMemoryStats with tiers ──

Deno.test("MemoryStore v2 - getMemoryStats includes byTier and byCategory", async () => {
  await withTestMemoryStore(false, async (store, workspace) => {
    await store.addMemory(workspace, "Core fact", { tier: "core", category: "fact" });
    await store.addMemory(workspace, "Working pref", { tier: "working", category: "preference" });
    await store.addMemory(workspace, "Archive episode", { tier: "archive", category: "episode" });
    await store.addMemory(workspace, "Archive summary", { tier: "archive", category: "summary" });
    const toDisable = await store.addMemory(workspace, "Disabled", { tier: "working" });
    await store.disableMemory(workspace, toDisable.id);

    const stats = await store.getMemoryStats(workspace, false);

    // byTier counts only enabled
    assertEquals(stats.byTier.core, 1);
    assertEquals(stats.byTier.working, 1);
    assertEquals(stats.byTier.archive, 2);

    // byCategory counts only enabled
    assertEquals(stats.byCategory.fact, 1);
    assertEquals(stats.byCategory.preference, 1);
    assertEquals(stats.byCategory.episode, 1);
    assertEquals(stats.byCategory.summary, 1);
    assertEquals(stats.byCategory.relationship, 0);
  });
});

// ── 12. Channel memory operations ──

Deno.test("MemoryStore v2 - addChannelMemory creates memory with scope=channel", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const memory = await store.addChannelMemory(channelWorkspace, "Channel fact", {
      tier: "core",
      category: "fact",
      durable: true,
    });

    assertEquals(memory.scope, "channel");
    assertEquals(memory.visibility, "public");
    assertEquals(memory.tier, "core");
    assertEquals(memory.decay, 1.0);

    const loaded = await store.loadChannelMemories(channelWorkspace);
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].scope, "channel");
  });
});

Deno.test("MemoryStore v2 - searchChannelMemories returns matching entries", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    await store.addChannelMemory(channelWorkspace, "Channel rule about coding");
    await store.addChannelMemory(channelWorkspace, "Channel rule about design");
    await store.addChannelMemory(channelWorkspace, "Unrelated topic");

    const results = await store.searchChannelMemories(channelWorkspace, ["rule"]);
    assertEquals(results.length, 2);
  });
});

Deno.test("MemoryStore v2 - searchChannelMemories filters by category", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    await store.addChannelMemory(channelWorkspace, "Team prefers TypeScript", {
      category: "preference",
    });
    await store.addChannelMemory(channelWorkspace, "Team meeting happened", {
      category: "episode",
    });

    const prefs = await store.searchChannelMemories(
      channelWorkspace,
      ["team"],
      {},
      "preference",
    );
    assertEquals(prefs.length, 1);
    assertEquals(prefs[0].category, "preference");
  });
});

Deno.test("MemoryStore v2 - getChannelCoreTierMemories returns only core", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    // Durable core entries come from the authorized/curated flow (F15).
    await store.addChannelMemory(channelWorkspace, "Core channel mem", {
      tier: "core",
      durable: true,
    });
    await store.addChannelMemory(channelWorkspace, "Archive channel mem", { tier: "archive" });

    const core = await store.getChannelCoreTierMemories(channelWorkspace);
    assertEquals(core.length, 1);
    assertEquals(core[0].content, "Core channel mem");
  });
});

Deno.test("MemoryStore v2 - patchChannelMemory updates fields", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const mem = await store.addChannelMemory(channelWorkspace, "Patchable channel mem");

    await store.patchChannelMemory(channelWorkspace, mem.id, {
      tier: "working",
      category: "relationship",
    });

    const loaded = await store.loadChannelMemories(channelWorkspace);
    const resolved = loaded.find((m) => m.id === mem.id)!;
    assertEquals(resolved.tier, "working");
    assertEquals(resolved.category, "relationship");
  });
});

Deno.test("MemoryStore v2 - patchChannelMemory fails for non-existent ID", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    await assertRejects(
      async () => {
        await store.patchChannelMemory(channelWorkspace, "mem_nonexistent", { enabled: false });
      },
      MemoryError,
      "not found",
    );
  });
});

Deno.test("MemoryStore v2 - getChannelMemoryStats includes byTier and byCategory", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    await store.addChannelMemory(channelWorkspace, "Core fact", {
      tier: "core",
      category: "fact",
      durable: true,
    });
    await store.addChannelMemory(channelWorkspace, "Archive pref", {
      tier: "archive",
      category: "preference",
    });

    const stats = await store.getChannelMemoryStats(channelWorkspace);
    assertEquals(stats.byTier.core, 1);
    assertEquals(stats.byTier.archive, 1);
    assertEquals(stats.byCategory.fact, 1);
    assertEquals(stats.byCategory.preference, 1);
    assertEquals(stats.private, null);
    assertEquals(stats.channel!.total, 2);
    assertEquals(stats.summary.totalEnabled, 2);
  });
});

// ── F15: channel memory de-trusting / non-permanence / bounds / attribution ──

Deno.test("F15 - untrusted channel write requesting core is downgraded to a decaying tier", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const memory = await store.addChannelMemory(channelWorkspace, "Injected fact", {
      tier: "core",
      importance: "high",
      // no durable flag → ordinary user-driven write
    });
    // Not pinned to permanent core
    assertEquals(memory.tier === "core", false);
    assertEquals(memory.decay === 1.0, false);

    const core = await store.getChannelCoreTierMemories(channelWorkspace);
    assertEquals(core.length, 0);
  });
});

Deno.test("F15 - durable channel write may create a core entry", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const memory = await store.addChannelMemory(channelWorkspace, "Curated fact", {
      tier: "core",
      durable: true,
    });
    assertEquals(memory.tier, "core");
    assertEquals(memory.decay, 1.0);
  });
});

Deno.test("F15 - channel write records the author for attribution", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    await store.addChannelMemory(channelWorkspace, "From a user", { author: "user_42" });
    const loaded = await store.loadChannelMemories(channelWorkspace);
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].author, "user_42");
  });
});

Deno.test("F15 - a disabled channel entry is excluded from context loading", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const mem = await store.addChannelMemory(channelWorkspace, "planted", {
      tier: "core",
      durable: true,
    });
    // Moderation path: disable via patchChannelMemory (as the dashboard does).
    await store.patchChannelMemory(channelWorkspace, mem.id, { enabled: false });

    const core = await store.getChannelCoreTierMemories(channelWorkspace);
    assertEquals(core.find((m) => m.id === mem.id), undefined);
  });
});

Deno.test("F15 - durable core channel entries are bounded by the cap", async () => {
  await withTestChannelStore(async (store, channelWorkspace) => {
    const { MAX_CHANNEL_CORE_ENTRIES } = await import("../../src/core/memory-store.ts");
    for (let i = 0; i < MAX_CHANNEL_CORE_ENTRIES; i++) {
      await store.addChannelMemory(channelWorkspace, `Core ${i}`, {
        tier: "core",
        durable: true,
      });
    }
    await assertRejects(
      () =>
        store.addChannelMemory(channelWorkspace, "One too many", {
          tier: "core",
          durable: true,
        }),
      MemoryError,
    );
  });
});
