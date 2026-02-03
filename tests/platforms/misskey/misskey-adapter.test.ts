// tests/platforms/misskey/misskey-adapter.test.ts

import { assertEquals } from "@std/assert";
import {
  normalizeMisskeyNote,
  noteToPlatformMessage,
  isMentionToBot,
  removeBotMention,
  isDirectMessage,
  shouldRespondToNote,
  buildReplyParams,
  MisskeyNote,
} from "@platforms/misskey/misskey-utils.ts";

function createMockNote(overrides: Partial<MisskeyNote> = {}): MisskeyNote {
  return {
    id: "note123",
    text: "Hello @testbot!",
    userId: "user123",
    user: {
      id: "user123",
      username: "testuser",
      name: "Test User",
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    visibility: "public",
    ...overrides,
  };
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
  assertEquals(msg.username, "Test User");
  assertEquals(msg.content, "Hello @testbot!");
  assertEquals(msg.isBot, false);
});

Deno.test("noteToPlatformMessage - should mark bot messages", () => {
  const note = createMockNote({ userId: "bot123" });
  const msg = noteToPlatformMessage(note, "bot123");
  assertEquals(msg.isBot, true);
});
