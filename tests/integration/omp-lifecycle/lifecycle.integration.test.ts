// tests/integration/omp-lifecycle/lifecycle.integration.test.ts
//
// Combined mock-ACP OMP lifecycle suite (cover-omp-mocked-acp-lifecycle, row 23).
//
// TIER POLICY (design D4 + plan review): scenarios touching the REAL
// AgentProcessPool or a real subprocess connector use real wall-clock time —
// fake timers are BANNED at this tier (the pool's liveness/idle math reads
// Date.now() across process boundaries). Subprocess death is asserted via the
// connector's own crash signal and recorded RPCs, never sleep-based kill
// races: the mock crash trigger is prompt-text-driven with NO delay
// dependency, and every bounded wait polls an explicitly observable fact.
//
// EVIDENCE BOUNDARY (docs/OMP_EVIDENCE design §15): every subprocess here is
// a `deno run` mock; every catalog/observation is synthetic. Nothing in this
// file demonstrates or claims that the native OMP binary invokes the attached
// handler, honors a denial, emits readiness, or suppresses a language server.
// Allow-path fixtures are registered as labeled
// synthetic positives on the shared ledger; the suite guard in
// opencode-regression.integration.test.ts scans them.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentProcessPool } from "@core/agent-process-pool.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { AgentConfig, AgentConnectorOptions } from "@acp/types.ts";
import { SessionRegistry } from "../../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { createLogger } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "../../acp/filesystem-test-calls.ts";
import type { PoolRunOptions } from "@core/agent-process-pool.ts";
import type { Config } from "../../../src/types/config.ts";
import {
  buildOmpFactoryAgentConfig,
  createOmpTestConfig,
  expectProcessGone,
  type OmpPermissionMode,
  processAlive,
  SyntheticPositiveLedger,
  useMockOmpAgent,
} from "../../mocks/omp-mock-session.ts";

const logger = createLogger("OmpLifecycleIntegration");

async function binaryAvailable(name: string): Promise<boolean> {
  try {
    const res = await new Deno.Command("which", { args: [name] }).output();
    return res.code === 0;
  } catch {
    return false;
  }
}

const CAN_RUN_SUBPROCESS = await binaryAvailable("dumb-init") && await binaryAvailable("deno");

const SKILL_SECRET = "0123456789abcdef0123456789abcdef01";

/** Recorded RPC line from the mock agent's MOCK_OMP_RECORD_RPC JSONL. */
interface RecordedLine {
  gen: string;
  seq: number;
  pid: number;
  method: string;
  params: Record<string, unknown>;
}

async function readRpcLines(file: string): Promise<RecordedLine[]> {
  try {
    const text = await Deno.readTextFile(file);
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedLine);
  } catch {
    return [];
  }
}

interface Harness {
  tempDir: string;
  jwtDir: string;
  workspacePath: string;
  config: Config;
  sessionRegistry: SessionRegistry;
  skillRegistry: SkillRegistry;
  pool: AgentProcessPool;
  spawned: AgentConnector[];
  shellSessionId: string;
}

/** Per-test hermetic harness: temp repo root, registry, real pool. */
async function createHarness(poolKey: string): Promise<Harness> {
  const tempDir = await Deno.makeTempDir({ prefix: "omp-lifecycle-" });
  const jwtDir = join(tempDir, "skill-jwt");
  await Deno.mkdir(jwtDir, { recursive: true });
  const config = createOmpTestConfig({ tempRepoRoot: tempDir, poolKey });
  const sessionRegistry = new SessionRegistry();
  const workspaceManager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
  const workspacePath = join(tempDir, "session-cwd");
  await Deno.mkdir(workspacePath, { recursive: true });
  // shellSessionId stays null in pool options: these scenarios exercise
  // lifecycle/lease/recovery wiring, not the Skill-API JWT/pointer machinery,
  // so no registry session is required — the id below is gate-context data.
  const shellSessionId = "lifecycle-shell-session";
  const spawned: AgentConnector[] = [];
  const pool = new AgentProcessPool(
    config,
    sessionRegistry,
    SKILL_SECRET,
    (options: AgentConnectorOptions) => {
      const connector = new AgentConnector(options);
      spawned.push(connector);
      return connector;
    },
    60_000,
  );
  return {
    tempDir,
    jwtDir,
    workspacePath,
    config,
    sessionRegistry,
    skillRegistry,
    pool,
    spawned,
    shellSessionId,
  };
}

async function teardownHarness(h: Harness, livePids: (number | undefined)[]): Promise<void> {
  // The run() promise resolves BEFORE the release path clears `inFlight`
  // (documented pool behavior); await the observable release condition with
  // a bounded poll rather than a fixed sleep.
  const releaseDeadline = Date.now() + 30_000;
  while (!h.pool.isIdle() && Date.now() < releaseDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // The bounded poll exists because run() resolves before the release drain
  // clears inFlight — the drain's own budgets are far below 30s, so a pool
  // that never drains is a real hang and must surface as this failure, not
  // as a leaked directory or a later unexplained flake.
  assertEquals(h.pool.isIdle(), true, "release path must drain within the bounded poll");
  for (const connector of h.spawned) {
    try {
      await connector.disconnect();
    } catch {
      // Best effort during teardown.
    }
  }
  h.pool.stop();
  h.sessionRegistry.stop();
  for (const pid of livePids) {
    if (pid !== undefined) await expectProcessGone(pid, "pool agent process", 200);
  }
  try {
    await Deno.remove(h.tempDir, { recursive: true });
  } catch {
    // Temp-dir cleanup is best effort.
  }
}

interface ScopedOptions {
  options: PoolRunOptions;
  /** Factory launch posture captured BEFORE the mock-agent swap. */
  factoryArgs: string[];
  agentConfig: AgentConfig;
}

function scopedOptions(params: {
  poolKey: string;
  mode: OmpPermissionMode;
  harness: Harness;
  stateDir: string;
  recordRpcFile: string;
  catalog: "grouped" | "flat" | "miss" | "none";
  loadCatalog?: "grouped" | "flat" | "miss" | "none";
  crashOnPrompt?: string;
  sidebro?: boolean;
}): ScopedOptions {
  const agentConfig = buildOmpFactoryAgentConfig({
    mode: params.mode,
    tempRepoRoot: params.harness.tempDir,
    workingDir: params.harness.workspacePath,
    poolKey: params.poolKey,
    sessionId: params.harness.shellSessionId,
  });
  // The mock swap REPLACES command/args; capture the shipped factory
  // posture verbatim here so launch-posture assertions consume the real
  // createAgentConfig output, not the mock's arg list.
  const factoryArgs = [...agentConfig.args];
  useMockOmpAgent(agentConfig, {
    stateDir: params.stateDir,
    catalog: params.catalog,
    loadCatalog: params.loadCatalog,
    recordRpcFile: params.recordRpcFile,
    crashOnPrompt: params.crashOnPrompt,
    sidebro: params.sidebro,
    allowRun: params.sidebro === true,
  });
  const clientConfig = {
    workingDir: params.harness.workspacePath,
    platform: "discord",
    userId: "u-lifecycle",
    channelId: "discord/lifecycle",
    isDM: false,
    yolo: params.mode === "native-yolo",
    sessionId: params.harness.shellSessionId,
    xdgDataHome: agentConfig.env?.["XDG_DATA_HOME"],
    allowedWriteExtensions: [".md", ".txt"],
    // Shipped test seam (ClientConfig.nativeCalls): the offline native-call
    // model the filesystem suites already use, so the write gate exercises
    // its real authorization + write machinery without libc/openat2 FFI.
    nativeCalls: createFilesystemTestCalls(),
  };
  const options: PoolRunOptions = {
    poolKey: params.poolKey,
    agentType: "omp",
    permissionMode: params.mode,
    sessionType: "message",
    shellSessionId: null,
    priority: "interactive",
    connectorOptions: {
      agentConfig,
      clientConfig,
      skillRegistry: params.harness.skillRegistry,
      logger,
      agentType: "omp",
      idleTimeoutConfig: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
    },
    sessionCwd: params.harness.workspacePath,
  };
  return { options, factoryArgs, agentConfig };
}

// ---------------------------------------------------------------------------
// 3.1 Happy path: initialize/new/prompt/cancel/load through REAL pool wiring
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "OMP lifecycle 3.1: happy-path initialize/new/prompt/cancel/load composes through the real pool entry with mode-keyed cache and lease release",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const h = await createHarness("discord:lifecycle-31");
    const stateDir = join(h.tempDir, "state-31");
    const rpcFile = join(stateDir, "rpc.jsonl");
    const livePids: (number | undefined)[] = [];
    try {
      const scoped = scopedOptions({
        poolKey: "discord:lifecycle-31",
        mode: "restricted",
        harness: h,
        stateDir,
        recordRpcFile: rpcFile,
        catalog: "grouped",
      });
      const ledger = new SyntheticPositiveLedger();

      const result = await h.pool.run(scoped.options, async (connector, opts) => {
        // Real spawn: initialize happens inside connect() during acquisition.
        livePids.push(connector.getProcessPid());
        const acpSessionId = await connector.createSession([], opts.sessionCwd);

        // Model selection through the shipped stable-first path against the
        // grouped catalog (synthetic shape; the canonical advertised value is
        // what must reach the wire).
        await connector.setSessionModel(acpSessionId, "MOCK-MODEL-CANONICAL");
        ledger.register(
          "31-model-set",
          "composition-boundary: model set is a scripted mock response; no native catalog claim",
          "grouped catalog, case-insensitive canonical selection",
        );

        // Reasoning effort reapplication shape (row 6): requested `none`
        // resolves to the advertised `off`.
        const effort = await connector.setReasoningEffort(acpSessionId, "none");
        assertEquals(effort, "applied");

        const response = await connector.prompt(acpSessionId, "hello lifecycle");
        assertEquals(response.stopReason, "end_turn");

        await connector.cancel(acpSessionId);

        // Load on the same live connection (the mock replays a catalog).
        assert(connector.supportsLoadSession());
        // The recovered session's OWN gate context (row 11): OMP recovery
        // restores it for the recovered id after the load.
        const gateContext = {
          cwd: opts.sessionCwd,
          shellSessionId: h.shellSessionId,
          yolo: false,
          canWriteAgentWorkspace: false,
          allowedWriteExtensions: [".md"],
        };
        connector.setSessionGateContext(acpSessionId, gateContext);
        const resumed = await connector.reconnectAndResumeSession(
          acpSessionId,
          opts.sessionCwd,
          [],
          { gateContext },
        );
        assertEquals(resumed, true);
        // Lease must be held for the WHOLE runner body: the pool's single
        // in-flight slot is occupied by this session.
        assertEquals(h.pool.isIdle(), false, "lease held while the runner executes");
        return acpSessionId;
      });

      assertEquals(result.cancelledByDeadline, false);
      assert(result.acpSessionId !== null);
      assertEquals(h.spawned.length, 1, "one connector for one mode-keyed entry");
      // Post-run isIdle() is asserted via teardown's bounded release wait:
      // run() resolves before the release path clears inFlight (documented).

      // Recorded RPC sequence over the first connection generation.
      const lines = await readRpcLines(rpcFile);
      const gen = lines[0]?.gen;
      assert(gen !== undefined, "RPC recording carries a generation marker");
      const gen1 = lines.filter((l) => l.gen === gen).map((l) => l.method);
      assertEquals(gen1, [
        "initialize",
        "session/new",
        "session/set_config_option", // stable-first model set
        "session/set_config_option", // reasoning off
        "session/prompt",
        "session/cancel",
      ]);
      // The model set carried the CANONICAL advertised value, not the raw
      // mixed-case request.
      const modelSet = lines.filter((l) => l.method === "session/set_config_option")[0];
      assertEquals(modelSet?.params?.["value"] as string | undefined, "mock-model-canonical");
      const effortSet = lines.filter((l) => l.method === "session/set_config_option")[1];
      assertEquals(effortSet?.params?.["configId"], "thought_level");
      assertEquals(effortSet?.params?.["value"], "off");

      // Reconnect generation: the recovery slice loads, then reapplies state.
      const gens = [...new Set(lines.map((l) => l.gen))];
      assertEquals(gens.length, 2, "crash-free reconnect still opens a new connection gen");
      const gen2 = lines.filter((l) => l.gen === gens[1]).map((l) => l.method);
      assertEquals(gen2.slice(0, 3), ["initialize", "session/load", "session/set_config_option"]);
      // No mode promotion anywhere: the connector never issues session/set_mode.
      assertEquals(lines.filter((l) => l.method === "session/set_mode").length, 0);

      // Config cache canonical on the live connector (private map read
      // directly: the only consumer-visible surface is selection behavior).
      const cache = h.spawned[0]["sessionConfigOptions"].get(result.acpSessionId!);
      assert(cache !== undefined && cache.length > 0, "config-options cache populated");
      // Local honesty check: this file's process must never see an
      // unlabeled allow fixture (the 5.2 guard only scans its own
      // Deno process; each suite checks its own registrations here).
      for (const entry of SyntheticPositiveLedger.allEntries()) {
        assert(
          entry.label.startsWith("composition-boundary:"),
          `unlabeled synthetic positive in-process: ${entry.id}`,
        );
      }
    } finally {
      await teardownHarness(h, livePids);
    }
  },
});

// ---------------------------------------------------------------------------
// 3.2 Crash → reconnect → same-mode load, one recovery flow
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "OMP lifecycle 3.2: recovery resumes on same mode-composed pool entry — load catalog + model + reasoning reapplied, recovered session's own gate context restored for real, sibling context untouched",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const poolKey = "discord:lifecycle-32";
    const h = await createHarness(poolKey);
    const stateDir = join(h.tempDir, "state-32");
    const rpcFile = join(stateDir, "rpc.jsonl");
    const livePids: (number | undefined)[] = [];
    try {
      const scoped = scopedOptions({
        poolKey,
        mode: "restricted",
        harness: h,
        stateDir,
        recordRpcFile: rpcFile,
        catalog: "grouped",
        crashOnPrompt: "mock-crash-now",
        sidebro: true,
      });
      const ledger = new SyntheticPositiveLedger();

      const entryIdentity: { connector?: AgentConnector; pid?: number; respawnPid?: number } = {};

      const result = await h.pool.run(scoped.options, async (connector, opts) => {
        // B3: recovery re-entry is driven from INSIDE this runner, so entry
        // identity is assertable against the very connector the pool served.
        entryIdentity.connector = connector;
        const acpSessionId = await connector.createSession([], opts.sessionCwd);
        await connector.setSessionModel(acpSessionId, "mock-model-canonical");
        // The recovered session's OWN gate context (row 11): cwd-scoped,
        // restricted (yolo false, no agent-workspace write authorization):
        // the only client-policy ALLOW leg is the session's own staging
        // root, which the shipped row-4 authorization opens for this
        // context alone.
        const gateContext = {
          cwd: opts.sessionCwd,
          shellSessionId: h.shellSessionId,
          yolo: false,
          canWriteAgentWorkspace: false,
          allowedWriteExtensions: [".md"],
        };
        connector.setSessionGateContext(acpSessionId, gateContext);
        // A SIBLING session's cached context, registered on the same
        // shared-process connector; recovery must never substitute it.
        const siblingAcpId = "sibling-acp-untouched";
        const siblingContext = {
          cwd: join(h.tempDir, "sibling-cwd"),
          shellSessionId: "sibling-shell",
          yolo: false,
          canWriteAgentWorkspace: false,
          allowedWriteExtensions: [".txt"],
        };
        connector.setSessionGateContext(siblingAcpId, siblingContext);

        entryIdentity.pid = connector.getProcessPid();
        await assertRejects(
          () => connector.prompt(acpSessionId, "task: mock-crash-now please"),
          Error,
          "exited",
        );

        // B2: witness the side-process death HERE — before the release-path
        // drain could reap it independently of the crash. The mock wrote the
        // side-process pid file before its synchronous SIGKILLs.
        const sidePid = parseInt(await Deno.readTextFile(join(stateDir, "mock-sidebro.pid")), 10);
        await expectProcessGone(sidePid, "mock side process (crash witness)");
        assertEquals(
          processAlive(entryIdentity.pid!),
          false,
          "crashed mock (dumb-init child) is dead at prompt-rejection time",
        );

        const resumed = await connector.reconnectAndResumeSession(
          acpSessionId,
          opts.sessionCwd,
          [],
          {
            gateContext,
            reasoningEffort: "none",
            onGateContextRestored: (id) => {
              assertEquals(id, acpSessionId, "post-restore hook fires for the recovered id");
            },
          },
        );
        assertEquals(resumed, true, "same-mode recovery loads the session");
        entryIdentity.respawnPid = connector.getProcessPid();
        assert(
          entryIdentity.respawnPid !== undefined && entryIdentity.respawnPid !== entryIdentity.pid,
          "recovery respawned a new process",
        );
        assertEquals(
          h.spawned.length,
          1,
          "recovery reconnects the SAME pool-entry connector (no second entry)",
        );
        assertEquals(h.spawned[0], connector, "same mode-composed entry served the runner");

        // The recovered session's OWN gate context is live on the fresh
        // client, and the filesystem decision is evaluated FOR REAL against
        // it (row 4 surfaces through the shipped writeTextFile boundary):
        const client = connector.getClient();
        assert(client !== null);
        // Synthetic positive: the restricted write ALLOW (in-cwd, .md) is a
        // staging-root client-policy composition result, not native evidence.
        ledger.register(
          "32-gate-allow-md",
          "composition-boundary: allowed write inside the recovered session's staging root is a synthetic positive; no native enforcement claim",
          "recovered gate context, staging root {cwd}/tmp/{shellSessionId}",
        );
        const stagingRoot = join(opts.sessionCwd, "tmp", h.shellSessionId);
        await Deno.mkdir(stagingRoot, { recursive: true });
        await client.writeTextFile({
          sessionId: acpSessionId,
          path: join(stagingRoot, "recovered.md"),
          content: "recovered",
        });
        assertEquals(
          await Deno.readTextFile(join(stagingRoot, "recovered.md")),
          "recovered",
          "re-issued filesystem decision executes against the restored context",
        );
        // Deny leg of the SAME restored context: a direct user-workspace
        // write outside staging fails closed with zero side effect.
        await assertRejects(
          () =>
            client.writeTextFile({
              sessionId: acpSessionId,
              path: join(opts.sessionCwd, "outside.md"),
              content: "no",
            }),
          Error,
        );
        await assertRejects(() => Deno.stat(join(opts.sessionCwd, "outside.md")));

        // Sibling context replayed UNCHANGED (never substituted, never dropped).
        assertEquals(
          client["sessionContexts"].get(siblingAcpId)?.cwd,
          join(h.tempDir, "sibling-cwd"),
          "sibling gate context survives recovery unchanged",
        );

        // Re-issued prompt executes on the respawned process.
        const response = await connector.prompt(acpSessionId, "re-issued after recovery");
        assertEquals(response.stopReason, "end_turn");
        return acpSessionId;
      });

      assertEquals(result.cancelledByDeadline, false);
      assert(result.acpSessionId !== null, "session resumed via session/load on the same entry");

      // Slice the RPC recording by connection generation.
      const lines = await readRpcLines(rpcFile);
      const gens = [...new Set(lines.map((l) => l.gen))];
      assertEquals(gens.length, 2, "one crashed generation, one recovery generation");
      const gen2 = lines.filter((l) => l.gen === gens[1]).map((l) => l.method);
      assertEquals(
        gen2,
        [
          "initialize",
          "session/load",
          "session/set_config_option", // model reapply (stable-first, canonical)
          "session/set_config_option", // reasoning none -> off
          "session/prompt", // re-issued prompt
        ],
      );
      const modelReapply = lines.filter((l) =>
        l.gen === gens[1] &&
        l.method === "session/set_config_option"
      )[0];
      assertEquals(modelReapply?.params?.["value"], "mock-model-canonical");
      // LSP posture survives the respawn: the SAME connector respawns from
      // its factory-built configuration — the `--no-lsp` carrier, exactly
      // once, is the identical shipped posture before and after the respawn.
      assertEquals(scoped.factoryArgs.filter((a) => a === "--no-lsp").length, 1);
      for (const entry of SyntheticPositiveLedger.allEntries()) {
        assert(
          entry.label.startsWith("composition-boundary:"),
          `unlabeled synthetic positive in-process: ${entry.id}`,
        );
      }
    } finally {
      await teardownHarness(h, livePids);
    }
  },
});

// ---------------------------------------------------------------------------
// 3.3 Mode-separated recovery through each entry's own connector options
// ---------------------------------------------------------------------------

/**
 * Crash and recover one mode's session on its own mode-keyed entry: recovery
 * needs no ownership record, keeps the same leased connector, restores the
 * session's own gate context, and never promotes or reconstructs the mode.
 */
async function modeRecoveryThroughOwnOptions(mode: OmpPermissionMode): Promise<void> {
  const poolKey = `discord:lifecycle-33-${mode}`;
  const h = await createHarness(poolKey);
  const stateDir = join(h.tempDir, "state-33");
  const rpcFile = join(stateDir, "rpc.jsonl");
  const livePids: (number | undefined)[] = [];
  try {
    const scoped = scopedOptions({
      poolKey,
      mode,
      harness: h,
      stateDir,
      recordRpcFile: rpcFile,
      catalog: "grouped",
      crashOnPrompt: "mock-crash-now",
    });

    const result = await h.pool.run(scoped.options, async (connector, opts) => {
      livePids.push(connector.getProcessPid());
      const acpSessionId = await connector.createSession([], opts.sessionCwd);
      const gateContext = {
        cwd: opts.sessionCwd,
        shellSessionId: h.shellSessionId,
        yolo: mode === "native-yolo",
        canWriteAgentWorkspace: false,
        allowedWriteExtensions: [".md"],
      };
      connector.setSessionGateContext(acpSessionId, gateContext);
      await assertRejects(
        () => connector.prompt(acpSessionId, "go mock-crash-now"),
        Error,
        "exited",
      );

      const resumed = await connector.reconnectAndResumeSession(
        acpSessionId,
        opts.sessionCwd,
        [],
        { gateContext },
      );
      assertEquals(resumed, true, `${mode} entry recovers through its own connector options`);
      livePids.push(connector.getProcessPid());
      assertEquals(
        h.spawned.length,
        1,
        "recovery reuses the SAME mode-keyed entry connector",
      );
      // The recovered session keeps working on its own entry.
      const response = await connector.prompt(acpSessionId, "re-issued after recovery");
      assertEquals(response.stopReason, "end_turn");
      return acpSessionId;
    });
    assertEquals(result.cancelledByDeadline, false);

    // The selected mode keeps its own mode-scoped state root, and recovery
    // loaded the session without promoting modes.
    assertEquals(
      scoped.agentConfig.env?.["PI_CODING_AGENT_DIR"]?.endsWith(`/omp-agent/${mode}`),
      true,
    );
    const lines = await readRpcLines(rpcFile);
    assert(lines.some((l) => l.method === "session/load"), "recovery issued session/load");
    assertEquals(
      lines.filter((l) => l.method === "session/set_mode").length,
      0,
      "no mode promotion RPC",
    );
  } finally {
    await teardownHarness(h, livePids);
  }
}

Deno.test({
  name:
    "OMP lifecycle 3.3: each mode's entry crashes and recovers through its own connector options with no ownership prerequisite, no mode promotion and no sibling substitution",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await modeRecoveryThroughOwnOptions("restricted");
    await modeRecoveryThroughOwnOptions("native-yolo");
  },
});

Deno.test({
  name:
    "OMP lifecycle 3.3b: post-load catalog miss fails ONLY the recovering session through the shipped error; sibling flows on the same entry keep running",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const poolKey = "discord:lifecycle-33b";
    const h = await createHarness(poolKey);
    const stateDir = join(h.tempDir, "state-33b");
    const rpcFile = join(stateDir, "rpc.jsonl");
    const livePids: (number | undefined)[] = [];
    try {
      const scoped = scopedOptions({
        poolKey,
        mode: "restricted",
        harness: h,
        stateDir,
        recordRpcFile: rpcFile,
        catalog: "grouped",
        loadCatalog: "miss",
        crashOnPrompt: "mock-crash-now",
      });
      const result = await h.pool.run(scoped.options, async (connector, opts) => {
        const acpSessionId = await connector.createSession([], opts.sessionCwd);
        await connector.setSessionModel(acpSessionId, "mock-model-canonical");
        const gateContext = {
          cwd: opts.sessionCwd,
          shellSessionId: h.shellSessionId,
          yolo: false,
          canWriteAgentWorkspace: false,
          allowedWriteExtensions: [".md"],
        };
        connector.setSessionGateContext(acpSessionId, gateContext);
        await assertRejects(
          () => connector.prompt(acpSessionId, "go mock-crash-now"),
          Error,
          "exited",
        );
        // Row 6's explicit error: the load catalog lacks the prior model, so
        // the shipped stable-first selection throws with the advertised
        // preview; row 11 isolates it to this session.
        await assertRejects(
          () =>
            connector.reconnectAndResumeSession(acpSessionId, opts.sessionCwd, [], {
              gateContext,
            }),
          Error,
          "not offered in advertised catalog",
        );
        // Sibling flow on the SAME respawned connector keeps working: a new
        // session + prompt completes against the mock.
        const siblingAcpId = await connector.createSession([], opts.sessionCwd);
        const response = await connector.prompt(siblingAcpId, "sibling keeps running");
        assertEquals(response.stopReason, "end_turn");
        return siblingAcpId;
      });
      assertEquals(result.cancelledByDeadline, false);
      assert(result.acpSessionId !== null);
      const lines = await readRpcLines(rpcFile);
      // The failed recovery issued session/load but NEVER a model set on the
      // recovery generation (the throw precedes it) — no fallback attempt.
      const gens = [...new Set(lines.map((l) => l.gen))];
      const recoveryGen = lines.filter((l) => l.gen === gens[1]).map((l) => l.method);
      assertEquals(recoveryGen[1], "session/load");
      assertEquals(
        recoveryGen.slice(2).some((m) => m === "session/set_config_option"),
        false,
        "catalog miss threw before any set_config_option fallback",
      );
      assert(recoveryGen.includes("session/new"), "sibling newSession ran on the same entry");
    } finally {
      await teardownHarness(h, livePids);
    }
  },
});

// ---------------------------------------------------------------------------
// 4.1 Absent-handler composition: client policy denies, posture pinned
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "OMP lifecycle 4.1: absent-handler restricted session denies an unauthorized ACP-mediated write at the real client policy with zero side effect; pinned non-YOLO approval posture unchanged, no handshake/fallback/mode promotion",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const poolKey = "discord:lifecycle-41";
    const h = await createHarness(poolKey);
    const stateDir = join(h.tempDir, "state-41");
    const rpcFile = join(stateDir, "rpc.jsonl");
    const livePids: (number | undefined)[] = [];
    try {
      const scoped = scopedOptions({
        poolKey,
        mode: "restricted",
        harness: h,
        stateDir,
        recordRpcFile: rpcFile,
        catalog: "grouped",
      });
      // No handler is installed anywhere in this composition (the mock agent
      // loads no extension): the accepted-residual posture. The ledger marks
      // it an absence fact, never a native default-deny equivalence claim.
      const ledger = new SyntheticPositiveLedger();
      ledger.register(
        "41-handler-absent",
        "composition-boundary: handler absent (accepted residual); client-policy denial here is NOT equivalent to native-callback default-deny",
        `mode=restricted`,
      );

      const result = await h.pool.run(scoped.options, async (connector, opts) => {
        livePids.push(connector.getProcessPid());
        const acpSessionId = await connector.createSession([], opts.sessionCwd);
        const client = connector.getClient();
        assert(client !== null);

        // Unauthorized ACP-mediated operation through the REAL client policy:
        // a write whose extension is outside the session's allowed list.
        await assertRejects(
          () =>
            client.writeTextFile({
              sessionId: acpSessionId,
              path: join(opts.sessionCwd, "unauthorized.json"),
              content: '{ "nope": true }',
            }),
          Error,
        );
        await assertRejects(
          () => Deno.stat(join(opts.sessionCwd, "unauthorized.json")),
          Deno.errors.NotFound,
        );
        // Bounded denial recorded for retry feedback, no operation side effect.
        const rejections = client.getRecentPermissionRejections();
        assertEquals(rejections.length, 1, "exactly one bounded denial recorded");

        // Pinned non-YOLO native approval launch posture (factory output,
        // consumed verbatim): restricted overlay carried, trusted extension
        // attached, system prompt owned — the launch args the native approval
        // configuration rides on. This asserts OUR launch configuration only,
        // never native honoring of it.
        const args = scoped.factoryArgs;
        assert(args.includes("acp"));
        assert(args.includes("--no-extensions"));
        assert(args.includes("--no-lsp"));
        assertStringIncludes(args.join(" "), "restricted.yml");
        assert(args.includes("--trusted-extension"));
        assert(
          scoped.agentConfig.env?.["PI_CODING_AGENT_DIR"]?.endsWith("/omp-agent/restricted") ===
            true,
        );

        // No readiness handshake exists to reject: the ACP surface used is
        // exactly initialize/new/prompt-class RPCs; the connector exposes no
        // readiness channel (row-13 cancelled) and no fallback spawn or mode
        // promotion happened.
        assertEquals(h.spawned.length, 1, "no fallback spawn");
        const lines = await readRpcLines(rpcFile);
        assertEquals(
          lines.filter((l) => l.method === "session/set_mode").length,
          0,
          "no mode promotion RPC",
        );
        const response = await connector.prompt(acpSessionId, "restricted flow continues");
        assertEquals(response.stopReason, "end_turn");
        return acpSessionId;
      });
      assertEquals(result.cancelledByDeadline, false);
      assert(ledger.entries().some((e) => e.id === "41-handler-absent"));
    } finally {
      await teardownHarness(h, livePids);
    }
  },
});

// ---------------------------------------------------------------------------
// 4.3 Dual-mode coexistence on the global lease + LSP posture across respawn
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "OMP lifecycle 4.3: restricted and native-YOLO sessions coexist under mode-keyed entries and serialize on the single execution lease; both modes' --no-lsp carrier survives crash-respawn and same-mode load, YOLO without restricted policy",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const poolKey = "discord:lifecycle-43";
    const h = await createHarness(poolKey);
    const stateDir = join(h.tempDir, "state-43");
    const livePids: (number | undefined)[] = [];
    try {
      const restrictedScoped = scopedOptions({
        poolKey,
        mode: "restricted",
        harness: h,
        stateDir: join(stateDir, "restricted"),
        recordRpcFile: join(stateDir, "restricted", "rpc.jsonl"),
        catalog: "grouped",
      });
      const yoloScoped = scopedOptions({
        poolKey,
        mode: "native-yolo",
        harness: h,
        stateDir: join(stateDir, "native-yolo"),
        recordRpcFile: join(stateDir, "native-yolo", "rpc.jsonl"),
        catalog: "grouped",
        crashOnPrompt: "mock-crash-now",
      });
      const lease: { held: string | null; violations: string[] } = {
        held: null,
        violations: [],
      };
      const mark = (label: string, phase: "enter" | "exit") => {
        if (phase === "enter") {
          if (lease.held !== null) {
            lease.violations.push(`${label} entered while ${lease.held} held`);
          }
          lease.held = label;
        } else {
          assertEquals(lease.held, label);
          lease.held = null;
        }
      };

      const [restrictedRun, yoloRun] = await Promise.all([
        h.pool.run(restrictedScoped.options, async (connector, opts) => {
          mark("restricted", "enter");
          try {
            const id = await connector.createSession([], opts.sessionCwd);
            const r = await connector.prompt(id, "restricted pass");
            assertEquals(r.stopReason, "end_turn");
            return id;
          } finally {
            mark("restricted", "exit");
          }
        }),
        h.pool.run(yoloScoped.options, async (connector, opts) => {
          mark("native-yolo", "enter");
          try {
            const id = await connector.createSession([], opts.sessionCwd);
            // Crash + same-mode recovery INSIDE the lease to also observe the
            // LSP posture across the respawn while both entries are live.
            const gateContext = {
              cwd: opts.sessionCwd,
              shellSessionId: h.shellSessionId,
              yolo: true,
              canWriteAgentWorkspace: true,
              allowedWriteExtensions: [".md"],
            };
            connector.setSessionGateContext(id, gateContext);
            await assertRejects(
              () => connector.prompt(id, "go mock-crash-now"),
              Error,
              "exited",
            );
            const resumed = await connector.reconnectAndResumeSession(
              id,
              opts.sessionCwd,
              [],
              { gateContext },
            );
            assertEquals(resumed, true);
            livePids.push(connector.getProcessPid());
            return id;
          } finally {
            mark("native-yolo", "exit");
          }
        }),
      ]);
      assertEquals(restrictedRun.cancelledByDeadline, false);
      assertEquals(yoloRun.cancelledByDeadline, false);
      assertEquals(lease.violations, [], "global lease serialized across BOTH mode entries");

      // Separate mode-keyed entries, separate processes.
      assertEquals(h.spawned.length, 2, "one connector per mode-keyed entry");
      const pids = h.spawned.map((c) => c.getProcessPid()).filter((p): p is number =>
        p !== undefined
      );
      assertEquals(new Set(pids).size, 2, "restricted and YOLO run as distinct processes");

      // LSP disable carrier in BOTH modes after respawn/load; YOLO carries it
      // WITHOUT the restricted policy file (no contamination).
      for (const scopedPair of [restrictedScoped, yoloScoped]) {
        assertEquals(scopedPair.factoryArgs.filter((a) => a === "--no-lsp").length, 1);
      }
      const yoloJoined = yoloScoped.factoryArgs.join(" ");
      assertStringIncludes(yoloJoined, "native-yolo.yml");
      assert(!yoloJoined.includes("restricted.yml"), "no restricted policy crosses into YOLO");
      // No fixture here certifies implicit native startup suppression — the
      // carrier is the claim's full extent (docs/OMP_COMPATIBILITY §1a).
    } finally {
      await teardownHarness(h, livePids);
    }
  },
});
