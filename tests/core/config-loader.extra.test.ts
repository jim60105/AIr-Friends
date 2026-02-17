import { assertEquals } from "@std/assert";
import { loadConfig } from "@core/config-loader.ts";

async function withTestConfig(
  configContent: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/config.yaml`, configContent);
    await Deno.mkdir(`${dir}/prompts`, { recursive: true });
    await Deno.writeTextFile(`${dir}/prompts/system_reply.md`, "test");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
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

Deno.test("config-loader - loadConfig applies reminder defaults when partial config", async () => {
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

Deno.test("config-loader - loadConfig clamps minIntervalMs to 10000", async () => {
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

Deno.test("config-loader - loadConfig clamps checkIntervalMs to 5000", async () => {
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
