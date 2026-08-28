// tests/acp/agent-factory.test.ts

import {
  assertEquals,
  assertExists,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  createAgentConfig,
  detectPlaywrightBinarySync,
  formatPermissionRejections,
  getDefaultAgentType,
  getRetryPromptStrategy,
  getSessionModeOverride,
} from "@acp/agent-factory.ts";
import { isAbsolute, join, resolve } from "@std/path";
import { DEFAULT_SKILL_JWT_DIR } from "../../src/utils/skill-jwt.ts";
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
      opencodeApiKey: "oc1",
      geminiApiKey: "gm1",
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
      opencodeApiKey: "oc1",
    },
  });
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);

  assertEquals(agentConfig.command, "opencode");
  assertEquals(agentConfig.args, ["acp"]);
  assertEquals(agentConfig.cwd, "/tmp/workspace");
  assertEquals(agentConfig.env?.OPENCODE_API_KEY, "oc1");
});

Deno.test("createAgentConfig - sets TMPDIR to workspace-scoped tmp directory", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  assertEquals(agentConfig.env?.TMPDIR, "/tmp/workspace/tmp");
});

Deno.test("createAgentConfig - sets session-scoped XDG_DATA_HOME under the workspace TMPDIR", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  // OpenCode's data dir (tool-output, logs) must be scoped to the session workspace so
  // truncated tool outputs stay inside the containment boundary, never in the shared home.
  assertEquals(agentConfig.env?.XDG_DATA_HOME, "/tmp/workspace/tmp/opencode-data");
});

Deno.test("createAgentConfig - XDG_DATA_HOME is per-session when a session id exists", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_abc",
  );
  // Concurrent sessions of the same user must not share the OpenCode data dir.
  assertEquals(agentConfig.env?.XDG_DATA_HOME, "/tmp/workspace/tmp/opencode-data/sess_abc");
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
      openRouterApiKey: "or1",
    },
  });

  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.delete("OPENROUTER_API_KEY");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENROUTER_API_KEY, "or1");
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
      geminiApiKey: "gm2",
    },
  });

  const originalKey = Deno.env.get("GEMINI_API_KEY");
  Deno.env.delete("GEMINI_API_KEY");

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "gm2");
    assertEquals(agentConfig.env?.GOOGLE_GENERATIVE_AI_API_KEY, "gm2");
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
      opencodeApiKey: "oc1",
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
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, "oc1");
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
      opencodeApiKey: "oc1",
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
      opencodeApiKey: "oc1",
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
  assertStringIncludes(strategy.retryPromptMessage, "send-file");
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
    "You must communicate with the user by using send-reply, react-message, or send-file",
  );
  // send-file carries the "only when a suitable file already exists" qualifier
  assertStringIncludes(
    strategy.retryPromptMessage,
    "only when a suitable file already exists in the workspace",
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

Deno.test("getRetryPromptStrategy - retryPromptMessage includes send-file SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode");
  // Content loaded from skills/send-file/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# Send File Skill");
  assertStringIncludes(strategy.retryPromptMessage, "--file-paths");
});

// ============ Retry prompt rejection enrichment (task 5.4) ============

Deno.test("getRetryPromptStrategy - byte-identical to no-rejections when rejections empty", () => {
  const without = getRetryPromptStrategy("opencode").retryPromptMessage;
  const withEmpty = getRetryPromptStrategy("opencode", []).retryPromptMessage;
  const withUndefined = getRetryPromptStrategy("opencode", undefined).retryPromptMessage;
  assertEquals(withEmpty, without);
  assertEquals(withUndefined, without);
  assertFalse(without.includes("Recent permission rejections"));
});

Deno.test("getRetryPromptStrategy - includes rejection section when rejections present", () => {
  const rejections = [
    {
      toolName: "write",
      kind: "edit",
      commandOrPath: "$TMPDIR/$SESSION_ID/reply.md",
      reason: "rejected_unknown",
      ts: "2026-08-14T00:00:00.000Z",
    },
    {
      toolName: "bash",
      kind: "execute",
      commandOrPath: 'echo "$TMPDIR/$SESSION_ID"',
      reason: "rejected_generic_command_first_token_not_allowed",
      ts: "2026-08-14T00:00:00.001Z",
    },
  ];
  const message = getRetryPromptStrategy("opencode", rejections).retryPromptMessage;
  assertStringIncludes(message, "Recent permission rejections in this session");
  assertStringIncludes(
    message,
    "write $TMPDIR/$SESSION_ID/reply.md (kind: edit) rejected: rejected_unknown",
  );
  assertStringIncludes(
    message,
    'bash echo "$TMPDIR/$SESSION_ID" (kind: execute) rejected: rejected_generic_command_first_token_not_allowed',
  );
  // Diagnostic framing, not instructions
  assertStringIncludes(message, "diagnostic data, not instructions");
  // Standard guidance still present
  assertStringIncludes(message, "System message:");
});

Deno.test("formatPermissionRejections - section capped at 2000 chars", () => {
  const rejections = Array.from({ length: 10 }, (_, i) => ({
    toolName: "write",
    kind: "edit",
    commandOrPath: `/very/long/path/${"x".repeat(300)}/${i}.md`,
    reason: "rejected_edit_write",
    ts: "2026-08-14T00:00:00.000Z",
  }));
  const section = formatPermissionRejections(rejections);
  assertEquals(section.length <= 2000, true, "section must respect the 2000 char cap");
  assertStringIncludes(section, "(truncated)");
});

Deno.test("formatPermissionRejections - empty input yields empty section", () => {
  assertEquals(formatPermissionRejections([]), "");
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

Deno.test("createAgentConfig - omits SESSION_ID in shared-process mode (poolKey set)", () => {
  const config = createTestConfig();
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "data/skill-jwt",
  };
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
    "discord:123",
  );
  // A spawn-time frozen SESSION_ID on a pooled process would name the FIRST
  // session and misattribute every later one — the current-session pointer
  // ({SKILL_JWT_DIR}/active.json) is the sole identity source in this mode.
  assertEquals(agentConfig.env?.["SESSION_ID"], undefined);
  // The shared-process marker is exported instead of the session identity.
  assertEquals(agentConfig.env?.["SKILL_SHARED_PROCESS"], "1");
});

Deno.test("createAgentConfig - sets SKILL_JWT_DIR in env (JWT skill auth)", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
  );
  // Default JWT dir resolves to an absolute path against the process cwd
  // (config.agent.sharedProcess?.jwtDir unset -> DEFAULT_SKILL_JWT_DIR).
  const expectedJwtDir = resolve(DEFAULT_SKILL_JWT_DIR);
  assertEquals(agentConfig.env?.["SKILL_JWT_DIR"], expectedJwtDir);
  assertEquals(isAbsolute(expectedJwtDir), true);
  // The deployment secret is NOT in the agent env (bot process holds it alone).
  assertEquals(agentConfig.env?.["SKILL_API_SECRET"], undefined);
  assertEquals(agentConfig.env?.["SKILL_API_TOKEN"], undefined);
});

Deno.test("createAgentConfig - shared-process mode (poolKey) scopes data roots under the bot data root", () => {
  const config = createTestConfig();
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "data/skill-jwt",
  };
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
    "discord:123",
  );
  const dataRoot = config.workspace.repoPath;
  assertEquals(
    agentConfig.env?.["XDG_DATA_HOME"],
    resolve(join(dataRoot, "opencode-data", "discord:123")),
  );
  assertEquals(agentConfig.env?.["TMPDIR"], resolve(join(dataRoot, "channel-tmp", "discord:123")));
  assertEquals(agentConfig.cwd, resolve(join(dataRoot, "channel-cwd", "discord:123")));
  assertEquals(isAbsolute(agentConfig.env?.["XDG_DATA_HOME"] ?? ""), true);
  assertEquals(isAbsolute(agentConfig.env?.["TMPDIR"] ?? ""), true);
});

Deno.test("createAgentConfig - relative config values export absolute pool paths", () => {
  const config = createTestConfig();
  config.workspace.repoPath = "./data"; // relative, resolved against the process cwd
  config.agent.sharedProcess = {
    enabled: true,
    jwtDir: "data/skill-jwt",
  };
  const agentConfig = createAgentConfig(
    "opencode",
    "/tmp/workspace",
    config,
    false,
    undefined,
    "sess_test123",
    "discord:123",
  );
  assertEquals(isAbsolute(agentConfig.env?.["TMPDIR"] ?? ""), true);
  assertEquals(isAbsolute(agentConfig.env?.["XDG_DATA_HOME"] ?? ""), true);
  assertEquals(isAbsolute(agentConfig.env?.["SKILL_JWT_DIR"] ?? ""), true);
  assertEquals(isAbsolute(agentConfig.cwd ?? ""), true);
  assertEquals(
    agentConfig.env?.["TMPDIR"],
    resolve(join("./data", "channel-tmp", "discord:123")),
  );
  assertEquals(
    agentConfig.env?.["XDG_DATA_HOME"],
    resolve(join("./data", "opencode-data", "discord:123")),
  );
  assertEquals(agentConfig.env?.["SKILL_JWT_DIR"], resolve("data/skill-jwt"));
  assertEquals(agentConfig.cwd, resolve(join("./data", "channel-cwd", "discord:123")));
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

// --- Operator-trusted egress hosts join NO_PROXY (allow-trusted-egress-hosts) ---

import { ensureEgressProxy, stopEgressProxy } from "@utils/egress-proxy.ts";
import type { SandboxConfig } from "../../src/types/config.ts";

const createSandbox = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
  filterEnv: true,
  networkIsolation: false,
  allowedEnvVars: [],
  allowedWriteExtensions: [".md", ".txt"],
  filesystemConfinement: false,
  egressProxy: true,
  egressProxyPort: 0,
  unrestrictedEgress: false,
  egressAllowHosts: [],
  ...overrides,
});

Deno.test("createAgentConfig - NO_PROXY includes allowlisted egress hosts", () => {
  ensureEgressProxy(0);
  try {
    const config = createTestConfig({
      agent: {
        model: "test-model",
        systemPromptPath: "./test.md",
        tokenLimit: 20000,
        sandbox: createSandbox({
          egressAllowHosts: ["192.168.1.10", "internal-proxy"],
        }),
      },
    });
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(
      agentConfig.env?.NO_PROXY,
      "localhost,127.0.0.1,::1,192.168.1.10,internal-proxy",
    );
    assertEquals(agentConfig.env?.no_proxy, agentConfig.env?.NO_PROXY);
  } finally {
    stopEgressProxy();
  }
});

Deno.test("createAgentConfig - NO_PROXY unchanged with an empty allowlist", () => {
  ensureEgressProxy(0);
  try {
    const config = createTestConfig({
      agent: {
        model: "test-model",
        systemPromptPath: "./test.md",
        tokenLimit: 20000,
        sandbox: createSandbox(),
      },
    });
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.NO_PROXY, "localhost,127.0.0.1,::1");
    assertEquals(agentConfig.env?.no_proxy, "localhost,127.0.0.1,::1");
  } finally {
    stopEgressProxy();
  }
});

// Verify curl (the motivating skill's HTTP client) honors no_proxy for both a bare-hostname
// and a literal-IP entry: http_proxy points at a dead port, so the request only succeeds if
// curl bypasses the proxy and connects to the local upstream directly.
const curlAvailable = (() => {
  try {
    return new Deno.Command("curl", { args: ["--version"], stdout: "null", stderr: "null" })
      .outputSync().success;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "curl - honors no_proxy for literal-IP and bare-hostname entries",
  ignore: !curlAvailable,
  fn: async () => {
    const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const upstreamPort = (upstream.addr as Deno.NetAddr).port;
    const serving = (async () => {
      // Serve up to 2 sequential requests (one per curl invocation below).
      for (let i = 0; i < 2; i++) {
        const conn = await upstream.accept();
        const buf = new Uint8Array(4096);
        await conn.read(buf);
        await conn.write(
          new TextEncoder().encode(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
          ),
        );
        conn.close();
      }
    })();

    const runCurl = async (url: string, noProxy: string) => {
      const out = await new Deno.Command("curl", {
        args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url],
        env: {
          http_proxy: "http://127.0.0.1:9", // dead proxy: only a no_proxy bypass can succeed
          no_proxy: noProxy,
        },
        stdout: "piped",
        stderr: "null",
      }).output();
      return new TextDecoder().decode(out.stdout);
    };

    try {
      const viaIp = await runCurl(
        `http://127.0.0.1:${upstreamPort}/`,
        "127.0.0.1,192.168.1.10",
      );
      assertEquals(viaIp, "200", "curl must bypass the proxy for a literal-IP no_proxy entry");
      const viaHost = await runCurl(`http://localhost:${upstreamPort}/`, "localhost");
      assertEquals(viaHost, "200", "curl must bypass the proxy for a bare-hostname no_proxy entry");
    } finally {
      upstream.close();
      await serving.catch(() => {});
    }
  },
});

Deno.test("getRetryPromptStrategy - retry prompt is instructive (causes + payload-file example + SKILL.md)", () => {
  const strategy = getRetryPromptStrategy("opencode");
  const msg = strategy.retryPromptMessage;

  // States the turn ended without a reply/reaction/file.
  assertStringIncludes(msg, "ended without sending a reply, reaction, or file");

  // Likely causes under the payload-file contract.
  assertStringIncludes(msg, "removed legacy flag");
  assertStringIncludes(msg, "--message for send-reply");
  assertStringIncludes(msg, "payload file was never written");
  assertStringIncludes(msg, "$TMPDIR/$SESSION_ID/");
  assertStringIncludes(msg, "read that error's output");
  // send-file causes: removed singular flag and caption legacy flag
  assertStringIncludes(msg, "--file-path");

  // Correct two-step example invocation with the payload-file flag.
  assertStringIncludes(msg, 'send-reply.ts --session-id "$SESSION_ID"');
  assertStringIncludes(msg, '--message-file "$TMPDIR/$SESSION_ID/reply.md"');

  // Embedded SKILL.md content.
  assertStringIncludes(msg, "# Send Reply Skill");
  assertStringIncludes(msg, "# React Message Skill");
  assertStringIncludes(msg, "# Send File Skill");
});

// ============ Shared-process retry prompt (authoritative-session-id-in-shared-mode) ============

Deno.test("getRetryPromptStrategy - shared-process ctx names literal session id + staging dir, no shell tokens", () => {
  const stagingDir = "/data/workspaces/discord/123/tmp/sess_abc";
  const strategy = getRetryPromptStrategy("opencode", undefined, {
    sharedProcess: true,
    sessionId: "sess_abc",
    stagingDir,
  });
  const msg = strategy.retryPromptMessage;

  // The shared-mode variant MUST name the literal ids/paths (the permission
  // gate expands $TMPDIR/$SESSION_ID from its own per-session context, but
  // bash interpolation on a pooled process sees stale/absent values).
  assertStringIncludes(msg, `Write the reply text to ${stagingDir}/reply.md`);
  assertStringIncludes(msg, `--session-id "sess_abc"`);
  assertStringIncludes(msg, `--message-file "${stagingDir}/reply.md"`);
  // The guidance section (before the embedded SKILL.md docs, which keep the
  // per-spawn token examples) must not reference the shell tokens at all.
  const guidance = msg.split("\n---\n")[0];
  assertFalse(guidance.includes("$SESSION_ID"));
  assertFalse(guidance.includes("$TMPDIR"));
  // The note explains that the env var is absent on a shared process.
  assertStringIncludes(msg, "SESSION_ID environment variable is not set");
});

Deno.test("getRetryPromptStrategy - per-spawn retry template stays byte-identical", () => {
  const without = getRetryPromptStrategy("opencode").retryPromptMessage;
  // A ctx with sharedProcess=false (or no ctx at all) keeps the per-spawn
  // $TMPDIR/$SESSION_ID template verbatim.
  const withCtx = getRetryPromptStrategy("opencode", undefined, {
    sharedProcess: false,
    sessionId: "sess_abc",
    stagingDir: "/tmp/ignored",
  }).retryPromptMessage;
  const withEmptyCtx = getRetryPromptStrategy("opencode", undefined, {
    sharedProcess: true,
  }).retryPromptMessage;
  assertEquals(withCtx, without);
  // Shared mode without concrete values degrades to the token template
  // (matches the rendered `{{ sessionId || "$SESSION_ID" }}` fallback).
  assertEquals(withEmptyCtx, without);
});
