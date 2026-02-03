// tests/skills/reply-handler.test.ts

import { assertEquals } from "@std/assert";
import { ReplyHandler } from "@skills/reply-handler.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

// Create a mock platform adapter
const createMockPlatformAdapter = (
  sendReplyResult: { success: boolean; messageId?: string; error?: string } = { success: true },
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
    sendReply: () => Promise.resolve(sendReplyResult),
    fetchRecentMessages: () => Promise.resolve([]),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

Deno.test("ReplyHandler - handleSendReply sends reply successfully", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/123/456",
    components: {
      platform: "discord",
      userId: "123",
      channelId: "456",
    },
    path: "/tmp/workspaces/discord/123/456",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "msg_123" }),
    channelId: "456",
    userId: "123",
  };

  const result = await handler.handleSendReply(
    {
      message: "Hello, world!",
    },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");
});

Deno.test("ReplyHandler - handleSendReply prevents multiple replies", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/789/012",
    components: {
      platform: "discord",
      userId: "789",
      channelId: "012",
    },
    path: "/tmp/workspaces/discord/789/012",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "msg_456" }),
    channelId: "012",
    userId: "789",
  };

  // First reply should succeed
  const result1 = await handler.handleSendReply(
    {
      message: "First reply",
    },
    context,
  );

  assertEquals(result1.success, true);

  // Second reply should fail
  const result2 = await handler.handleSendReply(
    {
      message: "Second reply",
    },
    context,
  );

  assertEquals(result2.success, false);
  assertEquals(result2.error, "Reply can only be sent once per interaction");
});

Deno.test("ReplyHandler - handleSendReply validates message parameter", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/345/678",
    components: {
      platform: "discord",
      userId: "345",
      channelId: "678",
    },
    path: "/tmp/workspaces/discord/345/678",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "678",
    userId: "345",
  };

  // Test missing message
  const result1 = await handler.handleSendReply({}, context);
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Missing or invalid 'message' parameter");

  // Test empty message
  const result2 = await handler.handleSendReply({ message: "   " }, context);
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Message cannot be empty");
});

Deno.test("ReplyHandler - clearReplyState clears state", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/111/222",
    components: {
      platform: "discord",
      userId: "111",
      channelId: "222",
    },
    path: "/tmp/workspaces/discord/111/222",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true }),
    channelId: "222",
    userId: "111",
  };

  // Send first reply
  await handler.handleSendReply({ message: "First" }, context);

  // Clear state
  handler.clearReplyState(workspace.key, context.channelId);

  // Second reply should now succeed
  const result = await handler.handleSendReply({ message: "Second" }, context);
  assertEquals(result.success, true);
});

Deno.test("ReplyHandler - handleSendReply handles platform failure", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/999/888",
    components: {
      platform: "discord",
      userId: "999",
      channelId: "888",
    },
    path: "/tmp/workspaces/discord/999/888",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({
      success: false,
      error: "Platform error",
    }),
    channelId: "888",
    userId: "999",
  };

  const result = await handler.handleSendReply({ message: "Test" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Platform error");
});

Deno.test("ReplyHandler - handleSendReply validates attachments type", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/777/666",
    components: {
      platform: "discord",
      userId: "777",
      channelId: "666",
    },
    path: "/tmp/workspaces/discord/777/666",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "666",
    userId: "777",
  };

  const result = await handler.handleSendReply(
    { message: "Test", attachments: "not an array" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Invalid 'attachments' parameter. Must be an array");
});

Deno.test("ReplyHandler - handleSendReply logs warning for attachments", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/555/444",
    components: {
      platform: "discord",
      userId: "555",
      channelId: "444",
    },
    path: "/tmp/workspaces/discord/555/444",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true }),
    channelId: "444",
    userId: "555",
  };

  const result = await handler.handleSendReply(
    {
      message: "Test",
      attachments: [{ type: "image", url: "http://example.com/img.png" }],
    },
    context,
  );

  // Should still succeed but log warning
  assertEquals(result.success, true);
});
