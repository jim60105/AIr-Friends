// tests/platforms/discord/discord-adapter.test.ts

// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "@std/assert";
import type { Message } from "discord.js";
import {
  extractDiscordChannelIds,
  isBotMentioned,
  normalizeDiscordMessage,
  removeBotMention,
  selectDiscordSpontaneousEntry,
  shouldRespondToMessage,
} from "@platforms/discord/discord-utils.ts";

// Mock Discord Message for testing
function createMockMessage(overrides: Record<string, unknown> = {}): any {
  return {
    id: "msg123",
    channelId: "ch123",
    guildId: "guild123",
    content: "Hello bot!",
    createdAt: new Date(),
    author: {
      id: "user123",
      username: "TestUser",
      displayName: "Test User",
      bot: false,
    },
    channel: {
      isDMBased: () => false,
    },
    mentions: {
      users: new Map(),
    },
    attachments: new Map(),
    stickers: new Map(),
    ...overrides,
  };
}

Deno.test("normalizeDiscordMessage - should normalize guild message", () => {
  const message = createMockMessage();
  const event = normalizeDiscordMessage(message as Message, "bot123");

  assertEquals(event.platform, "discord");
  assertEquals(event.channelId, "ch123");
  assertEquals(event.userId, "user123");
  assertEquals(event.messageId, "msg123");
  assertEquals(event.isDm, false);
  assertEquals(event.guildId, "guild123");
  assertEquals(event.content, "Hello bot!");
});

Deno.test("normalizeDiscordMessage - should normalize DM message", () => {
  const message = createMockMessage({
    guildId: null,
    channel: { isDMBased: () => true },
  });
  const event = normalizeDiscordMessage(message as Message, "bot123");

  assertEquals(event.isDm, true);
  assertEquals(event.guildId, "");
});

Deno.test("shouldRespondToMessage - should not respond to bots", () => {
  const message = createMockMessage({
    author: { id: "otherbot", bot: true },
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: true, respondToMention: true },
  );

  assertEquals(result, false);
});

Deno.test("shouldRespondToMessage - should not respond to self", () => {
  const message = createMockMessage({
    author: { id: "bot123", bot: true },
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: true, respondToMention: true },
  );

  assertEquals(result, false);
});

Deno.test("shouldRespondToMessage - should respond to DM when allowed", () => {
  const message = createMockMessage({
    channel: { isDMBased: () => true },
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: true, respondToMention: true },
  );

  assertEquals(result, true);
});

Deno.test("shouldRespondToMessage - should not respond to DM when not allowed", () => {
  const message = createMockMessage({
    channel: { isDMBased: () => true },
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: false, respondToMention: true },
  );

  assertEquals(result, false);
});

Deno.test("shouldRespondToMessage - should respond to mention", () => {
  const mentions = new Map([["bot123", {}]]);
  const message = createMockMessage({
    mentions: { users: mentions },
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: true, respondToMention: true },
  );

  assertEquals(result, true);
});

Deno.test("shouldRespondToMessage - should respond to prefix", () => {
  const message = createMockMessage({
    content: "!help me",
  });

  const result = shouldRespondToMessage(
    message as Message,
    "bot123",
    { allowDm: true, respondToMention: true, commandPrefix: "!" },
  );

  assertEquals(result, true);
});

Deno.test("removeBotMention - should remove mention from content", () => {
  const content = "<@bot123> Hello there";
  const result = removeBotMention(content, "bot123");
  assertEquals(result, "Hello there");
});

Deno.test("removeBotMention - should remove nickname mention", () => {
  const content = "<@!bot123> Hello there";
  const result = removeBotMention(content, "bot123");
  assertEquals(result, "Hello there");
});

Deno.test("isBotMentioned - should detect mention", () => {
  const mentions = new Map([["bot123", {}]]);
  const message = createMockMessage({
    mentions: { users: mentions },
  });

  const result = isBotMentioned(message as Message, "bot123");
  assertEquals(result, true);
});

Deno.test("isBotMentioned - should not detect when not mentioned", () => {
  const message = createMockMessage();

  const result = isBotMentioned(message as Message, "bot123");
  assertEquals(result, false);
});
Deno.test("normalizeDiscordMessage - image attachments are detected", () => {
  const attachment = {
    id: "att1",
    url: "https://cdn.example.com/image.png",
    contentType: "image/png",
    name: "image.png",
    size: 12345,
    width: 800,
    height: 600,
  };
  const message = createMockMessage({ attachments: new Map([["att1", attachment]]) });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.attachments?.length, 1);
  assertEquals(event.attachments![0].isImage, true);
  assertEquals(event.attachments![0].mimeType, "image/png");
  assertEquals(event.attachments![0].filename, "image.png");
  assertEquals(event.attachments![0].width, 800);
  assertEquals(event.attachments![0].height, 600);
  assertEquals(event.attachments![0].size, 12345);
});

Deno.test("normalizeDiscordMessage - non-image attachments are detected", () => {
  const attachment = {
    id: "att2",
    url: "https://cdn.example.com/file.zip",
    contentType: "application/zip",
    name: "file.zip",
    size: 999,
  };
  const message = createMockMessage({ attachments: new Map([["att2", attachment]]) });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.attachments?.length, 1);
  assertEquals(event.attachments![0].isImage, false);
  assertEquals(event.attachments![0].mimeType, "application/zip");
  assertEquals(event.attachments![0].width, undefined);
  assertEquals(event.attachments![0].height, undefined);
});

Deno.test("normalizeDiscordMessage - null contentType defaults to octet-stream", () => {
  const attachment = {
    id: "att3",
    url: "https://cdn.example.com/unknown",
    contentType: null,
    name: null,
    size: 100,
    width: null,
    height: null,
  };
  const message = createMockMessage({ attachments: new Map([["att3", attachment]]) });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.attachments![0].mimeType, "application/octet-stream");
  assertEquals(event.attachments![0].filename, "unknown");
  assertEquals(event.attachments![0].isImage, false);
});

import { messageToPltatformMessage } from "@platforms/discord/discord-utils.ts";
Deno.test("messageToPltatformMessage - with attachments", () => {
  const attachment = {
    id: "att1",
    url: "https://cdn.example.com/image.png",
    contentType: "image/png",
    name: "image.png",
    size: 12345,
    width: 800,
    height: 600,
  };
  const message = createMockMessage({ attachments: new Map([["att1", attachment]]) });
  const pm = messageToPltatformMessage(message as any, "bot123");
  assertEquals(pm.attachments?.length, 1);
});

Deno.test("messageToPltatformMessage - without attachments", () => {
  const message = createMockMessage();
  const pm = messageToPltatformMessage(message as any, "bot123");
  assertEquals(pm.attachments, undefined);
});

// ============ Sticker tests ============

Deno.test("normalizeDiscordMessage - sticker only message", () => {
  const sticker = { id: "s1", name: "wave_hello", tags: "hello, hi, wave" };
  const message = createMockMessage({
    content: "",
    stickers: new Map([["s1", sticker]]),
  });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.content, "[Sticker: wave_hello (hello, hi, wave)]");
});

Deno.test("normalizeDiscordMessage - text with sticker", () => {
  const sticker = { id: "s1", name: "laugh", tags: "lol, funny" };
  const message = createMockMessage({
    content: "看看這個",
    stickers: new Map([["s1", sticker]]),
  });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.content, "看看這個 [Sticker: laugh (lol, funny)]");
});

Deno.test("normalizeDiscordMessage - sticker without tags", () => {
  const sticker = { id: "s1", name: "custom_sticker", tags: null };
  const message = createMockMessage({
    content: "",
    stickers: new Map([["s1", sticker]]),
  });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.content, "[Sticker: custom_sticker]");
});

Deno.test("normalizeDiscordMessage - multiple stickers", () => {
  const s1 = { id: "s1", name: "wave", tags: "hello" };
  const s2 = { id: "s2", name: "heart", tags: "love" };
  const message = createMockMessage({
    content: "",
    stickers: new Map([["s1", s1], ["s2", s2]]),
  });
  const event = normalizeDiscordMessage(message as Message, "bot123");
  assertEquals(event.content, "[Sticker: wave (hello)] [Sticker: heart (love)]");
});

Deno.test("messageToPltatformMessage - with sticker", () => {
  const sticker = { id: "s1", name: "wave_hello", tags: "hello, hi" };
  const message = createMockMessage({
    content: "",
    stickers: new Map([["s1", sticker]]),
  });
  const pm = messageToPltatformMessage(message as any, "bot123");
  assertEquals(pm.content, "[Sticker: wave_hello (hello, hi)]");
});

Deno.test("messageToPltatformMessage - text with sticker", () => {
  const sticker = { id: "s1", name: "laugh", tags: "lol" };
  const message = createMockMessage({
    content: "check this",
    stickers: new Map([["s1", sticker]]),
  });
  const pm = messageToPltatformMessage(message as any, "bot123");
  assertEquals(pm.content, "check this [Sticker: laugh (lol)]");
});

// ============ DiscordAdapter.editMessage tests ============

import { DiscordAdapter } from "@platforms/discord/discord-adapter.ts";

function createMockDiscordAdapter(): DiscordAdapter {
  const adapter = new DiscordAdapter({ token: "fake-token" });
  return adapter;
}

function mockDiscordClient(adapter: DiscordAdapter, channelMock: any): void {
  (adapter as any).client = {
    channels: {
      fetch: () => Promise.resolve(channelMock),
    },
  };
}

Deno.test({
  name: "DiscordAdapter.editMessage - edits message successfully",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const mockChannel = {
      type: 0,
      messages: {
        fetch: () => Promise.resolve({ edit: () => Promise.resolve() }),
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const result = await adapter.editMessage("ch123", "msg123", "Updated content");
    assertEquals(result.success, true);
    assertEquals(result.messageId, "msg123");
  },
});

Deno.test({
  name: "DiscordAdapter.editMessage - handles channel not found",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    mockDiscordClient(adapter, null);

    const result = await adapter.editMessage("ch123", "msg123", "Updated");
    assertEquals(result.success, false);
    assertEquals(result.error, "Channel not found or not text-based");
  },
});

Deno.test({
  name: "DiscordAdapter.editMessage - handles edit error",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const mockChannel = {
      type: 0,
      messages: {
        fetch: () =>
          Promise.resolve({
            edit: () => Promise.reject(new Error("Missing permissions")),
          }),
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const result = await adapter.editMessage("ch123", "msg123", "Updated");
    assertEquals(result.success, false);
    assertEquals(result.error, "Failed to edit message: Missing permissions");
  },
});

Deno.test({
  name: "DiscordAdapter.editMessage - truncates long content",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    let capturedContent = "";
    const mockChannel = {
      type: 0,
      messages: {
        fetch: () =>
          Promise.resolve({
            edit: (opts: { content: string }) => {
              capturedContent = opts.content;
              return Promise.resolve();
            },
          }),
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const longContent = "a".repeat(3000);
    await adapter.editMessage("ch123", "msg123", longContent);
    assertEquals(capturedContent.length, 2000);
    assertEquals(capturedContent.endsWith("..."), true);
  },
});

// ============ DiscordAdapter.sendFile tests ============

Deno.test({
  name: "DiscordAdapter.sendFile - sends file successfully",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    let sentFiles: any[] = [];
    const mockChannel = {
      type: 0,
      send: (opts: any) => {
        sentFiles = opts.files;
        return Promise.resolve({ id: "sent_msg_123" });
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const fileContent = new TextEncoder().encode("test content");
    const result = await adapter.sendFile("ch123", fileContent, "test.md");
    assertEquals(result.success, true);
    assertEquals(result.messageId, "sent_msg_123");
    assertEquals(sentFiles.length, 1);
  },
});

Deno.test({
  name: "DiscordAdapter.sendFile - handles channel not found",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    mockDiscordClient(adapter, null);

    const fileContent = new TextEncoder().encode("test content");
    const result = await adapter.sendFile("ch123", fileContent, "test.md");
    assertEquals(result.success, false);
    assertEquals(result.error, "Channel not found or not text-based");
  },
});

Deno.test({
  name: "DiscordAdapter.sendFile - includes comment when provided",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    let capturedContent: string | undefined;
    const mockChannel = {
      type: 0,
      send: (opts: any) => {
        capturedContent = opts.content;
        return Promise.resolve({ id: "sent_msg_456" });
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const fileContent = new TextEncoder().encode("test content");
    const result = await adapter.sendFile("ch123", fileContent, "test.md", {
      comment: "Here is the file",
    });
    assertEquals(result.success, true);
    assertEquals(capturedContent, "Here is the file");
  },
});

Deno.test({
  name: "DiscordAdapter.sendFile - includes reply reference when provided",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    let capturedReply: any;
    const mockChannel = {
      type: 0,
      send: (opts: any) => {
        capturedReply = opts.reply;
        return Promise.resolve({ id: "sent_msg_789" });
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const fileContent = new TextEncoder().encode("test content");
    const result = await adapter.sendFile("ch123", fileContent, "test.md", {
      replyToMessageId: "original_msg_id",
    });
    assertEquals(result.success, true);
    assertEquals(capturedReply.messageReference, "original_msg_id");
  },
});

Deno.test({
  name: "DiscordAdapter.sendFile - handles send error",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const mockChannel = {
      type: 0,
      send: () => {
        throw new Error("Permission denied");
      },
    };
    mockDiscordClient(adapter, mockChannel);

    const fileContent = new TextEncoder().encode("test content");
    const result = await adapter.sendFile("ch123", fileContent, "test.md");
    assertEquals(result.success, false);
    assertEquals(result.error, "Permission denied");
  },
});

// ============ extractDiscordChannelIds tests ============

Deno.test("extractDiscordChannelIds - extracts channel IDs from whitelist", () => {
  const whitelist = [
    "discord/channel/111",
    "discord/account/222",
    "misskey/channel/333",
    "discord/channel/444",
  ];
  assertEquals(extractDiscordChannelIds(whitelist), ["111", "444"]);
});

Deno.test("extractDiscordChannelIds - returns empty for no channel entries", () => {
  assertEquals(extractDiscordChannelIds(["discord/account/123", "misskey/account/456"]), []);
});

Deno.test("extractDiscordChannelIds - handles empty whitelist", () => {
  assertEquals(extractDiscordChannelIds([]), []);
});

// ============ selectDiscordSpontaneousEntry tests ============

Deno.test("selectDiscordSpontaneousEntry - selects from discord entries", () => {
  const entry = selectDiscordSpontaneousEntry(["discord/channel/123"]);
  assertEquals(entry?.type, "channel");
  assertEquals(entry?.id, "123");
});

Deno.test("selectDiscordSpontaneousEntry - returns null for empty whitelist", () => {
  assertEquals(selectDiscordSpontaneousEntry([]), null);
});

Deno.test("selectDiscordSpontaneousEntry - ignores non-discord entries", () => {
  assertEquals(selectDiscordSpontaneousEntry(["misskey/account/abc"]), null);
});

Deno.test("selectDiscordSpontaneousEntry - parses account entries", () => {
  const entry = selectDiscordSpontaneousEntry(["discord/account/456"]);
  assertEquals(entry?.type, "account");
  assertEquals(entry?.id, "456");
});

Deno.test("selectDiscordSpontaneousEntry - parses unknown type entries", () => {
  const entry = selectDiscordSpontaneousEntry(["discord/unknown/789"]);
  assertEquals(entry?.type, "unknown");
  assertEquals(entry?.id, "789");
});

Deno.test("selectDiscordSpontaneousEntry - allowDm=true includes account entries", () => {
  const whitelist = ["discord/account/123", "discord/channel/456"];
  const results = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const entry = selectDiscordSpontaneousEntry(whitelist, true);
    if (entry) results.add(entry.type);
  }
  assertEquals(results.has("account"), true);
  assertEquals(results.has("channel"), true);
});

Deno.test("selectDiscordSpontaneousEntry - allowDm=false excludes account entries", () => {
  const whitelist = ["discord/account/123", "discord/channel/456"];
  for (let i = 0; i < 50; i++) {
    const entry = selectDiscordSpontaneousEntry(whitelist, false);
    assertEquals(entry?.type, "channel");
  }
});

Deno.test("selectDiscordSpontaneousEntry - allowDm=false with only account entries returns null", () => {
  const whitelist = ["discord/account/123", "discord/account/456"];
  const entry = selectDiscordSpontaneousEntry(whitelist, false);
  assertEquals(entry, null);
});

Deno.test("selectDiscordSpontaneousEntry - allowDm defaults to true when not specified", () => {
  const whitelist = ["discord/account/123"];
  const entry = selectDiscordSpontaneousEntry(whitelist);
  assertEquals(entry?.type, "account");
});

// ============ DiscordAdapter.determineSpontaneousTarget tests ============

function createTestConfig(whitelist: string[]): any {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test.com", token: "test", enabled: false },
    },
    accessControl: { replyTo: "whitelist", whitelist },
  };
}

function createTestConfigWithAllowDm(whitelist: string[], allowDm: boolean): any {
  return {
    platforms: {
      discord: {
        token: "test",
        enabled: true,
        spontaneousPost: {
          enabled: true,
          minIntervalMs: 10800000,
          maxIntervalMs: 43200000,
          contextFetchProbability: 0.5,
          allowDm,
        },
      },
      misskey: { host: "test.com", token: "test", enabled: false },
    },
    accessControl: { replyTo: "whitelist", whitelist },
  };
}

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - selects channel entry",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfig(["discord/channel/123456789"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target?.channelId, "123456789");
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - returns null for empty whitelist",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfig([]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - returns null for non-discord entries",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfig(["misskey/account/abc"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - account entry with DM failure returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    // Mock getDmChannelId to return null
    (adapter as any).getDmChannelId = () => Promise.resolve(null);
    const config = createTestConfig(["discord/account/999"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - account entry with DM exception returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    (adapter as any).getDmChannelId = () => Promise.reject(new Error("API error"));
    const config = createTestConfig(["discord/account/999"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - account entry with DM success",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    (adapter as any).getDmChannelId = () => Promise.resolve("dm-ch-123");
    const config = createTestConfig(["discord/account/999"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target?.channelId, "dm-ch-123");
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - unknown entry type returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfig(["discord/unknown/123"]);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

Deno.test({
  name: "DiscordAdapter.determineSpontaneousTarget - allowDm=false excludes account entries",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfigWithAllowDm(
      ["discord/account/999", "discord/channel/123"],
      false,
    );
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target?.channelId, "123");
  },
});

Deno.test({
  name:
    "DiscordAdapter.determineSpontaneousTarget - allowDm=false with only account entries returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const adapter = createMockDiscordAdapter();
    const config = createTestConfigWithAllowDm(["discord/account/999"], false);
    const target = await adapter.determineSpontaneousTarget(config);
    assertEquals(target, null);
  },
});

// ============ DiscordAdapter.getSearchGuildId tests ============

Deno.test({
  name: "DiscordAdapter.getSearchGuildId - returns channelId for non-DM",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const adapter = createMockDiscordAdapter();
    assertEquals(adapter.getSearchGuildId("channel123", false), "channel123");
  },
});

Deno.test({
  name: "DiscordAdapter.getSearchGuildId - returns empty for DM",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const adapter = createMockDiscordAdapter();
    assertEquals(adapter.getSearchGuildId("channel123", true), "");
  },
});
