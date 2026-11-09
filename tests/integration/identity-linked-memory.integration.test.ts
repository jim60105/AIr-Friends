// tests/integration/identity-linked-memory.integration.test.ts

import { assert, assertEquals } from "@std/assert";
import { resolve } from "node:path";
import { ContextAssembler } from "../../src/core/context-assembler.ts";
import { IdentityRegistry } from "../../src/core/identity-registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import type { MessageFetcher } from "../../src/types/context.ts";
import type { NormalizedEvent, Platform } from "../../src/types/events.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

/**
 * The ONE deployment-resolved skill-script root, the required `skillsDir`
 * render input of every context assembly.
 */
const RESOLVED_SKILLS_ROOT = fs.realpathSync(resolve(import.meta.dirname ?? ".", "../../skills"));

function createEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    platform: "discord" as Platform,
    channelId: "channel123",
    userId: "user456",
    messageId: `msg-${crypto.randomUUID()}`,
    isDm: false,
    guildId: "guild001",
    content: "hello",
    timestamp: new Date(),
    ...overrides,
  };
}

function emptyFetcher(): MessageFetcher {
  return {
    fetchRecentMessages: () => Promise.resolve([]),
    searchRelatedMessages: () => Promise.resolve([]),
  };
}

test("Integration: a linked account's memories reach fixed loading, private ones only in a DM", async function () {
  const tempDir = await makeTempDir({ prefix: "air-friends-identity-recall-" });
  try {
    await fsp.mkdir(`${tempDir}/prompts`, { recursive: true });
    await fsp.writeFile(`${tempDir}/prompts/system_reply.md`, "You are a helpful assistant.");

    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const store = new MemoryStore(manager, {});
    const registry = new IdentityRegistry(
      [{ id: "alice", accounts: ["discord/111", "misskey/222"] }],
      manager,
    );
    const assembler = new ContextAssembler(
      store,
      {
        recentMessageLimit: 20,
        tokenLimit: 20000,
        systemPromptPath: `${tempDir}/prompts/system_reply.md`,
        skillsDir: RESOLVED_SKILLS_ROOT,
      },
      manager,
      undefined,
      registry,
    );

    // Account A saves one public and one private core memory, exactly as the
    // memory-save skill would in a DM.
    const workspaceA = await manager.getOrCreateWorkspace(
      createEvent({ platform: "discord", userId: "111", isDm: true }),
    );
    await store.addMemory(workspaceA, "A public core memory", {
      tier: "core",
      visibility: "public",
    });
    await store.addMemory(workspaceA, "A private core memory", {
      tier: "core",
      visibility: "private",
    });

    // Account B is linked to A.
    const dmEventB = createEvent({ platform: "misskey", userId: "222", isDm: true });
    const dmWorkspaceB = await manager.getOrCreateWorkspace(dmEventB);
    const dmContext = await assembler.assembleContext(dmEventB, dmWorkspaceB, emptyFetcher());
    const dmContents = dmContext.coreMemories.map((memory) => memory.content);
    assert(dmContents.includes("A public core memory"));
    assert(dmContents.includes("A private core memory"));

    // The same account in a guild channel sees A's public memory only.
    const guildEventB = createEvent({
      platform: "misskey",
      userId: "222",
      isDm: false,
      channelId: "channel222",
    });
    const guildWorkspaceB = await manager.getOrCreateWorkspace(guildEventB);
    const guildContext = await assembler.assembleContext(
      guildEventB,
      guildWorkspaceB,
      emptyFetcher(),
    );
    const guildContents = guildContext.coreMemories.map((memory) => memory.content);
    assert(guildContents.includes("A public core memory"));
    assertEquals(guildContents.includes("A private core memory"), false);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
