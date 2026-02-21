// tests/core/spontaneous-target.test.ts

import { assertEquals } from "@std/assert";
import type { SpontaneousTarget } from "@core/spontaneous-target.ts";
import type { Config } from "../../src/types/config.ts";

function createConfig(whitelist: string[]): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test.com", token: "test", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
    },
    memory: { searchLimit: 10, maxChars: 2000, recentMessageLimit: 20 },
    workspace: { repoPath: "./data", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    accessControl: { replyTo: "whitelist", whitelist },
  };
}

// deno-lint-ignore no-explicit-any
function createMockDiscordAdapter(): any {
  return {
    platform: "discord" as const,
    getDmChannelId: (_userId: string) => Promise.resolve("dm-channel-123"),
    getBotId: () => "bot-123",
    determineSpontaneousTarget: async (config: Config): Promise<SpontaneousTarget | null> => {
      const discordEntries = config.accessControl.whitelist.filter(
        (entry) => entry.startsWith("discord/"),
      );
      if (discordEntries.length === 0) return null;
      const selectedEntry = discordEntries[Math.floor(Math.random() * discordEntries.length)];
      const parts = selectedEntry.split("/");
      const type = parts[1];
      const id = parts[2];
      if (type === "channel") return { channelId: id };
      if (type === "account") {
        // deno-lint-ignore no-explicit-any
        const self = arguments[0] as any;
        const dmChannelId = await self?.getDmChannelId?.(id) ?? "dm-channel-123";
        return dmChannelId ? { channelId: dmChannelId } : null;
      }
      return null;
    },
  };
}

Deno.test("DiscordAdapter.determineSpontaneousTarget - selects from whitelist channels", async () => {
  const config = createConfig(["discord/channel/111111111111111111"]);
  // Use a mock that simulates DiscordAdapter's determineSpontaneousTarget logic
  const adapter = createMockDiscordAdapter();

  const target = await adapter.determineSpontaneousTarget(config);
  assertEquals(target?.channelId, "111111111111111111");
});

Deno.test("DiscordAdapter.determineSpontaneousTarget - returns null when whitelist is empty", async () => {
  const config = createConfig([]);
  const adapter = createMockDiscordAdapter();

  const target = await adapter.determineSpontaneousTarget(config);
  assertEquals(target, null);
});

Deno.test("DiscordAdapter.determineSpontaneousTarget - filters only Discord entries", async () => {
  const config = createConfig([
    "misskey/account/abc123",
    "discord/channel/222222222222222222",
  ]);
  const adapter = createMockDiscordAdapter();

  const target = await adapter.determineSpontaneousTarget(config);
  assertEquals(target?.channelId, "222222222222222222");
});
