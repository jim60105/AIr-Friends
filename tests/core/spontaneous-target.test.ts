// tests/core/spontaneous-target.test.ts

import { assertEquals } from "@std/assert";
import type { Config } from "../../src/types/config.ts";
import { MockPlatformAdapter } from "../mocks/mock-platform-adapter.ts";
import { extractDiscordChannelIds } from "@platforms/discord/index.ts";

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

Deno.test("MockPlatformAdapter.determineSpontaneousTarget - returns mock channel", async () => {
  const adapter = new MockPlatformAdapter();
  const config = createConfig([]);
  const target = await adapter.determineSpontaneousTarget(config);
  assertEquals(target?.channelId, "mock-channel");
});

Deno.test("PlatformAdapter.getSearchGuildId - default returns empty string", () => {
  const adapter = new MockPlatformAdapter();
  assertEquals(adapter.getSearchGuildId("channel123", false), "");
  assertEquals(adapter.getSearchGuildId("channel123", true), "");
});

Deno.test("extractDiscordChannelIds - filters discord channel entries", () => {
  const whitelist = [
    "discord/channel/11100000000000000",
    "discord/account/22200000000000000",
    "misskey/channel/333",
    "discord/channel/44400000000000000",
  ];
  const result = extractDiscordChannelIds(whitelist);
  assertEquals(result, ["11100000000000000", "44400000000000000"]);
});

Deno.test("extractDiscordChannelIds - returns empty for no matches", () => {
  const result = extractDiscordChannelIds([
    "discord/account/12345678901234567",
    "misskey/account/456",
  ]);
  assertEquals(result, []);
});
