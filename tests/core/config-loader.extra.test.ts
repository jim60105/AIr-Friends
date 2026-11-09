import { assertEquals } from "@std/assert";
import { loadConfig } from "@core/config-loader.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

async function withTestConfig(
  configContent: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await makeTempDir();
  try {
    await fsp.writeFile(`${dir}/config.yaml`, configContent);
    await fsp.mkdir(`${dir}/prompts`, { recursive: true });
    await fsp.writeFile(`${dir}/prompts/system_reply.md`, "test");
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true });
  }
}

const baseConfig = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

test("config-loader - loadConfig applies reminder defaults when partial config", async () => {
  await withTestConfig(
    baseConfig + `
reminders:
  enabled: true
`,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.reminders?.enabled, true);
      assertEquals(typeof config.reminders?.maxRemindersPerUser, "number");
      assertEquals(typeof config.reminders?.minIntervalMs, "number");
      assertEquals(typeof config.reminders?.checkIntervalMs, "number");
      assertEquals(typeof config.reminders?.persistPath, "string");
    },
  );
});

test("config-loader - loadConfig clamps minIntervalMs to 10000", async () => {
  await withTestConfig(
    baseConfig + `
reminders:
  enabled: true
  minIntervalMs: 5000
`,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.reminders!.minIntervalMs, 10000);
    },
  );
});

test("config-loader - loadConfig clamps checkIntervalMs to 5000", async () => {
  await withTestConfig(
    baseConfig + `
reminders:
  enabled: true
  checkIntervalMs: 1000
`,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.reminders!.checkIntervalMs, 5000);
    },
  );
});

test("config-loader - loadConfig applies channelLurk defaults when not set", async () => {
  await withTestConfig(
    baseConfig,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.platforms.discord.channelLurk?.enabled, false);
      assertEquals(config.platforms.discord.channelLurk?.intervalMs, 1800000);
    },
  );
});

test("config-loader - loadConfig merges channelLurk partial config with defaults", async () => {
  const configWithLurk = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    channelLurk:
      enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  await withTestConfig(
    configWithLurk,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.platforms.discord.channelLurk?.enabled, true);
      assertEquals(config.platforms.discord.channelLurk?.intervalMs, 1800000);
    },
  );
});

test("config-loader - loadConfig clamps channelLurk intervalMs to 60000", async () => {
  const configWithSmallInterval = `
platforms:
  discord:
    token: "test-token"
    enabled: true
    channelLurk:
      enabled: true
      intervalMs: 5000
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  await withTestConfig(
    configWithSmallInterval,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.platforms.discord.channelLurk!.intervalMs, 60000);
    },
  );
});

test("config-loader - channelLurk sessionType is valid in model routing", async () => {
  const configWithRouting = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  modelRouting:
    enabled: true
    rules:
      - match:
          sessionType: "channelLurk"
        model: "gpt-5-mini"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
  await withTestConfig(
    configWithRouting,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.agent.modelRouting?.rules.length, 1);
      assertEquals(config.agent.modelRouting?.rules[0].match.sessionType, "channelLurk");
    },
  );
});
