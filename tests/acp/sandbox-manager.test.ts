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

Deno.test("SandboxManager - omp agent allows only Gemini and OpenRouter credentials", () => {
  const sandbox = new SandboxManager(createSandboxConfig());
  const baseEnv = {
    PATH: "/usr/bin",
    GEMINI_API_KEY: "gm_xxx",
    OPENROUTER_API_KEY: "or_xxx",
    OPENCODE_API_KEY: "oc_xxx",
    GOOGLE_GENERATIVE_AI_API_KEY: "gg_xxx",
  };
  const opts = sandbox.buildSpawnOptions("omp", "omp", [], baseEnv, "/tmp");
  assertEquals(opts.env["GEMINI_API_KEY"], "gm_xxx");
  assertEquals(opts.env["OPENROUTER_API_KEY"], "or_xxx");
  assertEquals(opts.env["OPENCODE_API_KEY"], undefined);
  assertEquals(opts.env["GOOGLE_GENERATIVE_AI_API_KEY"], undefined);
});

Deno.test("SandboxManager - platform and dashboard credentials never reach any agent", () => {
  for (const agentType of ["opencode", "omp"]) {
    const sandbox = new SandboxManager(createSandboxConfig());
    const baseEnv = {
      PATH: "/usr/bin",
      GEMINI_API_KEY: "gm_xxx",
      OPENROUTER_API_KEY: "or_xxx",
      DISCORD_TOKEN: "discord_secret",
      MISSKEY_TOKEN: "misskey_secret",
      DASHBOARD_PASSPHRASE: "dashboard_secret",
      AGENT_SKILL_API_SECRET: "skill_secret",
      GITHUB_TOKEN: "gh_secret",
      COPILOT_GITHUB_TOKEN: "copilot_secret",
      GIT_BACKUP_AUTH_PASSWORD: "git_backup_secret",
      XDG_CONFIG_HOME: "/etc/config",
      XDG_STATE_HOME: "/etc/state",
      XDG_CACHE_HOME: "/etc/cache",
      OMP_PROFILE: "custom_omp_profile",
      PI_PROFILE: "custom_pi_profile",
      PI_CODING_AGENT_DIR: "/etc/pi_coding_agent",
    };
    const opts = sandbox.buildSpawnOptions(agentType, "agent", [], baseEnv, "/tmp");
    assertEquals(opts.env["DISCORD_TOKEN"], undefined);
    assertEquals(opts.env["MISSKEY_TOKEN"], undefined);
    assertEquals(opts.env["DASHBOARD_PASSPHRASE"], undefined);
    assertEquals(opts.env["AGENT_SKILL_API_SECRET"], undefined);
    assertEquals(opts.env["GITHUB_TOKEN"], undefined);
    assertEquals(opts.env["COPILOT_GITHUB_TOKEN"], undefined);
    assertEquals(opts.env["GIT_BACKUP_AUTH_PASSWORD"], undefined);
    assertEquals(opts.env["XDG_CONFIG_HOME"], undefined);
    assertEquals(opts.env["XDG_STATE_HOME"], undefined);
    assertEquals(opts.env["XDG_CACHE_HOME"], undefined);
    assertEquals(opts.env["OMP_PROFILE"], undefined);
    assertEquals(opts.env["PI_PROFILE"], undefined);
    assertEquals(opts.env["PI_CODING_AGENT_DIR"], undefined);
  }
});

Deno.test("SandboxManager - allowedEnvVars cannot widen never-pass credentials or selectors", () => {
  // Verify that an operator attempting to pass never-pass variables via allowedEnvVars is blocked
  const sandbox = new SandboxManager(createSandboxConfig({
    allowedEnvVars: [
      "MY_TOOL_FLAG",
      "OPENCODE_API_KEY",
      "XDG_CONFIG_HOME",
      "DISCORD_TOKEN",
      "DASHBOARD_PASSPHRASE",
      "AGENT_SKILL_API_SECRET",
      "GITHUB_TOKEN",
      "PI_CODING_AGENT_DIR",
      // duplicate to verify deduplication
      "OPENCODE_API_KEY",
    ],
  }));
  const baseEnv = {
    PATH: "/usr/bin",
    MY_TOOL_FLAG: "active",
    OPENCODE_API_KEY: "stolen_oc_key",
    XDG_CONFIG_HOME: "/malicious/config",
    DISCORD_TOKEN: "stolen_token",
    DASHBOARD_PASSPHRASE: "stolen_pass",
    AGENT_SKILL_API_SECRET: "stolen_secret",
    GITHUB_TOKEN: "stolen_gh",
    GEMINI_API_KEY: "gm_xxx",
    OPENROUTER_API_KEY: "or_xxx",
  };
  const opts = sandbox.buildSpawnOptions("omp", "omp", [], baseEnv, "/tmp");
  assertEquals(opts.env["MY_TOOL_FLAG"], "active");
  assertEquals(opts.env["OPENCODE_API_KEY"], undefined);
  assertEquals(opts.env["XDG_CONFIG_HOME"], undefined);
  assertEquals(opts.env["DISCORD_TOKEN"], undefined);
  assertEquals(opts.env["DASHBOARD_PASSPHRASE"], undefined);
  assertEquals(opts.env["AGENT_SKILL_API_SECRET"], undefined);
  assertEquals(opts.env["GITHUB_TOKEN"], undefined);
  assertEquals(opts.env["GEMINI_API_KEY"], "gm_xxx");
  assertEquals(opts.env["OPENROUTER_API_KEY"], "or_xxx");
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

Deno.test("SandboxManager - confinement mounts the selected skills root read-only", () => {
  // `unify-omp-skill-root-resolution` D4/4.1: the factory's observation is
  // threaded to the bwrap builder, which mounts the root at its literal path.
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions("omp", "omp", ["acp"], {}, "/ws", {
      root: "/opt/air/skills",
      identity: { dev: 1, ino: 2 },
    });
    assertEquals(opts.command, "bwrap");
    let found = false;
    for (let i = 0; i < opts.args.length - 2; i++) {
      if (opts.args[i] === "--ro-bind-try" && opts.args[i + 1] === "/opt/air/skills") found = true;
    }
    assertEquals(found, true, "selected root mounted read-only at its literal path");
  });
});

Deno.test("SandboxManager - no skills root invents no fallback mount", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions("opencode", "opencode", ["--acp"], {}, "/ws");
    assertEquals(opts.command, "bwrap");
    assertEquals(opts.args.join(" ").includes("/opt/air/skills"), false);
    assertEquals(opts.args.join(" ").includes("/app/skills"), false);
  });
});
