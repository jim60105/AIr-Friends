import { assertEquals } from "@std/assert";
import { ReplyPolicyEvaluator } from "@core/reply-policy.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { ReplyPolicy } from "../../src/types/config.ts";

function createEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "12300000000000001",
    userId: "45600000000000001",
    messageId: "msg_789",
    isDm: false,
    guildId: "00100000000000001",
    content: "Hello",
    timestamp: new Date(),
    ...overrides,
  };
}

function createEvaluator(replyTo: ReplyPolicy, whitelist: string[] = []): ReplyPolicyEvaluator {
  return new ReplyPolicyEvaluator({ replyTo, whitelist });
}

Deno.test("ReplyPolicy - all mode allows public messages", () => {
  const evaluator = createEvaluator("all");
  const event = createEvent({ isDm: false });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - all mode allows DM messages", () => {
  const evaluator = createEvaluator("all");
  const event = createEvent({ isDm: true });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - public mode allows public messages", () => {
  const evaluator = createEvaluator("public");
  const event = createEvent({ isDm: false });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - public mode denies DM from non-whitelisted user", () => {
  const evaluator = createEvaluator("public");
  const event = createEvent({ isDm: true, userId: "66600000000000001" });
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - public mode allows DM from whitelisted account", () => {
  const evaluator = createEvaluator("public", ["discord/account/45600000000000001"]);
  const event = createEvent({ isDm: true, userId: "45600000000000001" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - public mode allows DM from whitelisted channel", () => {
  const evaluator = createEvaluator("public", ["discord/channel/99000000000000001"]);
  const event = createEvent({ isDm: true, channelId: "99000000000000001" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - whitelist mode allows whitelisted account and channel", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/45600000000000001",
    "discord/channel/12300000000000001",
  ]);
  const eventByAccount = createEvent({ userId: "45600000000000001", channelId: "unknown" });
  const eventByChannel = createEvent({
    userId: "44400000000000001",
    channelId: "12300000000000001",
  });

  assertEquals(evaluator.shouldReply(eventByAccount), true);
  assertEquals(evaluator.shouldReply(eventByChannel), true);
});

Deno.test("ReplyPolicy - whitelist mode denies non-whitelisted event", () => {
  const evaluator = createEvaluator("whitelist", ["discord/account/77700000000000001"]);
  const event = createEvent({ userId: "45600000000000001" });
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - whitelist mode with empty whitelist denies all", () => {
  const evaluator = createEvaluator("whitelist", []);
  const event = createEvent();
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - cross-platform whitelist entries do not match", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/55500000000000001",
    "misskey/account/misskey_user_id",
  ]);
  const misskeyEvent = createEvent({ platform: "misskey", userId: "55500000000000001" });
  const discordEvent = createEvent({ platform: "discord", userId: "misskey_user_id" });

  assertEquals(evaluator.shouldReply(misskeyEvent), false);
  assertEquals(evaluator.shouldReply(discordEvent), false);
});

Deno.test("ReplyPolicy - supports matching entries from multiple platforms", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/55500000000000001",
    "misskey/account/misskey_user_id",
  ]);
  const discordEvent = createEvent({ platform: "discord", userId: "55500000000000001" });
  const misskeyEvent = createEvent({ platform: "misskey", userId: "misskey_user_id" });

  assertEquals(evaluator.shouldReply(discordEvent), true);
  assertEquals(evaluator.shouldReply(misskeyEvent), true);
});

Deno.test("ReplyPolicy - ignores invalid whitelist entries", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/88800000000000001",
    "invalid_entry",
    "telegram/account/123",
    "",
  ]);

  const validEvent = createEvent({ userId: "88800000000000001" });
  const invalidEvent = createEvent({ userId: "123" });

  assertEquals(evaluator.shouldReply(validEvent), true);
  assertEquals(evaluator.shouldReply(invalidEvent), false);
});

Deno.test("ReplyPolicy - isWhitelistedAccount returns true for account entries", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/12345678901234567",
    "discord/channel/45678901234567890",
  ]);
  assertEquals(evaluator.isWhitelistedAccount("discord", "12345678901234567"), true);
});

Deno.test("ReplyPolicy - isWhitelistedAccount returns false for channel entries", () => {
  const evaluator = createEvaluator("whitelist", ["discord/channel/45678901234567890"]);
  assertEquals(evaluator.isWhitelistedAccount("discord", "45678901234567890"), false);
});

Deno.test("ReplyPolicy - isWhitelistedAccount returns false for different platform", () => {
  const evaluator = createEvaluator("whitelist", ["discord/account/12345678901234567"]);
  assertEquals(evaluator.isWhitelistedAccount("misskey", "123"), false);
});
