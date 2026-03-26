// tests/core/config-loader.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig, loadSystemPrompt } from "@core/config-loader.ts";
import { ConfigError } from "../../src/types/errors.ts";
import type { TemplateVariables } from "../../src/types/template.ts";

const defaultVars: TemplateVariables = {
  isDm: false,
  platform: "discord",
  userId: "user123",
  channelId: "channel456",
  guildId: "guild789",
};

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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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

Deno.test("loadConfig - AGENT_SKILLS_DIR env overrides config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  skillsDir: "custom-skills"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  Deno.env.set("AGENT_SKILLS_DIR", "/home/deno/.agents/skills");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.skillsDir, "/home/deno/.agents/skills");
    });
  } finally {
    Deno.env.delete("AGENT_SKILLS_DIR");
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
  systemPromptPath: "./prompts/system_reply.md"
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
    await fn(`${promptDir}/system_reply.md`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("loadSystemPrompt - should include fragment file content via Vento include", async () => {
  await withPromptDir(
    {
      "system_reply.md":
        '{{- set charName }}{{ include "./character_name.md" }}{{ /set -}}\nHello, I am {{ charName }}!',
      "character_name.md": "Yuna",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
      assertEquals(result, "Hello, I am Yuna!");
    },
  );
});

Deno.test("loadSystemPrompt - should include multiple different fragments", async () => {
  await withPromptDir(
    {
      "system_reply.md":
        '{{- set charName }}{{ include "./char_name.md" }}{{ /set -}}\n{{- set charInfo }}{{ include "./char_info.md" }}{{ /set -}}\nName: {{ charName }}, Info: {{ charInfo }}',
      "char_name.md": "Yuna",
      "char_info.md": "An AI assistant",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
      assertEquals(result, "Name: Yuna, Info: An AI assistant");
    },
  );
});

Deno.test("loadSystemPrompt - should reuse set variable appearing multiple times", async () => {
  await withPromptDir(
    {
      "system_reply.md":
        '{{- set name }}{{ include "./name.md" }}{{ /set -}}\nI am {{ name }}. Call me {{ name }}.',
      "name.md": "Yuna",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
      assertEquals(result, "I am Yuna. Call me Yuna.");
    },
  );
});

Deno.test("loadSystemPrompt - should throw error when included file is missing", async () => {
  await withPromptDir(
    {
      "system_reply.md": '{{ include "./missing_fragment.md" }}',
    },
    async (path) => {
      await assertRejects(
        () => loadSystemPrompt(path, defaultVars),
        Error,
      );
    },
  );
});

Deno.test("loadSystemPrompt - include uses explicit file paths", async () => {
  await withPromptDir(
    {
      "system_reply.md": '{{ include "./character_name.md" }}',
      "character_name.md": "Yuna",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
      assertEquals(result, "Yuna");
    },
  );
});

Deno.test("loadSystemPrompt - should trim final result", async () => {
  await withPromptDir(
    {
      "system_reply.md": "\n  Hello World  \n",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
      assertEquals(result, "Hello World");
    },
  );
});

Deno.test("loadSystemPrompt - should throw when system prompt file not found", async () => {
  await assertRejects(
    () => loadSystemPrompt("/nonexistent/path/system_reply.md", defaultVars),
    ConfigError,
    "System prompt file not found",
  );
});

Deno.test("loadSystemPrompt - should handle prompt with no placeholders", async () => {
  await withPromptDir(
    {
      "system_reply.md": "A plain prompt with no placeholders.",
      "unused.md": "This should not matter.",
    },
    async (path) => {
      const result = await loadSystemPrompt(path, defaultVars);
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.replyPolicy, "channels");
    assertEquals(result.channels, []);
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "public"
channels:
  - id: "discord/account/123456789012345678"
  - id: "misskey/channel/abcdef1234567890"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.replyPolicy, "public");
    assertEquals(result.channels.map((c) => c.id), [
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels: []
`;

  Deno.env.set("REPLY_TO", "all");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.replyPolicy, "all");
    });
  } finally {
    Deno.env.delete("REPLY_TO");
  }
});

Deno.test("loadConfig - CHANNELS env overrides config file with JSON values", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/111111111111111111"
`;

  Deno.env.set(
    "CHANNELS",
    '[{"id":"discord/account/123456789012345678"},{"id":"discord/channel/987654321098765432"},{"id":"misskey/account/abcdef1234567890"}]',
  );
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.channels.map((c) => c.id), [
        "discord/account/123456789012345678",
        "discord/channel/987654321098765432",
        "misskey/account/abcdef1234567890",
      ]);
    });
  } finally {
    Deno.env.delete("CHANNELS");
  }
});

Deno.test("loadConfig - CHANNELS env trims whitespace handled via JSON", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels: []
`;

  Deno.env.set(
    "CHANNELS",
    '[{"id":"discord/account/12345678901234567"},{"id":"misskey/channel/456"}]',
  );
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.channels.map((c) => c.id), [
        "discord/account/12345678901234567",
        "misskey/channel/456",
      ]);
    });
  } finally {
    Deno.env.delete("CHANNELS");
  }
});

Deno.test("loadConfig - empty CHANNELS env does not override config file", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/123456789012345678"
`;

  Deno.env.set("CHANNELS", "");
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.channels.map((c) => c.id), [
        "discord/account/123456789012345678",
      ]);
    });
  } finally {
    Deno.env.delete("CHANNELS");
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "invalid-value"
channels: []
`;

  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      'Invalid replyPolicy value: "invalid-value"',
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/123456789012345678"
    - id: "invalid-format"
    - id: "misskey/channel/abc123"
    - id: "twitter/account/123"
    - ""
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    // Only valid entries should be kept
    assertEquals(result.channels.map((c) => c.id), [
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/123456789012345678"
    - id: "discord/channel/987654321098765432"
    - id: "misskey/account/abcdef1234567890"
    - id: "misskey/channel/xyz9876543210"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels.length, 4);
    assertEquals(result.channels.map((c) => c.id).length, 4);
    assertEquals(result.channels.map((c) => c.id), [
      "discord/account/123456789012345678",
      "discord/channel/987654321098765432",
      "misskey/account/abcdef1234567890",
      "misskey/channel/xyz9876543210",
    ]);
  });
});

Deno.test("loadConfig - should reject Discord whitelist entries with non-numeric IDs", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/abcdef1234567890"
    - id: "discord/channel/not-a-snowflake"
    - id: "discord/account/123456789012345678"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels.map((c) => c.id), [
      "discord/account/123456789012345678",
    ]);
  });
});

Deno.test("loadConfig - should reject Discord IDs that are too short or too long", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "discord/account/1234567890123456"
    - id: "discord/account/123456789012345678901"
    - id: "discord/account/12345678901234567"
    - id: "discord/account/12345678901234567890"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels.map((c) => c.id), [
      "discord/account/12345678901234567",
      "discord/account/12345678901234567890",
    ]);
  });
});

Deno.test("loadConfig - should still accept Misskey IDs with various formats", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
replyPolicy: "channels"
channels:
    - id: "misskey/account/abcdef1234"
    - id: "misskey/account/abcdef1234567890ab"
    - id: "misskey/channel/0123456789abcdef01234567"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels.length, 3);
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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
  systemPromptPath: "./prompts/system_reply.md"
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

// --- gitBackup configuration tests ---

Deno.test("Config - applies gitBackup defaults when not specified", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.gitBackup?.enabled, false);
    assertEquals(result.gitBackup?.remoteUrl, "");
    assertEquals(result.gitBackup?.intervalMs, 3600000);
    assertEquals(result.gitBackup?.authorName, "AIr-Friends Backup");
    assertEquals(result.gitBackup?.authorEmail, "airfriends-backup@noreply.github.com");
  });
});

Deno.test("Config - merges partial gitBackup config with defaults", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
gitBackup:
  enabled: true
  remoteUrl: "https://github.com/test/repo.git"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.gitBackup?.enabled, true);
    assertEquals(result.gitBackup?.remoteUrl, "https://github.com/test/repo.git");
    assertEquals(result.gitBackup?.intervalMs, 3600000);
    assertEquals(result.gitBackup?.authorName, "AIr-Friends Backup");
  });
});

// --- Model Routing validation tests ---

Deno.test("loadConfig - should set default modelRouting when not configured", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.enabled, false);
    assertEquals(result.agent.modelRouting?.rules, []);
  });
});

Deno.test("loadConfig - should skip invalid model routing rules (missing match)", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - model: "some-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

Deno.test("loadConfig - should skip invalid model routing rules (empty model string)", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { sessionType: "message" }
        model: ""
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

Deno.test("loadConfig - should skip rules with invalid whitelist format", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { channel: "invalid-format" }
        model: "some-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

Deno.test("loadConfig - should skip rules with invalid sessionType", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { sessionType: "invalid-type" }
        model: "some-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

Deno.test("loadConfig - should accept rules with multiple match conditions (AND)", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { channel: "discord/account/12345678901234567", sessionType: "message" }
        model: "some-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 1);
    assertEquals(result.agent.modelRouting?.rules[0].model, "some-model");
  });
});

Deno.test("loadConfig - should preserve valid rules and discard invalid ones", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { channel: "discord/account/12345678901234567" }
        model: "valid-model"
      - match: { channel: "invalid-format" }
        model: "bad-model"
      - match: { sessionType: "spontaneous" }
        model: "spontaneous-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 2);
    assertEquals(result.agent.modelRouting?.rules[0].model, "valid-model");
    assertEquals(result.agent.modelRouting?.rules[1].model, "spontaneous-model");
  });
});

Deno.test("loadConfig - should validate contentKeywords as array", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: { contentKeywords: "not-an-array" }
        model: "bad-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

Deno.test("loadConfig - should filter empty contentKeywords entries", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match:
          contentKeywords: ["研究", "", "research"]
        model: "research-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 1);
    assertEquals(result.agent.modelRouting?.rules[0].match.contentKeywords, ["研究", "research"]);
  });
});

Deno.test("loadConfig - should accept rule with whitelist + contentKeywords", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match:
          channel: "discord/account/12345678901234567"
          contentKeywords: ["研究", "research"]
        model: "combo-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 1);
    assertEquals(result.agent.modelRouting?.rules[0].model, "combo-model");
    assertEquals(
      result.agent.modelRouting?.rules[0].match.channel,
      "discord/account/12345678901234567",
    );
    assertEquals(result.agent.modelRouting?.rules[0].match.contentKeywords, ["研究", "research"]);
  });
});

Deno.test("loadConfig - should skip rule with empty match object", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  modelRouting:
    enabled: true
    rules:
      - match: {}
        model: "empty-model"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.modelRouting?.rules.length, 0);
  });
});

// --- MCP Server config validation tests ---

import { convertUserMCPServerConfigs } from "@core/config-loader.ts";

const baseMCPConfig = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    host: "misskey.example.com"
    token: "test-token"
    enabled: false
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

function mcpAgentConfig(mcpServersYaml: string): string {
  return baseMCPConfig + `
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
${mcpServersYaml}
`;
}

Deno.test("config-loader - mcpServers", async (t) => {
  await t.step("valid stdio server is loaded", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "test-server"
      command: "echo"
      args: ["hello"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 1);
      assertEquals(result.agent.mcpServers![0].name, "test-server");
      assertEquals(result.agent.mcpServers![0].command, "echo");
      assertEquals(result.agent.mcpServers![0].args, ["hello"]);
    });
  });

  await t.step("valid http server is loaded", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "http-server"
      transport: "http"
      url: "http://localhost:3002/mcp"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 1);
      assertEquals(result.agent.mcpServers![0].name, "http-server");
      assertEquals(result.agent.mcpServers![0].transport, "http");
      assertEquals(result.agent.mcpServers![0].url, "http://localhost:3002/mcp");
    });
  });

  await t.step("server with missing name is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - command: "echo"
      args: ["hello"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  await t.step("server with duplicate name is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "dup"
      command: "echo"
      args: ["first"]
    - name: "dup"
      command: "echo"
      args: ["second"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 1);
      assertEquals(result.agent.mcpServers![0].args, ["first"]);
    });
  });

  await t.step("stdio server with missing command is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "no-cmd"
      args: ["hello"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  await t.step("http server with missing url is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "no-url"
      transport: "http"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  await t.step("unknown transport is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "bad-transport"
      transport: "grpc"
      url: "http://example.com"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  await t.step("${ENV_VAR} in env values is expanded", async () => {
    Deno.env.set("TEST_MCP_TOKEN", "secret123");
    try {
      const config = mcpAgentConfig(`  mcpServers:
    - name: "env-test"
      command: "echo"
      env:
        MY_TOKEN: "\${TEST_MCP_TOKEN}"`);
      await withTestConfig(config, async (dir) => {
        const result = await loadConfig(dir);
        assertEquals(result.agent.mcpServers?.length, 1);
        assertEquals(result.agent.mcpServers![0].env!["MY_TOKEN"], "secret123");
      });
    } finally {
      Deno.env.delete("TEST_MCP_TOKEN");
    }
  });

  await t.step("${ENV_VAR} in url is expanded", async () => {
    Deno.env.set("TEST_MCP_HOST", "myhost.example.com");
    try {
      const config = mcpAgentConfig(`  mcpServers:
    - name: "url-test"
      transport: "http"
      url: "http://\${TEST_MCP_HOST}:3002/mcp"`);
      await withTestConfig(config, async (dir) => {
        const result = await loadConfig(dir);
        assertEquals(result.agent.mcpServers?.length, 1);
        assertEquals(result.agent.mcpServers![0].url, "http://myhost.example.com:3002/mcp");
      });
    } finally {
      Deno.env.delete("TEST_MCP_HOST");
    }
  });

  await t.step("${ENV_VAR} in headers is expanded", async () => {
    Deno.env.set("TEST_MCP_BEARER", "bearer-token");
    try {
      const config = mcpAgentConfig(`  mcpServers:
    - name: "header-test"
      transport: "http"
      url: "http://localhost:3002/mcp"
      headers:
        Authorization: "Bearer \${TEST_MCP_BEARER}"`);
      await withTestConfig(config, async (dir) => {
        const result = await loadConfig(dir);
        assertEquals(result.agent.mcpServers?.length, 1);
        assertEquals(
          result.agent.mcpServers![0].headers!["Authorization"],
          "Bearer bearer-token",
        );
      });
    } finally {
      Deno.env.delete("TEST_MCP_BEARER");
    }
  });

  await t.step("unset ${ENV_VAR} expands to empty string", async () => {
    Deno.env.delete("NONEXISTENT_MCP_VAR_12345");
    const config = mcpAgentConfig(`  mcpServers:
    - name: "unset-test"
      command: "echo"
      env:
        MISSING: "\${NONEXISTENT_MCP_VAR_12345}"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 1);
      assertEquals(result.agent.mcpServers![0].env!["MISSING"], "");
    });
  });

  await t.step("empty mcpServers array is valid", async () => {
    const config = mcpAgentConfig("  mcpServers: []");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  await t.step("missing mcpServers field is valid", async () => {
    const config = mcpAgentConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers, undefined);
    });
  });
});

Deno.test("loadConfig - externalSkills validation", async (t) => {
  const baseConfig = (extra: string) => `
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 4096
${extra}
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await t.step("valid externalSkills are preserved", async () => {
    const config = baseConfig(`  externalSkills:
    - repo: "jim60105/copilot-prompt"
      skill: "create-blog-post"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.externalSkills?.length, 1);
      assertEquals(result.agent.externalSkills![0].repo, "jim60105/copilot-prompt");
      assertEquals(result.agent.externalSkills![0].skill, "create-blog-post");
    });
  });

  await t.step("invalid externalSkills entries are filtered out", async () => {
    const config = baseConfig(`  externalSkills:
    - repo: ""
      skill: "create-blog-post"
    - repo: "valid/repo"
      skill: ""`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.externalSkills?.length, 0);
    });
  });

  await t.step("missing externalSkills defaults to empty array", async () => {
    const config = baseConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.externalSkills?.length, 0);
    });
  });
});

Deno.test("loadConfig - autoApproveSkills validation", async (t) => {
  const baseConfig = (extra: string) => `
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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 4096
${extra}
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await t.step("valid autoApproveSkills are preserved", async () => {
    const config = baseConfig(`  autoApproveSkills:
    - "memory-save"
    - "send-reply"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills?.length, 2);
      assertEquals(result.agent.autoApproveSkills![0], "memory-save");
      assertEquals(result.agent.autoApproveSkills![1], "send-reply");
    });
  });

  await t.step("empty strings are filtered out", async () => {
    const config = baseConfig(`  autoApproveSkills:
    - "memory-save"
    - ""
    - "  "`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills?.length, 1);
      assertEquals(result.agent.autoApproveSkills![0], "memory-save");
    });
  });

  await t.step("missing autoApproveSkills is undefined", async () => {
    const config = baseConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills, undefined);
    });
  });

  await t.step("empty array results in undefined", async () => {
    const config = baseConfig("  autoApproveSkills: []");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills, undefined);
    });
  });
});

Deno.test("convertUserMCPServerConfigs", async (t) => {
  await t.step("converts stdio config correctly", () => {
    const result = convertUserMCPServerConfigs([{
      name: "stdio-test",
      command: "/usr/bin/echo",
      args: ["hello"],
      env: { KEY: "val" },
    }]);
    assertEquals(result.length, 1);
    assertEquals("type" in result[0], false);
    assertEquals((result[0] as { command: string }).command, "/usr/bin/echo");
    assertEquals((result[0] as { args: string[] }).args, ["hello"]);
    assertEquals(
      (result[0] as { env: { name: string; value: string }[] }).env,
      [{ name: "KEY", value: "val" }],
    );
  });

  await t.step("converts http config correctly", () => {
    const result = convertUserMCPServerConfigs([{
      name: "http-test",
      transport: "http",
      url: "http://localhost:3002/mcp",
      headers: { Authorization: "Bearer token" },
    }]);
    assertEquals(result.length, 1);
    assertEquals((result[0] as { type: string }).type, "http");
    assertEquals((result[0] as { url: string }).url, "http://localhost:3002/mcp");
    assertEquals(
      (result[0] as { headers: { name: string; value: string }[] }).headers,
      [{ name: "Authorization", value: "Bearer token" }],
    );
  });

  await t.step("converts sse config correctly", () => {
    const result = convertUserMCPServerConfigs([{
      name: "sse-test",
      transport: "sse",
      url: "https://events.example.com/mcp",
    }]);
    assertEquals(result.length, 1);
    assertEquals((result[0] as { type: string }).type, "sse");
    assertEquals((result[0] as { url: string }).url, "https://events.example.com/mcp");
  });

  await t.step("handles missing optional fields", () => {
    const result = convertUserMCPServerConfigs([{
      name: "minimal-stdio",
      command: "echo",
    }]);
    assertEquals(result.length, 1);
    assertEquals((result[0] as { args: string[] }).args, []);
    assertEquals((result[0] as { env?: unknown }).env, undefined);
  });

  await t.step("default transport is stdio", () => {
    const result = convertUserMCPServerConfigs([{
      name: "no-transport",
      command: "echo",
      args: [],
    }]);
    assertEquals(result.length, 1);
    assertEquals("type" in result[0], false);
    assertEquals((result[0] as { command: string }).command, "echo");
  });
});

// --- yolo field in channels tests ---

Deno.test("loadChannels - preserves yolo field from object format", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
channels:
  - id: "discord/account/123456789012345678"
    enabled: true
    yolo: true
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels[0].yolo, true);
  });
});

Deno.test("loadChannels - yolo defaults to false when not specified", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
channels:
  - id: "discord/account/123456789012345678"
    enabled: true
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels[0].yolo, false);
  });
});

// --- allowedWriteExtensions sandbox config tests ---

Deno.test("loadConfig - default sandbox includes allowedWriteExtensions [.md, .txt]", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.allowedWriteExtensions, [".md", ".txt"]);
  });
});

Deno.test("loadConfig - custom allowedWriteExtensions from config is preserved", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  sandbox:
    allowedWriteExtensions:
      - ".json"
      - ".yaml"
      - ".csv"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.allowedWriteExtensions, [".json", ".yaml", ".csv"]);
  });
});

Deno.test("loadConfig - invalid allowedWriteExtensions entries (non-dot-prefixed) are filtered out", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  sandbox:
    allowedWriteExtensions:
      - ".md"
      - "txt"
      - ".json"
      - "no-dot"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.allowedWriteExtensions, [".md", ".json"]);
  });
});

Deno.test("loadConfig - non-array allowedWriteExtensions is replaced with default", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  sandbox:
    allowedWriteExtensions: "not-an-array"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.allowedWriteExtensions, [".md", ".txt"]);
  });
});

Deno.test("loadConfig - default gitCredential config is applied", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.gitCredential?.enabled, false);
    assertEquals(result.agent.gitCredential?.host, undefined);
  });
});

Deno.test("loadConfig - gitCredential config merges with defaults", async () => {
  const config = `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
  gitCredential:
    enabled: true
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.gitCredential?.enabled, true);
    assertEquals(result.agent.gitCredential?.host, undefined);
  });
});
