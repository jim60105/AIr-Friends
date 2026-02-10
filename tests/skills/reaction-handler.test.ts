// tests/skills/reaction-handler.test.ts

import { assertEquals } from "@std/assert";
import { ReactionHandler } from "@skills/reaction-handler.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { Platform } from "../../src/types/events.ts";

// Create a mock platform adapter
const createMockPlatformAdapter = (
  addReactionResult: { success: boolean; error?: string } = { success: true },
): PlatformAdapter => {
  return {
    platform: "discord",
    capabilities: {
      canFetchHistory: true,
      canSearchMessages: true,
      supportsDm: true,
      supportsGuild: true,
      supportsReactions: true,
      maxMessageLength: 2000,
    },
    getConnectionStatus: () => ({
      state: "connected" as const,
      reconnectAttempts: 0,
    }),
    onEvent: () => {},
    offEvent: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendReply: () => Promise.resolve({ success: true }),
    fetchRecentMessages: () => Promise.resolve([]),
    fetchEmojis: () => Promise.resolve([]),
    addReaction: () => Promise.resolve(addReactionResult),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

function createTestWorkspace(key = "discord/123"): WorkspaceInfo {
  const parts = key.split("/");
  return {
    key,
    components: {
      platform: parts[0] as Platform,
      userId: parts[1],
    },
    path: `/tmp/workspaces/${key}`,
    isDm: true,
  };
}

Deno.test("ReactionHandler - handleReactMessage succeeds with valid emoji", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true }),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  const result = await handler.handleReactMessage({ emoji: "👍" }, context);

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");
});

Deno.test("ReactionHandler - handleReactMessage fails with missing emoji", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  const result = await handler.handleReactMessage({}, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Missing or invalid 'emoji' parameter");
});

Deno.test("ReactionHandler - handleReactMessage fails with empty emoji", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  const result = await handler.handleReactMessage({ emoji: "   " }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Emoji cannot be empty");
});

Deno.test("ReactionHandler - handleReactMessage fails without trigger message", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
    // No replyToMessageId
  };

  const result = await handler.handleReactMessage({ emoji: "👍" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "No trigger message to react to");
});

Deno.test("ReactionHandler - handleReactMessage fails when platform returns error", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({
      success: false,
      error: "Permission denied",
    }),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  const result = await handler.handleReactMessage({ emoji: "👍" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Permission denied");
});

Deno.test("ReactionHandler - hasReactionSent tracks state correctly", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true }),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  // Initially false
  assertEquals(handler.hasReactionSent(workspace.key, "456"), false);

  // After successful reaction
  await handler.handleReactMessage({ emoji: "👍" }, context);
  assertEquals(handler.hasReactionSent(workspace.key, "456"), true);
});

Deno.test("ReactionHandler - clearReactionState resets tracking", async () => {
  const handler = new ReactionHandler();
  const workspace = createTestWorkspace();

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true }),
    channelId: "456",
    userId: "123",
    replyToMessageId: "msg_trigger",
  };

  // Send reaction
  await handler.handleReactMessage({ emoji: "👍" }, context);
  assertEquals(handler.hasReactionSent(workspace.key, "456"), true);

  // Clear state
  handler.clearReactionState(workspace.key, "456");
  assertEquals(handler.hasReactionSent(workspace.key, "456"), false);
});
