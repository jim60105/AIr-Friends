// tests/dashboard/config.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig } from "@core/config-loader.ts";
import { ConfigError } from "../../src/types/errors.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

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

test("Dashboard config - defaults applied when section missing", async () => {
  await withTestConfig(minimalConfig, async (dir) => {
    const config = await loadConfig(dir);
    assertEquals(config.dashboard?.enabled, false);
    assertEquals(config.dashboard?.port, 8090);
    assertEquals(config.dashboard?.passphrase, "");
  });
});

test("Dashboard config - reject enabled: true with empty passphrase", async () => {
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

test("Dashboard config - reject enabled: true with missing passphrase", async () => {
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

test("Dashboard config - valid enabled config accepted", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
  port: 9999
  passphrase: "a-sufficiently-long-secret"
`;
  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.dashboard?.enabled, true);
    assertEquals(result.dashboard?.port, 9999);
    assertEquals(result.dashboard?.passphrase, "a-sufficiently-long-secret");
    // New defaults (F8/F10/F5).
    assertEquals(result.dashboard?.host, "127.0.0.1");
    assertEquals(result.dashboard?.behindHttpsProxy, false);
    assertEquals(result.dashboard?.trustedProxies, []);
  });
});

test("Dashboard config - F5: reject enabled with weak (short) passphrase", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
  passphrase: "short"
`;
  await withTestConfig(config, async (dir) => {
    await assertRejects(
      () => loadConfig(dir),
      ConfigError,
      "at least 16 characters",
    );
  });
});

test("Dashboard config - F8/F10/F5: new fields loaded from YAML", async () => {
  const config = minimalConfig + `
dashboard:
  enabled: true
  host: "0.0.0.0"
  passphrase: "a-sufficiently-long-secret"
  behindHttpsProxy: true
  trustedProxies:
    - "10.0.0.1"
    - "::1"
`;
  await withTestConfig(config, async (dir) => {
    const result = await loadConfig(dir);
    assertEquals(result.dashboard?.host, "0.0.0.0");
    assertEquals(result.dashboard?.behindHttpsProxy, true);
    assertEquals(result.dashboard?.trustedProxies, ["10.0.0.1", "::1"]);
  });
});

test("Dashboard config - env var overrides", async () => {
  process.env["DASHBOARD_ENABLED"] = "true";
  process.env["DASHBOARD_PORT"] = "7777";
  process.env["DASHBOARD_PASSPHRASE"] = "env-secret-that-is-long";
  process.env["DASHBOARD_HOST"] = "0.0.0.0";
  process.env["DASHBOARD_BEHIND_HTTPS_PROXY"] = "true";
  process.env["DASHBOARD_TRUSTED_PROXIES"] = "10.0.0.1, 10.0.0.2";
  try {
    await withTestConfig(minimalConfig, async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.dashboard?.enabled, true);
      assertEquals(config.dashboard?.port, 7777);
      assertEquals(config.dashboard?.passphrase, "env-secret-that-is-long");
      assertEquals(config.dashboard?.host, "0.0.0.0");
      assertEquals(config.dashboard?.behindHttpsProxy, true);
      assertEquals(config.dashboard?.trustedProxies, ["10.0.0.1", "10.0.0.2"]);
    });
  } finally {
    delete process.env["DASHBOARD_ENABLED"];
    delete process.env["DASHBOARD_PORT"];
    delete process.env["DASHBOARD_PASSPHRASE"];
    delete process.env["DASHBOARD_HOST"];
    delete process.env["DASHBOARD_BEHIND_HTTPS_PROXY"];
    delete process.env["DASHBOARD_TRUSTED_PROXIES"];
  }
});
