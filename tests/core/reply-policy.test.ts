import { assertEquals } from "@std/assert";
import { ReplyPolicyEvaluator } from "@core/reply-policy.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { ReplyPolicy } from "../../src/types/config.ts";

function createEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "channel_123",
    userId: "user_456",
    messageId: "msg_789",
    isDm: false,
    guildId: "guild_001",
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
  const event = createEvent({ isDm: true, userId: "stranger" });
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - public mode allows DM from whitelisted account", () => {
  const evaluator = createEvaluator("public", ["discord/account/user_456"]);
  const event = createEvent({ isDm: true, userId: "user_456" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - public mode allows DM from whitelisted channel", () => {
  const evaluator = createEvaluator("public", ["discord/channel/dm_channel_99"]);
  const event = createEvent({ isDm: true, channelId: "dm_channel_99" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - whitelist mode allows whitelisted account and channel", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/user_456",
    "discord/channel/channel_123",
  ]);
  const eventByAccount = createEvent({ userId: "user_456", channelId: "unknown" });
  const eventByChannel = createEvent({ userId: "unknown", channelId: "channel_123" });

  assertEquals(evaluator.shouldReply(eventByAccount), true);
  assertEquals(evaluator.shouldReply(eventByChannel), true);
});

Deno.test("ReplyPolicy - whitelist mode denies non-whitelisted event", () => {
  const evaluator = createEvaluator("whitelist", ["discord/account/other_user"]);
  const event = createEvent({ userId: "user_456" });
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - whitelist mode with empty whitelist denies all", () => {
  const evaluator = createEvaluator("whitelist", []);
  const event = createEvent();
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - cross-platform whitelist entries do not match", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/discord_user",
    "misskey/account/misskey_user",
  ]);
  const misskeyEvent = createEvent({ platform: "misskey", userId: "discord_user" });
  const discordEvent = createEvent({ platform: "discord", userId: "misskey_user" });

  assertEquals(evaluator.shouldReply(misskeyEvent), false);
  assertEquals(evaluator.shouldReply(discordEvent), false);
});

Deno.test("ReplyPolicy - supports matching entries from multiple platforms", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/discord_user",
    "misskey/account/misskey_user",
  ]);
  const discordEvent = createEvent({ platform: "discord", userId: "discord_user" });
  const misskeyEvent = createEvent({ platform: "misskey", userId: "misskey_user" });

  assertEquals(evaluator.shouldReply(discordEvent), true);
  assertEquals(evaluator.shouldReply(misskeyEvent), true);
});

Deno.test("ReplyPolicy - ignores invalid whitelist entries", () => {
  const evaluator = createEvaluator("whitelist", [
    "discord/account/valid_user",
    "invalid_entry",
    "telegram/account/123",
    "",
  ]);

  const validEvent = createEvent({ userId: "valid_user" });
  const invalidEvent = createEvent({ userId: "123" });

  assertEquals(evaluator.shouldReply(validEvent), true);
  assertEquals(evaluator.shouldReply(invalidEvent), false);
});
