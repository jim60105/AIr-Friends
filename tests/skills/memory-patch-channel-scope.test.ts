// tests/skills/memory-patch-channel-scope.test.ts
// Channel-scope memory patching tests (OpenSpec change: memory-patch-channel-scope)

import { assert, assertEquals } from "@std/assert";
import { MemoryHandler } from "@skills/memory-handler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const mockAdapter = { platform: "discord" } as unknown as PlatformAdapter;

async function withHandler(
  fn: (
    handler: MemoryHandler,
    store: MemoryStore,
    manager: WorkspaceManager,
    baseContext: Omit<SkillContext, "canWriteChannelMemory">,
  ) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const store = new MemoryStore(manager, { searchLimit: 10, maxChars: 2000 });
    const handler = new MemoryHandler(store);

    const workspace: WorkspaceInfo = {
      key: "discord/123",
      components: { platform: "discord", userId: "123" },
      path: `${tempDir}/workspaces/discord/123`,
      tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
      isDm: false,
    };
    await Deno.mkdir(workspace.path, { recursive: true });
    // Write empty user memory files so user-scope lookups don't fail with file read error
    await Deno.writeTextFile(`${workspace.path}/memory.public.jsonl`, "");
    await Deno.writeTextFile(`${workspace.path}/memory.private.jsonl`, "");

    const baseContext: Omit<SkillContext, "canWriteChannelMemory"> = {
      workspace,
      platformAdapter: mockAdapter,
      channelId: "chan_789",
      userId: "user_123",
      workspaceManager: manager,
    };

    await fn(handler, store, manager, baseContext);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("3.1 - Incident scenario: patch channel memory decay (0.8 -> 0.4)", async () => {
  await withHandler(async (handler, store, manager, baseContext) => {
    // Save channel memory with working tier (decay 0.8)
    const saveResult = await handler.handleMemorySave(
      { content: "channel incident fact", scope: "channel", tier: "working" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(saveResult.success, true);
    const saveData = saveResult.data;
    if (
      !saveData || typeof saveData !== "object" || !("id" in saveData) ||
      typeof saveData.id !== "string"
    ) {
      throw new Error("Expected saveResult.data.id to be a string");
    }
    const memoryId = saveData.id;

    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const channelFilePath = manager.getChannelMemoryFilePath(cw);
    const contentBefore = await Deno.readTextFile(channelFilePath);
    const linesBefore = contentBefore.trim().split("\n");
    assertEquals(linesBefore.length, 1);

    // Patch decay 0.8 -> 0.4
    const patchResult = await handler.handleMemoryPatch(
      { memory_id: memoryId, scope: "channel", decay: 0.4 },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(patchResult.success, true);
    const patchData = patchResult.data;
    if (
      !patchData ||
      typeof patchData !== "object" ||
      !("scope" in patchData) ||
      !("targetId" in patchData) ||
      !("changes" in patchData)
    ) {
      throw new Error("Expected patchResult.data to contain scope, targetId, and changes");
    }
    assertEquals(patchData.scope, "channel");
    assertEquals(patchData.targetId, memoryId);
    assertEquals(patchData.changes, { decay: 0.4 });

    // Assert resolved decay
    const loaded = await store.loadChannelMemories(cw);
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].id, memoryId);
    assertEquals(loaded[0].decay, 0.4);

    // Assert JSONL append-only: original line byte-unchanged, patch event appended
    const contentAfter = await Deno.readTextFile(channelFilePath);
    const linesAfter = contentAfter.trim().split("\n");
    assertEquals(linesAfter.length, 2);
    assertEquals(linesAfter[0], linesBefore[0]);
    const patchEvent = JSON.parse(linesAfter[1]);
    assertEquals(patchEvent.type, "patch");
    assertEquals(patchEvent.targetId, memoryId);
    assertEquals(patchEvent.decay, 0.4);
  });
});

Deno.test("3.1b - Core-pin interaction on channel path: patch to core tier pins decay at 1.0", async () => {
  await withHandler(async (handler, store, manager, baseContext) => {
    // Save working-tier channel memory (decay 0.8)
    const saveResult = await handler.handleMemorySave(
      { content: "channel working fact", scope: "channel", tier: "working" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(saveResult.success, true);
    const saveData = saveResult.data;
    if (
      !saveData || typeof saveData !== "object" || !("id" in saveData) ||
      typeof saveData.id !== "string"
    ) {
      throw new Error("Expected saveResult.data.id to be a string");
    }
    const memoryId = saveData.id;

    // Patch tier to core with decay 0.4
    const patchResult = await handler.handleMemoryPatch(
      { memory_id: memoryId, scope: "channel", tier: "core", decay: 0.4 },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(patchResult.success, true);

    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const loaded = await store.loadChannelMemories(cw);
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].tier, "core");
    assertEquals(loaded[0].decay, 1.0);
  });
});

Deno.test("3.2 - Authorization rejection: unauthorized channel patch is rejected", async () => {
  await withHandler(async (handler, _store, manager, baseContext) => {
    // Save initial channel memory (authorized)
    const saveResult = await handler.handleMemorySave(
      { content: "channel memory", scope: "channel" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(saveResult.success, true);
    const saveData = saveResult.data;
    if (
      !saveData || typeof saveData !== "object" || !("id" in saveData) ||
      typeof saveData.id !== "string"
    ) {
      throw new Error("Expected saveResult.data.id to be a string");
    }
    const memoryId = saveData.id;

    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const channelFilePath = manager.getChannelMemoryFilePath(cw);
    const contentBefore = await Deno.readTextFile(channelFilePath);

    // Patch unauthorized
    const patchResult = await handler.handleMemoryPatch(
      { memory_id: memoryId, scope: "channel", decay: 0.4 },
      { ...baseContext, canWriteChannelMemory: false },
    );
    assertEquals(patchResult.success, false);
    assertEquals(patchResult.error, "Not authorized to write channel memory in this session");

    // File content unchanged
    const contentAfter = await Deno.readTextFile(channelFilePath);
    assertEquals(contentAfter, contentBefore);
  });
});

Deno.test("3.3 - Visibility rejection: channel scope with visibility is rejected", async () => {
  await withHandler(async (handler, _store, manager, baseContext) => {
    // Save initial channel memory (authorized)
    const saveResult = await handler.handleMemorySave(
      { content: "channel memory", scope: "channel" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(saveResult.success, true);
    const saveData = saveResult.data;
    if (
      !saveData || typeof saveData !== "object" || !("id" in saveData) ||
      typeof saveData.id !== "string"
    ) {
      throw new Error("Expected saveResult.data.id to be a string");
    }
    const memoryId = saveData.id;

    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const channelFilePath = manager.getChannelMemoryFilePath(cw);
    const contentBefore = await Deno.readTextFile(channelFilePath);

    // Patch with visibility on channel scope
    const patchResult = await handler.handleMemoryPatch(
      { memory_id: memoryId, scope: "channel", visibility: "private" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(patchResult.success, false);
    assertEquals(
      patchResult.error,
      "'visibility' cannot be patched on channel-scoped memories (channel memories are always public; use scope 'user' to patch visibility)",
    );

    // File content unchanged
    const contentAfter = await Deno.readTextFile(channelFilePath);
    assertEquals(contentAfter, contentBefore);
  });
});

Deno.test("3.4 - User-scope not-found hint: error hints at --scope channel", async () => {
  await withHandler(async (handler, _store, _manager, baseContext) => {
    const patchResult = await handler.handleMemoryPatch(
      { memory_id: "mem_nonexistent_123", decay: 0.4 },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(patchResult.success, false);
    assert(patchResult.error?.includes("Memory not found: mem_nonexistent_123"));
    assert(patchResult.error?.includes("--scope channel"));
  });
});

Deno.test("3.5 - Channel-scope not-found: absent channel memory returns store error", async () => {
  await withHandler(async (handler, _store, manager, baseContext) => {
    await manager.getOrCreateChannelWorkspace("discord", "chan_789");

    const patchResult = await handler.handleMemoryPatch(
      { memory_id: "mem_absent_channel_id", scope: "channel", enabled: false },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(patchResult.success, false);
    assertEquals(patchResult.error, "Channel memory not found: mem_absent_channel_id");
  });
});
