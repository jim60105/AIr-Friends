// tests/acp/agent-factory.test.ts

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import {
  createAgentConfig,
  getDefaultAgentType,
  getRetryPromptStrategy,
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
      tokenLimit: 4096,
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
    accessControl: {
      replyTo: "whitelist",
      whitelist: [],
      ...overrides.accessControl,
    },
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
    "--acp",
    "--available-tools",
    "write_bash",
    "--available-tools",
    "read_bash",
    "--available-tools",
    "stop_bash",
    "--available-tools",
    "bash",
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
      tokenLimit: 4096,
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
      tokenLimit: 4096,
      githubToken: undefined,
    },
  });

  // Clear env var too
  const originalToken = Deno.env.get("GITHUB_TOKEN");
  Deno.env.delete("GITHUB_TOKEN");

  try {
    assertThrows(
      () => createAgentConfig("copilot", "/tmp/workspace", config),
      Error,
      "GitHub token not configured",
    );
  } finally {
    // Restore env var if it existed
    if (originalToken) {
      Deno.env.set("GITHUB_TOKEN", originalToken);
    }
  }
});

Deno.test("createAgentConfig - throws for gemini without API key", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 4096,
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
      tokenLimit: 4096,
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
      tokenLimit: 4096,
      githubToken: undefined,
    },
  });

  // Set env var
  const originalToken = Deno.env.get("GITHUB_TOKEN");
  Deno.env.set("GITHUB_TOKEN", "env-github-token");

  try {
    const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GITHUB_TOKEN, "env-github-token");
  } finally {
    // Restore env var
    if (originalToken) {
      Deno.env.set("GITHUB_TOKEN", originalToken);
    } else {
      Deno.env.delete("GITHUB_TOKEN");
    }
  }
});

Deno.test("createAgentConfig - uses env var for OpenCode API key if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 4096,
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
      tokenLimit: 4096,
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
      tokenLimit: 4096,
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
      tokenLimit: 4096,
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
    "--acp",
    "--available-tools",
    "write_bash",
    "--available-tools",
    "read_bash",
    "--available-tools",
    "stop_bash",
    "--available-tools",
    "bash",
  ]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
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

Deno.test("createAgentConfig - adds OPENCODE_YOLO env var when yolo is true", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 4096,
      opencodeApiKey: "test-opencode-key",
    },
  });
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config, true);

  assertEquals(agentConfig.command, "opencode");
  assertEquals(agentConfig.args, ["acp"]);
  assertExists(agentConfig.env);
  assertEquals(agentConfig.env!["OPENCODE_YOLO"], "true");
  assertEquals(agentConfig.cwd, "/tmp/workspace");
});

Deno.test("createAgentConfig - does not add OPENCODE_YOLO env var when yolo is false", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 4096,
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
