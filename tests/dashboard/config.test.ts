// tests/dashboard/config.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig } from "@core/config-loader.ts";
import { ConfigError } from "../../src/types/errors.ts";

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

const minimalConfig = `
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

Deno.test("Dashboard config - defaults applied when section missing", async () => {
  await withTestConfig(minimalConfig, async (dir) => {
    const config = await loadConfig(dir);
    assertEquals(config.dashboard?.enabled, false);
    assertEquals(config.dashboard?.port, 8090);
    assertEquals(config.dashboard?.passphrase, "");
  });
});

Deno.test("Dashboard config - reject enabled: true with empty passphrase", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
  passphrase: ""
`;
  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "dashboard.passphrase is required",
    );
  });
});

Deno.test("Dashboard config - reject enabled: true with missing passphrase", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
`;
  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "dashboard.passphrase is required",
    );
  });
});

Deno.test("Dashboard config - valid enabled config accepted", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
  port: 9999
  passphrase: "my-secret"
`;
  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.dashboard?.enabled, true);
    assertEquals(result.dashboard?.port, 9999);
    assertEquals(result.dashboard?.passphrase, "my-secret");
  });
});

Deno.test("Dashboard config - env var overrides", async () => {
  Deno.env.set("DASHBOARD_ENABLED", "true");
  Deno.env.set("DASHBOARD_PORT", "7777");
  Deno.env.set("DASHBOARD_PASSPHRASE", "env-secret");
  try {
    await withTestConfig(minimalConfig, async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.dashboard?.enabled, true);
      assertEquals(config.dashboard?.port, 7777);
      assertEquals(config.dashboard?.passphrase, "env-secret");
    });
  } finally {
    Deno.env.delete("DASHBOARD_ENABLED");
    Deno.env.delete("DASHBOARD_PORT");
    Deno.env.delete("DASHBOARD_PASSPHRASE");
  }
});
