/**
 * Row 27 (check-omp-workspace-executables): metadata-only executable-source
 * observer + pre-native seam unit/mock acceptance (tasks 4.1–4.3).
 *
 * Every fixture is synthetic wiring-test data: nothing here demonstrates that
 * the official binary discovers, imports, or executes anything (design §15
 * user-owned runtime verification). No real omp/agent/provider/container is
 * ever launched: the protected surface is a spy stub.
 */

import { AgentConnector } from "@acp/agent-connector.ts";
import { type OmpSettingsSourcePlan, ompSettingsSourcePlan } from "@acp/omp-settings.ts";
import {
  checkOmpExecutableSources,
  executableObservationForGuard,
  type ExecutableSourceMetadataReader,
  ExecutableSourceRejectionError,
} from "@acp/omp/executable-sources.ts";
import { computeDiscoveryDecision } from "@acp/omp/discovery-guard.ts";
import { SettingsSourceRejectionError } from "@acp/omp/settings-sources.ts";
import { bootstrapDiscoveryGuard } from "@acp/omp/extension/bootstrap.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";

interface Fixture {
  plan: OmpSettingsSourcePlan;
  baseRoot: string;
  workspace: string;
  cleanup: () => Promise<void>;
}

async function ownedFixture(mode: "restricted" | "native-yolo"): Promise<Fixture> {
  const baseRoot = await Deno.makeTempDir({ prefix: "omp-exec-fixture-" });
  const overlayPath = `${baseRoot}/mode.yml`;
  await Deno.writeTextFile(overlayPath, "# deployment-owned fixture overlay\n");
  const plan = ompSettingsSourcePlan(mode, { baseRoot, allowedOverlayPaths: [overlayPath] });
  await Deno.mkdir(plan.ownedHome, { recursive: true });
  await Deno.mkdir(plan.agentDir, { recursive: true });
  await Deno.mkdir(plan.launchCwd, { recursive: true });
  const workspace = await mkWorkspace(baseRoot);
  return {
    plan,
    baseRoot,
    workspace,
    cleanup: async () => await Deno.remove(baseRoot, { recursive: true }),
  };
}

/** Extra clean workspace under the same owned base root (one cleanup covers it). */
async function mkWorkspace(baseRoot: string): Promise<string> {
  const dir = `${baseRoot}/ws-${crypto.randomUUID()}`;
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

function check(
  ws: string,
  plan: OmpSettingsSourcePlan,
  extra: {
    sharedWorkspace?: string;
    processEnv?: Record<string, string | undefined>;
    reader?: ExecutableSourceMetadataReader;
    resourceGeneration?: string;
  } = {},
) {
  return checkOmpExecutableSources({
    phase: "preflight",
    sessionCwd: ws,
    ...(extra.sharedWorkspace !== undefined ? { sharedWorkspace: extra.sharedWorkspace } : {}),
    roots: {
      ownedHome: plan.ownedHome,
      agentDir: plan.agentDir,
      // The plan's neutral launch cwd is the designed inside-namespace
      // identity (row-9 layout); the connect()-seam posture admits exactly it.
      launchCwd: plan.launchCwd,
    },
    ...(extra.resourceGeneration !== undefined
      ? { resourceGeneration: extra.resourceGeneration }
      : {}),
    processEnv: extra.processEnv ?? {},
    ...(extra.reader !== undefined ? { reader: extra.reader } : {}),
  });
}

function expectRejection(run: () => unknown): ExecutableSourceRejectionError {
  let error: unknown = new Error("expected rejection, accepted instead");
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assertInstanceOf(error, ExecutableSourceRejectionError);
  return error;
}

const categories = (error: ExecutableSourceRejectionError): string[] =>
  error.issues.map((i) => `${i.surface}/${i.category}`);

// ---------------------------------------------------------------------------
// Task 4.1 — observer shapes (all fixtures chmod 0644: NO execute-bit logic)
// ---------------------------------------------------------------------------

Deno.test("observer - clean workspace: ordinary source and owned skill scripts stay un-inspected", async () => {
  const f = await ownedFixture("restricted");
  try {
    await Deno.mkdir(`${f.workspace}/src`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/src/index.ts`, "ordinary source");
    await Deno.writeTextFile(`${f.workspace}/README.md`, "docs");
    await Deno.mkdir(`${f.plan.agentDir}/skills/owner`, { recursive: true });
    await Deno.writeTextFile(`${f.plan.agentDir}/skills/owner/tool.ts`, "owned skill script");
    const accepted = check(f.workspace, f.plan);
    assertEquals(accepted.entries.every((e) => e.status === "absent"), true);
    assertEquals(accepted.workspaceIdentity, await Deno.realPath(f.workspace));
    // Guard admission shape rides the accepted identity/generation.
    const shaped = executableObservationForGuard(accepted);
    assertEquals(shaped.status, "absent-clean");
    assertEquals(shaped.resourceGeneration, accepted.resourceGeneration);
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - custom-tool file form rejects WITHOUT an execute bit (both roots)", async () => {
  const f = await ownedFixture("restricted");
  try {
    await Deno.mkdir(`${f.workspace}/.omp/tools`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/.omp/tools/evil.ts`, "console.log(1)");
    await Deno.chmod(`${f.workspace}/.omp/tools/evil.ts`, 0o644); // never executed by the check
    const error = expectRejection(() => check(f.workspace, f.plan));
    assert(categories(error).includes("native-custom-tool-discovery/executable_entry_found"));
    assertStringIncludes(error.message, "evil.ts");
    await Deno.remove(`${f.workspace}/.omp`, { recursive: true });
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/tools/plain.js`, "0");
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("native-custom-tool-discovery/executable_entry_found"),
      "root-relative `tools/` is the second pinned custom-tool route",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - custom-tool package form and deep nesting reject", async () => {
  const f = await ownedFixture("native-yolo");
  try {
    await Deno.mkdir(`${f.workspace}/tools/pkg/sub/deeper`, { recursive: true });
    await Deno.writeTextFile(
      `${f.workspace}/tools/pkg/package.json`,
      JSON.stringify({
        name: "pkg",
        main: "index.js",
      }),
    );
    const error = expectRejection(() => check(f.workspace, f.plan));
    assert(categories(error).includes("native-custom-tool-discovery/executable_entry_found"));
    assertStringIncludes(error.message, "package.json");
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - plugin package/index entry points reject; inert candidates accept", async () => {
  const f = await ownedFixture("restricted");
  try {
    await Deno.mkdir(`${f.workspace}/plugins/indexed`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/plugins/indexed/index.mjs`, "0");
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("plugin-entry-points/executable_entry_found"),
    );
    await Deno.remove(`${f.workspace}/plugins`, { recursive: true });

    await Deno.mkdir(`${f.workspace}/plugins/pkged`, { recursive: true });
    await Deno.writeTextFile(
      `${f.workspace}/plugins/pkged/package.json`,
      JSON.stringify({
        exports: "./impl.js",
      }),
    );
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("plugin-entry-points/executable_entry_found"),
      "a declared entry point is importable even with no index file present",
    );
    await Deno.remove(`${f.workspace}/plugins`, { recursive: true });

    await Deno.mkdir(`${f.workspace}/plugins/inert`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/plugins/inert/README.md`, "no entry point");
    const accepted = check(f.workspace, f.plan);
    assertEquals(
      accepted.entries.find((entry) => entry.root === `${f.workspace}/plugins`)?.status,
      "inert",
      "a plugin candidate with no importable entry stays inert",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - linked dependencies reject: manifest specifiers, node_modules links, @scoped links", async () => {
  const f = await ownedFixture("native-yolo");
  try {
    await Deno.writeTextFile(
      `${f.workspace}/package.json`,
      JSON.stringify({ dependencies: { local: "file:../outside" } }),
    );
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("workspace-owned-dependencies/linked_dependency_found"),
      "file:/link:/workspace: specifiers are linked dependencies (pinned plugin route)",
    );
    await Deno.remove(`${f.workspace}/package.json`);

    await Deno.mkdir(`${f.workspace}/node_modules`, { recursive: true });
    const target = await Deno.makeTempDir({ prefix: "omp-exec-target-" });
    try {
      await Deno.symlink(target, `${f.workspace}/node_modules/linked`);
      assert(
        categories(expectRejection(() => check(f.workspace, f.plan)))
          .includes("workspace-owned-dependencies/symlinked_discovery_candidate"),
      );
      await Deno.remove(`${f.workspace}/node_modules/linked`);
      await Deno.mkdir(`${f.workspace}/node_modules/@scoped`, { recursive: true });
      await Deno.symlink(target, `${f.workspace}/node_modules/@scoped/pkg`);
      assert(
        categories(expectRejection(() => check(f.workspace, f.plan)))
          .includes("workspace-owned-dependencies/symlinked_discovery_candidate"),
        "@scope groups are scanned for links too",
      );
    } finally {
      await Deno.remove(target, { recursive: true });
    }
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - configured module selectors in the observed env reject", async () => {
  const f = await ownedFixture("restricted");
  try {
    const error = expectRejection(() =>
      check(f.workspace, f.plan, { processEnv: { PI_CONFIG_FILES: "/foreign/config.yml" } })
    );
    assert(
      categories(error).includes("configured-module-roots/configured_module_selector_present"),
    );
    // The owned namespace variable is NOT a selector (row-2 posture): clean.
    check(f.workspace, f.plan, { processEnv: { PI_CODING_AGENT_DIR: f.plan.agentDir } });
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - outside (global) discovery routes fail closed when present, clean when absent", async () => {
  const f = await ownedFixture("native-yolo");
  try {
    check(f.workspace, f.plan); // absent global routes are the clean posture
    await Deno.mkdir(`${f.plan.ownedHome}/.omp/tools`, { recursive: true });
    const error = expectRejection(() => check(f.workspace, f.plan));
    assert(
      categories(error).includes("native-custom-tool-discovery/unknown_entry_shape"),
      "even an EMPTY global route cannot establish deployment exclusion",
    );
    assertStringIncludes(error.message, `${f.plan.ownedHome}/.omp/tools`);
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - global PLUGIN routes fail closed when present, clean when absent (duck B1)", async () => {
  const f = await ownedFixture("native-yolo");
  try {
    check(f.workspace, f.plan); // absent plugin routes are the clean posture
    await Deno.mkdir(`${f.plan.ownedHome}/.omp/plugins`, { recursive: true });
    const error = expectRejection(() => check(f.workspace, f.plan));
    assert(
      categories(error).includes("plugin-entry-points/unknown_entry_shape"),
      "a populated global plugin install is importable supply even with tools routes empty",
    );
    assertStringIncludes(error.message, `${f.plan.ownedHome}/.omp/plugins`);
    await Deno.remove(`${f.plan.ownedHome}/.omp/plugins`, { recursive: true });
    await Deno.mkdir(`${f.plan.agentDir}/plugins`, { recursive: true });
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("plugin-entry-points/unknown_entry_shape"),
      "the agent-namespace plugin route is also observed",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - foreign-provider project route .claude/tools fails closed (duck B1)", async () => {
  const f = await ownedFixture("restricted");
  try {
    check(f.workspace, f.plan); // absent .claude/tools is the clean posture
    await Deno.mkdir(`${f.workspace}/.claude/tools`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/.claude/tools/ambient.ts`, "0");
    const error = expectRejection(() => check(f.workspace, f.plan));
    assert(
      categories(error).includes("native-custom-tool-discovery/executable_entry_found"),
      "project .claude/tools modules are loader-recognized importable entries",
    );
    assertStringIncludes(error.message, `${f.workspace}/.claude/tools/ambient.ts`);
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - special-file ('other') entry kinds are never silently clean (duck B5)", async () => {
  const f = await ownedFixture("restricted");
  try {
    // node_modules position occupied by a special file: unknown importability.
    const otherAt = (target: string): ExecutableSourceMetadataReader => ({
      ...defaultishReader(),
      kind: (path) => (path === target ? "other" : defaultishReader().kind(path)),
    });
    const nodeModules = `${f.workspace}/node_modules`;
    assert(
      categories(
        expectRejection(() => check(f.workspace, f.plan, { reader: otherAt(nodeModules) })),
      )
        .includes("workspace-owned-dependencies/unknown_entry_shape"),
    );
    // package.json position occupied by a directory: unknown semantics.
    const manifestPath = `${f.workspace}/package.json`;
    assert(
      categories(
        expectRejection(() => check(f.workspace, f.plan, { reader: otherAt(manifestPath) })),
      )
        .includes("workspace-owned-dependencies/unknown_entry_shape"),
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - unset or relative owned roots are missing authority, never empty-route clean (duck B3)", async () => {
  const f = await ownedFixture("restricted");
  try {
    for (
      const roots of [
        { ownedHome: "", agentDir: f.plan.agentDir, launchCwd: f.plan.launchCwd },
        { ownedHome: f.plan.ownedHome, agentDir: "", launchCwd: f.plan.launchCwd },
        { ownedHome: "relative/home", agentDir: f.plan.agentDir, launchCwd: f.plan.launchCwd },
      ]
    ) {
      const error = expectRejection(() =>
        checkOmpExecutableSources({
          phase: "preflight",
          sessionCwd: f.workspace,
          roots,
          processEnv: {},
        })
      );
      assert(
        categories(error).some((c) => c.endsWith("missing_workspace_authority")),
        `interpolated filesystem-root routes must never admit: ${JSON.stringify(roots)}`,
      );
    }
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - symlinked, broken, replaced, and unknown shapes reject", async () => {
  const f = await ownedFixture("restricted");
  try {
    // Symlinked discovery candidate in the walk path.
    await Deno.symlink("/somewhere/else", `${f.workspace}/.omp`);
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .some((c) => c.endsWith("symlinked_discovery_candidate")),
    );
    await Deno.remove(`${f.workspace}/.omp`);

    // Broken link inside the tool tree (lstat-visible: never followed).
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    await Deno.symlink(`${f.workspace}/gone`, `${f.workspace}/tools/broken.ts`);
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .includes("native-custom-tool-discovery/symlinked_discovery_candidate"),
      "a broken module-suffixed link stays fail-closed",
    );
    await Deno.remove(`${f.workspace}/tools`, { recursive: true });

    // Discovery root replaced by a file: unknown layout.
    await Deno.writeTextFile(`${f.workspace}/tools`, "not a directory");
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .some((c) => c.endsWith("unknown_entry_shape")),
    );
    await Deno.remove(`${f.workspace}/tools`);

    // Unparsable workspace manifest: importability unknown → fail closed.
    await Deno.writeTextFile(`${f.workspace}/package.json`, "{not json");
    assert(
      categories(expectRejection(() => check(f.workspace, f.plan)))
        .some((c) => c.startsWith("workspace-owned-dependencies/")),
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("observer - IO failure rejects (injected reader); distinct workspaces bind distinct identities", async () => {
  const f = await ownedFixture("restricted");
  try {
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    const failingReader: ExecutableSourceMetadataReader = {
      ...defaultishReader(),
      readDirectory: () => {
        throw new Deno.errors.PermissionDenied("simulated IO failure");
      },
    };
    const error = expectRejection(() => check(f.workspace, f.plan, { reader: failingReader }));
    assert(categories(error).some((c) => c.endsWith("inaccessible_path")));

    // A replaced workspace (different identity) can never reuse a previous
    // clean result: each accepted snapshot binds its own canonical id.
    const base = check(f.workspace, f.plan);
    const second = await mkWorkspace(f.baseRoot);
    const other = check(second, f.plan);
    assert(other.workspaceIdentity !== base.workspaceIdentity);
    assert(other.resourceGeneration !== base.resourceGeneration);
  } finally {
    await f.cleanup();
  }
});

function defaultishReader(): ExecutableSourceMetadataReader {
  return {
    readDirectory(path) {
      const names: string[] = [];
      for (const entry of Deno.readDirSync(path)) names.push(entry.name);
      return names.sort();
    },
    kind(path) {
      try {
        const info = Deno.lstatSync(path);
        if (info.isSymlink) return "link";
        if (info.isDirectory) return "dir";
        if (info.isFile) return "file";
        return "other";
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return "missing";
        throw error;
      }
    },
    readFile: (path) => Deno.readTextFileSync(path),
    identity: (path) => Deno.realPathSync(path),
    parentIsCanonical: (parent) => {
      try {
        return Deno.realPathSync(parent) === parent;
      } catch {
        return false;
      }
    },
  };
}

Deno.test("observer - rejection reason is bounded (≤8 issues), content-free, no capability claim", async () => {
  const f = await ownedFixture("restricted");
  try {
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    for (let i = 0; i < 10; i++) await Deno.writeTextFile(`${f.workspace}/tools/t${i}.ts`, "0");
    const error = expectRejection(() => check(f.workspace, f.plan));
    assertEquals(error.issueCount, 10);
    assertEquals(error.issues.length, 8, "only the first 8 issues are listed");
    assertStringIncludes(error.message, "+2 more");
    assert(!error.message.includes("console.log"), "message carries metadata only, never content");
    assertStringIncludes(error.message, "rejected session before the native request");
    // Task 4.3: the client-visible preflight rejection never claims a native
    // supported mechanism or a readiness/acknowledgement channel (decision-2
    // residual-risk posture stays distinct).
    for (const forbidden of ["supported", "readiness", "acknowledg"]) {
      assertEquals(error.message.toLowerCase().includes(forbidden), false, `no "${forbidden}"`);
    }
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 2.1/4.2 — DECIDED decision-1 admission rides the guard; stale/foreign
// observations never admit (fail-closed fallback)
// ---------------------------------------------------------------------------

Deno.test("guard - clean observation admits decision 1 in both modes; stale generation never re-admits", async () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const f = await ownedFixture(mode);
    try {
      const accepted = check(f.workspace, f.plan, { resourceGeneration: "gen-7" });
      const decision = computeDiscoveryDecision({
        baseRoot: f.baseRoot,
        mode,
        // Admission binds the observation to the decision's own workspace
        // (duck B2): this is the connector-seam posture — the decision
        // evaluates exactly the workspace the observer just observed.
        observedCwd: f.workspace,
        resourceGeneration: "gen-7",
        executableObservation: executableObservationForGuard(accepted),
      });
      assertEquals(
        decision.blockers.filter((b) =>
          ["native-custom-tool-discovery", "plugin-entry-points"].includes(b.surfaceId)
        ).length,
        0,
        `${mode}: DECIDED-control admission replaces the unconditional unsupported-native rejection`,
      );
      // The pinned surfaces table keeps the no-supported-mechanism verdicts verbatim.
      assertEquals(
        decision.surfaces.find((s) => s.id === "native-custom-tool-discovery")?.status,
        "no-supported-mechanism",
      );
      assertExists(decision.executableObservation);

      const stale = computeDiscoveryDecision({
        baseRoot: f.baseRoot,
        mode,
        observedCwd: f.workspace,
        resourceGeneration: "gen-8",
        executableObservation: executableObservationForGuard(accepted),
      });
      assert(
        stale.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
        "a stale-generation observation never re-admits",
      );
    } finally {
      await f.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// Task 3.1/4.2 — connector seam: after settings, before protected calls,
// fresh workspace observed per step, zero side effects on rejection
// ---------------------------------------------------------------------------

function gatedConnector(
  plan: OmpSettingsSourcePlan,
  env: Record<string, string> = {},
): { connector: AgentConnector; protectedCalls: string[] } {
  const protectedCalls: string[] = [];
  const connector = new AgentConnector({
    agentConfig: {
      command: "unused",
      args: [],
      cwd: plan.launchCwd,
      env: { PI_CODING_AGENT_DIR: plan.agentDir, TMPDIR: plan.tmpDir, ...env },
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
  connector["connection"] = {
    newSession: () => {
      protectedCalls.push("newSession");
      return Promise.resolve({ sessionId: "s", configOptions: [] });
    },
  } as unknown as typeof connector["connection"];
  connector["capabilities"] = { loadSession: true } as typeof connector["capabilities"];
  return { connector, protectedCalls };
}

Deno.test("connector - clean workspace accepts in both modes; the observation rides the connector", async () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const f = await ownedFixture(mode);
    try {
      const { connector, protectedCalls } = gatedConnector(f.plan);
      const sessionId = await connector.createSession([], f.workspace);
      assertEquals(sessionId, "s");
      assertEquals(protectedCalls, ["newSession"]);
      const observation = connector.lastExecutableObservation;
      assertExists(observation);
      assertEquals(observation.sessionCwd, await Deno.realPath(f.workspace));
    } finally {
      await f.cleanup();
    }
  }
});

Deno.test("connector - workspace executable entry rejects BEFORE session/new (zero protected calls)", async () => {
  const f = await ownedFixture("restricted");
  try {
    const { connector, protectedCalls } = gatedConnector(f.plan);
    await connector.createSession([], f.workspace); // clean first acceptance

    // Owner drops a custom-tool module between lifecycle steps.
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/tools/dropped.ts`, "0");
    await assertRejects(
      () => connector.createSession([], f.workspace),
      ExecutableSourceRejectionError,
      "rejected session before the native request",
    );
    assertEquals(protectedCalls, ["newSession"], "the grown entry never reaches session/new");
    assertExists(
      connector.lastExecutableObservation,
      "a rejection never clobbers the accepted one",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("connector - settings check runs FIRST on the same seam (ordering witness)", async () => {
  const f = await ownedFixture("native-yolo");
  try {
    await Deno.mkdir(`${f.workspace}/.claude`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/.claude/settings.json`, "hostile");
    await Deno.mkdir(`${f.workspace}/tools`, { recursive: true });
    await Deno.writeTextFile(`${f.workspace}/tools/also.ts`, "0");
    const { connector, protectedCalls } = gatedConnector(f.plan);
    // Both gates would reject; the SETTINGS error must win → settings runs first.
    await assertRejects(
      () => connector.createSession([], f.workspace),
      SettingsSourceRejectionError,
    );
    assertEquals(protectedCalls, []);
  } finally {
    await f.cleanup();
  }
});

Deno.test("connector - shared AGENT_WORKSPACE participates in the observation", async () => {
  const f = await ownedFixture("restricted");
  try {
    const shared = await mkWorkspace(f.baseRoot);
    const { connector } = gatedConnector(f.plan, { AGENT_WORKSPACE: shared });
    await connector.createSession([], f.workspace); // both clean
    await Deno.mkdir(`${shared}/plugins/evil`, { recursive: true });
    await Deno.writeTextFile(`${shared}/plugins/evil/index.ts`, "0");
    await assertRejects(
      () => connector.createSession([], f.workspace),
      ExecutableSourceRejectionError,
      "plugin-entry-points",
      "a plugin entry point in the shared workspace rejects the session",
    );
  } finally {
    await f.cleanup();
  }
});

Deno.test("connector - recovery seam rejects with zero teardown/respawn/load side effects", async () => {
  const f = await ownedFixture("restricted");
  try {
    const recoveryCwd = await mkWorkspace(f.baseRoot);
    await Deno.mkdir(`${recoveryCwd}/.omp/tools`, { recursive: true });
    await Deno.writeTextFile(`${recoveryCwd}/.omp/tools/load.ts`, "0");
    const { connector, protectedCalls } = gatedConnector(f.plan);
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
            processNamespace: f.plan.agentDir,
          },
          gateContext: { cwd: recoveryCwd },
        }),
      ExecutableSourceRejectionError,
    );
    assertEquals(disconnects, 0, "rejection precedes teardown — zero side effects");
    assertEquals(protectedCalls, [], "respawn/load must not start");
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 3.1/3.2 — extension-load STARTUP CHECK (restricted identity only)
// ---------------------------------------------------------------------------

Deno.test("startup check - restricted extension load REJECTS a workspace executable module", async () => {
  const f = await ownedFixture("restricted");
  try {
    // The restricted launch cwd doubles as the observed workspace authority.
    const launch = f.plan.launchCwd;
    await Deno.mkdir(`${launch}/tools`, { recursive: true });
    await Deno.writeTextFile(`${launch}/tools/evil.ts`, "0");
    let thrown: unknown;
    try {
      bootstrapDiscoveryGuard({
        deploymentBaseRoot: f.baseRoot,
        observedCwd: launch,
        observedEnv: { HOME: f.plan.ownedHome, PI_CODING_AGENT_DIR: f.plan.agentDir },
      });
    } catch (error) {
      thrown = error;
    }
    const error = rejectionOf(thrown);
    assertEquals(error.phase, "extension_load");
    assert(categories(error).includes("native-custom-tool-discovery/executable_entry_found"));
  } finally {
    await f.cleanup();
  }
});

function rejectionOf(thrown: unknown): ExecutableSourceRejectionError {
  assertInstanceOf(thrown, ExecutableSourceRejectionError);
  return thrown;
}

Deno.test("startup check - clean restricted load admits decision 1 with the observation attached", async () => {
  const f = await ownedFixture("restricted");
  try {
    const decision = bootstrapDiscoveryGuard({
      deploymentBaseRoot: f.baseRoot,
      observedCwd: f.plan.launchCwd,
      observedEnv: { HOME: f.plan.ownedHome, PI_CODING_AGENT_DIR: f.plan.agentDir },
    });
    assertEquals(
      decision.blockers.filter((b) =>
        ["native-custom-tool-discovery", "plugin-entry-points"].includes(b.surfaceId)
      ).length,
      0,
      "the clean startup observation admits under DECIDED decision 1",
    );
    const observation = decision.executableObservation;
    assertExists(observation);
    assertEquals(decision.resourceGeneration, observation.resourceGeneration);
  } finally {
    await f.cleanup();
  }
});

Deno.test("startup check - development/unidentified identity keeps the pinned fail-closed blockers verbatim", async () => {
  const baseRoot = await Deno.makeTempDir({ prefix: "omp-exec-dev-" });
  try {
    // No /omp-agent/{mode}/cwd identity: no observation is taken at all and
    // the row-12/16 pinned pre-import blockers stay byte-for-byte.
    const decision = bootstrapDiscoveryGuard({
      deploymentBaseRoot: baseRoot,
      observedCwd: baseRoot,
      observedEnv: {},
    });
    assertEquals(decision.executableObservation, undefined);
    const messages = decision.blockers.map((b) => b.message);
    assert(
      messages.some((m) =>
        m ===
          "pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)"
      ),
      "pinned blocker text preserved verbatim",
    );
    assert(
      messages.some((m) =>
        m ===
          "pre-import exclusion not established: plugin-entry-points (no-supported-mechanism)"
      ),
    );
  } finally {
    await Deno.remove(baseRoot, { recursive: true });
  }
});
