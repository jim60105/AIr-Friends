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
import { isAbsolute, join, resolve } from "node:path";
import { DEFAULT_SKILL_JWT_DIR } from "../../src/utils/skill-jwt.ts";
import { ConfigError, ErrorCode } from "../../src/types/errors.ts";
import type { Config } from "../../src/types/config.ts";

// Mandatory literal-first retry context used by the strategy tests: the
// caller always supplies the literal Skill API session id + absolute staging
// dir (the values the session's system prompt renders), in both spawn shapes,
// plus the ABSOLUTE trusted skill-script root the retry documents are read
// from (`repair-omp-owned-skill-handoff`): the repository `skills/` tree here,
// never the old `${import.meta.dirname}` anchor or a HOME expression.
const TEST_RETRY_CTX = {
  sharedProcess: false,
  sessionId: "sess_test",
  stagingDir: "/data/workspaces/discord/123/tmp/sess_test",
  skillsDir: resolve(import.meta.dirname ?? ".", "../../skills"),
} as const;

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

test("createAgentConfig - creates opencode config correctly", () => {
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

test("getDefaultAgentType - returns omp when configured", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      defaultAgentType: "omp",
    },
  });
  assertEquals(getDefaultAgentType(config), "omp");
});

test("createAgentConfig - sets TMPDIR to workspace-scoped tmp directory", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  assertEquals(agentConfig.env?.TMPDIR, "/tmp/workspace/tmp");
});

test("createAgentConfig - sets session-scoped XDG_DATA_HOME under the workspace TMPDIR", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  // OpenCode's data dir (tool-output, logs) must be scoped to the session workspace so
  // truncated tool outputs stay inside the containment boundary, never in the shared home.
  assertEquals(agentConfig.env?.XDG_DATA_HOME, "/tmp/workspace/tmp/opencode-data");
});

test("createAgentConfig - XDG_DATA_HOME is per-session when a session id exists", () => {
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

test("createAgentConfig - creates opencode without API key (uses providers)", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: undefined,
    },
  });

  // Clear env var too
  const originalKey = process.env["OPENCODE_API_KEY"];
  delete process.env["OPENCODE_API_KEY"];

  try {
    // OpenCode can work without an API key by using other providers
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.command, "opencode");
    assertEquals(agentConfig.args, ["acp"]);
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, undefined);
  } finally {
    // Restore env var if it existed
    if (originalKey) {
      process.env["OPENCODE_API_KEY"] = originalKey;
    }
  }
});

test("createAgentConfig - uses env var for OpenCode API key if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: undefined,
    },
  });

  // Set env var
  const originalKey = process.env["OPENCODE_API_KEY"];
  process.env["OPENCODE_API_KEY"] = "env-opencode-key";

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENCODE_API_KEY, "env-opencode-key");
  } finally {
    // Restore env var
    if (originalKey) {
      process.env["OPENCODE_API_KEY"] = originalKey;
    } else {
      delete process.env["OPENCODE_API_KEY"];
    }
  }
});

test("createAgentConfig - sets OPENROUTER_API_KEY from config", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      openRouterApiKey: "or1",
    },
  });

  const originalKey = process.env["OPENROUTER_API_KEY"];
  delete process.env["OPENROUTER_API_KEY"];

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENROUTER_API_KEY, "or1");
  } finally {
    if (originalKey) {
      process.env["OPENROUTER_API_KEY"] = originalKey;
    }
  }
});

test("createAgentConfig - uses env var for OPENROUTER_API_KEY if config not set", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      openRouterApiKey: undefined,
    },
  });

  const originalKey = process.env["OPENROUTER_API_KEY"];
  process.env["OPENROUTER_API_KEY"] = "env-openrouter-key";

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.OPENROUTER_API_KEY, "env-openrouter-key");
  } finally {
    if (originalKey) {
      process.env["OPENROUTER_API_KEY"] = originalKey;
    } else {
      delete process.env["OPENROUTER_API_KEY"];
    }
  }
});

test("createAgentConfig - sets GEMINI_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY when gemini key present", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: "gm2",
    },
  });

  const originalKey = process.env["GEMINI_API_KEY"];
  delete process.env["GEMINI_API_KEY"];

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "gm2");
    assertEquals(agentConfig.env?.GOOGLE_GENERATIVE_AI_API_KEY, "gm2");
  } finally {
    if (originalKey) {
      process.env["GEMINI_API_KEY"] = originalKey;
    }
  }
});

test("createAgentConfig - uses env var for gemini key and sets both provider vars", () => {
  const config = createTestConfig({
    agent: {
      model: "test",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: undefined,
    },
  });

  const originalKey = process.env["GEMINI_API_KEY"];
  process.env["GEMINI_API_KEY"] = "env-gemini-key";

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.GEMINI_API_KEY, "env-gemini-key");
    assertEquals(agentConfig.env?.GOOGLE_GENERATIVE_AI_API_KEY, "env-gemini-key");
  } finally {
    if (originalKey) {
      process.env["GEMINI_API_KEY"] = originalKey;
    } else {
      delete process.env["GEMINI_API_KEY"];
    }
  }
});

test("createAgentConfig - throws for unknown agent type", () => {
  const config = createTestConfig();

  assertThrows(
    () => createAgentConfig("unknown" as never, "/tmp/workspace", config),
    Error,
    "Unknown agent type",
  );
});

test("getDefaultAgentType - returns opencode as default", () => {
  const config = createTestConfig();
  assertEquals(getDefaultAgentType(config), "opencode");
});

test("getDefaultAgentType - returns opencode when configured", () => {
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

test("createAgentConfig - inherits critical environment variables for opencode", () => {
  const config = createTestConfig({
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "oc1",
    },
  });

  // Set up environment variables to inherit
  const originalPath = process.env["PATH"];
  const originalHome = process.env["HOME"];
  process.env["PATH"] = "/usr/local/bin:/usr/bin";
  process.env["HOME"] = "/home/testuser";

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
      process.env["PATH"] = originalPath;
    }
    if (originalHome) {
      process.env["HOME"] = originalHome;
    }
  }
});

test("createAgentConfig - does not add OPENCODE_YOLO env var when yolo is true", () => {
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

test("createAgentConfig - does not add OPENCODE_YOLO env var when yolo is false", () => {
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

test("getRetryPromptStrategy - returns strategy for opencode", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  assertEquals(strategy.maxRetries, 1);
  assertStringIncludes(strategy.retryPromptMessage, "send-reply");
  assertStringIncludes(strategy.retryPromptMessage, "react-message");
  assertStringIncludes(strategy.retryPromptMessage, "send-file");
});

test("getRetryPromptStrategy - throws for unknown agent type", () => {
  assertThrows(
    () => getRetryPromptStrategy("unknown" as never, TEST_RETRY_CTX),
    Error,
    "Unknown agent type",
  );
});

test("getRetryPromptStrategy - retryPromptMessage starts with system message intro", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  assertStringIncludes(strategy.retryPromptMessage, "System message:");
  // `clarify-delivery-recovery-guidance`: the directive to communicate is
  // CONDITIONAL on nothing having actually reached the user, because a missing
  // recorded response is never proof of non-delivery.
  assertStringIncludes(
    strategy.retryPromptMessage,
    "No recorded response is not by itself evidence that nothing reached the user",
  );
  assertStringIncludes(
    strategy.retryPromptMessage,
    "If nothing actually reached the user, you must communicate with them by using send-reply, " +
      "react-message, or send-file",
  );
  // send-file carries the "only when a suitable file already exists" qualifier
  assertStringIncludes(
    strategy.retryPromptMessage,
    "only when a suitable file already exists in the workspace",
  );
});

test("getRetryPromptStrategy - retryPromptMessage contains section separators", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  // Should have at least two --- separators between the three sections
  const separatorCount = (strategy.retryPromptMessage.match(/\n---\n/g) ?? []).length;
  assertEquals(separatorCount >= 2, true, "Should contain at least 2 --- separators");
});

test("getRetryPromptStrategy - retryPromptMessage includes send-reply SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  // Content loaded from skills/send-reply/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# Send Reply Skill");
  // `clarify-delivery-recovery-guidance` scopes the documented limit to
  // SUCCESSFUL sends so a pre-delivery rejection can be corrected; the retry
  // prompt embeds that owning document verbatim.
  assertStringIncludes(
    strategy.retryPromptMessage,
    "You MUST deliver exactly ONE reply per session",
  );
  assertStringIncludes(
    strategy.retryPromptMessage,
    "does not consume it, so correct the reported cause and invoke the skill again",
  );
});

test("getRetryPromptStrategy - retryPromptMessage includes react-message SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  // Content loaded from skills/react-message/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# React Message Skill");
  assertStringIncludes(strategy.retryPromptMessage, "Use appropriate emoji");
});

test("getRetryPromptStrategy - retryPromptMessage includes send-file SKILL.md content", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  // Content loaded from skills/send-file/SKILL.md
  assertStringIncludes(strategy.retryPromptMessage, "# Send File Skill");
  assertStringIncludes(strategy.retryPromptMessage, "--file-paths");
});

// ============ Retry prompt rejection enrichment (task 5.4) ============

test("getRetryPromptStrategy - byte-identical to no-rejections when rejections empty", () => {
  const without = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined).retryPromptMessage;
  const withEmpty = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, []).retryPromptMessage;
  const withUndefined =
    getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined).retryPromptMessage;
  assertEquals(withEmpty, without);
  assertEquals(withUndefined, without);
  assertFalse(without.includes("Recent permission rejections"));
});

test("getRetryPromptStrategy - includes rejection section when rejections present", () => {
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
  const message = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, rejections).retryPromptMessage;
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

test("formatPermissionRejections - section capped at 2000 chars", () => {
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

test("formatPermissionRejections - empty input yields empty section", () => {
  assertEquals(formatPermissionRejections([]), "");
});

// ============ Agent Workspace Env Var Tests ============

test("createAgentConfig - includes AGENT_WORKSPACE env var for opencode", () => {
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

test("createAgentConfig - omits AGENT_WORKSPACE when not provided", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config, false);
  assertEquals(agentConfig.env?.AGENT_WORKSPACE, undefined);
});

test("getSessionModeOverride - returns yolo for opencode with yolo enabled", () => {
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
});

test("getSessionModeOverride - returns null for opencode without yolo", () => {
  assertEquals(getSessionModeOverride("opencode", false), null);
});

test("createAgentConfig - sets SESSION_ID in env when sessionId provided", () => {
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

test("createAgentConfig - does not set SESSION_ID when sessionId omitted", () => {
  const config = createTestConfig();
  const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
  assertEquals(agentConfig.env?.["SESSION_ID"], undefined);
});

test("createAgentConfig - omits SESSION_ID in shared-process mode (poolKey set)", () => {
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

test("createAgentConfig - sets SKILL_JWT_DIR in env (JWT skill auth)", () => {
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

test("createAgentConfig - shared-process mode (poolKey) scopes data roots under the bot data root", () => {
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

test("createAgentConfig - relative config values export absolute pool paths", () => {
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

test("detectPlaywrightBinarySync - detects chromium-headless-shell", () => {
  const tempDir = makeTempDirSync();
  const originalHome = process.env["HOME"];
  process.env["HOME"] = tempDir;

  try {
    const playwrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(playwrightDir, { recursive: true });
    const binaryPath = join(playwrightDir, "chrome-headless-shell");
    fs.writeFileSync(binaryPath, "dummy binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, binaryPath);
  } finally {
    if (originalHome) {
      process.env["HOME"] = originalHome;
    } else {
      delete process.env["HOME"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

test("detectPlaywrightBinarySync - detects standard chromium", () => {
  const tempDir = makeTempDirSync();
  const originalHome = process.env["HOME"];
  process.env["HOME"] = tempDir;

  try {
    const playwrightDir = join(tempDir, ".cache", "ms-playwright", "chromium-1097", "chrome-linux");
    fs.mkdirSync(playwrightDir, { recursive: true });
    const binaryPath = join(playwrightDir, "chrome");
    fs.writeFileSync(binaryPath, "dummy binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, binaryPath);
  } finally {
    if (originalHome) {
      process.env["HOME"] = originalHome;
    } else {
      delete process.env["HOME"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

test("createAgentConfig - sets AGENT_BROWSER_EXECUTABLE_PATH and respects env override", () => {
  const config = createTestConfig();
  const originalEnvVar = process.env["AGENT_BROWSER_EXECUTABLE_PATH"];

  // Set custom path in env
  process.env["AGENT_BROWSER_EXECUTABLE_PATH"] = "/custom/path/to/chrome";

  try {
    const agentConfig = createAgentConfig("opencode", "/tmp/workspace", config);
    assertEquals(agentConfig.env?.["AGENT_BROWSER_EXECUTABLE_PATH"], "/custom/path/to/chrome");
  } finally {
    if (originalEnvVar) {
      process.env["AGENT_BROWSER_EXECUTABLE_PATH"] = originalEnvVar;
    } else {
      delete process.env["AGENT_BROWSER_EXECUTABLE_PATH"];
    }
  }
});

test("detectPlaywrightBinarySync - sorts by revision descending", () => {
  const tempDir = makeTempDirSync();
  const originalHome = process.env["HOME"];
  process.env["HOME"] = tempDir;

  try {
    // Create an older version (1100)
    const oldPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1100",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(oldPlaywrightDir, { recursive: true });
    const oldBinaryPath = join(oldPlaywrightDir, "chrome-headless-shell");
    fs.writeFileSync(oldBinaryPath, "old binary content");

    // Create a newer version (1208)
    const newPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(newPlaywrightDir, { recursive: true });
    const newBinaryPath = join(newPlaywrightDir, "chrome-headless-shell");
    fs.writeFileSync(newBinaryPath, "new binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, newBinaryPath); // Must be the newer revision
  } finally {
    if (originalHome) {
      process.env["HOME"] = originalHome;
    } else {
      delete process.env["HOME"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

test("detectPlaywrightBinarySync - ignores temporary download folders", () => {
  const tempDir = makeTempDirSync();
  const originalHome = process.env["HOME"];
  process.env["HOME"] = tempDir;

  try {
    // Create a temp folder (chromium_headless_shell-1208-temp)
    const tempPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1208-temp",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(tempPlaywrightDir, { recursive: true });
    const tempBinaryPath = join(tempPlaywrightDir, "chrome-headless-shell");
    fs.writeFileSync(tempBinaryPath, "temp binary content");

    // Create a valid folder with older version (1100)
    const validPlaywrightDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1100",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(validPlaywrightDir, { recursive: true });
    const validBinaryPath = join(validPlaywrightDir, "chrome-headless-shell");
    fs.writeFileSync(validBinaryPath, "valid binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, validBinaryPath); // Must ignore the temp folder and pick the valid older folder
  } finally {
    if (originalHome) {
      process.env["HOME"] = originalHome;
    } else {
      delete process.env["HOME"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

test("detectPlaywrightBinarySync - prioritizes headless_shell over chromium when revisions match", () => {
  const tempDir = makeTempDirSync();
  const originalHome = process.env["HOME"];
  process.env["HOME"] = tempDir;

  try {
    const chromiumDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium-1200",
      "chrome-linux",
    );
    fs.mkdirSync(chromiumDir, { recursive: true });
    const chromiumBinary = join(chromiumDir, "chrome");
    fs.writeFileSync(chromiumBinary, "chromium binary content");

    const shellDir = join(
      tempDir,
      ".cache",
      "ms-playwright",
      "chromium_headless_shell-1200",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(shellDir, { recursive: true });
    const shellBinary = join(shellDir, "chrome-headless-shell");
    fs.writeFileSync(shellBinary, "shell binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, shellBinary);
  } finally {
    if (originalHome) {
      process.env["HOME"] = originalHome;
    } else {
      delete process.env["HOME"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

test("detectPlaywrightBinarySync - checks PLAYWRIGHT_BROWSERS_PATH if set", () => {
  const tempDir = makeTempDirSync();
  const originalBrowsersPath = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  process.env["PLAYWRIGHT_BROWSERS_PATH"] = tempDir;

  try {
    const shellDir = join(
      tempDir,
      "chromium_headless_shell-1300",
      "chrome-headless-shell-linux64",
    );
    fs.mkdirSync(shellDir, { recursive: true });
    const shellBinary = join(shellDir, "chrome-headless-shell");
    fs.writeFileSync(shellBinary, "custom path binary content");

    const detected = detectPlaywrightBinarySync();
    assertEquals(detected, shellBinary);
  } finally {
    if (originalBrowsersPath) {
      process.env["PLAYWRIGHT_BROWSERS_PATH"] = originalBrowsersPath;
    } else {
      delete process.env["PLAYWRIGHT_BROWSERS_PATH"];
    }
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
});

// --- Operator-trusted egress hosts join NO_PROXY (allow-trusted-egress-hosts) ---

import { ensureEgressProxy, stopEgressProxy } from "@utils/egress-proxy.ts";
import type { SandboxConfig } from "../../src/types/config.ts";
import fs from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

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

test("createAgentConfig - NO_PROXY includes allowlisted egress hosts", async () => {
  await ensureEgressProxy(0);
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
    await stopEgressProxy();
  }
});

test("createAgentConfig - NO_PROXY unchanged with an empty allowlist", async () => {
  await ensureEgressProxy(0);
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
    await stopEgressProxy();
  }
});

// Verify curl (the motivating skill's HTTP client) honors no_proxy for both a bare-hostname
// and a literal-IP entry: http_proxy points at a dead port, so the request only succeeds if
// curl bypasses the proxy and connects to the local upstream directly.
const curlAvailable = (() => {
  try {
    return spawnSync("curl", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

test.skipIf(!curlAvailable)(
  "curl - honors no_proxy for literal-IP and bare-hostname entries",
  async () => {
    // Serve each request with the minimal HTTP response curl needs.
    const upstream = createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      });
    });
    const listening = Promise.withResolvers<void>();
    upstream.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const address = upstream.address();
    const upstreamPort = typeof address === "object" && address !== null ? address.port : 0;

    // The request must run asynchronously: a synchronous child would block the
    // event loop this in-process upstream needs to accept and answer.
    const runCurl = (url: string, noProxy: string): Promise<string> => {
      const settled = Promise.withResolvers<string>();
      execFile(
        "curl",
        ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url],
        {
          // Dead proxy: only a no_proxy bypass can succeed.
          env: { ...process.env, http_proxy: "http://127.0.0.1:9", no_proxy: noProxy },
        },
        (_error, stdout) => settled.resolve(stdout),
      );
      return settled.promise;
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
    }
  },
);

test("getRetryPromptStrategy - retry prompt is instructive (causes + payload-file example + SKILL.md)", () => {
  const strategy = getRetryPromptStrategy("opencode", TEST_RETRY_CTX, undefined);
  const msg = strategy.retryPromptMessage;

  // States the turn ended without a RECORDED reply/reaction/file.
  assertStringIncludes(
    msg,
    "Your previous turn ended without a reply, reaction, or file send RECORDED in this session",
  );

  // Likely causes under the payload-file contract.
  assertStringIncludes(msg, "removed legacy flag");
  assertStringIncludes(msg, "--message for send-reply");
  assertStringIncludes(msg, "payload file was never written");
  assertStringIncludes(msg, "staged outside /data/workspaces/discord/123/tmp/sess_test/");
  assertStringIncludes(msg, "read that error's output");
  // send-file causes: removed singular flag and caption legacy flag
  assertStringIncludes(msg, "--file-path");

  // `clarify-delivery-recovery-guidance`: corrected sending is permitted ONLY
  // for the named pre-platform-rejection causes, and every other failure —
  // including a generic error whose cause is unknown — defers to the owning
  // skill documents instead of authorizing a resend.
  assertStringIncludes(
    msg,
    "failed before the platform was reached: fix that cause and send again, within the existing limits",
  );
  assertStringIncludes(msg, "or an error whose cause you cannot identify");
  assertStringIncludes(
    msg,
    "do NOT send again unless that evidence rules out arrival",
  );

  // Correct two-step example invocation with the payload-file flag, naming the
  // ctx's LITERAL session id + absolute staging dir (no shell tokens). Every
  // recipe argument is POSIX single-quoted — the complete executable path
  // included, not just the root prefix
  // (`render-delivered-skill-root-contract`).
  assertStringIncludes(msg, `'${TEST_RETRY_CTX.skillsDir}/send-reply/scripts/send-reply.ts'`);
  assertStringIncludes(msg, `--session-id 'sess_test'`);
  assertStringIncludes(
    msg,
    `--message-file '/data/workspaces/discord/123/tmp/sess_test/reply.md'`,
  );
  assertStringIncludes(
    msg,
    "Write the reply text to /data/workspaces/discord/123/tmp/sess_test/reply.md",
  );

  // The guidance section carries no unexpanded $TMPDIR/$SESSION_ID tokens.
  const guidance = msg.split("\n---\n")[0];
  assertFalse(guidance.includes("$SESSION_ID"));
  assertFalse(guidance.includes("$TMPDIR"));

  // Embedded SKILL.md content.
  assertStringIncludes(msg, "# Send Reply Skill");
  assertStringIncludes(msg, "# React Message Skill");
  assertStringIncludes(msg, "# Send File Skill");
});

// ============ Delivery-outcome recovery in the retry prompt ============
// (`clarify-delivery-recovery-guidance`) The existing corrective prompt is
// aligned with the owning skill policy without changing its gate: both agent
// types, in both spawn shapes, get the SAME text, one corrective turn, the
// qualified directive, the payload checklist, the literal recipe, and the
// trusted documents that own the outcome table. Mocked text evidence only —
// it proves what the retry turn is told, never what an agent then did.

test("getRetryPromptStrategy - every agent type and spawn shape gets the same qualified recovery policy", () => {
  const built: Array<{ label: string; msg: string }> = [];
  for (const type of ["opencode", "omp"] as const) {
    for (const sharedProcess of [false, true] as const) {
      const strategy = getRetryPromptStrategy(type, {
        sharedProcess,
        sessionId: "sess_policy",
        stagingDir: "/data/workspaces/discord/123/tmp/sess_policy",
        skillsDir: TEST_RETRY_CTX.skillsDir,
      });
      const label = `${type} ${sharedProcess ? "pooled" : "per-spawn"}`;
      const msg = strategy.retryPromptMessage;

      // One corrective turn, unchanged.
      assertEquals(strategy.maxRetries, 1, label);

      // The directive to communicate is conditional; a missing record is not
      // proof that nothing reached the user.
      assertStringIncludes(
        msg,
        "No recorded response is not by itself evidence that nothing reached the user",
        label,
      );
      assertStringIncludes(msg, "If nothing actually reached the user", label);

      // Confirmed pre-delivery rejection is the ONLY case that authorizes a
      // corrected resend; everything else defers to the included documents.
      assertStringIncludes(
        msg,
        "a removed legacy flag, an unwritten payload file, or a payload staged outside the session " +
          "staging directory",
        label,
      );
      assertStringIncludes(msg, "may already have reached the user", label);
      assertStringIncludes(
        msg,
        "inspect the evidence the send-reply and send-file documents included below allow",
        label,
      );
      assertFalse(
        /send again[^.]*\./i.test(msg.split("the most likely causes are")[0]),
        `${label}: no unconditional resend instruction in the preamble`,
      );

      // The owning document travels with the retry, so the outcome policy is
      // available where the decision is made.
      assertStringIncludes(msg, "## Delivery Recovery", label);
      assertStringIncludes(msg, "**Confirmed success**", label);
      assertStringIncludes(msg, "**Uncertain delivery**", label);
      assertStringIncludes(msg, "## Result", label); // send-file partial-delivery rule

      built.push({ label, msg });
    }
  }
  // One shared builder: both agent types and both spawn shapes render
  // byte-identical guidance for the same session.
  assertEquals(built.length, 4);
  for (const { label, msg } of built) {
    assertEquals(msg, built[0].msg, `${label}: identical to ${built[0].label}`);
  }
});

// ============ Literal-first retry prompt (make-skill-staging-agent-portable) ============

test("getRetryPromptStrategy - pooled ctx names literal session id + staging dir, no shell tokens", () => {
  const stagingDir = "/data/workspaces/discord/123/tmp/sess_abc";
  const strategy = getRetryPromptStrategy("opencode", {
    sharedProcess: true,
    sessionId: "sess_abc",
    stagingDir,
    skillsDir: TEST_RETRY_CTX.skillsDir,
  });
  const msg = strategy.retryPromptMessage;

  // The pooled variant names the literal ids/paths.
  assertStringIncludes(msg, `Write the reply text to ${stagingDir}/reply.md`);
  assertStringIncludes(msg, `--session-id 'sess_abc'`);
  assertStringIncludes(msg, `--message-file '${stagingDir}/reply.md'`);
  // The guidance section must not reference the shell tokens at all.
  const guidance = msg.split("\n---\n")[0];
  assertFalse(guidance.includes("$SESSION_ID"));
  assertFalse(guidance.includes("$TMPDIR"));
  // The spawn-shape-neutral note: the rendered literals are authoritative and
  // the environment may carry no session identity at all.
  assertStringIncludes(msg, "literals rendered in your system prompt");
  assertStringIncludes(msg, "may carry NO session identity");
  assertStringIncludes(msg, "never honored");
});

test("getRetryPromptStrategy - per-spawn ctx names the same literals (no token template exists)", () => {
  // Literal-first in BOTH spawn shapes: for the same session the guidance
  // section is identical whether or not the run is pooled.
  const perSpawn = getRetryPromptStrategy("opencode", {
    sharedProcess: false,
    sessionId: "sess_abc",
    stagingDir: "/data/workspaces/discord/123/tmp/sess_abc",
    skillsDir: TEST_RETRY_CTX.skillsDir,
  }).retryPromptMessage;
  const pooled = getRetryPromptStrategy("opencode", {
    sharedProcess: true,
    sessionId: "sess_abc",
    stagingDir: "/data/workspaces/discord/123/tmp/sess_abc",
    skillsDir: TEST_RETRY_CTX.skillsDir,
  }).retryPromptMessage;
  assertEquals(perSpawn, pooled);
  assertStringIncludes(perSpawn, `--session-id 'sess_abc'`);
  assertFalse(perSpawn.split("\n---\n")[0].includes("$SESSION_ID"));
  assertFalse(perSpawn.split("\n---\n")[0].includes("$TMPDIR"));
});

test("getRetryPromptStrategy - rejects an empty or relative trusted root", () => {
  for (
    const [label, skillsDir] of [
      ["empty", ""],
      ["relative", "skills"],
    ] as const
  ) {
    const error = assertThrows(
      () => getRetryPromptStrategy("opencode", { ...TEST_RETRY_CTX, skillsDir }),
      ConfigError,
      undefined,
      `${label} root must fail the retry build`,
    ) as ConfigError;
    assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  }
});
