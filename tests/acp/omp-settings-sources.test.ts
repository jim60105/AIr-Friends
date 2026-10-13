// tests/acp/omp-settings-sources.test.ts
//
// Row 26 (isolate-omp-settings-discovery) unit/mock acceptance (tasks 4.1/4.2/4.3):
// hostile daemon environment sanitization, trusted post-filter plan assignment,
// the metadata-only settings-source observer over clean and hostile fixtures,
// the connector's fail-closed pre-native-request gate with ZERO protected calls
// on rejection, and the decision-3 DECIDED disposition (pinned native reset
// verdict retained verbatim, WITHOUT any supported-native-reset claim).
// These tests certify deployment-side control logic only; native runtime
// discovery behavior remains user-owned runtime evidence.

import { assert, assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { createAgentConfig, finalizeOmpSpawnEnvironment } from "@acp/agent-factory.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import {
  OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
  OMP_SETTINGS_DISCOVERY_ENV_SELECTORS,
  type OmpPermissionMode,
  ompSettingsForMode,
  type OmpSettingsSourcePlan,
  ompSettingsSourcePlan,
} from "@acp/omp-settings.ts";
import {
  assertOmpSettingsSourcesVisible,
  checkOmpSettingsSources,
  formatSettingsSourceError,
  type SettingsSourceCheckResult,
  SettingsSourceRejectionError,
  type SourceCheckFailure,
} from "@acp/omp/settings-sources.ts";
import { SandboxManager, sanitizeOmpDiscoveryEnv } from "@acp/sandbox-manager.ts";
import type { AgentConfig } from "@acp/types.ts";
import type { Config, SandboxConfig } from "../../src/types/config.ts";
import { dirname } from "@std/path";

// Discriminated-union readers (no inline cast access on the check result).
function expectRejection(result: SettingsSourceCheckResult): readonly SourceCheckFailure[] {
  if (result.ok) {
    throw new Error("expected the settings-source check to reject, but it accepted");
  }
  return result.failures;
}

function expectAcceptance(
  result: SettingsSourceCheckResult,
): readonly { readonly path: string; readonly size: number; readonly mtimeMs: number }[] {
  if (!result.ok) {
    throw new Error(`expected acceptance, got: ${JSON.stringify(result.failures)}`);
  }
  return result.overlays;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A plan with authority roots created on disk and an owned overlay file. */
async function makeLivePlan(
  mode: OmpPermissionMode = "restricted",
  overlayContent = "# deployment-owned overlay\n",
): Promise<
  { plan: OmpSettingsSourcePlan; sessionCwd: string; cleanup: () => Promise<void> }
> {
  const baseRoot = await Deno.makeTempDir({ prefix: "omp-plan-" });
  const sessionCwd = await Deno.makeTempDir({ prefix: "omp-session-" });
  const overlayPath = `${baseRoot}/config/${mode}.yml`;
  await Deno.mkdir(dirname(overlayPath), { recursive: true });
  await Deno.writeTextFile(overlayPath, overlayContent);
  const plan = ompSettingsSourcePlan(mode, { baseRoot, allowedOverlayPaths: [overlayPath] });
  await Deno.mkdir(plan.ownedHome, { recursive: true });
  await Deno.mkdir(plan.agentDir, { recursive: true });
  await Deno.mkdir(plan.launchCwd, { recursive: true });
  return { plan, sessionCwd, cleanup: () => Deno.remove(baseRoot, { recursive: true }) };
}

const sandboxConfig = (overrides: Partial<SandboxConfig> = {}): SandboxConfig => ({
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

/** Every selector an OMP child must never inherit with a hostile value. */
const hostileEnv = (): Record<string, string> => ({
  PATH: "/usr/bin",
  HOME: "/hostile/daemon-home",
  XDG_CONFIG_HOME: "/hostile/config",
  XDG_DATA_HOME: "/hostile/data",
  XDG_STATE_HOME: "/hostile/state",
  XDG_CACHE_HOME: "/hostile/cache",
  OMP_PROFILE: "/hostile/omp-profile",
  PI_PROFILE: "/hostile/pi-profile",
  PI_CONFIG_FILES: "/hostile/injected-settings.yml",
  PI_CODING_AGENT_DIR: "/hostile/agent-dir",
  CLAUDE_CONFIG_DIR: "/hostile/claude",
  CURSOR_CONFIG_DIR: "/hostile/cursor",
  CODEX_HOME: "/hostile/codex",
  GEMINI_CONFIG_DIR: "/hostile/gemini",
});

const ALL_FORBIDDEN_SELECTORS: readonly string[] = [
  ...OMP_SETTINGS_DISCOVERY_ENV_SELECTORS,
  ...OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
];

// ---------------------------------------------------------------------------
// Task 4.1 — mandatory environment control (both filterEnv values, hostile
// selectors, polluted reused state; OpenCode regression)
// ---------------------------------------------------------------------------

Deno.test("sanitizeOmpDiscoveryEnv - removes every discovery and foreign selector unconditionally", () => {
  const env = hostileEnv();
  sanitizeOmpDiscoveryEnv(env);
  for (const selector of ALL_FORBIDDEN_SELECTORS) {
    assertEquals(env[selector], undefined, `${selector} survived sanitization`);
  }
  // Credentials / unrelated vars are untouched (the sanitizer is scoped).
  assertEquals(env["PATH"], "/usr/bin");
});

for (const filterEnv of [true, false]) {
  Deno.test(
    `SandboxManager omp - mandatory sanitization applies with filterEnv=${filterEnv} and allowedEnvVars cannot widen it back`,
    () => {
      const sandbox = new SandboxManager(
        sandboxConfig({
          filterEnv,
          // Operator attempt to re-allow forbidden selectors: must be refused.
          allowedEnvVars: ["HOME", "XDG_CONFIG_HOME", "PI_CONFIG_FILES", "CLAUDE_CONFIG_DIR"],
        }),
      );
      const opts = sandbox.buildSpawnOptions("omp", "omp", [], hostileEnv(), "/tmp");
      for (const selector of ALL_FORBIDDEN_SELECTORS) {
        assertEquals(
          opts.env[selector],
          undefined,
          `${selector} reached the omp child with filterEnv=${filterEnv}`,
        );
      }
    },
  );
}

Deno.test("SandboxManager opencode regression - HOME/XDG allowlist semantics untouched by the OMP sanitizer", () => {
  const sandbox = new SandboxManager(sandboxConfig());
  const opts = sandbox.buildSpawnOptions("opencode", "opencode", [], hostileEnv(), "/tmp");
  // OpenCode KEEPS its existing posture: HOME and XDG_DATA_HOME are allowlisted.
  assertEquals(opts.env["HOME"], "/hostile/daemon-home");
  assertEquals(opts.env["XDG_DATA_HOME"], "/hostile/data");
});

Deno.test("finalizeOmpSpawnEnvironment - assigns plan values post-filter and leaves only plan-owned selectors", async () => {
  const { plan, cleanup } = await makeLivePlan();
  try {
    // Full hostile environment: sanitize (first half) then finalize (second half).
    const env = hostileEnv();
    sanitizeOmpDiscoveryEnv(env);
    finalizeOmpSpawnEnvironment(env, plan);
    assertEquals(env["HOME"], plan.ownedHome);
    assertEquals(env["PI_CODING_AGENT_DIR"], plan.agentDir);
    assertEquals(env["XDG_DATA_HOME"], plan.xdgDataHome);
    assertEquals(env["TMPDIR"], plan.tmpDir);
    for (
      const selector of ALL_FORBIDDEN_SELECTORS.filter((s) =>
        !["HOME", "PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "TMPDIR"].includes(s)
      )
    ) {
      assertEquals(env[selector], undefined);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("finalizeOmpSpawnEnvironment - fails closed when a forbidden selector survived (assembly skipped sanitization)", async () => {
  const { plan, cleanup } = await makeLivePlan();
  try {
    // XDG_CONFIG_HOME present WITHOUT sanitization: finalize must refuse to
    // bless a spawn environment where a hostile selector survived.
    const env: Record<string, string> = { XDG_CONFIG_HOME: "/hostile/config", USER: "x" };
    assertThrows(
      () => finalizeOmpSpawnEnvironment(env, plan),
      Error,
      "XDG_CONFIG_HOME survived sanitization",
    );
    const foreign: Record<string, string> = { CLAUDE_CONFIG_DIR: "/hostile/claude" };
    assertThrows(
      () => finalizeOmpSpawnEnvironment(foreign, plan),
      Error,
      "survived sanitization",
    );
  } finally {
    await cleanup();
  }
});

function ompFactoryConfig(params: {
  tempRoot: string;
  yolo: boolean;
  sandbox?: SandboxConfig;
}): AgentConfig {
  const config = {
    agent: {
      defaultAgentType: "omp",
      model: "mock-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      ...(params.sandbox ? { sandbox: params.sandbox } : {}),
    },
    workspace: { repoPath: params.tempRoot },
  } as unknown as Config;
  return createAgentConfig("omp", params.tempRoot, config, params.yolo);
}

for (const withSandbox of [true, false]) {
  Deno.test(
    `agent-factory omp - attaches settingsSourcePlan and plan-owned env on the ${
      withSandbox ? "sandboxed" : "unsandboxed"
    } route`,
    async () => {
      const tempRoot = await Deno.makeTempDir({ prefix: "omp-factory-" });
      try {
        const cfg = ompFactoryConfig({
          tempRoot,
          yolo: false,
          sandbox: withSandbox ? sandboxConfig() : undefined,
        });
        const plan = cfg.settingsSourcePlan;
        assertExists(plan, "factory config must carry the settings-source plan");
        assertEquals(plan.mode, "restricted");
        assertEquals(cfg.cwd, plan.launchCwd);
        assertEquals(cfg.env?.["HOME"], plan.ownedHome);
        assertEquals(cfg.env?.["PI_CODING_AGENT_DIR"], plan.agentDir);
        assertEquals(cfg.env?.["XDG_DATA_HOME"], plan.xdgDataHome);
        assertEquals(cfg.env?.["TMPDIR"], plan.tmpDir);
        assertEquals(cfg.env?.["XDG_CONFIG_HOME"], undefined);
        assertEquals(cfg.env?.["PI_CONFIG_FILES"], undefined);
        assertEquals(cfg.env?.["CLAUDE_CONFIG_DIR"], undefined);
        // The factory creates the observer's authority roots at config build.
        for (const root of [plan.ownedHome, plan.agentDir, plan.launchCwd]) {
          const info = await Deno.stat(root);
          assertEquals(info.isDirectory, true);
        }
      } finally {
        await Deno.remove(tempRoot, { recursive: true });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Tasks 4.1/4.2 — metadata-only observer over clean and hostile fixtures
// ---------------------------------------------------------------------------

Deno.test("observer - clean plan accepted in both modes; unrelated user files untouched", async () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const { plan, sessionCwd, cleanup } = await makeLivePlan(mode);
    try {
      // An unrelated user file in the session workspace must neither block nor
      // be modified by observation (metadata-only: never reads content).
      const unrelated = `${sessionCwd}/notes.md`;
      await Deno.writeTextFile(unrelated, "user content\n");
      const overlays = expectAcceptance(await checkOmpSettingsSources(plan, sessionCwd));
      assertEquals(overlays.length, 1, `${mode}: clean plan must be accepted`);
      assertEquals(await Deno.readTextFile(unrelated), "user content\n");
    } finally {
      await cleanup();
    }
  }
});

Deno.test("observer - hostile native/legacy/foreign sources rejected with their pinned ids", async () => {
  const { plan, cleanup } = await makeLivePlan();
  try {
    // Nested session INSIDE the plan base root so the ancestor walk stays
    // exclusive to this fixture: native global (owned HOME), legacy agent-dir
    // settings, foreign project file at the ACTUAL session cwd, and a
    // foreign-project file at an ANCESTOR of the session cwd.
    const repo = `${plan.baseRoot}/work/repo`;
    const session = `${repo}/session`;
    await Deno.mkdir(session, { recursive: true });
    await Deno.mkdir(`${plan.ownedHome}`, { recursive: true });
    const writes: [string, string][] = [
      [`${plan.ownedHome}/config.yml`, "hostile global"],
      [`${plan.agentDir}/settings.json`, "hostile legacy"],
      [`${session}/.claude/settings.json`, "hostile foreign"],
      [`${repo}/.codex/config.toml`, "hostile ancestor"],
    ];
    for (const [path, content] of writes) {
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, content);
    }
    const failures = expectRejection(await checkOmpSettingsSources(plan, session));
    assert(failures.some((f) => f.kind === "forbidden_source"));
    const ids = new Set(failures.map((f) => f.label.split(" ")[0]!));
    assert(ids.has("native-global-config-yml"), "native global layer rejected");
    assert(ids.has("native-legacy-settings-json"), "legacy agent-dir layer rejected");
    assert(ids.has("foreign-claude-project-settings"), "foreign project layer rejected");
    assert(
      ids.has("foreign-codex-project-config-toml"),
      "foreign ANCESTOR layer rejected (cwd-only check would miss it)",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("observer - neutral launch cwd alone does not cover the ACP session cwd", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan();
  try {
    // Hostile project layer in the SESSION workspace only: the launch-cwd
    // preflight passes, the per-request session-cwd preflight must reject.
    await Deno.mkdir(`${sessionCwd}/.omp`, { recursive: true });
    await Deno.writeTextFile(`${sessionCwd}/.omp/config.yml`, "hostile project");
    expectAcceptance(await checkOmpSettingsSources(plan, plan.launchCwd));
    const failures = expectRejection(await checkOmpSettingsSources(plan, sessionCwd));
    assert(
      failures.some((f) => f.label.includes("native-project-config-yml")),
      "the session-cwd project layer is the rejection reason",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("observer - forbidden source reached via a LINK is its own failure kind", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan();
  try {
    const real = `${sessionCwd}/elsewhere.yml`;
    await Deno.writeTextFile(real, "payload");
    await Deno.symlink(real, `${plan.ownedHome}/config.yml`);
    const failures = expectRejection(await checkOmpSettingsSources(plan, sessionCwd));
    assert(
      failures.some((f) =>
        f.kind === "forbidden_source_link" && f.label.includes("native-global-config-yml")
      ),
      "a linked forbidden source is rejected as a link",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("observer - missing authority root and linked authority root fail closed", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan();
  try {
    await Deno.remove(plan.ownedHome, { recursive: true });
    const failures = expectRejection(await checkOmpSettingsSources(plan, sessionCwd));
    assert(
      failures.some((f) => f.kind === "authority_root_missing" && f.label.includes("owned HOME")),
      "a missing owned HOME cannot prove the owned-only posture",
    );
  } finally {
    await cleanup();
  }
  // A root replaced by a symlink to another directory escapes the plan.
  const { plan: plan2, sessionCwd: cwd2, cleanup: cleanup2 } = await makeLivePlan();
  try {
    const outside = await Deno.makeTempDir({ prefix: "omp-outside-" });
    await Deno.remove(plan2.agentDir, { recursive: true });
    await Deno.symlink(outside, plan2.agentDir, { type: "dir" });
    const failures = expectRejection(await checkOmpSettingsSources(plan2, cwd2));
    assert(
      failures.some((f) => f.kind === "authority_root_link" && f.label.includes("agent directory")),
      "a linked agent dir is rejected as an identity escape, never accepted",
    );
    await Deno.remove(outside, { recursive: true });
  } finally {
    await cleanup2();
  }
});

Deno.test("observer - unreadable metadata cannot prove absence (observation_error)", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan();
  try {
    const hostileReader = {
      lstat: (path: string) =>
        path === plan.ownedHome
          ? Promise.reject(new Deno.errors.PermissionDenied("eacces"))
          : Deno.lstat(path),
      realPath: (_path: string) => Promise.reject(new Deno.errors.PermissionDenied("eacces")),
    };
    const failures = expectRejection(
      await checkOmpSettingsSources(plan, sessionCwd, { reader: hostileReader }),
    );
    assert(
      failures.some((f) => f.kind === "observation_error" && f.label.includes("owned HOME")),
      "an unreadable authority root fails closed as observation_error",
    );
    // Content-free: the bounded detail carries the error class only.
    assert(failures.every((f) => !f.detail.includes("payload")));
  } finally {
    await cleanup();
  }
});

Deno.test("observer - owned overlays must exist, be plain files outside agent-writable roots, and keep identity across rechecks", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan("restricted", "v1\n");
  const overlayPath = plan.allowedOverlayPaths[0]!;
  try {
    // Accepted once (identity captured).
    const identities = await assertOmpSettingsSourcesVisible(plan, sessionCwd);
    assertEquals(identities.length, 1);

    // Replacement between checks fails closed on the changed identity (the
    // replaced content is a DIFFERENT SIZE, so the identity check is
    // deterministic without any clock dependence).
    await Deno.writeTextFile(overlayPath, "v2 REPLACED longer content\n");
    const failures = expectRejection(
      await checkOmpSettingsSources(plan, sessionCwd, {
        expectedOverlayIdentities: identities,
      }),
    );
    assert(
      failures.some((f) =>
        f.kind === "overlay_identity_mismatch" && f.label.includes("owned overlay")
      ),
      "a same-path overlay replacement fails closed",
    );
  } finally {
    await cleanup();
  }

  // Missing overlay and overlay placed INSIDE the agent dir are rejections.
  const { plan: p2, sessionCwd: c2, cleanup: cl2 } = await makeLivePlan();
  try {
    await Deno.remove(p2.allowedOverlayPaths[0]!);
    const failures = expectRejection(await checkOmpSettingsSources(p2, c2));
    assert(
      failures.some((f) => f.kind === "overlay_identity_mismatch"),
      "a missing owned overlay is a rejection",
    );
    const inside = `${p2.agentDir}/planted.yml`;
    await Deno.writeTextFile(inside, "agent-writable placement");
    const plantedPlan = ompSettingsSourcePlan("restricted", {
      baseRoot: p2.baseRoot,
      allowedOverlayPaths: [inside],
    });
    const plantedFailures = expectRejection(await checkOmpSettingsSources(plantedPlan, c2));
    assert(
      plantedFailures.some((f) =>
        f.kind === "overlay_identity_mismatch" && f.detail.includes("placement")
      ),
      "an overlay inside the agent-writable root escapes its deployment placement",
    );
  } finally {
    await cl2();
  }
});

Deno.test("observer - rejection message is bounded and content-free", () => {
  const many: SourceCheckFailure[] = Array.from({ length: 13 }, (_, i) => ({
    kind: "forbidden_source" as const,
    label: `source-${i} /some/path`,
    detail: "forbidden settings source exists",
  }));
  const message = formatSettingsSourceError(many);
  assert(message.includes("source-7"));
  assert(!message.includes("source-8"), "only the first 8 failures are listed");
  assert(message.includes("(+5 more)"));
  assert(message.includes("No user file was modified"));
});

// ---------------------------------------------------------------------------
// Task 4.2 — connector gate: zero protected calls on rejection; lifecycle
// steps accept on a clean plan (per-spawn/pooled share the seam)
// ---------------------------------------------------------------------------

function gatedConnector(plan: OmpSettingsSourcePlan): {
  connector: AgentConnector;
  protectedCalls: string[];
} {
  const protectedCalls: string[] = [];
  const connector = new AgentConnector({
    agentConfig: {
      command: "unused",
      args: [],
      cwd: plan.launchCwd,
      env: {
        // Ownership derivation reads the mode-scoped identity from the spawn
        // env; keep it consistent with the plan so recovery reaches the
        // settings preflight (row 26) AFTER the row-11 ownership verify.
        PI_CODING_AGENT_DIR: plan.agentDir,
        TMPDIR: plan.tmpDir,
      },
      settingsSourcePlan: plan,
    },
    clientConfig: {
      workingDir: plan.launchCwd,
      platform: "test",
      userId: "u",
      channelId: "c",
      isDM: false,
    },
    skillRegistry: null,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    agentType: "omp",
  });
  // Instrument the protected surface: any newSession here would be a native
  // request; connect() would spawn a process. Neither may happen on rejection.
  const stubConnection = {
    newSession: () => {
      protectedCalls.push("newSession");
      return Promise.resolve({ sessionId: "s", configOptions: [] });
    },
  } as unknown as typeof connector["connection"];
  connector["connection"] = stubConnection;
  connector["capabilities"] = { loadSession: true } as typeof connector["capabilities"];
  return { connector, protectedCalls };
}

Deno.test("connector createSession - hostile session cwd rejects BEFORE session/new (zero protected calls)", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan();
  try {
    await Deno.mkdir(`${sessionCwd}/.claude`, { recursive: true });
    await Deno.writeTextFile(`${sessionCwd}/.claude/settings.json`, "hostile");
    const { connector, protectedCalls } = gatedConnector(plan);

    await assertRejects(
      () => connector.createSession([], sessionCwd),
      SettingsSourceRejectionError,
      "settings-source preflight rejected",
    );
    assertEquals(protectedCalls, [], "session/new must never be reached");
  } finally {
    await cleanup();
  }
});

Deno.test("connector connect - planted forbidden source rejects BEFORE any spawn", async () => {
  const { plan, cleanup } = await makeLivePlan();
  try {
    await Deno.writeTextFile(`${plan.agentDir}/config.yml`, "planted global");
    const { connector } = gatedConnector(plan);
    await assertRejects(
      () => connector.connect(),
      SettingsSourceRejectionError,
      "native-global-config-yml",
    );
    assertEquals(connector.getProcessPid(), undefined, "the spawn is a protected call too");
  } finally {
    await cleanup();
  }
});

Deno.test("connector createSession - clean plan accepts, then overlay replacement fails the next request closed", async () => {
  const { plan, sessionCwd, cleanup } = await makeLivePlan("native-yolo", "v1\n");
  try {
    const { connector, protectedCalls } = gatedConnector(plan);
    const sessionId = await connector.createSession([], sessionCwd);
    assertEquals(sessionId, "s");
    assertEquals(protectedCalls, ["newSession"]);

    // Owner replaces the overlay between lifecycle steps (same connector, so
    // the accepted identity rides the recheck; size change keeps it clock-free).
    await Deno.writeTextFile(plan.allowedOverlayPaths[0]!, "v2 replaced longer\n");
    await assertRejects(
      () => connector.createSession([], sessionCwd),
      SettingsSourceRejectionError,
      "overlay_identity_mismatch",
    );
    assertEquals(protectedCalls, ["newSession"], "the replaced overlay never reaches session/new");
  } finally {
    await cleanup();
  }
});

Deno.test("connector recovery - hostile recovery cwd rejects with zero teardown/respawn side effects", async () => {
  const { plan, cleanup } = await makeLivePlan();
  const recoveryCwd = await Deno.makeTempDir({ prefix: "omp-recovery-" });
  try {
    await Deno.mkdir(`${recoveryCwd}/.gemini`, { recursive: true });
    await Deno.writeTextFile(`${recoveryCwd}/.gemini/settings.json`, "hostile");
    const { connector, protectedCalls } = gatedConnector(plan);
    let disconnects = 0;
    connector.disconnect = () => {
      disconnects++;
      return Promise.resolve();
    };
    connector.connect = () => {
      protectedCalls.push("connect");
      return Promise.resolve();
    };
    await assertRejects(
      () =>
        connector.reconnectAndResumeSession("sess", recoveryCwd, [], {
          ownership: {
            agentType: "omp",
            permissionMode: "restricted",
            processNamespace: plan.agentDir,
          },
          // A complete owning gate context (row 11): OMP recovery requires the
          // resolved permission and the owning skill session, not a cwd-only shape.
          gateContext: { cwd: recoveryCwd, shellSessionId: "shell_recovery", yolo: false },
        }),
      SettingsSourceRejectionError,
    );
    assertEquals(disconnects, 0);
    assertEquals(protectedCalls, [], "recovery load/respawn must not start");
  } finally {
    await Deno.remove(recoveryCwd, { recursive: true });
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 4.3 — decision-3 DECIDED disposition WITHOUT supported-native-reset
// claims (pinned reset verdict preserved verbatim by omp-settings.test.ts)
// ---------------------------------------------------------------------------

Deno.test("decision 3 - DECIDED application disposition rides the pinned unresolved reset verdict, claiming no native reset support", () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const { recordResetGate } = ompSettingsForMode(mode);
    assertEquals(recordResetGate.status, "unresolved");
    assertEquals(recordResetGate.strategy, "reset-then-mode-null");
    const d = recordResetGate.applicationDisposition;
    assertEquals(d.decision, 3);
    assertEquals(d.status, "DECIDED (2026-10-09)");
    assertEquals(d.control, "settings-discovery-path-control");
    assertEquals(d.nativeVerdictUnchanged, "unresolved/incompatible (recorded verbatim)");
    // The disposition is a path-control claim, never a reset-capability claim.
    for (
      const forbiddenClaim of [
        "supported-native-reset",
        "reset barrier provided",
        "natively supported",
      ]
    ) {
      assertEquals(d.mechanism.includes(forbiddenClaim), false);
    }
    // Restricted default-deny stays the second boundary in both modes.
    assert(d.secondBoundary.includes("default-deny"), "second boundary retained");
    assertEquals(d.residualRisks.length > 0, true);
  }
});
