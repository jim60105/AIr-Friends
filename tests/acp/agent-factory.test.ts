// tests/acp/agent-factory.test.ts

import { assertEquals, assertExists, assertStringIncludes, assertThrows } from "@std/assert";
import {
  createAgentConfig,
  detectPlaywrightBinarySync,
  getDefaultAgentType,
  getRetryPromptStrategy,
  getSessionModeOverride,
} from "@acp/agent-factory.ts";
import { join } from "@std/path";
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
      opencodeApiKey: "test-opencode-key",
      geminiApiKey: "test-gemini-key",
      ...overrides.agent,
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
      workingTierLimit: 20,
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
  };
};

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

Deno.test("createAgentConfig - sets TMPDIR to workspace-scoped tmp directory", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  assertEquals(agentConfig.env?.TMPDIR, "/tmp/workspace/tmp");
});

Deno.test("createAgentConfig - creates opencode without API key (uses providers)", () => {
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
    // OpenCode can work without an API key by using other providers
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

Deno.test("createAgentConfig - sets OPENROUTER_API_KEY from config", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      openRouterApiKey: "config-openrouter-key",
    },
  });

  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.delete("OPENROUTER_API_KEY");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENROUTER_API_KEY, "config-openrouter-key");
  } finally {
    if (originalKey) {
      Deno.env.set("OPENROUTER_API_KEY", originalKey);
    }
  }
});

Deno.test("createAgentConfig - uses env var for OPENROUTER_API_KEY if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      openRouterApiKey: undefined,
    },
  });

  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "env-openrouter-key");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENROUTER_API_KEY, "env-openrouter-key");
  } finally {
    if (originalKey) {
      Deno.env.set("OPENROUTER_API_KEY", originalKey);
    } else {
      Deno.env.delete("OPENROUTER_API_KEY");
    }
  }
});

Deno.test("createAgentConfig - sets GEMINI_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY when gemini key present", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: "config-gemini-key",
    },
  });

  const originalKey = Deno.env.get("GEMINI_API_KEY");
  Deno.env.delete("GEMINI_API_KEY");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "config-gemini-key");
    assertEquals(agentConfig.env?.GOOGLE_GENERATIVE_AI_API_KEY, "config-gemini-key");
  } finally {
    if (originalKey) {
      Deno.env.set("GEMINI_API_KEY", originalKey);
    }
  }
});

Deno.test("createAgentConfig - uses env var for gemini key and sets both provider vars", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: undefined,
    },
  });

  const originalKey = Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY", "env-gemini-key");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "env-gemini-key");
    assertEquals(agentConfig.env?.GOOGLE_GENERATIVE_AI_API_KEY, "env-gemini-key");
  } finally {
    if (originalKey) {
      Deno.env.set("GEMINI_API_KEY", originalKey);
    } else {
      Deno.env.delete("GEMINI_API_KEY");
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

Deno.test("getDefaultAgentType - returns opencode as default", () => {
  const config = createTestConfig();
  assertEquals(getDefaultAgentType(config), "opencode");
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

Deno.test("getRetryPromptStrategy - returns strategy for opencode", () => {
  const strategy = getRetryPromptStrategy("opencode");
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

Deno.test("getRetryPromptStrategy - retryPromptMessage starts with system message intro", () => {
  const strategy = getRetryPromptStrategy("opencode");
  assertStringIncludes(strategy.retryPromptMessage, "System message:");
  assertStringIncludes(
    strategy.retryPromptMessage,
    "You must communicate with the user by using send-reply or react-message before ending the session.",
  );
});

Deno.test("getRetryPromptStrategy - retryPromptMessage contains section separators", () => {
  const strategy = getRetryPromptStrategy("opencode");
  // Should have at least two --- separators between the three sections
  const separatorCount = (strategy.retryPromptMessage.match(/\n---\n/g) ?? []).length;
  assertEquals(separatorCount >= 2, true, "Should contain at least 2 --- separators");
});

Deno.test("getRetryPromptStrategy - retryPromptMessage includes send-reply SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode");
  // Content loaded from skills/send-reply/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# Send Reply Skill");
  assertStringIncludes(
    strategy.retryPromptMessage,
    "You can only send ONE reply. You MUST send exactly ONE reply.",
  );
});

Deno.test("getRetryPromptStrategy - retryPromptMessage includes react-message SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode");
  // Content loaded from skills/react-message/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# React Message Skill");
  assertStringIncludes(strategy.retryPromptMessage, "Use appropriate emoji");
});

// ============ Agent Workspace Env Var Tests ============

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
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config, false);
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, undefined);
});

Deno.test("getSessionModeOverride - returns yolo for opencode with yolo enabled", () => {
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
});

Deno.test("getSessionModeOverride - returns null for opencode without yolo", () => {
  assertEquals(getSessionModeOverride("opencode", false), null);
});

Deno.test("createAgentConfig - sets SESSION_ID in env when sessionId provided", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
  );
  assertEquals(agentConfig.env?.["SESSION_ID"], "sess_test123");
});

Deno.test("createAgentConfig - does not set SESSION_ID when sessionId omitted", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  assertEquals(agentConfig.env?.["SESSION_ID"], undefined);
});

Deno.test("createAgentConfig - sets SKILL_API_TOKEN in env when callerToken provided (F13)", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
    "tok_secret_value",
  );
  assertEquals(agentConfig.env?.["SKILL_API_TOKEN"], "tok_secret_value");
});

Deno.test("createAgentConfig - does not set SKILL_API_TOKEN when callerToken omitted", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
  );
  assertEquals(agentConfig.env?.["SKILL_API_TOKEN"], undefined);
});

Deno.test("detectPlaywrightBinarySync - detects chromium-headless-shell", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tempDir);

  try {
    const playwrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(playwrightDir, { recursive: true });
    const binaryPath = join(playwrightDir, "chrome-headless-shell");
    Deno.writeTextFileSync(binaryPath, "dummy binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, binaryPath);
  } finally {
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

Deno.test("detectPlaywrightBinarySync - detects standard chromium", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tempDir);

  try {
    const playwrightDir = join(tempDir, ".cache", "ms-playwright", "chromium-1097", "chrome-linux");
    Deno.mkdirSync(playwrightDir, { recursive: true });
    const binaryPath = join(playwrightDir, "chrome");
    Deno.writeTextFileSync(binaryPath, "dummy binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, binaryPath);
  } finally {
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

Deno.test("createAgentConfig - sets AGENT_BROWSER_EXECUTABLE_PATH and respects env override", () => {
  const config = createTestConfig();
  const originalEnvVar = Deno.env.get("AGENT_BROWSER_EXECUTABLE_PATH");

  // Set custom path in env
  Deno.env.set("AGENT_BROWSER_EXECUTABLE_PATH", "/custom/path/to/chrome");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.["AGENT_BROWSER_EXECUTABLE_PATH"], "/custom/path/to/chrome");
  } finally {
    if (originalEnvVar) {
      Deno.env.set("AGENT_BROWSER_EXECUTABLE_PATH", originalEnvVar);
    } else {
      Deno.env.delete("AGENT_BROWSER_EXECUTABLE_PATH");
    }
  }
});

Deno.test("detectPlaywrightBinarySync - sorts by revision descending", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tempDir);

  try {
    // Create an older version (1100)
    const oldPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1100",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(oldPlaywrightDir, { recursive: true });
    const oldBinaryPath = join(oldPlaywrightDir, "chrome-headless-shell");
    Deno.writeTextFileSync(oldBinaryPath, "old binary content");

    // Create a newer version (1208)
    const newPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(newPlaywrightDir, { recursive: true });
    const newBinaryPath = join(newPlaywrightDir, "chrome-headless-shell");
    Deno.writeTextFileSync(newBinaryPath, "new binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, newBinaryPath); // Must be the newer revision
  } finally {
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

Deno.test("detectPlaywrightBinarySync - ignores temporary download folders", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tempDir);

  try {
    // Create a temp folder (chromium_headless_shell-1208-temp)
    const tempPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208-temp",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(tempPlaywrightDir, { recursive: true });
    const tempBinaryPath = join(tempPlaywrightDir, "chrome-headless-shell");
    Deno.writeTextFileSync(tempBinaryPath, "temp binary content");

    // Create a valid folder with older version (1100)
    const validPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1100",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(validPlaywrightDir, { recursive: true });
    const validBinaryPath = join(validPlaywrightDir, "chrome-headless-shell");
    Deno.writeTextFileSync(validBinaryPath, "valid binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, validBinaryPath); // Must ignore the temp folder and pick the valid older folder
  } finally {
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

Deno.test("detectPlaywrightBinarySync - prioritizes headless_shell over chromium when revisions match", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tempDir);

  try {
    const chromiumDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium-1200",
      "chrome-linux",
    );
    Deno.mkdirSync(chromiumDir, { recursive: true });
    const chromiumBinary = join(chromiumDir, "chrome");
    Deno.writeTextFileSync(chromiumBinary, "chromium binary content");

    const shellDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1200",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(shellDir, { recursive: true });
    const shellBinary = join(shellDir, "chrome-headless-shell");
    Deno.writeTextFileSync(shellBinary, "shell binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, shellBinary);
  } finally {
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

Deno.test("detectPlaywrightBinarySync - checks PLAYWRIGHT_BROWSERS_PATH if set", () => {
  const tempDir = Deno.makeTempDirSync();
  const originalBrowsersPath = Deno.env.get("PLAYWRIGHT_BROWSERS_PATH");
  Deno.env.set("PLAYWRIGHT_BROWSERS_PATH", tempDir);

  try {
    const shellDir = join(
      tempDir,
      "chromium_headless_shell-1300",
      "chrome-headless-shell-linux64",
    );
    Deno.mkdirSync(shellDir, { recursive: true });
    const shellBinary = join(shellDir, "chrome-headless-shell");
    Deno.writeTextFileSync(shellBinary, "custom path binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, shellBinary);
  } finally {
    if (originalBrowsersPath) {
      Deno.env.set("PLAYWRIGHT_BROWSERS_PATH", originalBrowsersPath);
    } else {
      Deno.env.delete("PLAYWRIGHT_BROWSERS_PATH");
    }
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});
