// tests/core/channel-lurk-scheduler.test.ts

import { assertEquals } from "@std/assert";
import {
  ChannelLurkScheduler,
  type ChannelLurkTarget,
  extractDiscordChannelIds,
} from "@core/channel-lurk-scheduler.ts";
import type { ChannelLurkConfig } from "../../src/types/config.ts";
import type { PlatformMessage } from "../../src/types/events.ts";
import { MockPlatformAdapter } from "../mocks/mock-platform-adapter.ts";

function createConfig(overrides?: Partial<ChannelLurkConfig>): ChannelLurkConfig {
  return {
    enabled: true,
    intervalMs: 50, // Short interval for tests
    ...overrides,
  };
}

function createMockMessage(overrides?: Partial<PlatformMessage>): PlatformMessage {
  return {
    userId: "user-456",
    username: "TestUser",
    content: "Hello world",
    messageId: "msg-001",
    timestamp: new Date(),
    isBot: false,
    ...overrides,
  };
}

Deno.test("extractDiscordChannelIds - filters discord channel entries", () => {
  const whitelist = [
    "discord/channel/111",
    "discord/account/222",
    "misskey/channel/333",
    "discord/channel/444",
  ];
  const result = extractDiscordChannelIds(whitelist);
  assertEquals(result, ["111", "444"]);
});

Deno.test("extractDiscordChannelIds - returns empty for no matches", () => {
  const result = extractDiscordChannelIds(["discord/account/123", "misskey/account/456"]);
  assertEquals(result, []);
});

Deno.test("ChannelLurkScheduler - triggers callback when all conditions met", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);

  let triggered = false;
  let capturedTarget: ChannelLurkTarget | undefined;
  let capturedMessage: PlatformMessage | undefined;

  const scheduler = new ChannelLurkScheduler(
    createConfig(),
    adapter,
    ["channel-1"],
    (target, msg) => {
      triggered = true;
      capturedTarget = target;
      capturedMessage = msg;
    },
  );

  scheduler.start();
  // Wait for the interval to fire
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  assertEquals(triggered, true);
  assertEquals(capturedTarget?.platform, "discord");
  assertEquals(capturedTarget?.channelId, "channel-1");
  assertEquals(capturedMessage?.messageId, "msg-001");
});

Deno.test("ChannelLurkScheduler - skips when last message is from bot", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage({ userId: "bot-123" }); // bot's own ID
  adapter.setMockMessages([message]);

  let triggered = false;
  const scheduler = new ChannelLurkScheduler(
    createConfig(),
    adapter,
    ["channel-1"],
    () => {
      triggered = true;
    },
  );

  scheduler.start();
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  assertEquals(triggered, false);
});

Deno.test("ChannelLurkScheduler - skips when no messages in channel", async () => {
  const adapter = new MockPlatformAdapter();
  adapter.setMockMessages([]);

  let triggered = false;
  const scheduler = new ChannelLurkScheduler(
    createConfig(),
    adapter,
    ["channel-1"],
    () => {
      triggered = true;
    },
  );

  scheduler.start();
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  assertEquals(triggered, false);
});

Deno.test("ChannelLurkScheduler - skips already processed messageId", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);

  let triggerCount = 0;
  const scheduler = new ChannelLurkScheduler(
    createConfig({ intervalMs: 30 }),
    adapter,
    ["channel-1"],
    () => {
      triggerCount++;
    },
  );

  scheduler.start();
  // Wait for two intervals
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  // Should only trigger once for the same message
  assertEquals(triggerCount, 1);
});

Deno.test("ChannelLurkScheduler - start/stop lifecycle", () => {
  const adapter = new MockPlatformAdapter();
  const scheduler = new ChannelLurkScheduler(
    createConfig(),
    adapter,
    ["channel-1"],
    () => {},
  );

  // Should not throw
  scheduler.start();
  scheduler.stop();
  // Double stop should be safe
  scheduler.stop();
});

Deno.test("ChannelLurkScheduler - disabled config does not start", async () => {
  const adapter = new MockPlatformAdapter();
  adapter.setMockMessages([createMockMessage()]);

  let triggered = false;
  const scheduler = new ChannelLurkScheduler(
    createConfig({ enabled: false }),
    adapter,
    ["channel-1"],
    () => {
      triggered = true;
    },
  );

  scheduler.start();
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  assertEquals(triggered, false);
});
