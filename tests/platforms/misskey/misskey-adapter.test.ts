// tests/platforms/misskey/misskey-adapter.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { MisskeyAdapter } from "@platforms/misskey/misskey-adapter.ts";
import { PlatformError } from "../../../src/types/errors.ts";
import {
  buildReplyParams,
  ChatMessageLite,
  chatMessageToPlatformMessage,
  isDirectMessage,
  isMentionToBot,
  type MisskeyMessage,
  type MisskeyNote,
  normalizeMisskeyChatMessage,
  normalizeMisskeyNote,
  noteToPlatformMessage,
  removeBotMention,
  shouldRespondToChatMessage,
  shouldRespondToNote,
} from "@platforms/misskey/misskey-utils.ts";

// Create a minimal mock note for testing utility functions
function createMockNote(overrides: Partial<MisskeyNote> = {}): MisskeyNote {
  const base: MisskeyNote = {
    id: "note123",
    text: "Hello @testbot!",
    userId: "user123",
    user: {
      id: "user123",
      name: "Test User",
      username: "testuser",
      host: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarBlurhash: null,
      avatarDecorations: [],
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: "unknown",
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    visibility: "public",
    localOnly: false,
    reactionAcceptance: null,
    renoteCount: 0,
    repliesCount: 0,
    reactionCount: 0,
    reactions: {},
    reactionEmojis: {},
    fileIds: [],
    files: [],
    replyId: null,
    renoteId: null,
    ...overrides,
  } as MisskeyNote;

  return base;
}

Deno.test("normalizeMisskeyNote - should normalize public mention", () => {
  const note = createMockNote();
  const event = normalizeMisskeyNote(note, "bot123", false);

  assertEquals(event.platform, "misskey");
  assertEquals(event.channelId, "note:note123");
  assertEquals(event.userId, "user123");
  assertEquals(event.messageId, "note123");
  assertEquals(event.isDm, false);
  assertEquals(event.content, "Hello @testbot!");
});

Deno.test("normalizeMisskeyNote - should normalize DM", () => {
  const note = createMockNote({ visibility: "specified" });
  const event = normalizeMisskeyNote(note, "bot123", true);

  assertEquals(event.isDm, true);
  assertEquals(event.channelId, "dm:user123");
});

Deno.test("isMentionToBot - should detect @username mention", () => {
  const note = createMockNote({ text: "Hello @testbot how are you?" });
  assertEquals(isMentionToBot(note, "testbot"), true);
});

Deno.test("isMentionToBot - should detect @username@instance mention", () => {
  const note = createMockNote({ text: "Hello @testbot@example.com" });
  assertEquals(isMentionToBot(note, "testbot"), true);
});

Deno.test("isMentionToBot - should not detect different username", () => {
  const note = createMockNote({ text: "Hello @otheruser" });
  assertEquals(isMentionToBot(note, "testbot"), false);
});

Deno.test("removeBotMention - should remove mention from text", () => {
  const result = removeBotMention("Hello @testbot how are you?", "testbot");
  assertEquals(result, "Hello how are you?");
});

Deno.test("removeBotMention - should remove mention with instance", () => {
  const result = removeBotMention("@testbot@example.com Hello!", "testbot");
  assertEquals(result, "Hello!");
});

Deno.test("isDirectMessage - should detect specified visibility", () => {
  const note = createMockNote({ visibility: "specified" });
  assertEquals(isDirectMessage(note), true);
});

Deno.test("isDirectMessage - should not detect public visibility", () => {
  const note = createMockNote({ visibility: "public" });
  assertEquals(isDirectMessage(note), false);
});

Deno.test("shouldRespondToNote - should not respond to self", () => {
  const note = createMockNote({ userId: "bot123" });
  const result = shouldRespondToNote(note, "bot123", "testbot", {
    allowDm: true,
    respondToMention: true,
  });
  assertEquals(result, false);
});

Deno.test("shouldRespondToNote - should respond to DM when allowed", () => {
  const note = createMockNote({ visibility: "specified" });
  const result = shouldRespondToNote(note, "bot123", "testbot", {
    allowDm: true,
    respondToMention: true,
  });
  assertEquals(result, true);
});

Deno.test("shouldRespondToNote - should not respond to DM when not allowed", () => {
  const note = createMockNote({ visibility: "specified" });
  const result = shouldRespondToNote(note, "bot123", "testbot", {
    allowDm: false,
    respondToMention: true,
  });
  assertEquals(result, false);
});

Deno.test("shouldRespondToNote - should respond to mention", () => {
  const note = createMockNote({ text: "Hello @testbot" });
  const result = shouldRespondToNote(note, "bot123", "testbot", {
    allowDm: true,
    respondToMention: true,
  });
  assertEquals(result, true);
});

Deno.test("buildReplyParams - should use specified for DM reply", () => {
  const note = createMockNote({ visibility: "specified" });
  const params = buildReplyParams(note);
  assertEquals(params.visibility, "specified");
  assertEquals(params.visibleUserIds, ["user123"]);
});

Deno.test("buildReplyParams - should use same visibility for public", () => {
  const note = createMockNote({ visibility: "public" });
  const params = buildReplyParams(note);
  assertEquals(params.visibility, "public");
  assertEquals(params.visibleUserIds, undefined);
});

Deno.test("noteToPlatformMessage - should convert correctly", () => {
  const note = createMockNote();
  const msg = noteToPlatformMessage(note, "bot123");

  assertEquals(msg.messageId, "note123");
  assertEquals(msg.userId, "user123");
  assertEquals(msg.username, "@Test User (user123)");
  assertEquals(msg.content, "Hello @testbot!");
  assertEquals(msg.isBot, false);
});

Deno.test("noteToPlatformMessage - should mark bot messages", () => {
  const note = createMockNote({ userId: "bot123" });
  const msg = noteToPlatformMessage(note, "bot123");
  assertEquals(msg.isBot, true);
});

// ==================== Chat Message Tests ====================

// Create a minimal mock chat message for testing
function createMockChatMessage(
  overrides: Partial<MisskeyMessage> = {},
): MisskeyMessage {
  return {
    id: "chat123",
    createdAt: "2024-01-01T00:00:00.000Z",
    fromUserId: "user456",
    fromUser: {
      id: "user456",
      name: "Chat User",
      username: "chatuser",
      host: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarBlurhash: null,
      avatarDecorations: [],
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: "unknown",
    },
    toUserId: "bot123",
    toUser: null,
    toRoomId: null,
    toRoom: null,
    text: "Hello from chat!",
    fileId: null,
    file: null,
    isRead: false,
    reactions: [],
    ...overrides,
  } as MisskeyMessage;
}

// Create a mock ChatMessageLite for API response tests
function createMockChatMessageLite(
  overrides: Partial<ChatMessageLite> = {},
): ChatMessageLite {
  return {
    id: "chatLite123",
    createdAt: "2024-01-01T00:00:00.000Z",
    fromUserId: "user789",
    fromUser: {
      id: "user789",
      name: "Lite User",
      username: "liteuser",
    },
    toUserId: "bot123",
    text: "Hello from lite chat!",
    fileId: null,
    reactions: [],
    ...overrides,
  };
}

Deno.test("normalizeMisskeyChatMessage - should normalize chat message", () => {
  const message = createMockChatMessage();
  const event = normalizeMisskeyChatMessage(message, "bot123");

  assertEquals(event.platform, "misskey");
  assertEquals(event.channelId, "chat:user456");
  assertEquals(event.userId, "user456");
  assertEquals(event.messageId, "chat123");
  assertEquals(event.isDm, true);
  assertEquals(event.content, "Hello from chat!");
  assertEquals(event.guildId, "");
});

Deno.test("normalizeMisskeyChatMessage - should handle null text", () => {
  const message = createMockChatMessage({ text: null });
  const event = normalizeMisskeyChatMessage(message, "bot123");

  assertEquals(event.content, "");
});

Deno.test("chatMessageToPlatformMessage - should convert MisskeyMessage", () => {
  const message = createMockChatMessage();
  const msg = chatMessageToPlatformMessage(message, "bot123");

  assertEquals(msg.messageId, "chat123");
  assertEquals(msg.userId, "user456");
  assertEquals(msg.username, "@Chat User (user456)");
  assertEquals(msg.content, "Hello from chat!");
  assertEquals(msg.isBot, false);
});

Deno.test("chatMessageToPlatformMessage - should convert ChatMessageLite", () => {
  const message = createMockChatMessageLite();
  const msg = chatMessageToPlatformMessage(message, "bot123");

  assertEquals(msg.messageId, "chatLite123");
  assertEquals(msg.userId, "user789");
  assertEquals(msg.username, "@Lite User (user789)");
  assertEquals(msg.content, "Hello from lite chat!");
  assertEquals(msg.isBot, false);
});

Deno.test("chatMessageToPlatformMessage - should mark bot messages", () => {
  const message = createMockChatMessage({ fromUserId: "bot123" });
  const msg = chatMessageToPlatformMessage(message, "bot123");
  assertEquals(msg.isBot, true);
});

Deno.test("chatMessageToPlatformMessage - should fallback to username if name is null", () => {
  const message = createMockChatMessage();
  // deno-lint-ignore no-explicit-any
  (message as any).fromUser = {
    id: "user456",
    name: null,
    username: "chatuser",
  };
  const msg = chatMessageToPlatformMessage(message, "bot123");

  assertEquals(msg.username, "@chatuser (user456)");
});

Deno.test("chatMessageToPlatformMessage - should fallback to userId if fromUser is missing", () => {
  const message = createMockChatMessageLite();
  delete message.fromUser;
  const msg = chatMessageToPlatformMessage(message, "bot123");

  assertEquals(msg.username, "@user789 (user789)");
});

Deno.test("shouldRespondToChatMessage - should not respond to self", () => {
  const message = createMockChatMessage({ fromUserId: "bot123" });
  const result = shouldRespondToChatMessage(message, "bot123", { allowDm: true });

  assertEquals(result, false);
});

Deno.test("shouldRespondToChatMessage - should respond when DM allowed", () => {
  const message = createMockChatMessage();
  const result = shouldRespondToChatMessage(message, "bot123", { allowDm: true });

  assertEquals(result, true);
});

Deno.test("shouldRespondToChatMessage - should not respond when DM not allowed", () => {
  const message = createMockChatMessage();
  const result = shouldRespondToChatMessage(message, "bot123", { allowDm: false });

  assertEquals(result, false);
});

// ==================== MisskeyAdapter.fetchRecentMessages (note: channel) Tests ====================

/**
 * Helper to create a MisskeyAdapter with a stubbed client.request method.
 * Sets botId via the private field so fetchRecentMessages can function.
 */
function createAdapterWithMockClient(
  requestHandler: (endpoint: string, params: Record<string, unknown>) => unknown,
): MisskeyAdapter {
  const adapter = new MisskeyAdapter({
    host: "misskey.test",
    token: "test-token",
  });

  // Set botId so noteToPlatformMessage works
  // deno-lint-ignore no-explicit-any
  (adapter as any).botId = "bot123";

  // Replace the client.request method with our mock
  // deno-lint-ignore no-explicit-any
  const client = (adapter as any).client;
  client.request = (endpoint: string, params: Record<string, unknown> = {}) => {
    return Promise.resolve(requestHandler(endpoint, params));
  };

  return adapter;
}

Deno.test("fetchRecentMessages - note: channel fetches ancestors, current note, and replies", async () => {
  const ancestor = createMockNote({
    id: "ancestor1",
    text: "ancestor",
    createdAt: "2024-01-01T00:00:00.000Z",
  });
  const current = createMockNote({
    id: "noteABC",
    text: "current note",
    createdAt: "2024-01-01T01:00:00.000Z",
  });
  const reply = createMockNote({
    id: "reply1",
    text: "a reply",
    createdAt: "2024-01-01T02:00:00.000Z",
  });

  const endpoints: string[] = [];
  const adapter = createAdapterWithMockClient((endpoint, _params) => {
    endpoints.push(endpoint);
    if (endpoint === "notes/conversation") return [ancestor];
    if (endpoint === "notes/show") return current;
    if (endpoint === "notes/replies") return [reply];
    return [];
  });

  const messages = await adapter.fetchRecentMessages("note:noteABC", 20);

  assertEquals(endpoints.sort(), ["notes/conversation", "notes/replies", "notes/show"]);
  assertEquals(messages.length, 3);
  assertEquals(messages[0].messageId, "ancestor1");
  assertEquals(messages[1].messageId, "noteABC");
  assertEquals(messages[2].messageId, "reply1");
});

Deno.test("fetchRecentMessages - note: channel deduplicates notes", async () => {
  const note = createMockNote({
    id: "noteABC",
    text: "same note",
    createdAt: "2024-01-01T01:00:00.000Z",
  });

  const adapter = createAdapterWithMockClient((endpoint) => {
    // current note appears in both ancestors and notes/show
    if (endpoint === "notes/conversation") return [note];
    if (endpoint === "notes/show") return note;
    if (endpoint === "notes/replies") return [note];
    return [];
  });

  const messages = await adapter.fetchRecentMessages("note:noteABC", 20);

  assertEquals(messages.length, 1);
  assertEquals(messages[0].messageId, "noteABC");
});

Deno.test("fetchRecentMessages - note: channel sorts chronologically", async () => {
  const late = createMockNote({
    id: "late",
    text: "late",
    createdAt: "2024-01-01T03:00:00.000Z",
  });
  const early = createMockNote({
    id: "early",
    text: "early",
    createdAt: "2024-01-01T00:00:00.000Z",
  });
  const mid = createMockNote({
    id: "mid",
    text: "mid",
    createdAt: "2024-01-01T01:30:00.000Z",
  });

  const adapter = createAdapterWithMockClient((endpoint) => {
    // Return in non-chronological order
    if (endpoint === "notes/conversation") return [late];
    if (endpoint === "notes/show") return mid;
    if (endpoint === "notes/replies") return [early];
    return [];
  });

  const messages = await adapter.fetchRecentMessages("note:mid", 20);

  assertEquals(messages.length, 3);
  assertEquals(messages[0].messageId, "early");
  assertEquals(messages[1].messageId, "mid");
  assertEquals(messages[2].messageId, "late");
});

Deno.test("fetchRecentMessages - note: channel applies limit keeping latest notes", async () => {
  const notes = Array.from({ length: 5 }, (_, i) =>
    createMockNote({
      id: `note${i}`,
      text: `note ${i}`,
      createdAt: `2024-01-01T0${i}:00:00.000Z`,
    }));

  const adapter = createAdapterWithMockClient((endpoint) => {
    if (endpoint === "notes/conversation") return [notes[0], notes[1]];
    if (endpoint === "notes/show") return notes[2];
    if (endpoint === "notes/replies") return [notes[3], notes[4]];
    return [];
  });

  // Limit to 3 — should keep the 3 most recent (note2, note3, note4)
  const messages = await adapter.fetchRecentMessages("note:note2", 3);

  assertEquals(messages.length, 3);
  assertEquals(messages[0].messageId, "note2");
  assertEquals(messages[1].messageId, "note3");
  assertEquals(messages[2].messageId, "note4");
});

Deno.test("fetchRecentMessages - note: channel with empty ancestors and replies", async () => {
  const current = createMockNote({
    id: "noteOnly",
    text: "standalone note",
    createdAt: "2024-01-01T00:00:00.000Z",
  });

  const adapter = createAdapterWithMockClient((endpoint) => {
    if (endpoint === "notes/conversation") return [];
    if (endpoint === "notes/show") return current;
    if (endpoint === "notes/replies") return [];
    return [];
  });

  const messages = await adapter.fetchRecentMessages("note:noteOnly", 20);

  assertEquals(messages.length, 1);
  assertEquals(messages[0].messageId, "noteOnly");
  assertEquals(messages[0].content, "standalone note");
});

Deno.test("fetchRecentMessages - note: channel passes noteId and limit to API calls", async () => {
  const capturedCalls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];

  const adapter = createAdapterWithMockClient((endpoint, params) => {
    capturedCalls.push({ endpoint, params });
    if (endpoint === "notes/show") {
      return createMockNote({ id: "targetNote", createdAt: "2024-01-01T00:00:00.000Z" });
    }
    return [];
  });

  await adapter.fetchRecentMessages("note:targetNote", 15);

  const conversationCall = capturedCalls.find((c) => c.endpoint === "notes/conversation");
  const showCall = capturedCalls.find((c) => c.endpoint === "notes/show");
  const repliesCall = capturedCalls.find((c) => c.endpoint === "notes/replies");

  assertEquals(conversationCall?.params, { noteId: "targetNote", limit: 15 });
  assertEquals(showCall?.params, { noteId: "targetNote" });
  assertEquals(repliesCall?.params, { noteId: "targetNote", limit: 15 });
});

Deno.test("fetchRecentMessages - note: channel wraps API errors in PlatformError", async () => {
  const adapter = createAdapterWithMockClient((endpoint) => {
    if (endpoint === "notes/show") throw new Error("API failure");
    return [];
  });

  await assertRejects(
    () => adapter.fetchRecentMessages("note:failNote", 20),
    PlatformError,
    "Failed to fetch messages",
  );
});
