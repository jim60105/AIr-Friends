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
