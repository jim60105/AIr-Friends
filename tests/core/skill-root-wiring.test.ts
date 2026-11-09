// tests/core/skill-root-wiring.test.ts
//
// Wiring identity regression (`unify-omp-skill-root-resolution` D1/5.1):
// resolver root == prompt/retry skillsDir == connector inventory root
// == skill mount == readiness root, for the repository-development shape
// (real filesystem, real factory/connector/sandbox/healthcheck code paths).
//
// The container shape (the stock image's configured
// `/home/deno/.agents/skills`, shared by BOTH agent types since
// `unify-skill-root-and-inventory`) is covered by the resolver suite
// (`tests/core/skills-root.test.ts` — the one configured-root selection +
// canonical observation through its injectable seams), the confinement suite
// (literal-path ro mounts) and the packaging suite; a real container/bwrap
// acceptance run remains USER-OWNED and UNVERIFIED. The synthetic positives
// below are honestly labeled: they capture that the REAL consumers compose the
// SAME observation, not that a container exists.

import { assertEquals } from "@std/assert";
import { createAgentConfig, getDefaultAgentType } from "@acp/agent-factory.ts";
import { buildSkillAutoApproveList, matchesScriptEntrypoint } from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot, resolveTrustedSkillsRoot } from "@core/skills-root.ts";
import { resolve } from "node:path";
import { SandboxManager } from "../../src/acp/sandbox-manager.ts";
import { HealthCheckServer } from "../../src/healthcheck.ts";
import type { Config } from "../../src/types/config.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "../../src/utils/omp-native-cache.ts";
import {
  resetSandboxCapabilityCache,
  setSandboxCapabilityCacheForTest,
} from "../../src/acp/sandbox-capabilities.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

/**
 * The ONE deployment-resolved root in the repository-development shape
 * (`unify-skill-root-and-inventory`): the repository's own `skills/` tree, i.e.
 * what `agent.skillsDir` (default `"skills"`) resolves to from the repository
 * working directory for BOTH agent types.
 */
const REPO_SKILLS_ROOT = fs.realpathSync(resolve(import.meta.dirname ?? ".", "../../skills"));

function makeConfig(overrides: Partial<Config["agent"]> = {}): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "oc1",
      geminiApiKey: "gm1",
      ...overrides,
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: "/tmp/test", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  };
}

test("wiring identity - repository development: every consumer carries ONE root", async () => {
  // Deployment-default agent is OpenCode with the development default root
  // (`skills` relative to the deployment cwd = the repository `skills/` tree).
  const config = makeConfig();
  const agentType = getDefaultAgentType(config);

  // 1. RESOLVER root (the single authority).
  const resolver = observeTrustedSkillsRoot(agentType, config.agent.skillsDir);

  // 2. FACTORY / connector inventory root: the factory resolves once and the
  //    connector consumes THAT observation (AgentConnector: options
  //    .agentConfig.skillsRoot ?? re-observation) to build its inventory.
  const agentConfig = createAgentConfig("opencode", "/tmp/test/workspace", config);
  assertEquals(agentConfig.skillsRoot?.root, resolver.root);
  const inventory = buildSkillAutoApproveList({
    rootObservation: agentConfig.skillsRoot!,
  });
  assertEquals(inventory.root.canonicalPath, resolver.root);
  // The real repository tree yields real grants (identity-stable).
  assertEquals(inventory.scripts.length > 0, true);

  // 3. Prompt/retry `skillsDir`: the render contract and the retry context
  //    consume the resolver's string spelling of the SAME observation.
  const renderedSkillsDir = resolveTrustedSkillsRoot(agentType, config.agent.skillsDir);
  assertEquals(renderedSkillsDir, resolver.root);
  assertEquals(resolver.root, REPO_SKILLS_ROOT);

  // 4. Skill mount: the sandbox threads the factory observation to bwrap,
  //    which mounts the SAME literal path read-only.
  setSandboxCapabilityCacheForTest(false, true);
  try {
    const sandbox = new SandboxManager({
      filterEnv: true,
      networkIsolation: false,
      allowedEnvVars: [],
      allowedWriteExtensions: [".md"],
      filesystemConfinement: true,
      egressProxy: false,
      egressProxyPort: 0,
      unrestrictedEgress: true,
      egressAllowHosts: [],
    });
    const spawn = sandbox.buildSpawnOptions(
      "opencode",
      "opencode",
      ["acp"],
      {},
      "/tmp/test/workspace",
      agentConfig.skillsRoot,
    );
    let mounted = false;
    for (let i = 0; i < spawn.args.length - 2; i++) {
      if (spawn.args[i] === "--ro-bind-try" && spawn.args[i + 1] === resolver.root) mounted = true;
    }
    assertEquals(mounted, true, "skill mount literal == resolver root");
  } finally {
    resetSandboxCapabilityCache();
  }

  // 5. Readiness root: the healthcheck resolves the DEFAULT selected agent's
  //    root and its script checks name the SAME tree (the repository's real
  //    bundled script passes).
  const server = new HealthCheckServer(9997);
  const mockContext = {
    config,
    agentCore: {
      getSkillRegistry: () => ({ getAvailableSkills: () => ["memory-save"] }),
    },
    platformRegistry: { isAllConnected: () => true },
  };
  // oxlint-disable-next-line typescript/no-explicit-any
  server.setContext(mockContext as any);
  const readiness = await server.checkSkillReadiness();
  const scriptCheck = readiness.checks.find((c) => c.name === "scripts:memory-save");
  assertEquals(scriptCheck?.ready, true);
  // (A ready check carries no path; prove the root via the resolver identity —
  // the same check FAILS with the root in its message when pointed elsewhere,
  // pinned in tests/healthcheck.test.ts.)
  assertEquals(resolveTrustedSkillsRoot(agentType, config.agent.skillsDir), resolver.root);
});

test("wiring identity - a dashboard agent-type override cannot change the root", () => {
  // Dashboard override: selecting the OTHER agent type must not create a
  // second root spelling. Since `unify-skill-root-and-inventory` the resolver
  // has no agent-type selection at all, so both agent types (and every
  // dashboard `chatSession.agentType`) land on the one configured root — here
  // the repository `skills/` tree the default `"skills"` value resolves to.
  const config = makeConfig({ defaultAgentType: "omp" });
  const overridden = observeTrustedSkillsRoot("opencode", config.agent.skillsDir);
  const factory = createAgentConfig("opencode", "/tmp/test/workspace", config);
  assertEquals(factory.skillsRoot?.root, overridden.root);
  assertEquals(overridden.root, REPO_SKILLS_ROOT);
});

test("wiring identity - both agent types resolve a byte-identical canonical root in every deployment shape", () => {
  // Stock-image shape: the trio's declared container value, observed through
  // the injectable seam. The seam FABRICATES the identity, so this case proves
  // the SELECTION is that one configured value for both agent types (a
  // spelling-level proof, not an image evidence claim).
  const stock = "/home/deno/.agents/skills";
  const seamOptions = {
    directoryExists: (path: string) => path === stock,
    observeDirectory: (path: string) => ({ root: path, identity: { dev: 7, ino: 11 } }),
  };
  assertEquals(
    resolveTrustedSkillsRoot("opencode", stock, seamOptions),
    resolveTrustedSkillsRoot("omp", stock, seamOptions),
  );

  // Development shape (real filesystem): the repository tree the default
  // `skills` value resolves to, observed for BOTH agent types.
  const opencodeDev = observeTrustedSkillsRoot("opencode", undefined);
  const ompDev = observeTrustedSkillsRoot("omp", undefined);
  assertEquals(opencodeDev.root, REPO_SKILLS_ROOT);
  assertEquals(ompDev.root, REPO_SKILLS_ROOT);
  assertEquals(opencodeDev.identity, ompDev.identity);

  // Custom absolute root (real filesystem): a deployment-specific directory.
  const custom = fs.realpathSync(makeTempDirSync({ prefix: "air-custom-skills-" }));
  try {
    const opencodeCustom = observeTrustedSkillsRoot("opencode", custom);
    const ompCustom = observeTrustedSkillsRoot("omp", custom);
    assertEquals(opencodeCustom.root, custom);
    assertEquals(ompCustom.root, custom);
    assertEquals(opencodeCustom.identity, ompCustom.identity);
  } finally {
    fs.rmSync(custom, { recursive: true });
  }
});

test("wiring identity - per-spawn and pooled connectors resolve the identical root without SESSION_ID", () => {
  // One deployment configuration used by a per-spawn connector and by a pooled
  // connector must yield a byte-identical root for either agent type, and the
  // resolution must not read a per-session value to select one.
  // The `omp` factory hard-requires the shared prepared native payload, so this
  // suite supplies one over the internal selection seam (a real temporary tree,
  // no OMP process and no installed image).
  const nativeCacheRoot = makeTempDirSync();
  // A per-run deployment root: the mode roots carry the reserved `natives` link, so a
  // shared fixed path would make a second run refuse the previous run's link.
  const deploymentRoot = makeTempDirSync();
  const workingDir = `${deploymentRoot}/workspace`;
  fs.mkdirSync(workingDir, { recursive: true });
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(nativeCacheRoot, platform, "development");
  const { exact } = ompNativeCacheExpectedAddons(platform);
  const addonNames = exact.length > 0 ? [...exact] : ["pi_natives.synthetic-linux-arm64.node"];
  fs.mkdirSync(cache.versionDir, { recursive: true });
  for (const name of addonNames) fs.writeFileSync(`${cache.versionDir}/${name}`, "fixture");
  fs.writeFileSync(
    cache.manifestPath,
    serializeOmpNativeCacheManifest({
      version: OMP_NATIVE_CACHE_VERSION,
      platform,
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
      files: addonNames.map((name) => ({ name, size: "fixture".length })),
    }),
  );
  const config = makeConfig({
    skillsDir: REPO_SKILLS_ROOT,
    ompNativeCache: {
      installRoot: cache.installRoot,
      launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
    },
  });
  config.workspace.repoPath = deploymentRoot;
  const original = process.env["SESSION_ID"];
  process.env["SESSION_ID"] = "sess_must_not_select_a_root";
  try {
    for (const agentType of ["opencode", "omp"] as const) {
      const perSpawn = createAgentConfig(agentType, workingDir, config);
      const pooled = createAgentConfig(
        agentType,
        workingDir,
        config,
        false,
        undefined,
        "sess_pooled",
        "pool-key",
      );
      assertEquals(perSpawn.skillsRoot?.root, REPO_SKILLS_ROOT, agentType);
      assertEquals(pooled.skillsRoot?.root, REPO_SKILLS_ROOT, agentType);
      assertEquals(perSpawn.skillsRoot?.identity, pooled.skillsRoot?.identity, agentType);
    }
  } finally {
    if (original === undefined) delete process.env["SESSION_ID"];
    else process.env["SESSION_ID"] = original;
    fs.rmSync(nativeCacheRoot, { recursive: true });
    fs.rmSync(deploymentRoot, { recursive: true });
  }
});

test("wiring identity - pooled reconnect re-observation is deterministic", () => {
  // Recovery replays cached session contexts onto a fresh client, whose
  // connector re-observes through the SAME resolver (no gate-context drift in
  // the root spelling): two consecutive observations of the same configured
  // root agree on both path and identity, so a reconnect restores grants
  // against the identical physical tree. Readiness remains deployment-default
  // scoped (it always resolves getDefaultAgentType, never a session override —
  // pinned in tests/healthcheck.test.ts).
  const config = makeConfig();
  const first = observeTrustedSkillsRoot("opencode", config.agent.skillsDir);
  const second = observeTrustedSkillsRoot("opencode", config.agent.skillsDir);
  assertEquals(first.root, second.root);
  assertEquals(first.identity?.dev, second.identity?.dev);
  assertEquals(first.identity?.ino, second.identity?.ino);
});

test("external publication - the shared root admits the installed script for either agent type", async () => {
  // Publish an external script into the ONE resolved root layout (a temp tree
  // standing in for it), then decide for both agent types with an EMPTY and an
  // EXPLICIT approval list (`unify-skill-root-and-inventory`: the shared root
  // grants either agent type the installed script and neither needs a catalog
  // entry for it). Bootstrap ordering itself is pinned in
  // external-skill-publication-parity.test.ts.
  const root = fs.realpathSync(makeTempDirSync({ prefix: "air-shared-" }));
  try {
    const skillDir = `${root}/installed-external/scripts`;
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(`${root}/installed-external/SKILL.md`, "# external");
    await fsp.writeFile(`${skillDir}/installed-external.ts`, "// grant");
    const bundled = `${root}/memory-save/scripts`;
    await fsp.mkdir(bundled, { recursive: true });
    await fsp.writeFile(`${root}/memory-save/SKILL.md`, "# bundled");
    await fsp.writeFile(`${bundled}/memory-save.ts`, "// bundled grant");

    const scriptPath = `${root}/installed-external/scripts/installed-external.ts`;

    for (const agentType of ["opencode", "omp"] as const) {
      // The production seam for that agent type: the factory observes the one
      // configured root and the connector builds its inventory from it.
      const observation = observeTrustedSkillsRoot(agentType, root);
      for (const configured of [undefined, ["installed-external", "memory-save"]]) {
        // Empty list = full enumeration; explicit list = FILTER that still
        // observes the physically present external entry.
        const inventory = buildSkillAutoApproveList({
          rootObservation: observation,
          configuredSkills: configured,
        });
        assertEquals(
          inventory.scripts.some((s) => s.canonicalPath === scriptPath),
          true,
          `${agentType} admits the external script (configured=${String(configured)})`,
        );
        assertEquals(
          matchesScriptEntrypoint(`deno run ${scriptPath}`, inventory, {
            sessionCwd: undefined,
          }),
          true,
          `${agentType} approves the exact canonical invocation`,
        );
      }

      // A configured name absent from the root grants nothing for either type:
      const filtered = buildSkillAutoApproveList({
        rootObservation: observation,
        configuredSkills: ["ghost-skill"],
      });
      assertEquals(filtered.scripts.length, 0, agentType);
      assertEquals(filtered.commandPrefixes.size, 0, agentType);
    }
  } finally {
    await fsp.rm(root, { recursive: true });
  }
});
