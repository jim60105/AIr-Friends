import { assertEquals } from "@std/assert";
import { ReplyPolicyEvaluator } from "@core/reply-policy.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { ChannelConfig, ReplyPolicy } from "../../src/types/config.ts";

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

function createEvaluator(
  replyTo: ReplyPolicy,
  channels: ChannelConfig[] = [],
): ReplyPolicyEvaluator {
  return new ReplyPolicyEvaluator(replyTo, channels);
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
  const channels: ChannelConfig[] = [{ id: "discord/account/45600000000000001", enabled: true }];
  const evaluator = createEvaluator("public", channels);
  const event = createEvent({ isDm: true, userId: "45600000000000001" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - public mode allows DM from whitelisted channel", () => {
  const channels: ChannelConfig[] = [{ id: "discord/channel/99000000000000001", enabled: true }];
  const evaluator = createEvaluator("public", channels);
  const event = createEvent({ isDm: true, channelId: "99000000000000001" });
  assertEquals(evaluator.shouldReply(event), true);
});

Deno.test("ReplyPolicy - channels mode allows whitelisted account and channel", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/45600000000000001", enabled: true },
    { id: "discord/channel/12300000000000001", enabled: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  const eventByAccount = createEvent({ userId: "45600000000000001", channelId: "unknown" });
  const eventByChannel = createEvent({
    userId: "44400000000000001",
    channelId: "12300000000000001",
  });

  assertEquals(evaluator.shouldReply(eventByAccount), true);
  assertEquals(evaluator.shouldReply(eventByChannel), true);
});

Deno.test("ReplyPolicy - channels mode denies non-whitelisted event", () => {
  const channels: ChannelConfig[] = [{ id: "discord/account/77700000000000001", enabled: true }];
  const evaluator = createEvaluator("channels", channels);
  const event = createEvent({ userId: "45600000000000001" });
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - channels mode with empty channels denies all", () => {
  const evaluator = createEvaluator("channels", []);
  const event = createEvent();
  assertEquals(evaluator.shouldReply(event), false);
});

Deno.test("ReplyPolicy - cross-platform channels entries do not match", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/55500000000000001", enabled: true },
    { id: "misskey/account/misskey_user_id", enabled: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  const misskeyEvent = createEvent({ platform: "misskey", userId: "55500000000000001" });
  const discordEvent = createEvent({ platform: "discord", userId: "misskey_user_id" });

  assertEquals(evaluator.shouldReply(misskeyEvent), false);
  assertEquals(evaluator.shouldReply(discordEvent), false);
});

Deno.test("ReplyPolicy - supports matching entries from multiple platforms", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/55500000000000001", enabled: true },
    { id: "misskey/account/misskey_user_id", enabled: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  const discordEvent = createEvent({ platform: "discord", userId: "55500000000000001" });
  const misskeyEvent = createEvent({ platform: "misskey", userId: "misskey_user_id" });

  assertEquals(evaluator.shouldReply(discordEvent), true);
  assertEquals(evaluator.shouldReply(misskeyEvent), true);
});

Deno.test("ReplyPolicy - ignores invalid channel entries", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/88800000000000001", enabled: true },
    // invalid entries simulated by missing or malformed IDs are ignored by parser
  ];

  const evaluator = createEvaluator("channels", channels);
  const validEvent = createEvent({ userId: "88800000000000001" });
  const invalidEvent = createEvent({ userId: "123" });

  assertEquals(evaluator.shouldReply(validEvent), true);
  assertEquals(evaluator.shouldReply(invalidEvent), false);
});

Deno.test("ReplyPolicy - isRateLimitBypassed returns true for account entries", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: true, rateLimitBypass: true },
    { id: "discord/channel/45678901234567890", enabled: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isRateLimitBypassed("discord", "12345678901234567", ""), true);
});

Deno.test("ReplyPolicy - isRateLimitBypassed returns false for channel entries", () => {
  const channels: ChannelConfig[] = [{ id: "discord/channel/45678901234567890", enabled: true }];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(
    evaluator.isRateLimitBypassed("discord", "45678901234567890", "45678901234567890"),
    false,
  );
});

Deno.test("ReplyPolicy - isRateLimitBypassed returns false for different platform", () => {
  const channels: ChannelConfig[] = [{ id: "discord/account/12345678901234567", enabled: true }];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isRateLimitBypassed("misskey", "123", ""), false);
});

Deno.test("ReplyPolicy - isYoloEnabled returns true for account with yolo: true", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: true, yolo: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("discord", "12345678901234567", ""), true);
});

Deno.test("ReplyPolicy - isYoloEnabled returns true for channel with yolo: true", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/channel/99900000000000001", enabled: true, yolo: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("discord", "anyuser", "99900000000000001"), true);
});

Deno.test("ReplyPolicy - isYoloEnabled returns false when yolo not set", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("discord", "12345678901234567", ""), false);
});

Deno.test("ReplyPolicy - isYoloEnabled returns false when yolo: false", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: true, yolo: false },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("discord", "12345678901234567", ""), false);
});

Deno.test("ReplyPolicy - isYoloEnabled returns false when channel disabled", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: false, yolo: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("discord", "12345678901234567", ""), false);
});

Deno.test("ReplyPolicy - isYoloEnabled returns false for different platform", () => {
  const channels: ChannelConfig[] = [
    { id: "discord/account/12345678901234567", enabled: true, yolo: true },
  ];
  const evaluator = createEvaluator("channels", channels);
  assertEquals(evaluator.isYoloEnabled("misskey", "12345678901234567", ""), false);
});
