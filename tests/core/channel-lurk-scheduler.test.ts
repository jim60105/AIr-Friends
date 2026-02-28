// tests/core/channel-lurk-scheduler.test.ts

import { assertEquals } from "@std/assert";
import { ChannelLurkScheduler, type ChannelLurkTarget } from "@core/channel-lurk-scheduler.ts";
import { extractChannelLurkIds } from "@platforms/discord/index.ts";
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
  const channels = [
    { id: "discord/channel/11100000000000000", enabled: true, channelLurk: true },
    { id: "discord/account/22200000000000000", enabled: true, channelLurk: false },
    { id: "misskey/channel/333", enabled: true, channelLurk: false },
    { id: "discord/channel/44400000000000000", enabled: true, channelLurk: true },
  ];
  const result = extractChannelLurkIds(channels);
  assertEquals(result, ["11100000000000000", "44400000000000000"]);
});

Deno.test("extractChannelLurkIds - returns empty for no matches", () => {
  const result = extractChannelLurkIds([
    { id: "discord/account/12345678901234567", enabled: true, channelLurk: false },
    { id: "misskey/account/456", enabled: true, channelLurk: false },
  ]);
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

Deno.test("ChannelLurkScheduler - skips when bot mentioned in message", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);
  // Override hasBotMention to return true
  adapter.hasBotMention = () => Promise.resolve(true);

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

Deno.test("ChannelLurkScheduler - skips when bot already reacted", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);
  // Override hasBotReaction to return true
  adapter.hasBotReaction = () => Promise.resolve(true);

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

Deno.test("ChannelLurkScheduler - continues after single channel error", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);

  const triggeredChannels: string[] = [];
  let callCount = 0;

  // Make fetchRecentMessages fail for channel-1 but succeed for channel-2
  const origFetch = adapter.fetchRecentMessages.bind(adapter);
  adapter.fetchRecentMessages = (channelId: string, limit: number) => {
    callCount++;
    if (channelId === "channel-1") {
      return Promise.reject(new Error("API error"));
    }
    return origFetch(channelId, limit);
  };

  const scheduler = new ChannelLurkScheduler(
    createConfig(),
    adapter,
    ["channel-1", "channel-2"],
    (target) => {
      triggeredChannels.push(target.channelId);
    },
  );

  scheduler.start();
  await new Promise((r) => setTimeout(r, 120));
  scheduler.stop();

  // channel-2 should still be checked despite channel-1 error
  assertEquals(triggeredChannels.includes("channel-2"), true);
});

Deno.test("ChannelLurkScheduler - triggers for new messageId after previous", async () => {
  const adapter = new MockPlatformAdapter();
  const message1 = createMockMessage({ messageId: "msg-001" });
  adapter.setMockMessages([message1]);

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
  await new Promise((r) => setTimeout(r, 80));

  // Change to new message
  const message2 = createMockMessage({ messageId: "msg-002" });
  adapter.setMockMessages([message2]);

  await new Promise((r) => setTimeout(r, 80));
  scheduler.stop();

  // Should trigger for both different messages
  assertEquals(triggerCount, 2);
});

// === State Restoration Tests ===

Deno.test("ChannelLurkScheduler - uses restored schedule time within valid range", () => {
  const adapter = new MockPlatformAdapter();
  const scheduler = new ChannelLurkScheduler(
    createConfig({ intervalMs: 5000 }),
    adapter,
    ["ch-1"],
    () => Promise.resolve(),
  );

  const futureTime = new Date(Date.now() + 2000);
  scheduler.start({ channelLurk: futureTime.toISOString() });

  // Should not execute immediately — waiting for future time
  scheduler.stop();
});

Deno.test("ChannelLurkScheduler - executes immediately when restored time is past", async () => {
  const adapter = new MockPlatformAdapter();
  const message = createMockMessage();
  adapter.setMockMessages([message]);

  let triggered = false;
  const scheduler = new ChannelLurkScheduler(
    createConfig({ intervalMs: 5000 }),
    adapter,
    ["ch-1"],
    (_target, _msg) => {
      triggered = true;
      return Promise.resolve();
    },
  );

  scheduler.start({ channelLurk: new Date(Date.now() - 60000).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 200));

  assertEquals(triggered, true);
  scheduler.stop();
});

Deno.test("ChannelLurkScheduler - persists next time via stateStore", () => {
  const adapter = new MockPlatformAdapter();
  adapter.setMockMessages([createMockMessage()]);

  const saved: { key: string; nextAt: Date }[] = [];
  const scheduler = new ChannelLurkScheduler(
    createConfig({ intervalMs: 50 }),
    adapter,
    ["ch-1"],
    () => Promise.resolve(),
  );
  scheduler.setStateStore({
    save: (key: string, nextAt: Date) => {
      saved.push({ key, nextAt });
      return Promise.resolve();
    },
  } as never);
  scheduler.start();

  assertEquals(saved.some((s) => s.key === "channelLurk"), true);
  scheduler.stop();
});
