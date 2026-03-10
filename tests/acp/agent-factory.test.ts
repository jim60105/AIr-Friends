// tests/acp/agent-factory.test.ts

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import {
  createAgentConfig,
  getDefaultAgentType,
  getRetryPromptStrategy,
  getSessionModeOverride,
} from "@acp/agent-factory.ts";
import type { Config } from "../../src/types/config.ts";

// Create a minimal test config
const createTestConfig = (overrides: Partial<Config> = {}): Config => {
  return {
    platforms: {
      discord: {
        enabled: false,
        token: "",
      },
      misskey: {
        enabled: false,
        host: "",
        token: "",
      },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      githubToken: "test-github-token",
      geminiApiKey: "test-gemini-key",
      ...overrides.agent,
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
    },
    workspace: {
      repoPath: "/tmp/test",
      workspacesDir: "workspaces",
    },
    logging: {
      level: "INFO",
    },
    replyPolicy: "channels",
    channels: [],
    ...overrides,

    ...overrides,
  };
};

Deno.test("createAgentConfig - creates copilot config correctly", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "copilot");
  assertEquals(agentConfig.args, [
    "--disable-builtin-mcps",
    "--no-ask-user",
    "--no-color",
    "--no-auto-update",
    "--experimental",
    "--acp",
    "--available-tools",
    "write_bash",
    "--available-tools",
    "read_bash",
    "--available-tools",
    "stop_bash",
    "--available-tools",
    "bash",
    "--deny-tool",
    "shell(git:*)",
    "--deny-tool",
    "shell(echo:*)",
    "--deny-tool",
    "shell(mkdir:*)",
  ]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.GITHUB_TOKEN, "test-github-token");
});

Deno.test("createAgentConfig - creates gemini config correctly", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("gemini", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "gemini");
  assertEquals(agentConfig.args, ["--experimental-acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.GEMINI_API_KEY, "test-gemini-key");
  assertEquals(agentConfig.env?.GEMINI_SYSTEM_MD, "/app/prompts/system_prompt_override.md");
});

Deno.test("createAgentConfig - creates opencode config correctly", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "test-opencode-key",
    },
  });
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "opencode");
  assertEquals(agentConfig.args, ["acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.OPENCODE_API_KEY, "test-opencode-key");
});

Deno.test("createAgentConfig - throws for copilot without GitHub token", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: undefined,
      githubToken: undefined,
    },
  });

  // Clear env vars too
  const originalToken = Deno.env.get("GITHUB_TOKEN");
  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.delete("GITHUB_TOKEN");
  Deno.env.delete("COPILOT_GITHUB_TOKEN");

  try {
    assertThrows(
      () => createAgentConfig("copilot", "/tmp/workspace", config),
      Error,
      "COPILOT_GITHUB_TOKEN or GITHUB_TOKEN",
    );
  } finally {
    if (originalToken) Deno.env.set("GITHUB_TOKEN", originalToken);
    if (originalCopilotToken) Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
  }
});

Deno.test("createAgentConfig - throws for gemini without API key", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: undefined,
    },
  });

  // Clear env var too
  const originalKey = Deno.env.get("GEMINI_API_KEY");
  Deno.env.delete("GEMINI_API_KEY");

  try {
    assertThrows(
      () => createAgentConfig("gemini", "/tmp/workspace", config),
      Error,
      "Gemini API key not configured",
    );
  } finally {
    // Restore env var if it existed
    if (originalKey) {
      Deno.env.set("GEMINI_API_KEY", originalKey);
    }
  }
});

Deno.test("createAgentConfig - creates opencode without API key (uses GitHub/Gemini providers)", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: undefined,
    },
  });

  // Clear env var too
  const originalKey = Deno.env.get("OPENCODE_API_KEY");
  Deno.env.delete("OPENCODE_API_KEY");

  try {
    // OpenCode can work without API key by using GitHub/Gemini providers
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.command, "opencode");
    assertEquals(agentConfig.args, ["acp"]);
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, undefined);
  } finally {
    // Restore env var if it existed
    if (originalKey) {
      Deno.env.set("OPENCODE_API_KEY", originalKey);
    }
  }
});

Deno.test("createAgentConfig - uses env var for GitHub token if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      githubToken: undefined,
    },
  });

  // Set GITHUB_TOKEN env var, clear COPILOT_GITHUB_TOKEN to ensure fallback path
  const originalToken = Deno.env.get("GITHUB_TOKEN");
  Deno.env.set("GITHUB_TOKEN", "env-github-token");
  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.delete("COPILOT_GITHUB_TOKEN");

  try {
    const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GITHUB_TOKEN, "env-github-token");
  } finally {
    // Restore env vars
    if (originalToken) {
      Deno.env.set("GITHUB_TOKEN", originalToken);
    } else {
      Deno.env.delete("GITHUB_TOKEN");
    }
    if (originalCopilotToken) {
      Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
    } else {
      Deno.env.delete("COPILOT_GITHUB_TOKEN");
    }
  }
});

Deno.test("createAgentConfig - uses env var for OpenCode API key if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: undefined,
    },
  });

  // Set env var
  const originalKey = Deno.env.get("OPENCODE_API_KEY");
  Deno.env.set("OPENCODE_API_KEY", "env-opencode-key");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, "env-opencode-key");
  } finally {
    // Restore env var
    if (originalKey) {
      Deno.env.set("OPENCODE_API_KEY", originalKey);
    } else {
      Deno.env.delete("OPENCODE_API_KEY");
    }
  }
});

Deno.test("createAgentConfig - throws for unknown agent type", () => {
  const config = createTestConfig();

  assertThrows(
    () => createAgentConfig("unknown" as never, "/tmp/workspace", config),
    Error,
    "Unknown agent type",
  );
});

Deno.test("getDefaultAgentType - returns copilot as default", () => {
  const config = createTestConfig();
  assertEquals(getDefaultAgentType(config), "copilot");
});

Deno.test("getDefaultAgentType - returns configured default agent type", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      defaultAgentType: "gemini",
    },
  });
  assertEquals(getDefaultAgentType(config), "gemini");
});

Deno.test("getDefaultAgentType - returns opencode when configured", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
  });
  assertEquals(getDefaultAgentType(config), "opencode");
});

Deno.test("createAgentConfig - inherits critical environment variables for copilot", () => {
  const config = createTestConfig();

  // Set up environment variables to inherit
  const originalPath = Deno.env.get("PATH");
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("PATH", "/usr/bin:/bin");
  Deno.env.set("HOME", "/home/testuser");

  try {
    const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config);

    // Should inherit PATH and HOME
    assertEquals(agentConfig.env?.PATH, "/usr/bin:/bin");
    assertEquals(agentConfig.env?.HOME, "/home/testuser");
    // Should also have GITHUB_TOKEN
    assertEquals(agentConfig.env?.GITHUB_TOKEN, "test-github-token");
  } finally {
    // Restore original env vars
    if (originalPath) {
      Deno.env.set("PATH", originalPath);
    }
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    }
  }
});

Deno.test("createAgentConfig - inherits critical environment variables for gemini", () => {
  const config = createTestConfig();

  // Set up environment variables to inherit
  const originalPath = Deno.env.get("PATH");
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("PATH", "/usr/local/bin:/usr/bin");
  Deno.env.set("HOME", "/home/testuser");

  try {
    const agentConfig = createAgentConfig("gemini", "/tmp/workspace", config);

    // Should inherit PATH and HOME
    assertEquals(agentConfig.env?.PATH, "/usr/local/bin:/usr/bin");
    assertEquals(agentConfig.env?.HOME, "/home/testuser");
    // Should also have GEMINI_API_KEY
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "test-gemini-key");
  } finally {
    // Restore original env vars
    if (originalPath) {
      Deno.env.set("PATH", originalPath);
    }
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    }
  }
});

Deno.test("createAgentConfig - inherits critical environment variables for opencode", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "test-opencode-key",
    },
  });

  // Set up environment variables to inherit
  const originalPath = Deno.env.get("PATH");
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("PATH", "/usr/local/bin:/usr/bin");
  Deno.env.set("HOME", "/home/testuser");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);

    // Should inherit PATH and HOME
    assertEquals(agentConfig.env?.PATH, "/usr/local/bin:/usr/bin");
    assertEquals(agentConfig.env?.HOME, "/home/testuser");
    // Should also have OPENCODE_API_KEY
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, "test-opencode-key");
  } finally {
    // Restore original env vars
    if (originalPath) {
      Deno.env.set("PATH", originalPath);
    }
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    }
  }
});

Deno.test("createAgentConfig - adds --yolo flag to copilot when yolo is true", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config, true);

  assertEquals(agentConfig.command, "copilot");
  assertEquals(agentConfig.args, [
    "--disable-builtin-mcps",
    "--no-ask-user",
    "--no-color",
    "--no-auto-update",
    "--experimental",
    "--acp",
    "--yolo",
  ]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - does not add --yolo flag to copilot when yolo is false", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config, false);

  assertEquals(agentConfig.command, "copilot");
  assertEquals(agentConfig.args, [
    "--disable-builtin-mcps",
    "--no-ask-user",
    "--no-color",
    "--no-auto-update",
    "--experimental",
    "--acp",
    "--available-tools",
    "write_bash",
    "--available-tools",
    "read_bash",
    "--available-tools",
    "stop_bash",
    "--available-tools",
    "bash",
    "--deny-tool",
    "shell(git:*)",
    "--deny-tool",
    "shell(echo:*)",
    "--deny-tool",
    "shell(mkdir:*)",
  ]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - copilot non-YOLO includes deny-tool flags", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config, false);
  const args = agentConfig.args;

  // Verify deny-tool flags are present
  const denyToolIndices = args
    .map((arg, i) => arg === "--deny-tool" ? i : -1)
    .filter((i) => i >= 0);

  assertEquals(denyToolIndices.length, 3, "Should have exactly 3 --deny-tool flags");

  // Verify specific denied commands
  const denyPatterns = denyToolIndices.map((i) => args[i + 1]);
  assertEquals(denyPatterns.includes("shell(git:*)"), true, "Should deny git commands");
  assertEquals(denyPatterns.includes("shell(echo:*)"), true, "Should deny echo commands");
  assertEquals(denyPatterns.includes("shell(mkdir:*)"), true, "Should deny mkdir commands");
});

Deno.test("createAgentConfig - copilot YOLO mode does NOT include deny-tool flags", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config, true);
  const args = agentConfig.args;

  assertEquals(
    args.includes("--deny-tool"),
    false,
    "YOLO mode should not include --deny-tool flags",
  );
  assertEquals(args.includes("--yolo"), true, "YOLO mode should include --yolo flag");
});

Deno.test("createAgentConfig - adds --yolo flag to gemini when yolo is true", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("gemini", "/tmp/workspace", config, true);

  assertEquals(agentConfig.command, "gemini");
  assertEquals(agentConfig.args, ["--experimental-acp", "--yolo"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - does not add --yolo flag to gemini when yolo is false", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("gemini", "/tmp/workspace", config, false);

  assertEquals(agentConfig.command, "gemini");
  assertEquals(agentConfig.args, ["--experimental-acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - does not add OPENCODE_YOLO env var when yolo is true", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "test-opencode-key",
    },
  });
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config, true);

  assertEquals(agentConfig.command, "opencode");
  assertEquals(agentConfig.args, ["acp"]);
  assertExists(agentConfig.env);
  assertEquals(agentConfig.env!["OPENCODE_YOLO"], undefined);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - does not add OPENCODE_YOLO env var when yolo is false", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "test-opencode-key",
    },
  });
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config, false);

  assertEquals(agentConfig.command, "opencode");
  assertEquals(agentConfig.args, ["acp"]);
  assertExists(agentConfig.env);
  assertEquals(agentConfig.env!["OPENCODE_YOLO"], undefined);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("getRetryPromptStrategy - returns strategy for copilot", () => {
  const strategy = getRetryPromptStrategy("copilot");
  assertEquals(strategy.maxRetries, 1);
  assertStringIncludes(strategy.retryPromptMessage, "send-reply");
  assertStringIncludes(strategy.retryPromptMessage, "react-message");
});

Deno.test("getRetryPromptStrategy - returns strategy for opencode", () => {
  const strategy = getRetryPromptStrategy("opencode");
  assertEquals(strategy.maxRetries, 1);
  assertStringIncludes(strategy.retryPromptMessage, "send-reply");
  assertStringIncludes(strategy.retryPromptMessage, "react-message");
});

Deno.test("getRetryPromptStrategy - returns strategy for gemini", () => {
  const strategy = getRetryPromptStrategy("gemini");
  assertEquals(strategy.maxRetries, 1);
  assertStringIncludes(strategy.retryPromptMessage, "send-reply");
  assertStringIncludes(strategy.retryPromptMessage, "react-message");
});

Deno.test("getRetryPromptStrategy - throws for unknown agent type", () => {
  assertThrows(
    () => getRetryPromptStrategy("unknown" as never),
    Error,
    "Unknown agent type",
  );
});

Deno.test("getRetryPromptStrategy - all strategies have maxRetries of 1", () => {
  const types: Array<"copilot" | "opencode" | "gemini"> = ["copilot", "opencode", "gemini"];
  for (const type of types) {
    const strategy = getRetryPromptStrategy(type);
    assertEquals(strategy.maxRetries, 1, `${type} should have maxRetries of 1`);
  }
});

Deno.test("getRetryPromptStrategy - retryPromptMessage starts with system message intro", () => {
  const strategy = getRetryPromptStrategy("copilot");
  assertStringIncludes(strategy.retryPromptMessage, "System message:");
  assertStringIncludes(
    strategy.retryPromptMessage,
    "You must communicate with the user by using send-reply or react-message before ending the session.",
  );
});

Deno.test("getRetryPromptStrategy - retryPromptMessage contains section separators", () => {
  const strategy = getRetryPromptStrategy("copilot");
  // Should have at least two --- separators between the three sections
  const separatorCount = (strategy.retryPromptMessage.match(/\n---\n/g) ?? []).length;
  assertEquals(separatorCount >= 2, true, "Should contain at least 2 --- separators");
});

Deno.test("getRetryPromptStrategy - retryPromptMessage includes send-reply SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("copilot");
  // Content loaded from skills/send-reply/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# Send Reply Skill");
  assertStringIncludes(strategy.retryPromptMessage, "You can only send ONE reply. You MUST send exactly ONE reply.");
});

Deno.test("getRetryPromptStrategy - retryPromptMessage includes react-message SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("copilot");
  // Content loaded from skills/react-message/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# React Message Skill");
  assertStringIncludes(strategy.retryPromptMessage, "Use appropriate emoji");
});

Deno.test("getRetryPromptStrategy - all agent types share the same retryPromptMessage content", () => {
  const types: Array<"copilot" | "opencode" | "gemini"> = ["copilot", "opencode", "gemini"];
  const messages = types.map((t) => getRetryPromptStrategy(t).retryPromptMessage);
  // All agent types use the same default message
  assertEquals(messages[0], messages[1], "copilot and opencode should share the same message");
  assertEquals(messages[1], messages[2], "opencode and gemini should share the same message");
});

// ============ Agent Workspace Env Var Tests ============

Deno.test("createAgentConfig - includes AGENT_WORKSPACE env var for copilot", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "copilot",
    "/tmp/workspace",
    config,
    false,
    "/data/agent-workspace",
  );
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, "/data/agent-workspace");
});

Deno.test("createAgentConfig - includes AGENT_WORKSPACE env var for gemini", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "gemini",
    "/tmp/workspace",
    config,
    false,
    "/data/agent-workspace",
  );
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, "/data/agent-workspace");
});

Deno.test("createAgentConfig - includes AGENT_WORKSPACE env var for opencode", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    "/data/agent-workspace",
  );
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, "/data/agent-workspace");
});

Deno.test("createAgentConfig - omits AGENT_WORKSPACE when not provided", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config, false);
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, undefined);
});

// ============ Copilot Separate Token Tests (Issue #248) ============

Deno.test("createAgentConfig - copilot passes COPILOT_GITHUB_TOKEN and GITHUB_TOKEN separately", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: "copilot-specific-token",
      githubToken: "generic-token",
    },
  });
  const result = createAgentConfig("copilot", "/tmp/workspace", config);
  assertEquals(result.env?.COPILOT_GITHUB_TOKEN, "copilot-specific-token");
  assertEquals(result.env?.GITHUB_TOKEN, "generic-token");
});

Deno.test("createAgentConfig - copilot works with only copilotGithubToken", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: "copilot-only-token",
      githubToken: undefined,
    },
  });

  const originalGithubToken = Deno.env.get("GITHUB_TOKEN");
  Deno.env.delete("GITHUB_TOKEN");
  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.delete("COPILOT_GITHUB_TOKEN");

  try {
    const result = createAgentConfig("copilot", "/tmp/workspace", config);
    assertEquals(result.env?.COPILOT_GITHUB_TOKEN, "copilot-only-token");
    assertEquals(result.env?.GITHUB_TOKEN, undefined);
  } finally {
    if (originalGithubToken) Deno.env.set("GITHUB_TOKEN", originalGithubToken);
    if (originalCopilotToken) Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
  }
});

Deno.test("createAgentConfig - copilot falls back to githubToken when copilotGithubToken is unset", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: undefined,
      githubToken: "generic-token",
    },
  });

  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.delete("COPILOT_GITHUB_TOKEN");

  try {
    const result = createAgentConfig("copilot", "/tmp/workspace", config);
    assertEquals(result.env?.COPILOT_GITHUB_TOKEN, undefined);
    assertEquals(result.env?.GITHUB_TOKEN, "generic-token");
  } finally {
    if (originalCopilotToken) Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
  }
});

Deno.test("createAgentConfig - copilot ENV vars take priority over config values", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: "config-copilot",
      githubToken: "config-github",
    },
  });

  const originalGithubToken = Deno.env.get("GITHUB_TOKEN");
  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.set("COPILOT_GITHUB_TOKEN", "env-copilot");
  Deno.env.set("GITHUB_TOKEN", "env-github");

  try {
    const result = createAgentConfig("copilot", "/tmp/workspace", config);
    assertEquals(result.env?.COPILOT_GITHUB_TOKEN, "env-copilot");
    assertEquals(result.env?.GITHUB_TOKEN, "env-github");
  } finally {
    if (originalGithubToken) {
      Deno.env.set("GITHUB_TOKEN", originalGithubToken);
    } else {
      Deno.env.delete("GITHUB_TOKEN");
    }
    if (originalCopilotToken) {
      Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
    } else {
      Deno.env.delete("COPILOT_GITHUB_TOKEN");
    }
  }
});

Deno.test("createAgentConfig - copilot throws when both tokens are unset", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      copilotGithubToken: undefined,
      githubToken: undefined,
    },
  });

  const originalGithubToken = Deno.env.get("GITHUB_TOKEN");
  const originalCopilotToken = Deno.env.get("COPILOT_GITHUB_TOKEN");
  Deno.env.delete("GITHUB_TOKEN");
  Deno.env.delete("COPILOT_GITHUB_TOKEN");

  try {
    assertThrows(
      () => createAgentConfig("copilot", "/tmp/workspace", config),
      Error,
      "COPILOT_GITHUB_TOKEN or GITHUB_TOKEN",
    );
  } finally {
    if (originalGithubToken) Deno.env.set("GITHUB_TOKEN", originalGithubToken);
    if (originalCopilotToken) Deno.env.set("COPILOT_GITHUB_TOKEN", originalCopilotToken);
  }
});

Deno.test("getSessionModeOverride - returns yolo for opencode with yolo enabled", () => {
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
});

Deno.test("getSessionModeOverride - returns null for opencode without yolo", () => {
  assertEquals(getSessionModeOverride("opencode", false), null);
});

Deno.test("getSessionModeOverride - returns null for copilot with yolo", () => {
  assertEquals(getSessionModeOverride("copilot", true), null);
});

Deno.test("getSessionModeOverride - returns null for gemini with yolo", () => {
  assertEquals(getSessionModeOverride("gemini", true), null);
});
