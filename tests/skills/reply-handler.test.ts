// tests/skills/reply-handler.test.ts

import { assertEquals } from "@std/assert";
import { ReplyHandler } from "@skills/reply-handler.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

// Create a mock platform adapter
const createMockPlatformAdapter = (
  sendReplyResult: { success: boolean; messageId?: string; error?: string } = { success: true },
  editMessageResult?: { success: boolean; messageId?: string; error?: string },
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
    editMessage: () =>
      Promise.resolve(editMessageResult ?? { success: true, messageId: "msg_123" }),
    fetchRecentMessages: () => Promise.resolve([]),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

Deno.test("ReplyHandler - handleSendReply sends reply successfully", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: "/tmp/workspaces/discord/123",
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
    key: "discord/789",
    components: {
      platform: "discord",
      userId: "789",
    },
    path: "/tmp/workspaces/discord/789",
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
    key: "discord/345",
    components: {
      platform: "discord",
      userId: "345",
    },
    path: "/tmp/workspaces/discord/345",
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
    key: "discord/111",
    components: {
      platform: "discord",
      userId: "111",
    },
    path: "/tmp/workspaces/discord/111",
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
    key: "discord/999",
    components: {
      platform: "discord",
      userId: "999",
    },
    path: "/tmp/workspaces/discord/999",
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
    key: "discord/777",
    components: {
      platform: "discord",
      userId: "777",
    },
    path: "/tmp/workspaces/discord/777",
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
    key: "discord/555",
    components: {
      platform: "discord",
      userId: "555",
    },
    path: "/tmp/workspaces/discord/555",
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

// ============ edit-reply tests ============

Deno.test("ReplyHandler - handleEditReply succeeds after send-reply", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit1",
    components: { platform: "discord", userId: "edit1" },
    path: "/tmp/workspaces/discord/edit1",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(
      { success: true, messageId: "msg_edit1" },
      { success: true, messageId: "msg_edit1" },
    ),
    channelId: "ch_edit1",
    userId: "edit1",
  };

  // Send reply first
  await handler.handleSendReply({ message: "Original" }, context);

  // Edit should succeed
  const result = await handler.handleEditReply(
    { messageId: "msg_edit1", message: "Corrected" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as Record<string, unknown>).messageId, "msg_edit1");
});

Deno.test("ReplyHandler - handleEditReply fails without prior send-reply", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit2",
    components: { platform: "discord", userId: "edit2" },
    path: "/tmp/workspaces/discord/edit2",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "ch_edit2",
    userId: "edit2",
  };

  const result = await handler.handleEditReply(
    { messageId: "msg_x", message: "Edit" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "No reply has been sent yet. Use send-reply first.");
});

Deno.test("ReplyHandler - handleEditReply validates messageId parameter", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit3",
    components: { platform: "discord", userId: "edit3" },
    path: "/tmp/workspaces/discord/edit3",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "msg_e3" }),
    channelId: "ch_edit3",
    userId: "edit3",
  };

  await handler.handleSendReply({ message: "First" }, context);

  const result = await handler.handleEditReply({ message: "Edit" }, context);
  assertEquals(result.success, false);
  assertEquals(result.error, "Missing or invalid 'messageId' parameter");
});

Deno.test("ReplyHandler - handleEditReply validates message parameter", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit4",
    components: { platform: "discord", userId: "edit4" },
    path: "/tmp/workspaces/discord/edit4",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "msg_e4" }),
    channelId: "ch_edit4",
    userId: "edit4",
  };

  await handler.handleSendReply({ message: "First" }, context);

  // Missing message
  const result1 = await handler.handleEditReply({ messageId: "msg_e4" }, context);
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Missing or invalid 'message' parameter");

  // Empty message
  const result2 = await handler.handleEditReply({ messageId: "msg_e4", message: "   " }, context);
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Message cannot be empty");
});

Deno.test("ReplyHandler - handleEditReply handles platform failure", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit5",
    components: { platform: "discord", userId: "edit5" },
    path: "/tmp/workspaces/discord/edit5",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(
      { success: true, messageId: "msg_e5" },
      { success: false, error: "Message not found" },
    ),
    channelId: "ch_edit5",
    userId: "edit5",
  };

  await handler.handleSendReply({ message: "First" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_e5", message: "Edit" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Message not found");
});

Deno.test("ReplyHandler - handleEditReply allows multiple edits", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit6",
    components: { platform: "discord", userId: "edit6" },
    path: "/tmp/workspaces/discord/edit6",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(
      { success: true, messageId: "msg_e6" },
      { success: true, messageId: "msg_e6" },
    ),
    channelId: "ch_edit6",
    userId: "edit6",
  };

  await handler.handleSendReply({ message: "First" }, context);

  const result1 = await handler.handleEditReply(
    { messageId: "msg_e6", message: "Edit 1" },
    context,
  );
  assertEquals(result1.success, true);

  const result2 = await handler.handleEditReply(
    { messageId: "msg_e6", message: "Edit 2" },
    context,
  );
  assertEquals(result2.success, true);
});
