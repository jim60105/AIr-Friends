// tests/core/config-loader.test.ts

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadConfig, loadSystemPrompt } from "@core/config-loader.ts";
import { ConfigError } from "../../src/types/errors.ts";

// Test with a temporary directory containing test config files
async function withTestConfig(
  configContent: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/config.yaml`, configContent);
    await fn(tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("loadConfig - should load valid configuration", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    host: "misskey.example.com"
    token: "test-token"
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.enabled, true);
    assertEquals(result.agent.model, "gpt-4");
    assertEquals(result.workspace.repoPath, "./data");
  });
});

Deno.test("loadConfig - should apply default values", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    // Default values should be applied
    assertEquals(result.memory.searchLimit, 10);
    assertEquals(result.memory.recentMessageLimit, 20);
    assertEquals(result.logging.level, "INFO");
  });
});

Deno.test("loadConfig - should override with environment variables", async () => {
  const config = `
platforms:
  discord:
    token: "original-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  // Set environment variable
  Deno.env.set("DISCORD_TOKEN", "env-override-token");

  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.token, "env-override-token");
    });
  } finally {
    Deno.env.delete("DISCORD_TOKEN");
  }
});

Deno.test("loadConfig - DISCORD_ENABLED env overrides config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: false
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  Deno.env.set("DISCORD_ENABLED", "true");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.enabled, true);
    });
  } finally {
    Deno.env.delete("DISCORD_ENABLED");
  }
});

Deno.test("loadConfig - MISSKEY_ENABLED env overrides config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: false
  misskey:
    host: "misskey.example.com"
    token: "mk-token"
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  Deno.env.set("MISSKEY_ENABLED", "true");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.misskey.enabled, true);
    });
  } finally {
    Deno.env.delete("MISSKEY_ENABLED");
  }
});

Deno.test("loadConfig - AGENT_DEFAULT_TYPE env overrides config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
  defaultAgentType: "copilot"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  Deno.env.set("AGENT_DEFAULT_TYPE", "opencode");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.defaultAgentType, "opencode");
    });
  } finally {
    Deno.env.delete("AGENT_DEFAULT_TYPE");
  }
});

Deno.test("loadConfig - should throw on missing required fields", async () => {
  const config = `
platforms:
  discord:
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
`;

  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "Missing required configuration fields",
    );
  });
});

Deno.test("loadConfig - should throw when no platform is enabled", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: false
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "At least one platform must be enabled",
    );
  });
});

// --- loadSystemPrompt tests ---

async function withPromptDir(
  files: Record<string, string>,
  fn: (systemPromptPath: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const promptDir = `${tempDir}/prompts`;
    await Deno.mkdir(promptDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await Deno.writeTextFile(`${promptDir}/${name}`, content);
    }
    await fn(`${promptDir}/system.md`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("loadSystemPrompt - should replace single placeholder with fragment file content", async () => {
  await withPromptDir(
    {
      "system.md": "Hello, I am {{character_name}}!",
      "character_name.md": "Yuna",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "Hello, I am Yuna!");
    },
  );
});

Deno.test("loadSystemPrompt - should replace multiple different placeholders", async () => {
  await withPromptDir(
    {
      "system.md": "Name: {{char_name}}, Info: {{char_info}}",
      "char_name.md": "Yuna",
      "char_info.md": "An AI assistant",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "Name: Yuna, Info: An AI assistant");
    },
  );
});

Deno.test("loadSystemPrompt - should replace same placeholder appearing multiple times", async () => {
  await withPromptDir(
    {
      "system.md": "I am {{name}}. Call me {{name}}.",
      "name.md": "Yuna",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "I am Yuna. Call me Yuna.");
    },
  );
});

Deno.test("loadSystemPrompt - should leave placeholder unchanged when fragment file is missing", async () => {
  await withPromptDir(
    {
      "system.md": "Hello {{missing_fragment}}!",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertStringIncludes(result, "{{missing_fragment}}");
    },
  );
});

Deno.test("loadSystemPrompt - should not use system.md as a fragment source", async () => {
  await withPromptDir(
    {
      "system.md": "Hello {{system}}!",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      // {{system}} should remain because system.md is excluded
      assertStringIncludes(result, "{{system}}");
    },
  );
});

Deno.test("loadSystemPrompt - should trim fragment content", async () => {
  await withPromptDir(
    {
      "system.md": "Name: {{char_name}}.",
      "char_name.md": "  Yuna  \n",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "Name: Yuna.");
    },
  );
});

Deno.test("loadSystemPrompt - should trim final result", async () => {
  await withPromptDir(
    {
      "system.md": "\n  Hello World  \n",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "Hello World");
    },
  );
});

Deno.test("loadSystemPrompt - should throw when system prompt file not found", async () => {
  await assertRejects(
    () => loadSystemPrompt("/nonexistent/path/system.md"),
    ConfigError,
    "System prompt file not found",
  );
});

Deno.test("loadSystemPrompt - should handle prompt with no placeholders", async () => {
  await withPromptDir(
    {
      "system.md": "A plain prompt with no placeholders.",
      "unused.md": "This should not matter.",
    },
    async (path) => {
      const result = await loadSystemPrompt(path);
      assertEquals(result, "A plain prompt with no placeholders.");
    },
  );
});

// --- accessControl configuration tests ---

Deno.test("loadConfig - should apply default accessControl values", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.accessControl.replyTo, "whitelist");
    assertEquals(result.accessControl.whitelist, []);
  });
});

Deno.test("loadConfig - should load valid accessControl configuration", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "public"
  whitelist:
    - "discord/account/123456789012345678"
    - "misskey/channel/abcdef1234567890"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.accessControl.replyTo, "public");
    assertEquals(result.accessControl.whitelist, [
      "discord/account/123456789012345678",
      "misskey/channel/abcdef1234567890",
    ]);
  });
});

Deno.test("loadConfig - REPLY_TO env overrides config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist: []
`;

  Deno.env.set("REPLY_TO", "all");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.accessControl.replyTo, "all");
    });
  } finally {
    Deno.env.delete("REPLY_TO");
  }
});

Deno.test("loadConfig - WHITELIST env overrides config file with comma-separated values", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/111111111111111111"
`;

  Deno.env.set(
    "WHITELIST",
    "discord/account/123456789012345678,discord/channel/987654321098765432,misskey/account/abcdef1234567890",
  );
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.accessControl.whitelist, [
        "discord/account/123456789012345678",
        "discord/channel/987654321098765432",
        "misskey/account/abcdef1234567890",
      ]);
    });
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("loadConfig - WHITELIST env trims whitespace from entries", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist: []
`;

  Deno.env.set("WHITELIST", "  discord/account/123  ,  misskey/channel/456  ");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.accessControl.whitelist, [
        "discord/account/123",
        "misskey/channel/456",
      ]);
    });
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("loadConfig - empty WHITELIST env does not override config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789012345678"
`;

  Deno.env.set("WHITELIST", "");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.accessControl.whitelist, [
        "discord/account/123456789012345678",
      ]);
    });
  } finally {
    Deno.env.delete("WHITELIST");
  }
});

Deno.test("loadConfig - should throw on invalid replyTo value", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "invalid-value"
  whitelist: []
`;

  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      'Invalid accessControl.replyTo value: "invalid-value"',
    );
  });
});

Deno.test("loadConfig - should filter invalid whitelist entries and warn", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789012345678"
    - "invalid-format"
    - "misskey/channel/abc123"
    - "twitter/account/123"
    - ""
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    // Only valid entries should be kept
    assertEquals(result.accessControl.whitelist, [
      "discord/account/123456789012345678",
      "misskey/channel/abc123",
    ]);
  });
});

Deno.test("loadConfig - should accept all valid whitelist entry formats", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789012345678"
    - "discord/channel/987654321098765432"
    - "misskey/account/abcdef1234567890"
    - "misskey/channel/xyz9876543210"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.accessControl.whitelist.length, 4);
    assertEquals(result.accessControl.whitelist, [
      "discord/account/123456789012345678",
      "discord/channel/987654321098765432",
      "misskey/account/abcdef1234567890",
      "misskey/channel/xyz9876543210",
    ]);
  });
});

// --- spontaneousPost configuration tests ---

Deno.test("Config - spontaneousPost default values are applied", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.enabled, false);
    assertEquals(result.platforms.discord.spontaneousPost?.minIntervalMs, 10800000);
    assertEquals(result.platforms.discord.spontaneousPost?.maxIntervalMs, 43200000);
    assertEquals(result.platforms.discord.spontaneousPost?.contextFetchProbability, 0.5);
  });
});

Deno.test("Config - spontaneousPost.enabled can be set via env var", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  Deno.env.set("DISCORD_SPONTANEOUS_ENABLED", "true");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.spontaneousPost?.enabled, true);
    });
  } finally {
    Deno.env.delete("DISCORD_SPONTANEOUS_ENABLED");
  }
});

Deno.test("Config - spontaneousPost validation swaps min/max interval when reversed", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    spontaneousPost:
      enabled: true
      minIntervalMs: 50000000
      maxIntervalMs: 10000000
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.minIntervalMs, 10000000);
    assertEquals(result.platforms.discord.spontaneousPost?.maxIntervalMs, 50000000);
  });
});

Deno.test("Config - spontaneousPost validation clamps minIntervalMs to 60 seconds", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    spontaneousPost:
      enabled: true
      minIntervalMs: 1000
      maxIntervalMs: 100000
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.minIntervalMs, 60000);
  });
});

Deno.test("Config - spontaneousPost validation clamps contextFetchProbability to [0, 1]", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    spontaneousPost:
      enabled: true
      contextFetchProbability: 1.5
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.contextFetchProbability, 1.0);
  });
});

Deno.test("Config - spontaneousPost validation clamps negative contextFetchProbability to 0", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    spontaneousPost:
      enabled: true
      contextFetchProbability: -0.5
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.contextFetchProbability, 0);
  });
});

Deno.test("Config - spontaneousPost merges partial config with defaults", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    spontaneousPost:
      enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.platforms.discord.spontaneousPost?.enabled, true);
    // Defaults should be filled in
    assertEquals(result.platforms.discord.spontaneousPost?.minIntervalMs, 10800000);
    assertEquals(result.platforms.discord.spontaneousPost?.maxIntervalMs, 43200000);
    assertEquals(result.platforms.discord.spontaneousPost?.contextFetchProbability, 0.5);
  });
});

// --- selfResearch configuration tests ---

Deno.test("Config - selfResearch default values are applied", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, false);
    assertEquals(result.selfResearch?.model, "");
    assertEquals(result.selfResearch?.rssFeeds, []);
    assertEquals(result.selfResearch?.minIntervalMs, 43200000);
    assertEquals(result.selfResearch?.maxIntervalMs, 86400000);
  });
});

Deno.test("Config - selfResearch enabled with valid config", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: true
  model: "gpt-5-mini"
  rssFeeds:
    - url: "https://example.com/feed.xml"
      name: "Test Feed"
  minIntervalMs: 43200000
  maxIntervalMs: 86400000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, true);
    assertEquals(result.selfResearch?.model, "gpt-5-mini");
    assertEquals(result.selfResearch?.rssFeeds.length, 1);
  });
});

Deno.test("Config - selfResearch auto-disables when rssFeeds is empty", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: true
  model: "gpt-5-mini"
  rssFeeds: []
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, false);
  });
});

Deno.test("Config - selfResearch auto-disables when model is empty", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: true
  model: ""
  rssFeeds:
    - url: "https://example.com/feed.xml"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, false);
  });
});

Deno.test("Config - selfResearch clamps minIntervalMs to 1 hour", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: false
  model: "gpt-5-mini"
  rssFeeds: []
  minIntervalMs: 1000
  maxIntervalMs: 86400000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.minIntervalMs, 3600000);
  });
});

Deno.test("Config - selfResearch swaps min/max interval when reversed", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: false
  model: "gpt-5-mini"
  rssFeeds: []
  minIntervalMs: 86400000
  maxIntervalMs: 43200000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.minIntervalMs, 43200000);
    assertEquals(result.selfResearch?.maxIntervalMs, 86400000);
  });
});

Deno.test("Config - selfResearch merges partial config with defaults", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: false
  model: "gpt-5-mini"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, false);
    assertEquals(result.selfResearch?.model, "gpt-5-mini");
    assertEquals(result.selfResearch?.rssFeeds, []);
    assertEquals(result.selfResearch?.minIntervalMs, 43200000);
    assertEquals(result.selfResearch?.maxIntervalMs, 86400000);
  });
});

Deno.test("Config - selfResearch filters out empty url feeds", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
selfResearch:
  enabled: true
  model: "gpt-5-mini"
  rssFeeds:
    - url: "https://example.com/feed.xml"
    - url: ""
    - url: "https://example.org/rss"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.selfResearch?.enabled, true);
    assertEquals(result.selfResearch?.rssFeeds.length, 2);
  });
});

// --- memoryMaintenance configuration tests ---

Deno.test("Config - applies memoryMaintenance defaults", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memoryMaintenance?.enabled, false);
    assertEquals(result.memoryMaintenance?.model, "gpt-5-mini");
    assertEquals(result.memoryMaintenance?.minMemoryCount, 50);
    assertEquals(result.memoryMaintenance?.intervalMs, 604800000);
  });
});

Deno.test("Config - clamps memoryMaintenance intervalMs minimum to 1 hour", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
memoryMaintenance:
  enabled: false
  model: "gpt-5-mini"
  minMemoryCount: 50
  intervalMs: 1000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memoryMaintenance?.intervalMs, 3600000);
  });
});

Deno.test("Config - clamps memoryMaintenance minMemoryCount minimum to 10", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
memoryMaintenance:
  enabled: false
  model: "gpt-5-mini"
  minMemoryCount: 1
  intervalMs: 604800000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memoryMaintenance?.minMemoryCount, 10);
  });
});

Deno.test("Config - memoryMaintenance disables if model is missing", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
memoryMaintenance:
  enabled: true
  model: ""
  minMemoryCount: 50
  intervalMs: 604800000
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memoryMaintenance?.enabled, false);
  });
});

Deno.test("Config - metrics defaults when not specified", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.metrics?.enabled, false);
    assertEquals(result.metrics?.path, "/metrics");
  });
});

Deno.test("Config - metrics respects user values", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
metrics:
  enabled: true
  path: "/custom"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.metrics?.enabled, true);
    assertEquals(result.metrics?.path, "/custom");
  });
});
