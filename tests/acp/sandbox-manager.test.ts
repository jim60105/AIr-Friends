// tests/acp/sandbox-manager.test.ts

import { assertEquals, assertThrows } from "@std/assert";
import { SandboxManager } from "../../src/acp/sandbox-manager.ts";
import type { SandboxConfig } from "../../src/types/config.ts";
import {
  resetSandboxCapabilityCache,
  setSandboxCapabilityCacheForTest,
} from "../../src/acp/sandbox-capabilities.ts";

// Base helper: raw egress + no confinement, so command/env pass through unwrapped. Tests
// that exercise wrapping override the relevant flags and pin capability probe results.
const createSandboxConfig = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
  filterEnv: true,
  networkIsolation: false,
  allowedEnvVars: [],
  allowedWriteExtensions: [".md", ".txt"],
  filesystemConfinement: false,
  egressProxy: false,
  egressProxyPort: 0,
  unrestrictedEgress: true,
  egressAllowHosts: [],
  ...overrides,
});

function withCapabilities(network: boolean, confinement: boolean, fn: () => void): void {
  setSandboxCapabilityCacheForTest(network, confinement);
  try {
    fn();
  } finally {
    resetSandboxCapabilityCache();
  }
}

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

Deno.test("SandboxManager - session-scoped XDG_DATA_HOME passes through the filter (F12)", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    XDG_DATA_HOME: "/ws/tmp/opencode-data",
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/ws");
  assertEquals(opts.env["XDG_DATA_HOME"], "/ws/tmp/opencode-data");
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
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["GEMINI_API_KEY"], "gm_xxx");
  assertEquals(opts.env["OPENROUTER_API_KEY"], "or_xxx");
  assertEquals(opts.env["OPENCODE_API_KEY"], "oc_xxx");
  assertEquals(opts.env["GOOGLE_GENERATIVE_AI_API_KEY"], "gg_xxx");
});

Deno.test("SandboxManager - egress proxy env vars pass through the filter (F14)", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    HTTP_PROXY: "http://127.0.0.1:5555",
    HTTPS_PROXY: "http://127.0.0.1:5555",
    NO_PROXY: "localhost,127.0.0.1,::1",
  };
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], baseEnv, "/tmp");
  assertEquals(opts.env["HTTP_PROXY"], "http://127.0.0.1:5555");
  assertEquals(opts.env["HTTPS_PROXY"], "http://127.0.0.1:5555");
  assertEquals(opts.env["NO_PROXY"], "localhost,127.0.0.1,::1");
});

Deno.test("SandboxManager - unknown agent type only gets base env", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    OPENCODE_API_KEY: "oc_xxx",
  };
  const opts = sandbox.buildSpawnOptions("unknown", "test", [], baseEnv, "/tmp");
  assertEquals(opts.env["PATH"], "/usr/bin");
  assertEquals(opts.env["OPENCODE_API_KEY"], undefined);
});

Deno.test("SandboxManager - full networkIsolation wraps with userns-first unshare", () => {
  withCapabilities(true, false, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        networkIsolation: true,
        unrestrictedEgress: false,
        egressProxy: false,
        filesystemConfinement: false,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/tmp");
    assertEquals(opts.command, "unshare");
    // userns-first: bare `unshare --net` fails in a non-root container.
    assertEquals(opts.args, ["--user", "--map-root", "--net", "opencode", "--acp"]);
  });
});

Deno.test("SandboxManager - networkIsolation fails closed when the probe fails", () => {
  withCapabilities(false, false, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        networkIsolation: true,
        unrestrictedEgress: false,
        egressProxy: false,
        filesystemConfinement: false,
      }),
    );
    assertThrows(
      () => sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/tmp"),
      Error,
      "network isolation",
    );
  });
});

Deno.test("SandboxManager - unrestrictedEgress does not wrap the command", () => {
  const sandbox = new SandboxManager(
    createSandboxConfig({ unrestrictedEgress: true, filterEnv: false }),
  );
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/tmp");
  assertEquals(opts.command, "opencode");
  assertEquals(opts.args, ["--acp"]);
});

Deno.test("SandboxManager - no egress posture configured fails closed", () => {
  const sandbox = new SandboxManager(
    createSandboxConfig({
      unrestrictedEgress: false,
      egressProxy: false,
      networkIsolation: false,
      filesystemConfinement: false,
    }),
  );
  assertThrows(
    () => sandbox.buildSpawnOptions("opencode", "opencode", [], {}, "/tmp"),
    Error,
    "No agent egress posture configured",
  );
});

Deno.test("SandboxManager - filesystem confinement wraps with bwrap (shared net)", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: true, // proxy posture keeps the network shared
        unrestrictedEgress: false,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions(
      "opencode",
      "opencode",
      ["--acp"],
      { TMPDIR: "/ws/tmp", AGENT_WORKSPACE: "/agent-ws" },
      "/ws",
    );
    assertEquals(opts.command, "bwrap");
    // Fresh /proc hides the daemon environ; shared net (no --unshare-net) keeps Skill API.
    assertEquals(opts.args.includes("--proc"), true);
    assertEquals(opts.args.includes("--unshare-net"), false);
    // Only this session's own dirs are bound writable.
    assertEquals(opts.args.includes("/ws"), true);
    assertEquals(opts.args.includes("/agent-ws"), true);
    // The inner command is preserved after the `--` separator.
    const sepIndex = opts.args.indexOf("--");
    assertEquals(opts.args.slice(sepIndex + 1), ["opencode", "--acp"]);
  });
});

Deno.test("SandboxManager - confinement fails closed when bwrap probe fails", () => {
  withCapabilities(false, false, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: true,
        unrestrictedEgress: false,
      }),
    );
    assertThrows(
      () => sandbox.buildSpawnOptions("opencode", "opencode", [], {}, "/ws"),
      Error,
      "filesystem confinement",
    );
  });
});

Deno.test("SandboxManager - confinement + full isolation unshares net inside bwrap", () => {
  withCapabilities(true, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        networkIsolation: true,
        egressProxy: false,
        unrestrictedEgress: false,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/ws");
    assertEquals(opts.command, "bwrap");
    assertEquals(opts.args.includes("--unshare-net"), true);
  });
});

Deno.test("SandboxManager - cwd is passed through", () => {
  const sandbox = new SandboxManager(createSandboxConfig({ filterEnv: false }));
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], {}, "/my/workspace");
  assertEquals(opts.cwd, "/my/workspace");
});
