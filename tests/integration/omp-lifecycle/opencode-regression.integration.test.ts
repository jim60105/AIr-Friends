// tests/integration/omp-lifecycle/opencode-regression.integration.test.ts
//
// OpenSpec change `cover-omp-mocked-acp-lifecycle` rows 5.1 + 5.2 (P9a).
//
// 5.1 — OpenCode regression through the SAME harness as the OMP lifecycle
// suites: one pooled OpenCode process drives initialize/new/prompt/cancel
// plus load-through-recovery and pool reuse, and the captured launch values
// — command strings, spawn environment, pool-key composition — byte-match
// the current shipped OpenCode values. The recorded RPC stream carries only
// OpenCode-shipped methods: zero readiness verification, zero OMP trusted-
// extension traffic. The shipped agent-config/opencode.json retains its
// build+yolo per-agent explicit `lsp` denies (numbered rows 15 and 17 —
// this asserts that CONFIG data, not any binary behavior).
//
// 5.2 — the retained runtime guard: the default builder composition carries
// no readiness surface — no handshake, no readiness tuple/state/channel —
// anywhere on the composed connector.
//
// Determinism (design D4): every subprocess assertion is driven by the
// recorded RPC JSONL or the connector's own crash/recovery signal; the only
// waiting is bounded polling of explicitly observable facts. Guarded on
// dumb-init/deno like the existing integration suite; no network, real
// agent, official `omp` executable, container/bwrap, or provider credential
// is used.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join, resolve } from "@std/path";
import { AgentProcessPool, poolEntryKey } from "@core/agent-process-pool.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { AgentConfig, AgentConnectorOptions } from "@acp/types.ts";
import { SessionRegistry } from "../../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { createLogger } from "@utils/logger.ts";
import { resolveSkillJwtDir } from "@utils/skill-jwt.ts";
import { createAgentConfig } from "@acp/agent-factory.ts";
import {
  deriveActualRecoveryTarget,
  RecoveryOwnershipError,
  type SessionRecoveryOwnership,
} from "@acp/recovery-ownership.ts";
import type { PoolRunOptions } from "@core/agent-process-pool.ts";
import type { Config } from "../../../src/types/config.ts";
import { buildOmpMockSession } from "../../mocks/omp-mock-session.ts";

const logger = createLogger("OpenCodeRegressionIntegration");

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
const TEST_MODEL = "opencode/hy3-free";

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

async function waitForProcessGone(pid: number, attempts = 120): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      Deno.kill(pid, 0);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      if (error instanceof Deno.errors.PermissionDenied) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        continue;
      }
      throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`process ${pid} still alive after ${attempts} polls`);
}

async function removeDirWithRetry(dir: string, attempts = 6): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await Deno.remove(dir, { recursive: true });
      return;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  await Deno.remove(dir, { recursive: true });
}

/**
 * Byte-identical copy of the shipped OpenCode mock-swap helper
 * (tests/integration/shared-process.integration.test.ts `useMockAgent`).
 * The original file stays untouched (row 5.1 runs the SAME shipped arg
 * shape; that suite is the baseline owner); this copy keeps the arg list
 * honest for the harness here. If a later refactor can export the shipped
 * helper without touching that suite's assertions, import it and delete
 * this copy — the duplicate exists only to avoid editing the baseline owner.
 */
function useMockAgentShippedShape(agentConfig: AgentConfig): void {
  const mockAgentScript = join(import.meta.dirname!, "../../mocks/mock-acp-agent.ts");
  agentConfig.command = "deno";
  agentConfig.args = [
    "run",
    "--no-check",
    "--allow-env",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    mockAgentScript,
  ];
}

/** Per-test hermetic harness: temp repo root, registry, real pool. */
interface Harness {
  tempDir: string;
  workspacePath: string;
  config: Config;
  sessionRegistry: SessionRegistry;
  skillRegistry: SkillRegistry;
  pool: AgentProcessPool;
  spawned: AgentConnector[];
}

function buildHarness(tempDir: string): Harness {
  const jwtDir = join(tempDir, "skill-jwt");
  Deno.mkdirSync(jwtDir, { recursive: true });
  const config = {
    platforms: {
      discord: { enabled: false, token: "mock" },
      misskey: { enabled: false, host: "http://localhost", token: "mock" },
    },
    agent: {
      defaultAgentType: "opencode",
      model: TEST_MODEL,
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      sharedProcess: { jwtDir, reclaimIdleMs: 120_000 },
      idleTimeout: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
    },
    memory: {},
    workspace: { repoPath: tempDir, workspacesDir: "workspaces" },
    logging: { level: "info" },
    replyPolicy: "channels",
    channels: [],
    // Partial launch-shape fixture, same pattern as the shipped shared-process
    // suite's buildTestConfig: the factory only consumes agent + workspace.
  } as unknown as Config;
  const sessionRegistry = new SessionRegistry();
  const workspaceManager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
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
  const workspacePath = join(tempDir, "session-cwd");
  Deno.mkdirSync(workspacePath, { recursive: true });
  // The pooled opencode spawn runs in the factory's channel-scoped roots;
  // create them so the subprocess cwd exists (the factory composes the
  // paths but does not mkdir them for opencode).
  Deno.mkdirSync(join(tempDir, "channel-cwd", "discord:discord/opencode-51"), { recursive: true });
  Deno.mkdirSync(join(tempDir, "channel-tmp", "discord:discord/opencode-51"), { recursive: true });
  Deno.mkdirSync(join(tempDir, "opencode-data", "discord:discord/opencode-51"), {
    recursive: true,
  });
  return {
    tempDir,
    workspacePath,
    config,
    sessionRegistry,
    skillRegistry,
    pool,
    spawned,
  };
}

Deno.test({
  name:
    "OpenCode lifecycle 5.1: pooled mock flow keeps shipped launch values byte-identical, reuses the pool entry, records OpenCode-only RPCs, and rejects cross-namespace recovery before teardown",
  ignore: !CAN_RUN_SUBPROCESS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "omp-lifecycle-oc-" });
    const h = buildHarness(tempDir);
    const stateDir = join(tempDir, "state-51");
    Deno.mkdirSync(stateDir, { recursive: true });
    const rpcFile = join(stateDir, "rpc.jsonl");
    const poolKey = "discord:discord/opencode-51";
    const otherPoolKey = "discord:discord/opencode-51-peer";
    const agentWorkspacePath = join(tempDir, "agent-workspace");
    const livePids: number[] = [];
    try {
      // ---- shipped OpenCode launch values, byte-compared -----------------
      const shipped = createAgentConfig(
        "opencode",
        h.workspacePath,
        h.config,
        false,
        agentWorkspacePath,
        "shell-opencode-51",
        poolKey,
      );
      assertEquals(shipped.command, "opencode");
      assertEquals(shipped.args, ["acp"]);
      // AgentConfig.env is optional on the type; the shipped factory always
      // populates it — pin the populated object once for byte comparisons.
      const shippedEnv = shipped.env ?? {};
      // Pool-key composition: pool-scoped data roots under the bot data root.
      assertEquals(shipped.cwd, resolve(join(tempDir, "channel-cwd", poolKey)));
      assertEquals(shippedEnv["TMPDIR"], resolve(join(tempDir, "channel-tmp", poolKey)));
      assertEquals(
        shippedEnv["XDG_DATA_HOME"],
        resolve(join(tempDir, "opencode-data", poolKey)),
      );
      assertEquals(shippedEnv["SKILL_SHARED_PROCESS"], "1");
      assertEquals(shippedEnv["AGENT_WORKSPACE"], agentWorkspacePath);
      assertEquals(
        shippedEnv["SKILL_JWT_DIR"],
        resolveSkillJwtDir(`${tempDir}/skill-jwt`),
      );
      // Pool mode omits the frozen per-spawn SESSION_ID marker entirely.
      assertEquals(shippedEnv["SESSION_ID"], undefined);
      // No provider credential is present or injected (no paid credentials,
      // ever): the factory only forwards keys configured or set in env.
      for (const key of ["OPENCODE_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]) {
        if (shippedEnv[key] !== undefined) {
          assertEquals(shippedEnv[key], Deno.env.get(key), `${key} must pass through verbatim`);
        }
      }
      // The same call twice is stable (pool keys/env are pure functions of
      // configuration, not of call order).
      const shippedAgain = createAgentConfig(
        "opencode",
        h.workspacePath,
        h.config,
        false,
        agentWorkspacePath,
        "shell-opencode-51",
        poolKey,
      );
      assertEquals(shippedAgain.args, shipped.args);
      assertEquals(shippedAgain.command, shipped.command);
      assertEquals(shippedAgain.cwd, shipped.cwd);
      assertEquals(shippedAgain.env, shipped.env);

      // ---- run configuration: same shipped values plus harness knobs -----
      const runConfig = createAgentConfig(
        "opencode",
        h.workspacePath,
        h.config,
        false,
        agentWorkspacePath,
        "shell-opencode-51",
        poolKey,
      );
      runConfig.env = {
        ...runConfig.env,
        // Hermeticity knobs only — the launch identity itself is untouched.
        MOCK_PROMPT_DELAY_MS: "0",
        MOCK_STATE_FILE: `${stateDir}/mock-state.json`,
        MOCK_OMP_RECORD_RPC: rpcFile,
      };
      // The env the subprocess actually spawns with byte-matches the shipped
      // env once the hermeticity knobs are removed (spawn-environment
      // capture, spec 5.1).
      const {
        MOCK_PROMPT_DELAY_MS: _d,
        MOCK_STATE_FILE: _s,
        MOCK_OMP_RECORD_RPC: _r,
        ...spawnEnv
      } = runConfig.env;
      void _d;
      void _s;
      void _r;
      assertEquals(spawnEnv, shipped.env);
      const runFactoryArgsBeforeSwap = [...runConfig.args];
      useMockAgentShippedShape(runConfig);
      // The swap is the shipped arg list applied verbatim.
      assertEquals(runFactoryArgsBeforeSwap, ["acp"]);

      const clientConfig = {
        workingDir: h.workspacePath,
        platform: "discord" as const,
        userId: "u-opencode-51",
        channelId: "discord/opencode-51",
        isDM: false,
        yolo: false,
        sessionId: "shell-opencode-51",
        xdgDataHome: runConfig.env["XDG_DATA_HOME"],
      };

      const runOptions = (key: string): PoolRunOptions => ({
        poolKey: key,
        agentType: "opencode",
        permissionMode: "restricted",
        sessionType: "message",
        // shellSessionId null: these scenarios exercise lifecycle/pool
        // wiring, not the Skill-API JWT/pointer machinery.
        shellSessionId: null,
        priority: "interactive",
        connectorOptions: {
          agentConfig: runConfig,
          clientConfig,
          skillRegistry: h.skillRegistry,
          logger,
          agentType: "opencode",
          idleTimeoutConfig: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
        },
        sessionCwd: h.workspacePath,
      });

      // ---- run 1: initialize/new/set_model/prompt/cancel -----------------
      let pid1: number | undefined;
      const first = await h.pool.run(runOptions(poolKey), async (connector, opts) => {
        pid1 = connector.getProcessPid();
        assert(pid1 !== undefined);
        livePids.push(pid1);
        const acpSessionId = await connector.createSession([], opts.sessionCwd);
        await connector.setSessionModel(acpSessionId, TEST_MODEL);
        const response = await connector.prompt(acpSessionId, "opencode regression");
        assertEquals(response.stopReason, "end_turn");
        await connector.cancel(acpSessionId);
        return acpSessionId;
      });
      assertEquals(first.cancelledByDeadline, false);
      assert(first.acpSessionId !== null);

      // ---- run 2: same pool key REUSES the entry; recovery + rejection ---
      // The acquisition record row 10 writes is the connector's own derived
      // target (same formula, not a re-resolution from config).
      const opencodeTarget = deriveActualRecoveryTarget("opencode", runConfig.env);
      assertEquals(opencodeTarget.permissionMode, "yolo-switch");
      const opencodeOwnership: SessionRecoveryOwnership = {
        agentType: "opencode",
        permissionMode: "yolo-switch",
        processNamespace: opencodeTarget.processNamespace,
      };
      let pid2: number | undefined;
      const second = await h.pool.run(runOptions(poolKey), async (connector, opts) => {
        pid2 = connector.getProcessPid();
        assertEquals(pid2, pid1, "same pool key reuses the same live process");
        assertEquals(h.spawned.length, 1, "same pool key reuses the same entry connector");

        // Cross-namespace recovery (spec's no-OMP-involvement leg): an OMP
        // ownership record cannot prove same-mode recovery on an OpenCode
        // connector: the shipped derivation reads the target through the
        // record's own agent type, finds no OMP namespace in the OpenCode
        // spawn env, and fails CLOSED as unverified — before any teardown.
        const foreign: SessionRecoveryOwnership = {
          agentType: "omp",
          permissionMode: "restricted",
          // The OMP namespace shape `deriveActualRecoveryTarget` reads from the
          // spawn env: `{baseRoot}/omp-agent/{mode}/xdg-data`.
          processNamespace: join(
            tempDir,
            "omp-pools",
            poolKey,
            "omp-agent",
            "restricted",
            "xdg-data",
          ),
        };
        const before = await readRpcLines(rpcFile);
        const rejection = await assertRejects(
          () =>
            connector.reconnectAndResumeSession(first.acpSessionId!, opts.sessionCwd, [], {
              ownership: foreign,
            }),
          RecoveryOwnershipError,
          "ownership check failed",
        );
        assertEquals(rejection.reason, "ownership_unverified");
        const after = await readRpcLines(rpcFile);
        assertEquals(
          after.length,
          before.length,
          "rejection issued zero RPCs: no teardown, no respawn, no load",
        );
        assertEquals(connector.getProcessPid(), pid1, "live process untouched");
        assertEquals(connector.isConnected, true, "live connection untouched");
        assertEquals(h.pool.isIdle(), false, "lease still held by this session");

        // Same-namespace recovery through the harness: load re-enters the
        // SAME entry on a fresh process (reconnect respawn).
        const resumeSessionId = await connector.createSession([], opts.sessionCwd);
        const resumed = await connector.reconnectAndResumeSession(
          resumeSessionId,
          opts.sessionCwd,
          [],
          { ownership: opencodeOwnership },
        );
        assertEquals(resumed, true, "session/load succeeds under the OpenCode identity");
        const respawnPid = connector.getProcessPid();
        assert(respawnPid !== undefined && respawnPid !== pid1, "recovery respawned the process");
        livePids.push(respawnPid);
        assertEquals(
          h.spawned.length,
          1,
          "recovery reconnected the SAME entry connector (no second entry)",
        );
        // The recovered process is still the pool entry's live process and
        // the session keeps working on it.
        const alive = await connector.prompt(resumeSessionId, "post-recovery");
        assertEquals(alive.stopReason, "end_turn");
        return resumeSessionId;
      });
      assertEquals(second.cancelledByDeadline, false);
      assert(second.acpSessionId !== null);

      // ---- run 3: a different pool key composes its OWN entry ------------
      let pid3: number | undefined;
      const third = await h.pool.run(runOptions(otherPoolKey), async (connector, opts) => {
        pid3 = connector.getProcessPid();
        const sid = await connector.createSession([], opts.sessionCwd);
        const response = await connector.prompt(sid, "peer pool key");
        assertEquals(response.stopReason, "end_turn");
        return sid;
      });
      assertEquals(third.cancelledByDeadline, false);
      assert(pid3 !== undefined && pid1 !== undefined && pid3 !== pid1);
      assertEquals(h.spawned.length, 2, "two pool keys compose two entries");

      // Pool-key composition observable: the exported key function places
      // both runs on distinct entries of the shipped agent type.
      assert(
        poolEntryKey(poolKey, "opencode", "restricted") !==
          poolEntryKey(otherPoolKey, "opencode", "restricted"),
      );

      // ---- recorded RPCs: OpenCode-shipped methods only ------------------
      const lines = await readRpcLines(rpcFile);
      assert(lines.length > 0, "RPC recording populated");
      for (const line of lines) {
        // Shipped OpenCode surface: initialize + session/* lifecycle (model
        // selection with no advertised catalog goes through the shipped
        // unstable fallback method name). No OMP config-option catalog set,
        // no mode switch, no readiness/extension handshake.
        assert(
          line.method === "initialize" || line.method.startsWith("session/"),
          `unexpected RPC family: ${line.method}`,
        );
        // Exact names first: `session/set_model` (the shipped unstable
        // fallback wire name) is a SUPERSTRING of `session/set_mode`, so a
        // substring ban would false-positive on it.
        assert(
          line.method !== "session/set_config_option",
          "OMP config-option sets must not appear",
        );
        assert(line.method !== "session/set_mode", "mode switches must not appear");
        for (const banned of ["readiness", "ready", "extension"]) {
          assert(!line.method.includes(banned), `non-OpenCode method appeared: ${line.method}`);
        }
      }
      const gens = [...new Set(lines.map((line) => line.gen))];
      assertEquals(gens.length, 3, "two spawns (original + recovery respawn) plus the peer spawn");
      const firstGen = lines.filter((line) => line.gen === gens[0]).map((line) => line.method);
      // The mock accepts unknown methods with {}; the SDK maps
      // unstable_setSessionModel to its own method name, so only the first
      // three and the tail are pinned per generation.
      assertEquals(firstGen.slice(0, 3), ["initialize", "session/new", "session/set_model"]);
      assert(firstGen.includes("session/prompt"));
      assert(firstGen.includes("session/cancel"));
      const recoveryGen = lines.filter((line) => line.gen === gens[1]).map((line) => line.method);
      assertEquals(recoveryGen.slice(0, 2), ["initialize", "session/load"]);

      // ---- shipped opencode.json baseline (config data, not behavior) ----
      const opencodeJson = JSON.parse(
        await Deno.readTextFile(new URL("../../../agent-config/opencode.json", import.meta.url)),
      ) as {
        default_agent: string;
        agent: Record<string, { permission: Record<string, string> }>;
      };
      // Numbered rows 15 and 17 shipped these denies; the config retains them.
      assertEquals(opencodeJson.agent["build"]?.permission?.["lsp"], "deny");
      assertEquals(opencodeJson.agent["yolo"]?.permission?.["lsp"], "deny");
      assertEquals(opencodeJson.agent["yolo"]?.permission?.["*"], "allow");
      assertEquals(opencodeJson.default_agent, "build");
    } finally {
      // run() resolves before the release path clears inFlight (documented
      // pool behavior): await the observable release condition.
      const releaseDeadline = Date.now() + 30_000;
      while (!h.pool.isIdle() && Date.now() < releaseDeadline) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
      // The release drain's own budgets are far below 30s: a pool that
      // never drains is a real hang and must surface HERE, not as a leaked
      // temp dir or a later unexplained flake.
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
        await waitForProcessGone(pid);
      }
      await removeDirWithRetry(tempDir);
    }
  },
});

// ---------------------------------------------------------------------------
// 5.2 — retained runtime suite guard (spec: Fail-Closed Honest Posture)
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "runtime guard 5.2: the default builder composition carries no readiness surface anywhere on the connector",
  fn() {
    // The default composition is fail-closed: a builder composition scripted
    // only with `initialize` introduces no readiness handshake — no readiness
    // tuple, state or channel anywhere on the composed connector.
    const harness = buildOmpMockSession({
      mode: "restricted",
      baseRoot: "/composed-harness-only",
      script: { initialize: { response: { protocolVersion: 1 } } },
    });
    for (
      const surface of ["ready", "readiness", "enforcementReady", "handlerReady"] as const
    ) {
      assertEquals(
        (harness.connector as unknown as Record<string, unknown>)[surface],
        undefined,
        `readiness surface leaked onto the connector: ${surface}`,
      );
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
