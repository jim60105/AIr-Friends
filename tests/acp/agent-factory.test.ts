// tests/acp/agent-factory.test.ts

import { assertEquals, assertThrows } from "@std/assert";
import { createAgentConfig, getDefaultAgentType } from "@acp/agent-factory.ts";
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
    ...overrides,
  };
};

Deno.test("createAgentConfig - creates copilot config correctly", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("copilot", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "copilot");
  assertEquals(agentConfig.args, ["--acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.GITHUB_TOKEN, "test-github-token");
});

Deno.test("createAgentConfig - creates gemini config correctly", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("gemini", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "gemini");
  assertEquals(agentConfig.args, ["cli", "--acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.GEMINI_API_KEY, "test-gemini-key");
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
