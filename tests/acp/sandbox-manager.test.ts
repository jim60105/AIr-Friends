// tests/acp/sandbox-manager.test.ts

import { assert, assertEquals, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { SandboxManager } from "../../src/acp/sandbox-manager.ts";
import type { SandboxConfig } from "../../src/types/config.ts";
import {
  canConfineFilesystem,
  resetSandboxCapabilityCache,
  setSandboxCapabilityCacheForTest,
} from "../../src/acp/sandbox-capabilities.ts";
import {
  DEFAULT_CONFINEMENT_READONLY_PATHS,
  DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS,
} from "../../src/acp/filesystem-confinement.ts";

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

Deno.test("SandboxManager - confinement mounts the resolved skills root read-only for either agent type", () => {
  // `unify-skill-root-and-inventory` D4: the factory's single observation is
  // threaded to the bwrap builder, which mounts that root at its literal path
  // for BOTH agent types (no per-agent image tree).
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    for (const agentType of ["opencode", "omp"] as const) {
      const opts = sandbox.buildSpawnOptions(agentType, agentType, ["acp"], {}, "/ws", {
        root: "/srv/air/skills",
        identity: { dev: 1, ino: 2 },
      });
      assertEquals(opts.command, "bwrap");
      let found = false;
      for (let i = 0; i < opts.args.length - 2; i++) {
        if (opts.args[i] === "--ro-bind-try" && opts.args[i + 1] === "/srv/air/skills") {
          found = true;
        }
      }
      assertEquals(found, true, `${agentType}: root mounted read-only at its literal path`);
    }
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
    // With no resolved root supplied the confinement mounts no skill tree of
    // its own — neither an image constant nor a cwd-relative guess.
    for (let i = 0; i < opts.args.length - 2; i++) {
      if (opts.args[i] === "--ro-bind-try") {
        assertEquals(opts.args[i + 1].endsWith("/skills"), false, opts.args.join(" "));
      }
    }
    assertEquals(opts.args.join(" ").includes("/app/skills"), false);
  });
});

// ---------------------------------------------------------------------------
// Per-launch runtime mounts (OMP `runtimeMounts`) and the confinement they produce
// ---------------------------------------------------------------------------

/** argv index of the bind whose SOURCE is `src`, or -1 when absent. */
function bindSourceIndex(args: string[], flag: string, src: string): number {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === src) return i;
  }
  return -1;
}

/** Every `flag <src> <src>` bind source in argv order — i.e. the whole mount list. */
function bindSources(args: string[], flag: string): string[] {
  const sources: string[] = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === flag && args[i + 1] === args[i + 2]) sources.push(args[i + 1]);
  }
  return sources;
}

/** Every hard `--ro-bind <src> <dst>` pair in argv order (`-try` excluded). */
function hardRoBindPairs(args: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === "--ro-bind") pairs.push([args[i + 1], args[i + 2]]);
  }
  return pairs;
}

/**
 * Whether THIS host has the known topology that cannot materialise the production
 * confinement mount list at all.
 *
 * `canConfineFilesystem()` only proves that bwrap can create a namespace with a fresh
 * `/proc`; the real mount policy can still be unspawnable, because `--ro-bind-try`
 * tolerates a missing SOURCE but bwrap aborts the whole spawn when it cannot create a
 * bind DESTINATION. On a Fedora Silverblue-style host `/usr/local` is a symlink into
 * `/var` (`/usr/local -> ../var/usrlocal`), so the default read-only `/usr/local/bin`
 * resolves to an unbound `/var/usrlocal/bin` and every confined spawn fails before exec.
 *
 * The gate names that topology EXPLICITLY (and only it) rather than probing a spawn:
 * a regression that makes the default argv unspawnable on a normal host must turn
 * this test RED, never silently ignore it.
 */
function confinementHostUnsupported(): boolean {
  if (!canConfineFilesystem()) return false;
  try {
    // `/usr/local` present as a SYMLINK is the known unspawnable topology; a real
    // directory (or its absence) is supported.
    return Deno.lstatSync("/usr/local").isSymlink;
  } catch {
    return false;
  }
}

Deno.test("SandboxManager - OMP runtimeMounts are additive and emitted after the writable binds", () => {
  withCapabilities(false, true, () => {
    // F12 filesystem confinement with the shared network kept; filterEnv stays off so the
    // fixtures below exercise the mount policy, not the env policy.
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    // The restricted-mode launch shape: the authored settings + system prompt +
    // installed extension bundle read-only, plus the mode's own native data dir writable.
    const readOnly = [
      "/mode/agent-config/omp/restricted.yml",
      "/mode/prompts/omp/restricted.md",
      "/install/omp/extension/index.js",
    ];
    const writable = ["/base/omp-agent/restricted/xdg-data/omp"];
    const shadowed = ["/ws/tmp/omp-agent"];
    const opts = sandbox.buildSpawnOptions(
      "omp",
      "omp",
      ["acp"],
      { TMPDIR: "/ws/tmp" },
      "/ws",
      undefined,
      { readOnlyPaths: readOnly, writableRuntimePaths: writable, shadowedPaths: shadowed },
    );
    assertEquals(opts.command, "bwrap");
    // The shared defaults are untouched by the extra inputs: the whole read-only list is
    // the shared defaults followed by the extras, and no shared default is dropped.
    assertEquals(bindSources(opts.args, "--ro-bind-try"), [
      ...DEFAULT_CONFINEMENT_READONLY_PATHS,
      ...readOnly,
    ]);
    assertEquals(bindSources(opts.args, "--bind-try"), [
      ...DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS,
      ...writable,
    ]);
    // Positional proof, independent of the list equality above: the extras are emitted
    // AFTER the mandatory writable binds (session workspace, session TMPDIR, shared
    // writable runtime roots), so no writable ancestor can widen or hide them.
    const sessionWorkspaceBind = opts.args.indexOf("--bind");
    assert(sessionWorkspaceBind > -1, "the confinement binds the session workspace");
    for (const path of readOnly) {
      assert(
        bindSourceIndex(opts.args, "--ro-bind-try", path) > sessionWorkspaceBind,
        `${path} must be bound read-only after every writable bind`,
      );
    }
    for (const path of writable) {
      assert(
        bindSourceIndex(opts.args, "--bind-try", path) > sessionWorkspaceBind,
        `${path} must be bound writable after every mandatory writable bind`,
      );
    }
    // The mode parent is shadowed BEFORE the selected child is re-exposed inside it.
    const shadowIndex = opts.args.findIndex(
      (arg, index) => arg === "--tmpfs" && opts.args[index + 1] === shadowed[0],
    );
    assert(shadowIndex > -1, `the mode parent must be shadowed: ${opts.args.join(" ")}`);
    assert(shadowIndex > sessionWorkspaceBind, "the shadow must follow the writable binds");
    assertEquals(
      bindSourceIndex(opts.args, "--bind-try", writable[0]) > shadowIndex,
      true,
      "the selected data child must be re-bound after its parent is shadowed",
    );
    // No extra read-only path is ever emitted as a writable bind.
    assertEquals(
      bindSources(opts.args, "--bind-try").some((source) => readOnly.includes(source)),
      false,
    );
    // The shared skill-root overlap refusal still applies unchanged.
    assertEquals(bindSources(opts.args, "--ro-bind-try").includes("/ws"), false);
  });
});

Deno.test("SandboxManager - a skill root overlapping a runtime writable input is refused", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    const data = "/base/omp-agent/restricted/xdg-data/omp";
    const spawn = (skillRoot: string, writable: string): void => {
      sandbox.buildSpawnOptions(
        "omp",
        "omp",
        ["acp"],
        { TMPDIR: "/ws/tmp" },
        "/ws",
        { root: skillRoot, identity: { dev: 1, ino: 2 } },
        { readOnlyPaths: [], writableRuntimePaths: [writable] },
      );
    };
    // The late per-launch writable inputs are mandatory writables for the
    // overlap refusal: an equal root, an enclosing root and a canonical alias
    // spelling are all refused before any mount is emitted.
    assertThrows(() => spawn(data, data), Error, "mandatory writable mount");
    assertThrows(() => spawn("/base/omp-agent", data), Error, "mandatory writable mount");
    const base = Deno.makeTempDirSync({ prefix: "air-omp-overlap-" });
    try {
      const real = join(base, "xdg-data");
      Deno.mkdirSync(real, { recursive: true });
      const alias = join(base, "data-alias");
      Deno.symlinkSync(real, alias);
      assertThrows(() => spawn(real, alias), Error, "mandatory writable mount");
    } finally {
      Deno.removeSync(base, { recursive: true });
    }
  });
});

Deno.test("SandboxManager - no runtimeMounts emits exactly the shared default mounts", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    for (const agentType of ["opencode", "omp"] as const) {
      const env = { TMPDIR: "/ws/tmp" };
      const baseline = sandbox.buildSpawnOptions(agentType, agentType, ["acp"], env, "/ws");
      // Pre-existing call shape (no 7th argument) and an explicitly empty mount set must be
      // byte-identical: an absent runtimeMounts adds no mount at all.
      const emptyMounts = sandbox.buildSpawnOptions(
        agentType,
        agentType,
        ["acp"],
        env,
        "/ws",
        undefined,
        {},
      );
      assertEquals(emptyMounts.args, baseline.args, agentType);
      assertEquals(bindSources(baseline.args, "--ro-bind-try"), [
        ...DEFAULT_CONFINEMENT_READONLY_PATHS,
      ]);
      assertEquals(bindSources(baseline.args, "--bind-try"), [
        ...DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS,
      ]);
      assertEquals(
        baseline.args.some((arg, index) =>
          arg === "--tmpfs" && baseline.args[index + 1] === "/tmp"
        ),
        true,
        "the confinement still shadows /tmp itself",
      );
      // Neither agent type gets a mode-scoped native-data mount it did not ask for.
      assertEquals(baseline.args.some((arg) => arg.includes("/omp-agent/")), false);
    }
  });
});

// ---------------------------------------------------------------------------
// Shared OMP native payload (`runtimeMounts.payloadReadOnlyPaths`): the factory
// threads the selected payload subtree through the sandbox, which emits it as a
// HARD `--ro-bind` LAST — after every writable bind and after the mode-parent
// tmpfs shadow. No payload input means no hard ro bind (OpenCode's posture), and
// a vanished source fails a REAL confined launch rather than falling back.
// ---------------------------------------------------------------------------

const PAYLOAD = "/srv/devhome/.cache/air-friends/omp/linux-x64/natives";

Deno.test("SandboxManager - the OMP payload is a hard ro bind emitted last, after every writable bind and the shadow", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    const shadowed = "/ws/tmp/omp-agent";
    const nativeDataDir = "/ws/tmp/omp-agent/restricted/xdg-data/omp";
    const opts = sandbox.buildSpawnOptions(
      "omp",
      "omp",
      ["acp"],
      { TMPDIR: "/ws/tmp" },
      "/ws",
      { root: "/srv/air/skills", identity: { dev: 1, ino: 2 } },
      {
        readOnlyPaths: ["/ro/restricted.yml"],
        writableRuntimePaths: [nativeDataDir],
        shadowedPaths: [shadowed],
        payloadReadOnlyPaths: [PAYLOAD],
      },
    );
    assertEquals(opts.command, "bwrap");

    // Hard `--ro-bind <literal> <literal>` — never the lenient `-try` variant.
    const payloadIdx = bindSourceIndex(opts.args, "--ro-bind", PAYLOAD);
    assert(payloadIdx > -1, `the payload must be hard-bound: ${opts.args.join(" ")}`);
    assertEquals(opts.args[payloadIdx + 2], PAYLOAD);
    assertEquals(bindSources(opts.args, "--ro-bind-try").includes(PAYLOAD), false);

    // The payload is the LAST mount, immediately before the inner-command separator.
    const separator = opts.args.indexOf("--");
    assertEquals(opts.args.slice(separator - 3, separator), ["--ro-bind", PAYLOAD, PAYLOAD]);

    // Every earlier group precedes it: the writable binds, the tmpfs shadow and
    // the late writable child re-bind that restores the link's parent path.
    const shadowIdx = opts.args.findIndex((arg, i) =>
      arg === "--tmpfs" && opts.args[i + 1] === shadowed
    );
    assert(shadowIdx > -1, "the mode parent must be shadowed");
    for (
      const [flag, source, label] of [
        ["--bind", "/ws", "session workspace"],
        ["--bind", "/ws/tmp", "session TMPDIR"],
        ["--bind-try", nativeDataDir, "late writable child"],
      ] as const
    ) {
      assert(
        bindSourceIndex(opts.args, flag, source) < payloadIdx,
        `${label} must precede the payload bind`,
      );
    }
    assert(shadowIdx < payloadIdx, "the mode-parent shadow must precede the payload bind");

    // Only the payload subtree is exposed: no mount target is its ancestor.
    const mountedTargets = [
      ...bindSources(opts.args, "--bind"),
      ...bindSources(opts.args, "--bind-try"),
      ...bindSources(opts.args, "--ro-bind-try"),
      ...hardRoBindPairs(opts.args).map(([src]) => src),
    ];
    for (const target of mountedTargets) {
      if (target === PAYLOAD) continue;
      assertEquals(
        PAYLOAD.startsWith(`${target}/`),
        false,
        `"${target}" must not expose the payload's ancestor tree`,
      );
    }
  });
});

Deno.test("SandboxManager - a launch without payload inputs emits no hard ro bind (OpenCode unchanged)", () => {
  withCapabilities(false, true, () => {
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    for (const agentType of ["opencode", "omp"] as const) {
      const opts = sandbox.buildSpawnOptions(
        agentType,
        agentType,
        ["acp"],
        { TMPDIR: "/ws/tmp" },
        "/ws",
      );
      assertEquals(hardRoBindPairs(opts.args).length, 0, agentType);
      assertEquals(opts.args.includes("/opt/air/omp/native-cache"), false, agentType);
    }
  });
});

Deno.test({
  name:
    "SandboxManager - a vanished payload source fails the confined launch (hard ro bind, no fallback)",
  // The real spawn needs bwrap AND a host that can materialise the production
  // mount list; otherwise the leg stays UNEXERCISED.
  ignore: !canConfineFilesystem() || confinementHostUnsupported(),
  fn: async () => {
    const baseRoot = Deno.makeTempDirSync({ prefix: "air-omp-payload-missing-" });
    try {
      const tmpDir = join(baseRoot, "tmp");
      Deno.mkdirSync(tmpDir, { recursive: true });
      const missingPayload = join(baseRoot, "native-cache", "natives");
      // The source really is absent, so only a HARD `--ro-bind` can fail the spawn.
      assertEquals(await Deno.lstat(missingPayload).catch(() => null), null);

      const sandbox = new SandboxManager(
        createSandboxConfig({
          filesystemConfinement: true,
          egressProxy: false,
          unrestrictedEgress: true,
          filterEnv: false,
        }),
      );
      const opts = sandbox.buildSpawnOptions(
        "omp",
        "sh",
        ["-c", "echo should-not-run"],
        { PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", TMPDIR: tmpDir },
        baseRoot,
        undefined,
        { payloadReadOnlyPaths: [missingPayload] },
      );
      assertEquals(opts.command, "bwrap");
      // argv already proves the hard variant (no `-try`), independent of the spawn.
      assert(bindSourceIndex(opts.args, "--ro-bind", missingPayload) > -1);
      assertEquals(bindSources(opts.args, "--ro-bind-try").includes(missingPayload), false);

      const output = await new Deno.Command(opts.command, {
        args: opts.args,
        cwd: opts.cwd,
        env: opts.env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);
      // The missing source fails the launch instead of degrading into a dangling
      // link, and the inner command never starts (no unconfined fallback).
      assertEquals(output.success, false, `expected a failed launch, stderr: ${stderr}`);
      assertEquals(stdout.includes("should-not-run"), false);
    } finally {
      Deno.removeSync(baseRoot, { recursive: true });
    }
  },
});

Deno.test("SandboxManager - an absent payload source is still emitted as a hard ro bind, never a lenient variant", () => {
  withCapabilities(false, true, () => {
    // The path does not exist, yet the mount list must stay hard: a `-try`
    // variant would silently continue and surface an opaque loader error later.
    const missingPayload = "/srv/absent/native-cache/natives";
    const sandbox = new SandboxManager(
      createSandboxConfig({
        filesystemConfinement: true,
        egressProxy: false,
        unrestrictedEgress: true,
        filterEnv: false,
      }),
    );
    const opts = sandbox.buildSpawnOptions(
      "omp",
      "omp",
      ["acp"],
      { TMPDIR: "/ws/tmp" },
      "/ws",
      undefined,
      { payloadReadOnlyPaths: [missingPayload] },
    );
    assertEquals(opts.command, "bwrap");
    assert(bindSourceIndex(opts.args, "--ro-bind", missingPayload) > -1);
    assertEquals(bindSources(opts.args, "--ro-bind-try").includes(missingPayload), false);
    // And it remains the last mount, so no earlier bind can widen it.
    const separator = opts.args.indexOf("--");
    assertEquals(opts.args.slice(separator - 3, separator), [
      "--ro-bind",
      missingPayload,
      missingPayload,
    ]);
  });
});

Deno.test("SandboxManager - with filesystem confinement disabled the payload posture is unchanged", () => {
  // The operator-trusted, confinement-disabled posture mounts nothing: the
  // payload input is simply ignored (no bwrap, no bind, no failure), so this
  // change adds no restriction and no mount to that posture.
  const sandbox = new SandboxManager(
    createSandboxConfig({
      filesystemConfinement: false,
      unrestrictedEgress: true,
      filterEnv: false,
    }),
  );
  const opts = sandbox.buildSpawnOptions(
    "omp",
    "omp",
    ["acp"],
    { TMPDIR: "/ws/tmp" },
    "/ws",
    undefined,
    { payloadReadOnlyPaths: [PAYLOAD] },
  );
  assertEquals(opts.command, "omp");
  assertEquals(opts.args, ["acp"]);
  assertEquals(opts.args.includes("--ro-bind"), false);
  assertEquals(opts.args.includes("--ro-bind-try"), false);
});

Deno.test({
  name: "SandboxManager - confined omp: mounts read, own data written, no sibling access",
  // Both gates must hold: bwrap can namespace (canConfineFilesystem) AND this host can
  // materialise the production mount list (confinementHostUnsupported names the one
  // known-unsupported topology explicitly).
  ignore: !canConfineFilesystem() || confinementHostUnsupported(),
  fn: async () => {
    // Real spawn through the real confinement builder: the assertions below observe the
    // mounted filesystem (reads, writes, exit statuses), never the argv that produced it.
    const baseRoot = Deno.makeTempDirSync({ prefix: "air-omp-confinement-" });
    try {
      const home = join(baseRoot, "home");
      const modelsFile = join(home, ".omp", "agent", "models.yml");
      // The REAL per-spawn factory layout: the session workspace holds the
      // session TMPDIR, and native data lives under `{TMPDIR}/omp-agent/{mode}`.
      const workspace = join(baseRoot, "workspace");
      const tmpDir = join(workspace, "tmp");
      const shadowedModeParent = join(tmpDir, "omp-agent");
      const nativeDataDir = join(shadowedModeParent, "restricted", "xdg-data", "omp");
      const siblingMarker = join(
        shadowedModeParent,
        "native-yolo",
        "xdg-data",
        "omp",
        "marker",
      );
      const skillRoot = join(baseRoot, "skills");
      // The shared prepared payload of the OTHER mode root's link target: outside
      // the workspace and the mode tree, under the development cache HOME so the
      // "cache parent HOME stays hidden" property is observable too.
      const payloadCacheHome = join(baseRoot, "cache-home");
      const payloadDir = join(
        payloadCacheHome,
        ".cache",
        "air-friends",
        "omp",
        "linux-x64",
        "natives",
      );
      const payloadVersionDir = join(payloadDir, "18.6.1");
      const payloadFile = join(payloadVersionDir, "pi_natives.linux-x64-modern.node");
      const cacheHomeMarker = join(payloadCacheHome, "home-marker");
      const directories = [
        dirname(modelsFile),
        nativeDataDir,
        dirname(siblingMarker),
        skillRoot,
        workspace,
        tmpDir,
        payloadVersionDir,
      ];
      for (const directory of directories) {
        Deno.mkdirSync(directory, { recursive: true });
      }
      const modelBytes = "model: deployment-authored";
      const siblingSentinel = "sibling-mode-sentinel";
      const skillInstruction = "trusted instruction";
      const payloadBytes = "shared native payload bytes";
      const cacheHomeSentinel = "cache-home-sentinel";
      Deno.writeTextFileSync(modelsFile, `${modelBytes}\n`);
      Deno.writeTextFileSync(siblingMarker, siblingSentinel);
      Deno.writeTextFileSync(join(skillRoot, "SKILL.md"), `${skillInstruction}\n`);
      Deno.writeTextFileSync(payloadFile, payloadBytes);
      Deno.writeTextFileSync(cacheHomeMarker, cacheHomeSentinel);
      // The mode root's reserved `omp/natives` entry: an absolute symlink to the
      // shared payload, exactly as the shipped factory installs it.
      Deno.symlinkSync(payloadDir, join(nativeDataDir, "natives"));
      // The sibling marker IS readable outside the confinement, so a failing read inside can
      // only come from the mount policy — not from a missing fixture.
      assertEquals(Deno.readTextFileSync(siblingMarker), siblingSentinel);
      assertEquals(Deno.readTextFileSync(cacheHomeMarker), cacheHomeSentinel);

      const ownMarker = join(nativeDataDir, "agent-marker");
      const forbiddenInSkillRoot = join(skillRoot, "forbidden.md");
      // Deno-generated absolute paths never contain a single quote, so single-quoting them
      // keeps the script free of any shell expansion.
      const script = [
        `cat '${modelsFile}'`,
        `echo "model_read_status=$?"`,
        `printf '%s' 'native-agent-marker' > '${ownMarker}'`,
        `echo "native_write_status=$?"`,
        `cat '${join(skillRoot, "SKILL.md")}'`,
        `echo "skill_read_status=$?"`,
        `cat '${siblingMarker}' 2>/dev/null`,
        `echo "sibling_read_status=$?"`,
        `touch '${forbiddenInSkillRoot}' 2>/dev/null`,
        `echo "skill_write_status=$?"`,
        // The payload reads through the mode root's `natives` link, whose parent
        // path is re-bound after the mode-parent tmpfs shadow.
        `cat '${join(nativeDataDir, "natives", "18.6.1", "pi_natives.linux-x64-modern.node")}'`,
        `echo "payload_read_status=$?"`,
        `printf 'tampered' > '${
          join(nativeDataDir, "natives", "18.6.1", "pi_natives.linux-x64-modern.node")
        }' 2>/dev/null`,
        `echo "payload_write_status=$?"`,
        `cat '${cacheHomeMarker}' 2>/dev/null`,
        `echo "cache_home_read_status=$?"`,
      ].join("\n");

      const sandbox = new SandboxManager(
        createSandboxConfig({
          filesystemConfinement: true,
          egressProxy: false,
          unrestrictedEgress: true,
          filterEnv: false,
        }),
      );
      const opts = sandbox.buildSpawnOptions(
        "omp",
        "sh",
        ["-c", script],
        { PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", TMPDIR: tmpDir },
        workspace,
        { root: skillRoot },
        {
          readOnlyPaths: [modelsFile],
          writableRuntimePaths: [nativeDataDir],
          shadowedPaths: [shadowedModeParent],
          payloadReadOnlyPaths: [payloadDir],
        },
      );
      assertEquals(opts.command, "bwrap");
      // The payload is the hard-bound LAST mount, after the shadow and the late
      // writable child re-bind, so the write attempt below cannot reach it.
      const separator = opts.args.indexOf("--");
      assertEquals(opts.args.slice(separator - 3, separator), [
        "--ro-bind",
        payloadDir,
        payloadDir,
      ]);
      const output = await new Deno.Command(opts.command, {
        args: opts.args,
        cwd: opts.cwd,
        env: opts.env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);
      assert(output.success, `confined sh exited ${output.code}: ${stderr}`);

      /** The `key=<n>` line the confined script printed; absent means the run aborted early. */
      const status = (key: string): number => {
        const match = stdout.match(new RegExp(`(?:^|\\n)${key}=(\\d+)`));
        assert(match !== null, `confined script printed no "${key}" status: ${stdout}`);
        return Number(match[1]);
      };

      // (a) The authored model file is really readable through the read-only mount.
      assertEquals(stdout.includes(modelBytes), true, stdout);
      assertEquals(status("model_read_status"), 0);
      // (b) The native data child is really writable, and the write lands on the host tree.
      assertEquals(status("native_write_status"), 0);
      assertEquals(Deno.readTextFileSync(ownMarker), "native-agent-marker");
      // The skill root is admitted read-only (its instruction reads) but refuses writes.
      assertEquals(stdout.includes(skillInstruction), true, stdout);
      assertEquals(status("skill_read_status"), 0);
      assertEquals(status("skill_write_status") !== 0, true);
      assertEquals(await Deno.lstat(forbiddenInSkillRoot).catch(() => null), null);
      // (c) The SIBLING mode's marker is absent from the mount namespace.
      assertEquals(status("sibling_read_status") !== 0, true);
      assertEquals(stdout.includes(siblingSentinel), false, stdout);
      // (d) The shared payload is reachable (read) through the mode root's link,
      // yet it refuses every write and its host bytes stay unchanged; the cache's
      // parent HOME is never exposed to make the link resolve.
      assertEquals(stdout.includes(payloadBytes), true, stdout);
      assertEquals(status("payload_read_status"), 0);
      assertEquals(status("payload_write_status") !== 0, true);
      assertEquals(Deno.readTextFileSync(payloadFile), payloadBytes);
      assertEquals(status("cache_home_read_status") !== 0, true);
      assertEquals(stdout.includes(cacheHomeSentinel), false, stdout);
    } finally {
      Deno.removeSync(baseRoot, { recursive: true });
    }
  },
});
