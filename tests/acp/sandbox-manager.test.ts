// tests/acp/sandbox-manager.test.ts

import { assertEquals } from "@std/assert";
import { SandboxManager } from "../../src/acp/sandbox-manager.ts";
import type { SandboxConfig } from "../../src/types/config.ts";

const createSandboxConfig = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
  filterEnv: true,
  networkIsolation: false,
  allowedEnvVars: [],
  allowedWriteExtensions: [".md", ".txt"],
  ...overrides,
});

Deno.test("SandboxManager - filterEnv: true filters out non-allowed env vars", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    SECRET_TOKEN: "leaked",
    RANDOM_VAR: "x",
    OPENCODE_API_KEY: "oc_xxx",
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--agent"], baseEnv, "/tmp");
  assertEquals(opts.env["PATH"], "/usr/bin");
  assertEquals(opts.env["OPENCODE_API_KEY"], "oc_xxx");
  assertEquals(opts.env["SECRET_TOKEN"], undefined);
  assertEquals(opts.env["RANDOM_VAR"], undefined);
});

Deno.test("SandboxManager - filterEnv: false passes all env vars through", () => {
  const sandbox = new SandboxManager(createSandboxConfig({ filterEnv: false }));
  const baseEnv = { PATH: "/usr/bin", SECRET: "value" };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["SECRET"], "value");
  assertEquals(opts.env["PATH"], "/usr/bin");
});

Deno.test("SandboxManager - allowedEnvVars adds custom vars to filter", () => {
  const sandbox = new SandboxManager(
    createSandboxConfig({ allowedEnvVars: ["MY_CUSTOM_VAR"] }),
  );
  const baseEnv = { PATH: "/usr/bin", MY_CUSTOM_VAR: "kept", OTHER: "removed" };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["MY_CUSTOM_VAR"], "kept");
  assertEquals(opts.env["OTHER"], undefined);
});

Deno.test("SandboxManager - opencode agent allows all provider API keys", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    GEMINI_API_KEY: "gm_xxx",
    OPENROUTER_API_KEY: "or_xxx",
    OPENCODE_API_KEY: "oc_xxx",
    GOOGLE_GENERATIVE_AI_API_KEY: "gg_xxx",
    PIONEER_API_KEY: "pi_xxx",
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["GEMINI_API_KEY"], "gm_xxx");
  assertEquals(opts.env["OPENROUTER_API_KEY"], "or_xxx");
  assertEquals(opts.env["OPENCODE_API_KEY"], "oc_xxx");
  assertEquals(opts.env["GOOGLE_GENERATIVE_AI_API_KEY"], "gg_xxx");
  assertEquals(opts.env["PIONEER_API_KEY"], "pi_xxx");
});

Deno.test("SandboxManager - unknown agent type only gets base env", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    OPENCODE_API_KEY: "oc_xxx",
    PIONEER_API_KEY: "pi_xxx",
  };
  const opts = sandbox.buildSpawnOptions("unknown", "test", [], baseEnv, "/tmp");
  assertEquals(opts.env["PATH"], "/usr/bin");
  assertEquals(opts.env["OPENCODE_API_KEY"], undefined);
  assertEquals(opts.env["PIONEER_API_KEY"], undefined);
});

Deno.test("SandboxManager - base allowed env vars are preserved", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    USER: "deno",
    SHELL: "/bin/bash",
    TERM: "xterm",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    DENO_DIR: "/deno-dir",
    DENO_NO_UPDATE_CHECK: "1",
    SKILL_API_PORT: "3001",
    SESSION_ID: "sess_123",
    AGENT_WORKSPACE: "/workspace",
    OPENCODE_API_KEY: "oc_xxx",
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["PATH"], "/usr/bin");
  assertEquals(opts.env["HOME"], "/home/user");
  assertEquals(opts.env["DENO_DIR"], "/deno-dir");
  assertEquals(opts.env["SKILL_API_PORT"], "3001");
  assertEquals(opts.env["SESSION_ID"], "sess_123");
  assertEquals(opts.env["AGENT_WORKSPACE"], "/workspace");
});

Deno.test("SandboxManager - networkIsolation on Linux wraps with unshare", () => {
  // This test only runs on Linux where unshare is available
  if (Deno.build.os !== "linux") {
    return;
  }

  // Check if unshare is available
  try {
    const check = new Deno.Command("which", { args: ["unshare"] });
    const output = check.outputSync();
    if (!output.success) return;
  } catch {
    return;
  }

  const sandbox = new SandboxManager(
    createSandboxConfig({ networkIsolation: true, filterEnv: false }),
  );
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/tmp");
  assertEquals(opts.command, "unshare");
  assertEquals(opts.args, ["--net", "opencode", "--acp"]);
});

Deno.test("SandboxManager - networkIsolation false does not wrap command", () => {
  const sandbox = new SandboxManager(
    createSandboxConfig({ networkIsolation: false, filterEnv: false }),
  );
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/tmp");
  assertEquals(opts.command, "opencode");
  assertEquals(opts.args, ["--acp"]);
});

Deno.test("SandboxManager - cwd is passed through", () => {
  const sandbox = new SandboxManager(createSandboxConfig({ filterEnv: false }));
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], {}, "/my/workspace");
  assertEquals(opts.cwd, "/my/workspace");
});

Deno.test("SandboxManager - missing env vars are not included in filtered output", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = { PATH: "/usr/bin" };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["PATH"], "/usr/bin");
  assertEquals(opts.env["HOME"], undefined);
  assertEquals(opts.env["OPENCODE_API_KEY"], undefined);
});
