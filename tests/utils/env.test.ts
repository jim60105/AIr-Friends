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
  Deno.env.set("AGENT_DEFAULT_TYPE", "opencode");
  try {
    const config: Record<string, unknown> = {
      agent: { defaultAgentType: "unset" },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { defaultAgentType: string };
    assertEquals(agent.defaultAgentType, "opencode");
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

Deno.test("applyEnvOverrides - SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION sets skills.sendFile.maxFilesPerInvocation as number", () => {
  Deno.env.set("SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION", "5");
  try {
    const config: Record<string, unknown> = {
      skills: { sendFile: { enabled: true } },
    };
    applyEnvOverrides(config);
    const sendFile = config.skills as { sendFile: { maxFilesPerInvocation: number } };
    assertEquals(sendFile.sendFile.maxFilesPerInvocation, 5);
  } finally {
    Deno.env.delete("SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION");
  }
});

Deno.test("applyEnvOverrides - SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB sets skills.sendFile.maxTotalSizeMb as number", () => {
  Deno.env.set("SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB", "100");
  try {
    const config: Record<string, unknown> = {
      skills: { sendFile: { enabled: true } },
    };
    applyEnvOverrides(config);
    const sendFile = config.skills as { sendFile: { maxTotalSizeMb: number } };
    assertEquals(sendFile.sendFile.maxTotalSizeMb, 100);
  } finally {
    Deno.env.delete("SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB");
  }
});

Deno.test("applyEnvOverrides - REPLY_TO sets accessControl.replyTo", () => {
  Deno.env.set("REPLY_TO", "public");
  try {
    const config: Record<string, unknown> = {
      replyPolicy: "channels",
      channels: [],
    };
    applyEnvOverrides(config);
    const replyPolicy = config.replyPolicy as string;
    assertEquals(replyPolicy, "public");
  } finally {
    Deno.env.delete("REPLY_TO");
  }
});

Deno.test("applyEnvOverrides - CHANNELS parses JSON entries", () => {
  Deno.env.set(
    "CHANNELS",
    '[{"id":"discord/account/12345678901234567"},{"id":"discord/channel/45678901234567890"},{"id":"misskey/account/abc"}]',
  );
  try {
    const config: Record<string, unknown> = {
      replyPolicy: "channels",
      channels: [],
    };
    applyEnvOverrides(config);
    const channels = config.channels as { id: string }[];
    assertEquals(channels.map((c) => c.id), [
      "discord/account/12345678901234567",
      "discord/channel/45678901234567890",
      "misskey/account/abc",
    ]);
  } finally {
    Deno.env.delete("CHANNELS");
  }
});

Deno.test("applyEnvOverrides - CHANNELS with invalid JSON is skipped", () => {
  Deno.env.set("CHANNELS", "not-json");
  try {
    const config: Record<string, unknown> = {
      channels: [{ id: "discord/account/11100000000000001" }],
    };
    applyEnvOverrides(config);
    const channels = config.channels as { id: string }[];
    assertEquals(channels, [{ id: "discord/account/11100000000000001" }]);
  } finally {
    Deno.env.delete("CHANNELS");
  }
});

Deno.test("applyEnvOverrides - empty CHANNELS does not override", () => {
  Deno.env.set("CHANNELS", "");
  try {
    const config: Record<string, unknown> = {
      channels: [{ id: "discord/account/11100000000000001" }],
    };
    applyEnvOverrides(config);
    const channels = config.channels as { id: string }[];
    assertEquals(channels, [{ id: "discord/account/11100000000000001" }]);
  } finally {
    Deno.env.delete("CHANNELS");
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
    { match: { whitelist: "discord/account/12345678901234567" }, model: "test-model" },
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

Deno.test("applyEnvOverrides - AGENT_MCP_SERVERS parses valid JSON", () => {
  Deno.env.set(
    "AGENT_MCP_SERVERS",
    '[{"name":"github","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}]',
  );
  try {
    const config: Record<string, unknown> = { agent: {} };
    applyEnvOverrides(config);
    const agent = config.agent as { mcpServers: unknown[] };
    assertEquals(agent.mcpServers.length, 1);
    assertEquals((agent.mcpServers[0] as { name: string }).name, "github");
  } finally {
    Deno.env.delete("AGENT_MCP_SERVERS");
  }
});

Deno.test("applyEnvOverrides - AGENT_MCP_SERVERS skips invalid JSON", () => {
  Deno.env.set("AGENT_MCP_SERVERS", "not-valid-json");
  try {
    const config: Record<string, unknown> = { agent: { mcpServers: [] } };
    applyEnvOverrides(config);
    const agent = config.agent as { mcpServers: unknown[] };
    assertEquals(agent.mcpServers.length, 0);
  } finally {
    Deno.env.delete("AGENT_MCP_SERVERS");
  }
});

Deno.test("applyEnvOverrides - AGENT_AUTO_APPROVE_SKILLS parses comma-separated list", () => {
  Deno.env.set("AGENT_AUTO_APPROVE_SKILLS", "memory-save,send-reply,agent-browser");
  try {
    const config: Record<string, unknown> = { agent: {} };
    applyEnvOverrides(config);
    const agent = config.agent as { autoApproveSkills: string[] };
    assertEquals(agent.autoApproveSkills.length, 3);
    assertEquals(agent.autoApproveSkills[0], "memory-save");
    assertEquals(agent.autoApproveSkills[1], "send-reply");
    assertEquals(agent.autoApproveSkills[2], "agent-browser");
  } finally {
    Deno.env.delete("AGENT_AUTO_APPROVE_SKILLS");
  }
});

Deno.test("applyEnvOverrides - AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS parses comma-separated list", () => {
  Deno.env.set("AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS", ".md,.txt,.json");
  try {
    const config: Record<string, unknown> = {
      agent: { sandbox: { allowedWriteExtensions: [] } },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { sandbox: { allowedWriteExtensions: string[] } };
    assertEquals(agent.sandbox.allowedWriteExtensions.length, 3);
    assertEquals(agent.sandbox.allowedWriteExtensions[0], ".md");
    assertEquals(agent.sandbox.allowedWriteExtensions[1], ".txt");
    assertEquals(agent.sandbox.allowedWriteExtensions[2], ".json");
  } finally {
    Deno.env.delete("AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS");
  }
});

Deno.test("applyEnvOverrides - AGENT_SANDBOX_EGRESS_ALLOW_HOSTS parses comma-separated list", () => {
  Deno.env.set("AGENT_SANDBOX_EGRESS_ALLOW_HOSTS", " 192.168.1.10 , internal-proxy ,, ");
  try {
    const config: Record<string, unknown> = {
      agent: { sandbox: { egressAllowHosts: [] } },
    };
    applyEnvOverrides(config);
    const agent = config.agent as { sandbox: { egressAllowHosts: string[] } };
    assertEquals(agent.sandbox.egressAllowHosts, ["192.168.1.10", "internal-proxy"]);
  } finally {
    Deno.env.delete("AGENT_SANDBOX_EGRESS_ALLOW_HOSTS");
  }
});

Deno.test("applyEnvOverrides - unset AGENT_SANDBOX_EGRESS_ALLOW_HOSTS leaves the default", () => {
  Deno.env.delete("AGENT_SANDBOX_EGRESS_ALLOW_HOSTS");
  const config: Record<string, unknown> = {
    agent: { sandbox: { egressAllowHosts: [] } },
  };
  applyEnvOverrides(config);
  const agent = config.agent as { sandbox: { egressAllowHosts: string[] } };
  assertEquals(agent.sandbox.egressAllowHosts, []);
});
