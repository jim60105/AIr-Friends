// tests/core/spontaneous-target.test.ts

import { assertEquals } from "@std/assert";
import {
  determineDiscordTarget,
  determineMisskeyTarget,
  determineSpontaneousTarget,
} from "@core/spontaneous-target.ts";
import type { Config } from "../../src/types/config.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

function createConfig(whitelist: string[]): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test.com", token: "test", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system.md",
      tokenLimit: 20000,
    },
    memory: { searchLimit: 10, maxChars: 2000, recentMessageLimit: 20 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    accessControl: { replyTo: "whitelist", whitelist },
  };
}

// deno-lint-ignore no-explicit-any
function createMockAdapter(): any {
  return {
    platform: "discord" as const,
    getDmChannelId: (_userId: string) => Promise.resolve("dm-channel-123"),
    getBotId: () => "bot-123",
  };
}

Deno.test("determineSpontaneousTarget - Discord selects from whitelist channels", async () => {
  const config = createConfig(["discord/channel/111111111111111111"]);
  const adapter = createMockAdapter();

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target?.channelId, "111111111111111111");
});

Deno.test("determineSpontaneousTarget - Discord resolves account to DM channel", async () => {
  const config = createConfig(["discord/account/333333333333333333"]);
  const adapter = createMockAdapter();

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target?.channelId, "dm-channel-123");
});

Deno.test("determineSpontaneousTarget - Discord returns null when whitelist is empty", async () => {
  const config = createConfig([]);
  const adapter = createMockAdapter();

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target, null);
});

Deno.test("determineSpontaneousTarget - Discord handles DM creation failure", async () => {
  const config = createConfig(["discord/account/nonexistent"]);
  // deno-lint-ignore no-explicit-any
  const adapter: any = {
    platform: "discord" as const,
    getDmChannelId: () => Promise.resolve(null),
  };

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target, null);
});

Deno.test("determineSpontaneousTarget - Discord filters only Discord entries", async () => {
  const config = createConfig([
    "misskey/account/abc123",
    "discord/channel/222222222222222222",
  ]);
  const adapter = createMockAdapter();

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target?.channelId, "222222222222222222");
});

Deno.test("determineSpontaneousTarget - Misskey always returns timeline:self", () => {
  const target = determineMisskeyTarget();
  assertEquals(target.channelId, "timeline:self");
});

Deno.test("determineSpontaneousTarget - Discord handles DM creation exception", async () => {
  const config = createConfig(["discord/account/erruser"]);
  // deno-lint-ignore no-explicit-any
  const adapter: any = {
    platform: "discord" as const,
    getDmChannelId: () => Promise.reject(new Error("API error")),
  };

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target, null);
});

Deno.test("determineSpontaneousTarget - Discord returns null for unknown entry type", async () => {
  const config = createConfig(["discord/unknown/12345"]);
  const adapter = createMockAdapter();

  const target = await determineDiscordTarget(adapter as PlatformAdapter, config);
  assertEquals(target, null);
});

Deno.test("determineSpontaneousTarget - Misskey via determineSpontaneousTarget", async () => {
  const config = createConfig([]);
  const adapter = createMockAdapter();

  const target = await determineSpontaneousTarget(
    "misskey",
    adapter as PlatformAdapter,
    config,
  );
  assertEquals(target?.channelId, "timeline:self");
});

Deno.test("determineSpontaneousTarget - Discord via determineSpontaneousTarget", async () => {
  const config = createConfig(["discord/channel/555"]);
  const adapter = createMockAdapter();

  const target = await determineSpontaneousTarget(
    "discord",
    adapter as PlatformAdapter,
    config,
  );
  assertEquals(target?.channelId, "555");
});

Deno.test("determineSpontaneousTarget - unsupported platform returns null", async () => {
  const config = createConfig([]);
  const adapter = createMockAdapter();

  const target = await determineSpontaneousTarget(
    // deno-lint-ignore no-explicit-any
    "unknown" as any,
    adapter as PlatformAdapter,
    config,
  );
  assertEquals(target, null);
});
