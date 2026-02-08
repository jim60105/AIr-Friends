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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
  tokenLimit: 4096
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
