// tests/utils/env.test.ts

import { assertEquals } from "@std/assert";
import { applyEnvOverrides, setNestedProperty } from "@utils/env.ts";

Deno.test("setNestedProperty - sets deeply nested value", () => {
  const obj: Record<string, unknown> = {};
  setNestedProperty(obj, "platforms.discord.enabled", true);
  assertEquals(
    (obj as { platforms: { discord: { enabled: boolean } } }).platforms.discord.enabled,
    true,
  );
});

Deno.test("applyEnvOverrides - DISCORD_ENABLED=true sets platforms.discord.enabled to boolean true", () => {
  Deno.env.set("DISCORD_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { enabled: false, token: "tok" }, misskey: { enabled: false } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as { discord: { enabled: boolean } };
    assertEquals(platforms.discord.enabled, true);
  } finally {
    Deno.env.delete("DISCORD_ENABLED");
  }
});

Deno.test("applyEnvOverrides - DISCORD_ENABLED=false sets platforms.discord.enabled to boolean false", () => {
  Deno.env.set("DISCORD_ENABLED", "false");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { enabled: true, token: "tok" }, misskey: { enabled: false } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as { discord: { enabled: boolean } };
    assertEquals(platforms.discord.enabled, false);
  } finally {
    Deno.env.delete("DISCORD_ENABLED");
  }
});

Deno.test("applyEnvOverrides - MISSKEY_ENABLED=true sets platforms.misskey.enabled to boolean true", () => {
  Deno.env.set("MISSKEY_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { enabled: false, token: "tok" }, misskey: { enabled: false } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as { misskey: { enabled: boolean } };
    assertEquals(platforms.misskey.enabled, true);
  } finally {
    Deno.env.delete("MISSKEY_ENABLED");
  }
});

Deno.test("applyEnvOverrides - AGENT_DEFAULT_TYPE sets agent.defaultAgentType", () => {
  Deno.env.set("AGENT_DEFAULT_TYPE", "gemini");
  try {
    const config: Record<string, unknown> = {
      agent: { defaultAgentType: "copilot" },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { defaultAgentType: string };
    assertEquals(agent.defaultAgentType, "gemini");
  } finally {
    Deno.env.delete("AGENT_DEFAULT_TYPE");
  }
});

Deno.test("applyEnvOverrides - empty env var does not override", () => {
  Deno.env.set("DISCORD_ENABLED", "");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { enabled: true, token: "tok" }, misskey: { enabled: false } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as { discord: { enabled: boolean } };
    assertEquals(platforms.discord.enabled, true);
  } finally {
    Deno.env.delete("DISCORD_ENABLED");
  }
});

Deno.test("applyEnvOverrides - REPLY_TO sets accessControl.replyTo", () => {
  Deno.env.set("REPLY_TO", "public");
  try {
    const config: Record<string, unknown> = {
      accessControl: { replyTo: "whitelist", whitelist: [] },
    };
    applyEnvOverrides(config);
    const accessControl = config.accessControl as { replyTo: string };
    assertEquals(accessControl.replyTo, "public");
  } finally {
    Deno.env.delete("REPLY_TO");
  }
});

Deno.test("applyEnvOverrides - WHITELIST parses comma-separated entries", () => {
  Deno.env.set(
    "WHITELIST",
    "discord/account/123,discord/channel/456,misskey/account/abc",
  );
  try {
    const config: Record<string, unknown> = {
      accessControl: { replyTo: "whitelist", whitelist: [] },
    };
    applyEnvOverrides(config);
    const accessControl = config.accessControl as { whitelist: string[] };
    assertEquals(accessControl.whitelist, [
      "discord/account/123",
      "discord/channel/456",
      "misskey/account/abc",
    ]);
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("applyEnvOverrides - WHITELIST trims whitespace from entries", () => {
  Deno.env.set("WHITELIST", "  discord/account/123  ,  misskey/channel/456  ");
  try {
    const config: Record<string, unknown> = {
      accessControl: { replyTo: "whitelist", whitelist: [] },
    };
    applyEnvOverrides(config);
    const accessControl = config.accessControl as { whitelist: string[] };
    assertEquals(accessControl.whitelist, [
      "discord/account/123",
      "misskey/channel/456",
    ]);
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("applyEnvOverrides - WHITELIST filters out empty entries", () => {
  Deno.env.set("WHITELIST", "discord/account/123,,misskey/channel/456,  ,");
  try {
    const config: Record<string, unknown> = {
      accessControl: { replyTo: "whitelist", whitelist: [] },
    };
    applyEnvOverrides(config);
    const accessControl = config.accessControl as { whitelist: string[] };
    assertEquals(accessControl.whitelist, [
      "discord/account/123",
      "misskey/channel/456",
    ]);
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("applyEnvOverrides - empty WHITELIST does not override", () => {
  Deno.env.set("WHITELIST", "");
  try {
    const config: Record<string, unknown> = {
      accessControl: { replyTo: "whitelist", whitelist: ["discord/account/original"] },
    };
    applyEnvOverrides(config);
    const accessControl = config.accessControl as { whitelist: string[] };
    assertEquals(accessControl.whitelist, ["discord/account/original"]);
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("applyEnvOverrides - converts float string to number", () => {
  Deno.env.set("DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY", "0.7");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { spontaneousPost: { contextFetchProbability: 0.5 } } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as {
      discord: { spontaneousPost: { contextFetchProbability: number } };
    };
    assertEquals(platforms.discord.spontaneousPost.contextFetchProbability, 0.7);
    assertEquals(typeof platforms.discord.spontaneousPost.contextFetchProbability, "number");
  } finally {
    Deno.env.delete("DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY");
  }
});

Deno.test("applyEnvOverrides - DISCORD_SPONTANEOUS_ENABLED sets nested boolean", () => {
  Deno.env.set("DISCORD_SPONTANEOUS_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      platforms: { discord: { spontaneousPost: { enabled: false } } },
    };
    applyEnvOverrides(config);
    const platforms = config.platforms as {
      discord: { spontaneousPost: { enabled: boolean } };
    };
    assertEquals(platforms.discord.spontaneousPost.enabled, true);
  } finally {
    Deno.env.delete("DISCORD_SPONTANEOUS_ENABLED");
  }
});

Deno.test("applyEnvOverrides - SELF_RESEARCH_ENABLED sets selfResearch.enabled", () => {
  Deno.env.set("SELF_RESEARCH_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      selfResearch: { enabled: false },
    };
    applyEnvOverrides(config);
    const sr = config.selfResearch as { enabled: boolean };
    assertEquals(sr.enabled, true);
  } finally {
    Deno.env.delete("SELF_RESEARCH_ENABLED");
  }
});

Deno.test("applyEnvOverrides - SELF_RESEARCH_MODEL sets selfResearch.model", () => {
  Deno.env.set("SELF_RESEARCH_MODEL", "gpt-5-mini");
  try {
    const config: Record<string, unknown> = {
      selfResearch: { model: "" },
    };
    applyEnvOverrides(config);
    const sr = config.selfResearch as { model: string };
    assertEquals(sr.model, "gpt-5-mini");
  } finally {
    Deno.env.delete("SELF_RESEARCH_MODEL");
  }
});

Deno.test("applyEnvOverrides - SELF_RESEARCH_RSS_FEEDS parses JSON array", () => {
  Deno.env.set(
    "SELF_RESEARCH_RSS_FEEDS",
    '[{"url":"https://example.com/feed.xml","name":"Test"}]',
  );
  try {
    const config: Record<string, unknown> = {
      selfResearch: { rssFeeds: [] },
    };
    applyEnvOverrides(config);
    const sr = config.selfResearch as { rssFeeds: { url: string; name: string }[] };
    assertEquals(sr.rssFeeds.length, 1);
    assertEquals(sr.rssFeeds[0].url, "https://example.com/feed.xml");
    assertEquals(sr.rssFeeds[0].name, "Test");
  } finally {
    Deno.env.delete("SELF_RESEARCH_RSS_FEEDS");
  }
});

Deno.test("applyEnvOverrides - SELF_RESEARCH_RSS_FEEDS skips invalid JSON", () => {
  Deno.env.set("SELF_RESEARCH_RSS_FEEDS", "not-json");
  try {
    const config: Record<string, unknown> = {
      selfResearch: { rssFeeds: [{ url: "original" }] },
    };
    applyEnvOverrides(config);
    const sr = config.selfResearch as { rssFeeds: { url: string }[] };
    assertEquals(sr.rssFeeds.length, 1);
    assertEquals(sr.rssFeeds[0].url, "original");
  } finally {
    Deno.env.delete("SELF_RESEARCH_RSS_FEEDS");
  }
});

Deno.test("applyEnvOverrides - SELF_RESEARCH_MIN_INTERVAL_MS sets number", () => {
  Deno.env.set("SELF_RESEARCH_MIN_INTERVAL_MS", "7200000");
  try {
    const config: Record<string, unknown> = {
      selfResearch: { minIntervalMs: 43200000 },
    };
    applyEnvOverrides(config);
    const sr = config.selfResearch as { minIntervalMs: number };
    assertEquals(sr.minIntervalMs, 7200000);
    assertEquals(typeof sr.minIntervalMs, "number");
  } finally {
    Deno.env.delete("SELF_RESEARCH_MIN_INTERVAL_MS");
  }
});

Deno.test("applyEnvOverrides - MEMORY_MAINTENANCE_ENABLED sets memoryMaintenance.enabled", () => {
  Deno.env.set("MEMORY_MAINTENANCE_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      memoryMaintenance: { enabled: false },
    };
    applyEnvOverrides(config);
    const mm = config.memoryMaintenance as { enabled: boolean };
    assertEquals(mm.enabled, true);
  } finally {
    Deno.env.delete("MEMORY_MAINTENANCE_ENABLED");
  }
});

Deno.test("applyEnvOverrides - MEMORY_MAINTENANCE_INTERVAL_MS sets number", () => {
  Deno.env.set("MEMORY_MAINTENANCE_INTERVAL_MS", "7200000");
  try {
    const config: Record<string, unknown> = {
      memoryMaintenance: { intervalMs: 604800000 },
    };
    applyEnvOverrides(config);
    const mm = config.memoryMaintenance as { intervalMs: number };
    assertEquals(mm.intervalMs, 7200000);
  } finally {
    Deno.env.delete("MEMORY_MAINTENANCE_INTERVAL_MS");
  }
});

Deno.test("applyEnvOverrides - GIT_BACKUP_ENABLED sets gitBackup.enabled", () => {
  Deno.env.set("GIT_BACKUP_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      gitBackup: { enabled: false },
    };
    applyEnvOverrides(config);
    const gb = config.gitBackup as { enabled: boolean };
    assertEquals(gb.enabled, true);
  } finally {
    Deno.env.delete("GIT_BACKUP_ENABLED");
  }
});

Deno.test("applyEnvOverrides - GIT_BACKUP_REMOTE_URL sets gitBackup.remoteUrl", () => {
  Deno.env.set("GIT_BACKUP_REMOTE_URL", "https://github.com/test/repo.git");
  try {
    const config: Record<string, unknown> = {
      gitBackup: { remoteUrl: "" },
    };
    applyEnvOverrides(config);
    const gb = config.gitBackup as { remoteUrl: string };
    assertEquals(gb.remoteUrl, "https://github.com/test/repo.git");
  } finally {
    Deno.env.delete("GIT_BACKUP_REMOTE_URL");
  }
});

Deno.test("applyEnvOverrides - GIT_BACKUP_INTERVAL_MS sets number", () => {
  Deno.env.set("GIT_BACKUP_INTERVAL_MS", "7200000");
  try {
    const config: Record<string, unknown> = {
      gitBackup: { intervalMs: 3600000 },
    };
    applyEnvOverrides(config);
    const gb = config.gitBackup as { intervalMs: number };
    assertEquals(gb.intervalMs, 7200000);
    assertEquals(typeof gb.intervalMs, "number");
  } finally {
    Deno.env.delete("GIT_BACKUP_INTERVAL_MS");
  }
});

Deno.test("applyEnvOverrides - GIT_BACKUP_AUTHOR_NAME sets string", () => {
  Deno.env.set("GIT_BACKUP_AUTHOR_NAME", "Custom Author");
  try {
    const config: Record<string, unknown> = {
      gitBackup: { authorName: "Default" },
    };
    applyEnvOverrides(config);
    const gb = config.gitBackup as { authorName: string };
    assertEquals(gb.authorName, "Custom Author");
  } finally {
    Deno.env.delete("GIT_BACKUP_AUTHOR_NAME");
  }
});

// --- Model Routing env override tests ---

Deno.test("applyEnvOverrides - MODEL_ROUTING_ENABLED sets boolean", () => {
  Deno.env.set("MODEL_ROUTING_ENABLED", "true");
  try {
    const config: Record<string, unknown> = {
      agent: { modelRouting: { enabled: false } },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { modelRouting: { enabled: boolean } };
    assertEquals(agent.modelRouting.enabled, true);
  } finally {
    Deno.env.delete("MODEL_ROUTING_ENABLED");
  }
});

Deno.test("applyEnvOverrides - MODEL_ROUTING_RULES applies JSON", () => {
  const rules = JSON.stringify([
    { match: { whitelist: "discord/account/123" }, model: "test-model" },
  ]);
  Deno.env.set("MODEL_ROUTING_RULES", rules);
  try {
    const config: Record<string, unknown> = {
      agent: { modelRouting: { enabled: true, rules: [] } },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { modelRouting: { rules: unknown[] } };
    assertEquals(agent.modelRouting.rules.length, 1);
  } finally {
    Deno.env.delete("MODEL_ROUTING_RULES");
  }
});

Deno.test("applyEnvOverrides - MODEL_ROUTING_RULES skips on invalid JSON", () => {
  Deno.env.set("MODEL_ROUTING_RULES", "not-valid-json");
  try {
    const config: Record<string, unknown> = {
      agent: { modelRouting: { enabled: true, rules: [] } },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { modelRouting: { rules: unknown[] } };
    assertEquals(agent.modelRouting.rules.length, 0);
  } finally {
    Deno.env.delete("MODEL_ROUTING_RULES");
  }
});
