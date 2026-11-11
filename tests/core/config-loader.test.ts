// tests/core/config-loader.test.ts

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { loadConfig, loadSystemPrompt, normalizeIdentities } from "@core/config-loader.ts";
import { ConfigError } from "../../src/types/errors.ts";
import { ErrorCode } from "../../src/types/errors.ts";
import { getDefaultAgentType } from "../../src/acp/agent-factory.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import type { TemplateVariables } from "../../src/types/template.ts";
import { join, resolve } from "node:path";

const defaultVars: TemplateVariables = {
  isDm: false,
  platform: "discord",
  userId: "user123",
  channelId: "channel456",
  guildId: "guild789",
  // Trusted skill-script root is a mandatory render input; the fixture is the
  // ONE deployment-resolved root (`unify-skill-root-and-inventory`) — the
  // repository `skills/` tree that the default `"skills"` value resolves to.
  skillsDir: fs.realpathSync(resolve(import.meta.dirname ?? ".", "../../skills")),
};

// Test with a temporary directory containing test config files
async function withTestConfig(
  configContent: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await makeTempDir();
  try {
    await fsp.writeFile(`${tempDir}/config.yaml`, configContent);
    await fn(tempDir);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
}

test("loadConfig - should load valid configuration", async () => {
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

test("loadConfig - email disabled by default and loads without error", async () => {
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
    assertEquals(result.platforms.email?.enabled, false);
    assertEquals(result.platforms.email?.pollIntervalMs, 300000);
  });
});

test("loadConfig - email enabled is a complete platform on its own", async () => {
  const validEmailConfig = `
platforms:
  discord:
    enabled: false
  misskey:
    enabled: false
  email:
    enabled: true
    address: "bot@example.com"
    imap:
      host: "imap.example.com"
      username: "bot"
      password: "secret-imap-password"
      tlsMode: "tls"
    smtp:
      host: "smtp.example.com"
      username: "bot"
      password: "secret-smtp-password"
      tlsMode: "tls"
    receivingAuth:
      authservId: "mail.example.com"
      attestedStripping: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(validEmailConfig, async (dir) => {
    // Email is the only enabled platform: no Discord token is required, and the complete
    // transport/trust configuration loads instead of being rejected by an activation guard.
    const result = await loadConfig(dir);
    assertEquals(result.platforms.email?.enabled, true);
    assertEquals(result.platforms.email?.address, "bot@example.com");
    assertEquals(result.platforms.email?.imap.tlsMode, "tls");
    assertEquals(result.platforms.email?.imap.port, 993);
    assertEquals(result.platforms.email?.smtp.port, 465);
    assertEquals(result.platforms.email?.receivingAuth.attestedStripping, true);
  });

  for (const invalidCa of ["true", "123", "[certificate]"]) {
    const invalidConfig = validEmailConfig.replace(
      'address: "bot@example.com"',
      `address: "bot@example.com"\n    tlsCa: ${invalidCa}`,
    );
    await withTestConfig(invalidConfig, async (dir) => {
      await assertRejects(
        () => loadConfig(dir),
        ConfigError,
        "platforms.email.tlsCa must be a PEM certificate bundle string",
      );
    });
  }
});

test("loadConfig - email enabled rejects plaintext or opportunistic TLS mode", async () => {
  const invalidTlsConfig = `
platforms:
  discord:
    enabled: false
  email:
    enabled: true
    address: "bot@example.com"
    imap:
      host: "imap.example.com"
      username: "bot"
      password: "secret-imap-password"
      tlsMode: "plaintext"
    smtp:
      host: "smtp.example.com"
      username: "bot"
      password: "secret-smtp-password"
      tlsMode: "tls"
    receivingAuth:
      authservId: "mail.example.com"
      attestedStripping: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  await withTestConfig(invalidTlsConfig, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "plaintext and opportunistic TLS are prohibited",
    );
  });
});

test("loadConfig - email enabled rejects missing receivingAuth trust declaration", async () => {
  const unauthenticatedConfig = `
platforms:
  discord:
    enabled: false
  email:
    enabled: true
    address: "bot@example.com"
    imap:
      host: "imap.example.com"
      username: "bot"
      password: "secret-imap-password"
      tlsMode: "tls"
    smtp:
      host: "smtp.example.com"
      username: "bot"
      password: "secret-smtp-password"
      tlsMode: "tls"
    receivingAuth:
      authservId: "mail.example.com"
      attestedStripping: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  await withTestConfig(unauthenticatedConfig, async (dir) => {
    // attestedStripping: false fails validation before the activation guard is consulted.
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "platforms.email.receivingAuth.attestedStripping must be true when email is enabled",
    );
  });
});

test("loadConfig - email channels normalized to safe userId", async () => {
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
channels:
  - id: "email/account/User+tag@EXAMPLE.COM"
  - id: "email/account/invalid@@address"
`;
  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.channels.length, 1);
    assertEquals(result.channels[0].id.startsWith("email/account/e_"), true);
  });
});

test("loadConfig - email signature containing ${DISCORD_TOKEN} remains literal and unexpanded", () => {
  process.env["DISCORD_TOKEN"] = "real-secret-token";
  const configWithSignature = `
platforms:
  discord:
    token: "token123"
    enabled: true
  email:
    enabled: false
    signature: |
      Regards,
      Bot
      \${DISCORD_TOKEN}
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  return withTestConfig(configWithSignature, async (dir) => {
    const loaded = await loadConfig(dir);
    assertEquals(loaded.platforms.email?.signature.includes("${DISCORD_TOKEN}"), true);
    assertEquals(loaded.platforms.email?.signature.includes("real-secret-token"), false);
  }).finally(() => {
    delete process.env["DISCORD_TOKEN"];
  });
});

// --- agent.defaultAgentType configuration tests ---

async function withEnv(
  key: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

const agentTypeConfig = (agentSnippet: string) => `
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
${agentSnippet}
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

test("Config - omitted defaultAgentType loads with effective default opencode", async () => {
  await withTestConfig(agentTypeConfig(""), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.defaultAgentType, undefined);
    assertEquals(getDefaultAgentType(result), "opencode");
  });
});

test("Config - defaultAgentType: 'omp' in YAML loads as omp", async () => {
  const snippet = `  defaultAgentType: "omp"`;
  await withTestConfig(agentTypeConfig(snippet), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.defaultAgentType, "omp");
    assertEquals(getDefaultAgentType(result), "omp");
  });
});

test("Config - AGENT_DEFAULT_TYPE=omp env override loads as omp", async () => {
  await withEnv("AGENT_DEFAULT_TYPE", "omp", async () => {
    await withTestConfig(agentTypeConfig(""), async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.defaultAgentType, "omp");
      assertEquals(getDefaultAgentType(result), "omp");
    });
  });
});

test("Config - invalid defaultAgentType values fail startup with ConfigError", async () => {
  const invalidValues = [
    '"pi"',
    '"OpenCode"',
    '" omp "',
    "true",
    '""',
  ];

  for (const val of invalidValues) {
    const snippet = `  defaultAgentType: ${val}`;
    await withTestConfig(agentTypeConfig(snippet), async (dir) => {
      let caughtError: ConfigError | null = null;
      try {
        await loadConfig(dir);
      } catch (err) {
        if (err instanceof ConfigError) {
          caughtError = err;
        }
      }
      assertEquals(caughtError !== null, true, `Should have rejected defaultAgentType: ${val}`);
      assertEquals(caughtError?.code, ErrorCode.CONFIG_INVALID);
      assertEquals(caughtError?.message.includes("agent.defaultAgentType"), true);
      assertEquals(caughtError?.message.includes("opencode, omp"), true);
    });
  }
});

test("Config - invalid AGENT_DEFAULT_TYPE env overrides fail startup with ConfigError", async () => {
  const invalidEnvValues = [
    "pi",
    "OpenCode",
    " omp ",
    "true",
  ];

  for (const envVal of invalidEnvValues) {
    await withEnv("AGENT_DEFAULT_TYPE", envVal, async () => {
      await withTestConfig(agentTypeConfig(""), async (dir) => {
        let caughtError: ConfigError | null = null;
        try {
          await loadConfig(dir);
        } catch (err) {
          if (err instanceof ConfigError) {
            caughtError = err;
          }
        }
        assertEquals(caughtError !== null, true, `Should have rejected env override: ${envVal}`);
        assertEquals(caughtError?.code, ErrorCode.CONFIG_INVALID);
        assertEquals(caughtError?.message.includes("agent.defaultAgentType"), true);
        assertEquals(caughtError?.message.includes("opencode, omp"), true);
        assertEquals(caughtError?.context?.field, "agent.defaultAgentType");
      });
    });
  }
});

test("Config - unresolved ${AGENT_DEFAULT_TYPE} expansion to empty string fails with ConfigError", async () => {
  await withEnv("AGENT_DEFAULT_TYPE", undefined, async () => {
    const snippet = `  defaultAgentType: "\${AGENT_DEFAULT_TYPE}"`;
    await withTestConfig(agentTypeConfig(snippet), async (dir) => {
      let caughtError: ConfigError | null = null;
      try {
        await loadConfig(dir);
      } catch (err) {
        if (err instanceof ConfigError) {
          caughtError = err;
        }
      }
      assertEquals(caughtError !== null, true, "Should have rejected empty expansion");
      assertEquals(caughtError?.code, ErrorCode.CONFIG_INVALID);
      assertEquals(caughtError?.context?.field, "agent.defaultAgentType");
    });
  });
});

test("loadConfig - should apply default values", async () => {
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
    assertEquals(result.memory.recentMessageLimit, 20);
    assertEquals(result.logging.level, "INFO");
  });
});

test("Config - removed memory.searchLimit/maxChars inject no defaults", async () => {
  await withTestConfig(recallConfig(""), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(Object.hasOwn(result.memory, "searchLimit"), false);
    assertEquals(Object.hasOwn(result.memory, "maxChars"), false);
    assertEquals(result.memory.workingTierLimit, 20);
    assertEquals(result.memory.recall?.coreMaxTokens, 512);
  });
});

test("Config - legacy memory.searchLimit/maxChars keys load without error and stay inert", async () => {
  const memory = `memory:
  searchLimit: 5
  maxChars: 1000
  recall:
    fastRecallMaxTokens: 128`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    const result = await loadConfig(dir);
    // The legacy keys are merged verbatim — never defaulted, never read.
    const merged = result.memory as unknown as Record<string, unknown>;
    assertEquals(merged.searchLimit, 5);
    assertEquals(merged.maxChars, 1000);
    // Retrieval budgets and the surviving knobs are unaffected: the explicit
    // budget survives and every other budget still falls back to its default.
    assertEquals(result.memory.workingTierLimit, 20);
    assertEquals(result.memory.recall?.fastRecallMaxTokens, 128);
    assertEquals(result.memory.recall?.coreMaxTokens, 512);
    assertEquals(result.memory.recall?.fastRecallEnabled, true);
  });
});

test("loadConfig - should override with environment variables", async () => {
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
  process.env["DISCORD_TOKEN"] = "env-override-token";

  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.token, "env-override-token");
    });
  } finally {
    delete process.env["DISCORD_TOKEN"];
  }
});

test("loadConfig - DISCORD_ENABLED env overrides config file", async () => {
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

  process.env["DISCORD_ENABLED"] = "true";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.enabled, true);
    });
  } finally {
    delete process.env["DISCORD_ENABLED"];
  }
});

test("loadConfig - MISSKEY_ENABLED env overrides config file", async () => {
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

  process.env["MISSKEY_ENABLED"] = "true";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.misskey.enabled, true);
    });
  } finally {
    delete process.env["MISSKEY_ENABLED"];
  }
});

test("loadConfig - AGENT_DEFAULT_TYPE env overrides config file", async () => {
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
  defaultAgentType: "opencode"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  process.env["AGENT_DEFAULT_TYPE"] = "opencode";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.defaultAgentType, "opencode");
    });
  } finally {
    delete process.env["AGENT_DEFAULT_TYPE"];
  }
});

test("loadConfig - AGENT_SKILLS_DIR env overrides config file", async () => {
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

  process.env["AGENT_SKILLS_DIR"] = "/home/air/.agents/skills";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.skillsDir, "/home/air/.agents/skills");
    });
  } finally {
    delete process.env["AGENT_SKILLS_DIR"];
  }
});

test("loadConfig - should throw on missing required fields", async () => {
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

test("loadConfig - should throw when no platform is enabled", async () => {
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
  const tempDir = await makeTempDir();
  try {
    const promptDir = `${tempDir}/prompts`;
    await fsp.mkdir(promptDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await fsp.writeFile(`${promptDir}/${name}`, content);
    }
    await fn(`${promptDir}/system_reply.md`);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
}

test("loadSystemPrompt - should include fragment file content via Vento include", async () => {
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

test("loadSystemPrompt - should include multiple different fragments", async () => {
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

test("loadSystemPrompt - should reuse set variable appearing multiple times", async () => {
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

test("loadSystemPrompt - should throw error when included file is missing", async () => {
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

test("loadSystemPrompt - include uses explicit file paths", async () => {
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

test("loadSystemPrompt - should trim final result", async () => {
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

test("loadSystemPrompt - should throw when system prompt file not found", async () => {
  await assertRejects(
    () => loadSystemPrompt("/nonexistent/path/system_reply.md", defaultVars),
    ConfigError,
    "System prompt file not found",
  );
});

test("loadSystemPrompt - should handle prompt with no placeholders", async () => {
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

// The conversation-summary prompt's Usage example must render the LITERAL
// session id + staging dir it is given — and NEVER fall back to shell tokens:
// every bundled payload-staging render supplies both values in both spawn
// shapes, and an operator-mounted template must not resurrect the tokens.
// Renders the REAL prompts/system_summary.md so the example stays copy-pasteable.
test("loadSystemPrompt - system_summary Usage example renders the literal session id + tmpDir", async () => {
  const promptPath = join(import.meta.dirname ?? ".", "..", "..", "prompts", "system_summary.md");
  const withSession = await loadSystemPrompt(promptPath, {
    ...defaultVars,
    sessionId: "sess_sum",
    tmpDir: "/data/workspaces/discord/u1/tmp/sess_sum",
  });
  assertEquals(
    withSession.includes("--session-id 'sess_sum'"),
    true,
    "example should carry the rendered session id",
  );
  assertEquals(
    withSession.includes("--content-file '/data/workspaces/discord/u1/tmp/sess_sum/summary.md'"),
    true,
    "example should carry the rendered staging directory",
  );
  assertEquals(withSession.includes('"$SESSION_ID"'), false);

  // Even WITHOUT the values the template no longer emits shell tokens — the
  // `|| "$SESSION_ID"` fallbacks are gone (an absent id renders empty rather
  // than a token the agent cannot act on).
  const noSession = await loadSystemPrompt(promptPath, defaultVars);
  assertEquals(noSession.includes("$SESSION_ID"), false);
  assertEquals(noSession.includes("$TMPDIR"), false);
});

// --- accessControl configuration tests ---

test("loadConfig - should apply default accessControl values", async () => {
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

test("loadConfig - should load valid accessControl configuration", async () => {
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

test("loadConfig - REPLY_TO env overrides config file", async () => {
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

  process.env["REPLY_TO"] = "all";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.replyPolicy, "all");
    });
  } finally {
    delete process.env["REPLY_TO"];
  }
});

test("loadConfig - CHANNELS env overrides config file with JSON values", async () => {
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

  process.env["CHANNELS"] =
    '[{"id":"discord/account/123456789012345678"},{"id":"discord/channel/987654321098765432"},{"id":"misskey/account/abcdef1234567890"}]';
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
    delete process.env["CHANNELS"];
  }
});

test("loadConfig - CHANNELS env trims whitespace handled via JSON", async () => {
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

  process.env["CHANNELS"] =
    '[{"id":"discord/account/12345678901234567"},{"id":"misskey/channel/456"}]';
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.channels.map((c) => c.id), [
        "discord/account/12345678901234567",
        "misskey/channel/456",
      ]);
    });
  } finally {
    delete process.env["CHANNELS"];
  }
});

test("loadConfig - empty CHANNELS env does not override config file", async () => {
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

  process.env["CHANNELS"] = "";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.channels.map((c) => c.id), [
        "discord/account/123456789012345678",
      ]);
    });
  } finally {
    delete process.env["CHANNELS"];
  }
});

test("loadConfig - should throw on invalid replyTo value", async () => {
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

test("loadConfig - should filter invalid whitelist entries and warn", async () => {
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

test("loadConfig - should accept all valid whitelist entry formats", async () => {
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

test("loadConfig - should reject Discord whitelist entries with non-numeric IDs", async () => {
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

test("loadConfig - should reject Discord IDs that are too short or too long", async () => {
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

test("loadConfig - should still accept Misskey IDs with various formats", async () => {
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

test("Config - spontaneousPost default values are applied", async () => {
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

test("Config - spontaneousPost.enabled can be set via env var", async () => {
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

  process.env["DISCORD_SPONTANEOUS_ENABLED"] = "true";
  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.platforms.discord.spontaneousPost?.enabled, true);
    });
  } finally {
    delete process.env["DISCORD_SPONTANEOUS_ENABLED"];
  }
});

test("Config - spontaneousPost validation swaps min/max interval when reversed", async () => {
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

test("Config - spontaneousPost validation clamps minIntervalMs to 60 seconds", async () => {
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

test("Config - spontaneousPost validation clamps contextFetchProbability to [0, 1]", async () => {
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

test("Config - spontaneousPost validation clamps negative contextFetchProbability to 0", async () => {
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

test("Config - spontaneousPost merges partial config with defaults", async () => {
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

test("Config - selfResearch default values are applied", async () => {
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
    assertEquals(result.selfResearch?.verifyCompletion, true);
  });
});

test("Config - selfResearch enabled with valid config", async () => {
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

test("Config - selfResearch auto-disables when rssFeeds is empty", async () => {
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

test("Config - selfResearch auto-disables when model is empty", async () => {
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

test("Config - selfResearch clamps minIntervalMs to 1 hour", async () => {
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

test("Config - selfResearch swaps min/max interval when reversed", async () => {
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

test("Config - selfResearch merges partial config with defaults", async () => {
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

test("Config - selfResearch filters out empty url feeds", async () => {
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

test("Config - applies memoryMaintenance defaults", async () => {
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

test("Config - clamps memoryMaintenance intervalMs minimum to 1 hour", async () => {
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

test("Config - clamps memoryMaintenance minMemoryCount minimum to 10", async () => {
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

test("Config - memoryMaintenance disables if model is missing", async () => {
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

test("Config - metrics defaults when not specified", async () => {
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

test("Config - metrics respects user values", async () => {
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

test("Config - applies gitBackup defaults when not specified", async () => {
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

test("Config - merges partial gitBackup config with defaults", async () => {
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

test("loadConfig - should set default modelRouting when not configured", async () => {
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

test("loadConfig - should skip invalid model routing rules (missing match)", async () => {
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

test("loadConfig - should skip invalid model routing rules (empty model string)", async () => {
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

test("loadConfig - should skip rules with invalid whitelist format", async () => {
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

test("loadConfig - should skip rules with invalid sessionType", async () => {
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

test("loadConfig - should accept rules with multiple match conditions (AND)", async () => {
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

test("loadConfig - should preserve valid rules and discard invalid ones", async () => {
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

test("loadConfig - should validate contentKeywords as array", async () => {
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

test("loadConfig - should filter empty contentKeywords entries", async () => {
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

test("loadConfig - should accept rule with whitelist + contentKeywords", async () => {
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

test("loadConfig - should skip rule with empty match object", async () => {
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
import fs from "node:fs";
import fsp from "node:fs/promises";
import { describe, test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

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

describe("config-loader - mcpServers", () => {
  test("valid stdio server is loaded", async () => {
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

  test("valid http server is loaded", async () => {
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

  test("server with missing name is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - command: "echo"
      args: ["hello"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  test("server with duplicate name is skipped", async () => {
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

  test("stdio server with missing command is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "no-cmd"
      args: ["hello"]`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  test("http server with missing url is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "no-url"
      transport: "http"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  test("unknown transport is skipped", async () => {
    const config = mcpAgentConfig(`  mcpServers:
    - name: "bad-transport"
      transport: "grpc"
      url: "http://example.com"`);
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  test("${ENV_VAR} in env values is expanded", async () => {
    process.env["TEST_MCP_TOKEN"] = "secret123";
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
      delete process.env["TEST_MCP_TOKEN"];
    }
  });

  test("${ENV_VAR} in url is expanded", async () => {
    process.env["TEST_MCP_HOST"] = "myhost.example.com";
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
      delete process.env["TEST_MCP_HOST"];
    }
  });

  test("${ENV_VAR} in headers is expanded", async () => {
    process.env["TEST_MCP_BEARER"] = "bearer-token";
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
      delete process.env["TEST_MCP_BEARER"];
    }
  });

  test("unset ${ENV_VAR} expands to empty string", async () => {
    delete process.env["NONEXISTENT_MCP_VAR_12345"];
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

  test("empty mcpServers array is valid", async () => {
    const config = mcpAgentConfig("  mcpServers: []");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers?.length, 0);
    });
  });

  test("missing mcpServers field is valid", async () => {
    const config = mcpAgentConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.mcpServers, undefined);
    });
  });
});

describe("loadConfig - externalSkills validation", () => {
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

  test("valid externalSkills are preserved", async () => {
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

  test("invalid externalSkills entries are filtered out", async () => {
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

  test("missing externalSkills defaults to empty array", async () => {
    const config = baseConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.externalSkills?.length, 0);
    });
  });
});

describe("loadConfig - autoApproveSkills validation", () => {
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

  test("valid autoApproveSkills are preserved", async () => {
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

  test("empty strings are filtered out", async () => {
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

  test("missing autoApproveSkills is undefined", async () => {
    const config = baseConfig("");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills, undefined);
    });
  });

  test("empty array results in undefined", async () => {
    const config = baseConfig("  autoApproveSkills: []");
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.autoApproveSkills, undefined);
    });
  });
});

describe("convertUserMCPServerConfigs", () => {
  test("converts stdio config correctly", () => {
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

  test("converts http config correctly", () => {
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

  test("converts sse config correctly", () => {
    const result = convertUserMCPServerConfigs([{
      name: "sse-test",
      transport: "sse",
      url: "https://events.example.com/mcp",
    }]);
    assertEquals(result.length, 1);
    assertEquals((result[0] as { type: string }).type, "sse");
    assertEquals((result[0] as { url: string }).url, "https://events.example.com/mcp");
  });

  test("handles missing optional fields", () => {
    const result = convertUserMCPServerConfigs([{
      name: "minimal-stdio",
      command: "echo",
    }]);
    assertEquals(result.length, 1);
    assertEquals((result[0] as { args: string[] }).args, []);
    assertEquals((result[0] as { env?: unknown }).env, undefined);
  });

  test("default transport is stdio", () => {
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

test("loadChannels - preserves yolo field from object format", async () => {
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

test("loadChannels - yolo defaults to false when not specified", async () => {
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

test("loadConfig - default sandbox includes allowedWriteExtensions [.md, .txt]", async () => {
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

test("loadConfig - custom allowedWriteExtensions from config is preserved", async () => {
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

test("loadConfig - invalid allowedWriteExtensions entries (non-dot-prefixed) are filtered out", async () => {
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

test("loadConfig - non-array allowedWriteExtensions is replaced with default", async () => {
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

// --- egressAllowHosts sandbox config tests ---

test("loadConfig - egressAllowHosts defaults to an empty list", async () => {
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
    assertEquals(result.agent.sandbox?.egressAllowHosts, []);
  });
});

test("loadConfig - egressAllowHosts from config is preserved, empty entries dropped", async () => {
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
    egressAllowHosts:
      - "192.168.1.10"
      - "internal-proxy"
      - ""
      - "   "
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.egressAllowHosts, ["192.168.1.10", "internal-proxy"]);
  });
});

test("loadConfig - non-array egressAllowHosts falls back to an empty list", async () => {
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
    egressAllowHosts: "not-an-array"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.agent.sandbox?.egressAllowHosts, []);
  });
});

test("loadConfig - default gitCredential config is applied", async () => {
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

test("loadConfig - gitCredential config merges with defaults", async () => {
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

test("loadConfig - connectTimeoutMs defaults to 30000 when unset", async () => {
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
    assertEquals(result.agent.connectTimeoutMs, 30000);
  });
});

test("loadConfig - AGENT_CONNECT_TIMEOUT_MS env overrides agent.connectTimeoutMs", async () => {
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
  connectTimeoutMs: 30000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

  process.env["AGENT_CONNECT_TIMEOUT_MS"] = "15000";

  try {
    await withTestConfig(config, async (dir) => {
      const result = await loadConfig(dir);
      assertEquals(result.agent.connectTimeoutMs, 15000);
    });
  } finally {
    delete process.env["AGENT_CONNECT_TIMEOUT_MS"];
  }
});

// --- memory.recall configuration tests ---

/** Minimal valid configuration; `memory` is appended per test. */
function recallConfig(memory: string): string {
  return `
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
${memory}
`;
}

test("Config - applies memory.recall defaults", async () => {
  await withTestConfig(recallConfig(""), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memory.recall?.fastRecallEnabled, true);
    assertEquals(result.memory.recall?.fastRecallMaxResults, 2);
    assertEquals(result.memory.recall?.fastRecallMaxTokens, 192);
    assertEquals(result.memory.recall?.fastRecallNoteMaxResults, 2);
    assertEquals(result.memory.recall?.fastRecallNoteMaxTokens, 256);
    assertEquals(result.memory.recall?.coreMaxTokens, 512);
    assertEquals(result.memory.recall?.workingMaxItems, 4);
    assertEquals(result.memory.recall?.workingMaxTokens, 384);
    assertEquals(result.memory.recall?.minRecallScore, 6.75);
    assertEquals(result.memory.recall?.secondRecallScore, 6.5);
    assertEquals(result.memory.recall?.noteMinRecallScore, 11.5);
    assertEquals(result.memory.recall?.secondNoteRecallScore, 9.25);
    assertEquals(result.memory.recall?.secondResultRatio, 0.65);
    assertEquals(result.memory.recall?.deepRecallMaxTokens, 1024);
    assertEquals(result.memory.recall?.deepMinRecallScore, 0);
  });
});

test("Config - memory.recall keeps every default a partial override does not set", async () => {
  const memory = `memory:
  recall:
    fastRecallMaxTokens: 128`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.memory.recall?.fastRecallMaxTokens, 128);
    assertEquals(result.memory.recall?.fastRecallEnabled, true);
    assertEquals(result.memory.recall?.fastRecallMaxResults, 2);
    assertEquals(result.memory.recall?.fastRecallNoteMaxResults, 2);
    assertEquals(result.memory.recall?.fastRecallNoteMaxTokens, 256);
    assertEquals(result.memory.recall?.coreMaxTokens, 512);
    assertEquals(result.memory.recall?.workingMaxItems, 4);
    assertEquals(result.memory.recall?.workingMaxTokens, 384);
    assertEquals(result.memory.recall?.noteMinRecallScore, 11.5);
    assertEquals(result.memory.recall?.secondNoteRecallScore, 9.25);
    assertEquals(result.memory.recall?.secondResultRatio, 0.65);
    assertEquals(result.memory.recall?.deepRecallMaxTokens, 1024);
  });
});

test("Config - rejects a negative memory.recall.coreMaxTokens", async () => {
  const memory = `memory:
  recall:
    coreMaxTokens: -1`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.workingMaxItems", async () => {
  const memory = `memory:
  recall:
    workingMaxItems: -1`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.workingMaxTokens", async () => {
  const memory = `memory:
  recall:
    workingMaxTokens: -1`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-integer memory.recall.workingMaxItems", async () => {
  const memory = `memory:
  recall:
    workingMaxItems: 1.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a memory.recall.secondResultRatio above 1", async () => {
  const memory = `memory:
  recall:
    secondResultRatio: 1.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.minRecallScore", async () => {
  const memory = `memory:
  recall:
    minRecallScore: -0.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-integer memory.recall.fastRecallMaxResults", async () => {
  const memory = `memory:
  recall:
    fastRecallMaxResults: 1.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a memory.recall.deepRecallMaxTokens of zero", async () => {
  const memory = `memory:
  recall:
    deepRecallMaxTokens: 0`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-numeric memory.recall.minRecallScore", async () => {
  const memory = `memory:
  recall:
    minRecallScore: "3"`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-boolean memory.recall.fastRecallEnabled", async () => {
  const memory = `memory:
  recall:
    fastRecallEnabled: "yes"`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.fastRecallNoteMaxResults", async () => {
  const memory = `memory:
  recall:
    fastRecallNoteMaxResults: -1`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-integer memory.recall.fastRecallNoteMaxResults", async () => {
  const memory = `memory:
  recall:
    fastRecallNoteMaxResults: 1.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.fastRecallNoteMaxTokens", async () => {
  const memory = `memory:
  recall:
    fastRecallNoteMaxTokens: -1`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-integer memory.recall.fastRecallNoteMaxTokens", async () => {
  const memory = `memory:
  recall:
    fastRecallNoteMaxTokens: 1.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.noteMinRecallScore", async () => {
  const memory = `memory:
  recall:
    noteMinRecallScore: -0.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-numeric memory.recall.noteMinRecallScore", async () => {
  const memory = `memory:
  recall:
    noteMinRecallScore: "3"`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a negative memory.recall.secondNoteRecallScore", async () => {
  const memory = `memory:
  recall:
    secondNoteRecallScore: -0.5`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

test("Config - rejects a non-numeric memory.recall.secondNoteRecallScore", async () => {
  const memory = `memory:
  recall:
    secondNoteRecallScore: "3"`;

  await withTestConfig(recallConfig(memory), async (dir) => {
    await assertRejects(() => loadConfig(dir), ConfigError);
  });
});

// --- identity groups configuration tests ---

const identityConfig = (identitiesSnippet: string) => `
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
${identitiesSnippet}
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

function identityError(raw: unknown): ConfigError {
  return assertThrows(() => normalizeIdentities(raw), ConfigError);
}

test("identity groups - workspace key kept as-is", () => {
  assertEquals(
    normalizeIdentities([{ id: "alice", accounts: ["discord/123456789012345678"] }]),
    [{ id: "alice", accounts: ["discord/123456789012345678"] }],
  );
});

test("identity groups - channel-style account id collapsed", () => {
  assertEquals(
    normalizeIdentities([{ id: "alice", accounts: ["misskey/account/abcdef1234567890"] }])[0]
      .accounts,
    ["misskey/abcdef1234567890"],
  );
});

test("identity groups - email address forms hashed", () => {
  const expected = `email/${normalizeEmailMailbox("Alice@example.com").userId}`;
  const entries = [
    " Alice@Example.COM ",
    "email/Alice@example.com",
    "email/account/Alice@example.com",
  ];

  for (const entry of entries) {
    assertEquals(
      normalizeIdentities([{ id: "alice", accounts: [entry] }])[0].accounts,
      [expected],
    );
  }
});

test("identity groups - email owner id kept as-is", () => {
  const userId = `e_${"a".repeat(64)}`;
  assertEquals(
    normalizeIdentities([{ id: "alice", accounts: [`email/${userId}`] }])[0].accounts,
    [`email/${userId}`],
  );
});

test("identity groups - omitted identities load as []", async () => {
  await withTestConfig(identityConfig(""), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.identities, []);
  });
});

test("identity groups - empty YAML identities key loads as []", async () => {
  await withTestConfig(identityConfig("identities:"), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.identities, []);
  });
});

test("identity groups - YAML block is normalized end to end", async () => {
  const yaml = `identities:
  - id: " alice "
    accounts:
      - "discord/123456789012345678"
      - "misskey/account/abcdef1234567890"
      - "Alice@example.com"`;

  await withTestConfig(identityConfig(yaml), async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.identities, [{
      id: "alice",
      accounts: [
        "discord/123456789012345678",
        "misskey/abcdef1234567890",
        `email/${normalizeEmailMailbox("Alice@example.com").userId}`,
      ],
    }]);
  });
});

test("identity groups - shape errors name the field path", () => {
  const cases: [unknown, string][] = [
    [{}, "identities must be an array"],
    ["not-an-array", "identities must be an array"],
    [[null], "identities[0] must be a mapping"],
    [[[]], "identities[0] must be a mapping"],
    [[1], "identities[0] must be a mapping"],
    [[{}], "identities[0].id must be a non-empty string"],
    [[{ id: "  ", accounts: ["discord/1"] }], "identities[0].id must be a non-empty string"],
    [[{ id: 1, accounts: ["discord/1"] }], "identities[0].id must be a non-empty string"],
    [[{ id: "alice" }], "identities[0].accounts must be a non-empty array"],
    [[{ id: "alice", accounts: [] }], "identities[0].accounts must be a non-empty array"],
    [[{ id: "alice", accounts: "discord/1" }], "identities[0].accounts must be a non-empty array"],
    [[{ id: "alice", accounts: [1] }], "identities[0].accounts[0] must be a string"],
  ];

  for (const [raw, message] of cases) {
    const error = identityError(raw);
    assertEquals(error.message, message);
    assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  }
});

test("identity groups - duplicate group id rejected at the later group", () => {
  const error = identityError([
    { id: "alice", accounts: ["discord/1"] },
    { id: " alice ", accounts: ["discord/2"] },
  ]);

  assertEquals(error.message, "identities[1].id duplicates an earlier group id");
  assertEquals(error.context, { field: "identities[1].id" });
});

test("identity groups - unsupported account forms rejected", () => {
  const entries = [
    "slack/123",
    "slack/account/123",
    "discord",
    "alice",
    "discord/channel/123456789012345678",
    "misskey/timeline/self",
    "discord/alice@example.com",
    "discord/",
    "discord/a/b",
    "discord/..",
    "discord/.hidden",
    "discord/ alice",
    "discord/a\\b",
    "not-an-address@@example.com",
    "email/",
  ];

  for (const entry of entries) {
    const error = identityError([{ id: "alice", accounts: [entry] }]);
    assertEquals(error.message, "identities[0].accounts[0] is not a supported identity account");
    assertEquals(error.context, { field: "identities[0].accounts[0]" });
  }
});

test("identity groups - errors never echo the account value", () => {
  const raw = "not-an-address@@example.com";
  const error = identityError([{ id: "alice", accounts: [raw] }]);

  assertEquals(error.message.includes("not-an-address"), false);
  assertEquals(JSON.stringify(error.context).includes("not-an-address"), false);
});

test("identity groups - duplicate account within one group rejected", () => {
  const error = identityError([
    { id: "alice", accounts: ["alice@example.com", "email/alice@example.com"] },
  ]);

  assertEquals(error.message, "identities[0].accounts[1] duplicates identities[0].accounts[0]");
});

test("identity groups - duplicate account across groups rejected", () => {
  const error = identityError([
    { id: "alice", accounts: ["discord/123"] },
    { id: "bob", accounts: ["discord/123"] },
  ]);

  assertEquals(error.message, "identities[1].accounts[0] duplicates identities[0].accounts[0]");
});

test("identity groups - IDENTITIES env override replaces the YAML value", async () => {
  const yaml = `identities:
  - id: "bob"
    accounts:
      - "discord/999"`;

  await withTestConfig(identityConfig(yaml), async (dir) => {
    const override = JSON.stringify([
      { id: "alice", accounts: ["discord/123", "alice@example.com"] },
    ]);
    await withEnv("IDENTITIES", override, async () => {
      const result = await loadConfig(dir);
      assertEquals(result.identities, [{
        id: "alice",
        accounts: [
          "discord/123",
          `email/${normalizeEmailMailbox("alice@example.com").userId}`,
        ],
      }]);
    });
  });
});

test("identity groups - invalid IDENTITIES override is ignored", async () => {
  const yaml = `identities:
  - id: "bob"
    accounts:
      - "discord/999"`;

  for (const invalid of ['{"id":"alice"}', "not json"]) {
    await withTestConfig(identityConfig(""), async (dir) => {
      await withEnv("IDENTITIES", invalid, async () => {
        assertEquals((await loadConfig(dir)).identities, []);
      });
    });
    await withTestConfig(identityConfig(yaml), async (dir) => {
      await withEnv("IDENTITIES", invalid, async () => {
        assertEquals(
          (await loadConfig(dir)).identities,
          [{ id: "bob", accounts: ["discord/999"] }],
        );
      });
    });
  }
});

test("identity groups - invalid group in IDENTITIES override rejected", async () => {
  await withTestConfig(identityConfig(""), async (dir) => {
    const override = JSON.stringify([{ id: "alice", accounts: ["discord/123", "discord/123"] }]);
    await withEnv("IDENTITIES", override, async () => {
      await assertRejects(() => loadConfig(dir), ConfigError);
    });
  });
});
