// tests/skills/reply-handler.test.ts

import { assertEquals } from "@std/assert";
import { ReplyHandler, stripXmlTags, unescapeNewlines } from "@skills/reply-handler.ts";
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
    fetchMessage: () => Promise.resolve(null),
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
    tmpPath: "/tmp/workspaces/discord/123/tmp",
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

Deno.test("ReplyHandler - handleSendReply allows multiple replies", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/789",
    components: {
      platform: "discord",
      userId: "789",
    },
    path: "/tmp/workspaces/discord/789",
    tmpPath: "/tmp/workspaces/discord/789/tmp",
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

  // Second reply should also succeed
  const result2 = await handler.handleSendReply(
    {
      message: "Second reply",
    },
    context,
  );

  assertEquals(result2.success, true);
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
    tmpPath: "/tmp/workspaces/discord/345/tmp",
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
    tmpPath: "/tmp/workspaces/discord/111/tmp",
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
    tmpPath: "/tmp/workspaces/discord/999/tmp",
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
    tmpPath: "/tmp/workspaces/discord/777/tmp",
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
    tmpPath: "/tmp/workspaces/discord/555/tmp",
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
    tmpPath: "/tmp/workspaces/discord/edit1/tmp",
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
    lastSentMessageId: "msg_edit1",
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
    tmpPath: "/tmp/workspaces/discord/edit2/tmp",
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
    tmpPath: "/tmp/workspaces/discord/edit3/tmp",
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
    tmpPath: "/tmp/workspaces/discord/edit4/tmp",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "msg_e4" }),
    channelId: "ch_edit4",
    userId: "edit4",
    lastSentMessageId: "msg_e4",
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
    tmpPath: "/tmp/workspaces/discord/edit5/tmp",
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
    lastSentMessageId: "msg_e5",
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
    tmpPath: "/tmp/workspaces/discord/edit6/tmp",
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
    lastSentMessageId: "msg_e6",
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

Deno.test("ReplyHandler - handleEditReply handles thrown exception", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit7",
    components: { platform: "discord", userId: "edit7" },
    path: "/tmp/workspaces/discord/edit7",
    tmpPath: "/tmp/workspaces/discord/edit7/tmp",
    isDm: true,
  };

  const throwingAdapter = createMockPlatformAdapter({ success: true, messageId: "msg_e7" });
  throwingAdapter.editMessage = () => {
    throw new Error("Network failure");
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: throwingAdapter,
    channelId: "ch_edit7",
    userId: "edit7",
    lastSentMessageId: "msg_e7",
  };

  await handler.handleSendReply({ message: "First" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_e7", message: "Edit" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Network failure");
});

Deno.test("ReplyHandler - handleEditReply handles non-Error exception", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit8",
    components: { platform: "discord", userId: "edit8" },
    path: "/tmp/workspaces/discord/edit8",
    tmpPath: "/tmp/workspaces/discord/edit8/tmp",
    isDm: true,
  };

  const throwingAdapter = createMockPlatformAdapter({ success: true, messageId: "msg_e8" });
  throwingAdapter.editMessage = () => {
    throw "string error";
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: throwingAdapter,
    channelId: "ch_edit8",
    userId: "edit8",
    lastSentMessageId: "msg_e8",
  };

  await handler.handleSendReply({ message: "First" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_e8", message: "Edit" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Unknown error");
});

Deno.test("ReplyHandler - handleEditReply passes replyToMessageId to editMessage", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/edit9",
    components: { platform: "discord", userId: "edit9" },
    path: "/tmp/workspaces/discord/edit9",
    tmpPath: "/tmp/workspaces/discord/edit9/tmp",
    isDm: true,
  };

  let capturedReplyToMessageId: string | undefined;
  const adapter = createMockPlatformAdapter(
    { success: true, messageId: "msg_e9" },
    { success: true, messageId: "msg_e9" },
  );
  adapter.editMessage = (
    _channelId: string,
    _messageId: string,
    _newContent: string,
    replyToMessageId?: string,
  ) => {
    capturedReplyToMessageId = replyToMessageId;
    return Promise.resolve({ success: true, messageId: "msg_e9" });
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_edit9",
    userId: "edit9",
    lastSentMessageId: "msg_e9",
    replyToMessageId: "trigger_msg_123",
  };

  await handler.handleSendReply({ message: "First" }, context);

  await handler.handleEditReply(
    { messageId: "msg_e9", message: "Edited" },
    context,
  );

  assertEquals(capturedReplyToMessageId, "trigger_msg_123");
});

// ============ stripXmlTags tests ============

Deno.test("stripXmlTags - strips simple XML tags", () => {
  assertEquals(stripXmlTags("<e>😆</e>"), "😆");
});

Deno.test("stripXmlTags - strips multiple different tags", () => {
  assertEquals(stripXmlTags("<e>😆</e> <t>text</t>"), "😆 text");
});

Deno.test("stripXmlTags - strips nested-looking tags", () => {
  assertEquals(stripXmlTags("<a><e>😆</e></a>"), "😆");
});

Deno.test("stripXmlTags - preserves text without tags", () => {
  assertEquals(stripXmlTags("Hello, world!"), "Hello, world!");
});

Deno.test("stripXmlTags - strips multi-character tag names", () => {
  assertEquals(stripXmlTags("<scenario>text</scenario>"), "text");
});

Deno.test("stripXmlTags - preserves angle brackets in non-tag contexts", () => {
  assertEquals(stripXmlTags("1 < 2 and 3 > 1"), "1 < 2 and 3 > 1");
});

Deno.test("stripXmlTags - handles empty string", () => {
  assertEquals(stripXmlTags(""), "");
});

Deno.test("stripXmlTags - strips tags with alphanumeric names", () => {
  assertEquals(stripXmlTags("<h1>Title</h1>"), "Title");
});

Deno.test("stripXmlTags - strips self-closing-like tag pairs", () => {
  assertEquals(stripXmlTags("before <r>reaction</r> after"), "before reaction after");
});

// ============ XML tag stripping integration tests ============

Deno.test("ReplyHandler - handleSendReply strips XML tags from message", async () => {
  const handler = new ReplyHandler();

  let capturedContent = "";
  const adapter = createMockPlatformAdapter({ success: true, messageId: "msg_xml1" });
  adapter.sendReply = (_channelId: string, content: string) => {
    capturedContent = content;
    return Promise.resolve({ success: true, messageId: "msg_xml1" });
  };

  const workspace: WorkspaceInfo = {
    key: "discord/xml1",
    components: { platform: "discord", userId: "xml1" },
    path: "/tmp/workspaces/discord/xml1",
    tmpPath: "/tmp/workspaces/discord/xml1/tmp",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_xml1",
    userId: "xml1",
  };

  const result = await handler.handleSendReply(
    { message: "Hello <e>😆</e> world" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(capturedContent, "Hello 😆 world");
});

Deno.test("ReplyHandler - handleEditReply strips XML tags from message", async () => {
  const handler = new ReplyHandler();

  let capturedContent = "";
  const adapter = createMockPlatformAdapter({ success: true, messageId: "msg_xml2" });
  adapter.editMessage = (
    _channelId: string,
    _messageId: string,
    newContent: string,
  ) => {
    capturedContent = newContent;
    return Promise.resolve({ success: true, messageId: "msg_xml2" });
  };

  const workspace: WorkspaceInfo = {
    key: "discord/xml2",
    components: { platform: "discord", userId: "xml2" },
    path: "/tmp/workspaces/discord/xml2",
    tmpPath: "/tmp/workspaces/discord/xml2/tmp",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_xml2",
    userId: "xml2",
    lastSentMessageId: "msg_xml2",
  };

  // Send reply first
  await handler.handleSendReply({ message: "First" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_xml2", message: "<scenario>edited</scenario> <e>🎉</e>" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(capturedContent, "edited 🎉");
});

Deno.test("ReplyHandler - handleEditReply skips edit when content is unchanged", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp1",
    components: { platform: "discord", userId: "cmp1" },
    path: "/tmp/workspaces/discord/cmp1",
    tmpPath: "/tmp/workspaces/discord/cmp1/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter({ success: true, messageId: "msg_cmp1" });
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve({
      messageId: "msg_cmp1",
      userId: "user1",
      username: "TestUser",
      content: "Same content",
      timestamp: new Date(),
      isBot: false,
    });

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp1",
    userId: "cmp1",
    lastSentMessageId: "msg_cmp1",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_cmp1", message: "Same content" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(
    result.error,
    "The edit content is the same as the current message content. No changes were made.",
  );
});

Deno.test("ReplyHandler - handleEditReply proceeds when content is different", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp2",
    components: { platform: "discord", userId: "cmp2" },
    path: "/tmp/workspaces/discord/cmp2",
    tmpPath: "/tmp/workspaces/discord/cmp2/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter(
    { success: true, messageId: "msg_cmp2" },
    { success: true, messageId: "msg_cmp2" },
  );
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve({
      messageId: "msg_cmp2",
      userId: "user1",
      username: "TestUser",
      content: "Old content",
      timestamp: new Date(),
      isBot: false,
    });

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp2",
    userId: "cmp2",
    lastSentMessageId: "msg_cmp2",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_cmp2", message: "New content" },
    context,
  );

  assertEquals(result.success, true);
  assertEquals((result.data as Record<string, unknown>).messageId, "msg_cmp2");
});

Deno.test("ReplyHandler - handleEditReply proceeds when fetchMessage returns null", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp3",
    components: { platform: "discord", userId: "cmp3" },
    path: "/tmp/workspaces/discord/cmp3",
    tmpPath: "/tmp/workspaces/discord/cmp3/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter(
    { success: true, messageId: "msg_cmp3" },
    { success: true, messageId: "msg_cmp3" },
  );
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve(null);

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp3",
    userId: "cmp3",
    lastSentMessageId: "msg_cmp3",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_cmp3", message: "Updated content" },
    context,
  );

  assertEquals(result.success, true);
});

Deno.test("ReplyHandler - handleEditReply proceeds when fetchMessage throws", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp4",
    components: { platform: "discord", userId: "cmp4" },
    path: "/tmp/workspaces/discord/cmp4",
    tmpPath: "/tmp/workspaces/discord/cmp4/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter(
    { success: true, messageId: "msg_cmp4" },
    { success: true, messageId: "msg_cmp4" },
  );
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () => {
    throw new Error("API error");
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp4",
    userId: "cmp4",
    lastSentMessageId: "msg_cmp4",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_cmp4", message: "Updated content" },
    context,
  );

  assertEquals(result.success, true);
});

Deno.test("ReplyHandler - handleEditReply compares content after XML strip and unescape", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp5",
    components: { platform: "discord", userId: "cmp5" },
    path: "/tmp/workspaces/discord/cmp5",
    tmpPath: "/tmp/workspaces/discord/cmp5/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter({ success: true, messageId: "msg_cmp5" });
  // Current content is "hello\nworld" (real newline), new content is "hello\\nworld" (escaped)
  // After unescapeNewlines they should be the same → skips edit
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve({
      messageId: "msg_cmp5",
      userId: "user1",
      username: "TestUser",
      content: "hello\nworld",
      timestamp: new Date(),
      isBot: false,
    });

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp5",
    userId: "cmp5",
    lastSentMessageId: "msg_cmp5",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  // "hello\\nworld" becomes "hello\nworld" after unescape — same as current
  const result = await handler.handleEditReply(
    { messageId: "msg_cmp5", message: "hello\\nworld" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(
    result.error,
    "The edit content is the same as the current message content. No changes were made.",
  );
});

Deno.test("ReplyHandler - handleEditReply success response includes nextAction", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/cmp6",
    components: { platform: "discord", userId: "cmp6" },
    path: "/tmp/workspaces/discord/cmp6",
    tmpPath: "/tmp/workspaces/discord/cmp6/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter(
    { success: true, messageId: "msg_cmp6" },
    { success: true, messageId: "msg_cmp6" },
  );

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_cmp6",
    userId: "cmp6",
    lastSentMessageId: "msg_cmp6",
  };

  await handler.handleSendReply({ message: "First reply" }, context);

  const result = await handler.handleEditReply(
    { messageId: "msg_cmp6", message: "Edited content" },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(
    data.nextAction,
    "You have done your job. EXIT IMMEDIATELY or you will be terminated.",
  );
});

// ============ F7: edit-reply scoping to session's own last-sent message ============

Deno.test("F7 handleEditReply - rejects foreign messageId (no edit/delete)", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "misskey/f7a",
    components: { platform: "misskey", userId: "f7a" },
    path: "/tmp/workspaces/misskey/f7a",
    tmpPath: "/tmp/workspaces/misskey/f7a/tmp",
    isDm: false,
  };

  let editCalled = false;
  const adapter = createMockPlatformAdapter({ success: true, messageId: "note_A" });
  adapter.editMessage = () => {
    editCalled = true;
    return Promise.resolve({ success: true, messageId: "note_A" });
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "note:note_A",
    userId: "f7a",
    lastSentMessageId: "note_A",
  };

  await handler.handleSendReply({ message: "Original" }, context);

  // Attempt to edit a DIFFERENT (foreign) note from another conversation.
  const result = await handler.handleEditReply(
    { messageId: "note_FOREIGN", message: "hijack" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(editCalled, false);
});

Deno.test("F7 handleEditReply - two consecutive Misskey edits (new ID after delete) both succeed", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "misskey/f7b",
    components: { platform: "misskey", userId: "f7b" },
    path: "/tmp/workspaces/misskey/f7b",
    tmpPath: "/tmp/workspaces/misskey/f7b/tmp",
    isDm: false,
  };

  // Misskey delete-and-recreate returns a NEW note id each edit.
  let editCount = 0;
  const adapter = createMockPlatformAdapter({ success: true, messageId: "note_1" });
  adapter.editMessage = () => {
    editCount++;
    return Promise.resolve({ success: true, messageId: `note_${editCount + 1}` });
  };

  // The Skill API updates lastSentMessageId after each edit; we simulate that here.
  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "note:note_1",
    userId: "f7b",
    lastSentMessageId: "note_1",
  };

  await handler.handleSendReply({ message: "First" }, context);

  // First edit: matches note_1 → succeeds, returns note_2.
  const r1 = await handler.handleEditReply(
    { messageId: "note_1", message: "Edit 1" },
    context,
  );
  assertEquals(r1.success, true);
  assertEquals((r1.data as Record<string, unknown>).messageId, "note_2");

  // Simulate the Skill API updating the tracked last-sent id to the new note.
  context.lastSentMessageId = "note_2";

  // Second edit: must use the NEW id (note_2) to pass scoping.
  const r2 = await handler.handleEditReply(
    { messageId: "note_2", message: "Edit 2" },
    context,
  );
  assertEquals(r2.success, true);
  assertEquals((r2.data as Record<string, unknown>).messageId, "note_3");
});

// --- unescapeNewlines tests ---

Deno.test("unescapeNewlines - converts literal backslash-n to newline", () => {
  assertEquals(unescapeNewlines("hello\\nworld"), "hello\nworld");
});

Deno.test("unescapeNewlines - converts multiple occurrences", () => {
  assertEquals(unescapeNewlines("a\\nb\\nc"), "a\nb\nc");
});

Deno.test("unescapeNewlines - preserves existing real newlines", () => {
  assertEquals(unescapeNewlines("hello\nworld"), "hello\nworld");
});

Deno.test("unescapeNewlines - handles empty string", () => {
  assertEquals(unescapeNewlines(""), "");
});

Deno.test("unescapeNewlines - handles string without newlines", () => {
  assertEquals(unescapeNewlines("hello world"), "hello world");
});

Deno.test("unescapeNewlines - handles mixed real and literal newlines", () => {
  assertEquals(unescapeNewlines("line1\nline2\\nline3"), "line1\nline2\nline3");
});

// ============ get-message tests ============

Deno.test("ReplyHandler - handleGetMessage with explicit messageId success", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm1",
    components: { platform: "discord", userId: "gm1" },
    path: "/tmp/workspaces/discord/gm1",
    tmpPath: "/tmp/workspaces/discord/gm1/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve({
      messageId: "msg123",
      userId: "user456",
      username: "TestUser",
      content: "Hello world",
      timestamp: new Date("2024-06-01T12:00:00Z"),
      isBot: false,
    });

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm1",
    userId: "gm1",
  };

  const result = await handler.handleGetMessage({ messageId: "msg123" }, context);

  assertEquals(result.success, true);
  const data = result.data as Record<string, unknown>;
  assertEquals(data.messageId, "msg123");
  assertEquals(data.userId, "user456");
  assertEquals(data.username, "TestUser");
  assertEquals(data.content, "Hello world");
  assertEquals(data.isBot, false);
});

Deno.test("ReplyHandler - handleGetMessage uses lastSentMessageId fallback", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm2",
    components: { platform: "discord", userId: "gm2" },
    path: "/tmp/workspaces/discord/gm2",
    tmpPath: "/tmp/workspaces/discord/gm2/tmp",
    isDm: true,
  };

  let capturedMessageId = "";
  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = (
    _channelId: string,
    messageId: string,
  ) => {
    capturedMessageId = messageId;
    return Promise.resolve({
      messageId,
      userId: "user789",
      username: "BotUser",
      content: "Bot reply",
      timestamp: new Date("2024-06-01T13:00:00Z"),
      isBot: true,
    });
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm2",
    userId: "gm2",
    lastSentMessageId: "last_sent_999",
  };

  const result = await handler.handleGetMessage({}, context);

  assertEquals(result.success, true);
  assertEquals(capturedMessageId, "last_sent_999");
});

Deno.test("ReplyHandler - handleGetMessage fails with no messageId and no lastSentMessageId", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm3",
    components: { platform: "discord", userId: "gm3" },
    path: "/tmp/workspaces/discord/gm3",
    tmpPath: "/tmp/workspaces/discord/gm3/tmp",
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "ch_gm3",
    userId: "gm3",
  };

  const result = await handler.handleGetMessage({}, context);

  assertEquals(result.success, false);
  assertEquals(
    result.error,
    "Missing 'messageId' parameter and no message has been sent yet in this session.",
  );
});

Deno.test("ReplyHandler - handleGetMessage returns error when message not found", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm4",
    components: { platform: "discord", userId: "gm4" },
    path: "/tmp/workspaces/discord/gm4",
    tmpPath: "/tmp/workspaces/discord/gm4/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () =>
    Promise.resolve(null);

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm4",
    userId: "gm4",
  };

  const result = await handler.handleGetMessage({ messageId: "nonexistent" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Message not found: nonexistent");
});

Deno.test("ReplyHandler - handleGetMessage handles platform error", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm5",
    components: { platform: "discord", userId: "gm5" },
    path: "/tmp/workspaces/discord/gm5",
    tmpPath: "/tmp/workspaces/discord/gm5/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () => {
    throw new Error("API connection failed");
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm5",
    userId: "gm5",
  };

  const result = await handler.handleGetMessage({ messageId: "msg123" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "API connection failed");
});

Deno.test("ReplyHandler - handleGetMessage handles non-Error exception", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm6",
    components: { platform: "discord", userId: "gm6" },
    path: "/tmp/workspaces/discord/gm6",
    tmpPath: "/tmp/workspaces/discord/gm6/tmp",
    isDm: true,
  };

  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = () => {
    throw "string error";
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm6",
    userId: "gm6",
  };

  const result = await handler.handleGetMessage({ messageId: "msg123" }, context);

  assertEquals(result.success, false);
  assertEquals(result.error, "Unknown error");
});

Deno.test("ReplyHandler - handleGetMessage prefers explicit messageId over lastSentMessageId", async () => {
  const handler = new ReplyHandler();

  const workspace: WorkspaceInfo = {
    key: "discord/gm7",
    components: { platform: "discord", userId: "gm7" },
    path: "/tmp/workspaces/discord/gm7",
    tmpPath: "/tmp/workspaces/discord/gm7/tmp",
    isDm: true,
  };

  let capturedMessageId = "";
  const adapter = createMockPlatformAdapter();
  (adapter as unknown as { fetchMessage: PlatformAdapter["fetchMessage"] }).fetchMessage = (
    _channelId: string,
    messageId: string,
  ) => {
    capturedMessageId = messageId;
    return Promise.resolve({
      messageId,
      userId: "user1",
      username: "User",
      content: "Content",
      timestamp: new Date(),
      isBot: false,
    });
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "ch_gm7",
    userId: "gm7",
    lastSentMessageId: "fallback_id",
  };

  await handler.handleGetMessage({ messageId: "explicit_id" }, context);

  assertEquals(capturedMessageId, "explicit_id");
});
