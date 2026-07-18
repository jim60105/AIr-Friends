// tests/skills/channel-memory-authz.test.ts
// F15: channel-scope memory writes must be authorized, attributed, and non-durable.

import { assertEquals } from "@std/assert";
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

Deno.test("F15 - channel write is rejected when session is not authorized", async () => {
  await withHandler(async (handler, store, manager, baseContext) => {
    const result = await handler.handleMemorySave(
      { content: "planted", scope: "channel" },
      { ...baseContext, canWriteChannelMemory: false },
    );
    assertEquals(result.success, false);

    // Nothing was persisted.
    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const loaded = await store.loadChannelMemories(cw);
    assertEquals(loaded.length, 0);
  });
});

Deno.test("F15 - authorized channel write records author and is not pinned core", async () => {
  await withHandler(async (handler, store, manager, baseContext) => {
    const result = await handler.handleMemorySave(
      { content: "shared note", scope: "channel", tier: "core", importance: "high" },
      { ...baseContext, canWriteChannelMemory: true },
    );
    assertEquals(result.success, true);

    const cw = await manager.getOrCreateChannelWorkspace("discord", "chan_789");
    const loaded = await store.loadChannelMemories(cw);
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].author, "user_123");
    // The requested core tier was downgraded (not a permanent implant).
    assertEquals(loaded[0].tier === "core", false);
    assertEquals(loaded[0].decay === 1.0, false);
  });
});
