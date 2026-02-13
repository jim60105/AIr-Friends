// tests/platforms/discord/discord-adapter.test.ts

// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "@std/assert";
import type { Message } from "discord.js";
import {
  isBotMentioned,
  normalizeDiscordMessage,
  removeBotMention,
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
