/**
 * Shared OMP mock-session composition surface (mock-acp-lifecycle-coverage).
 *
 * The consume-unchanged builder promised to row 22 (finish-omp-mocked-skill-
 * handoff): one entry point assembles
 * the dimensions every OMP lifecycle scenario needs — mode-scoped OMP launch
 * identity ({permissionMode, processNamespace}), OMP-shaped config catalogs,
 * handler-absent posture, registry observations, destructive fixtures — and
 * an explicit SyntheticPositiveLedger.
 *
 * Pinned honesty posture (row-13 cancelled readiness; P0 fixture rule):
 * - There is NO readiness tuple, handshake, channel, or state anywhere on the
 *   builder surface: the builder exposes none, and default compositions are
 *   fail-closed (handler "absent" by default, untrusted registry defaults).
 * - Every allow-path fixture must be registered as a labeled synthetic
 *   positive in the ledger; the ledger makes the composition boundary
 *   explicit and mechanically inspectable.
 * - Nothing here demonstrates native OMP binary behavior: catalogs are
 *   synthetic shapes, subprocess spawns are `deno run` mocks only, and the
 *   real production defaults (factory launch posture, real pool, real
 *   connector) are consumed unchanged wherever the flow touches them.
 *
 * Determinism: no timers are created or depended on by the builder itself;
 * FakeTime is NEVER permitted in tests that construct a real AgentProcessPool
 * or a subprocess connector (their liveness math uses real Date.now).
 */

import { AgentConnector } from "@acp/agent-connector.ts";
import { createAgentConfig } from "@acp/agent-factory.ts";
import { ompAgentDir } from "@utils/omp-paths.ts";
import type { AgentConfig, ClientConfig } from "@acp/types.ts";
import type { Config } from "../../src/types/config.ts";
import {
  createMockAcpConnection,
  type MockAcpConnection,
  type MockAcpConnectionScript,
} from "./mock-acp-connection.ts";

export type OmpPermissionMode = "restricted" | "native-yolo";

/**
 * One labeled synthetic allow-positive. Every client-observable allow that the
 * mock composition produces (e.g. the yolo gate approving the recovered
 * session's re-issued prompt, an operator-MCP re-admission on a fresh epoch)
 * is registered here with the label stating WHY it is a synthetic positive
 * and not native-agent evidence.
 */
export interface SyntheticPositive {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export class SyntheticPositiveLedger {
  static #all: SyntheticPositiveLedger[] = [];
  #entries: SyntheticPositive[] = [];

  constructor() {
    // Suite-level honesty guard (5.2) scans every ledger created anywhere in
    // the process at runtime — no source-text snapshots.
    SyntheticPositiveLedger.#all.push(this);
  }

  /** Every synthetic positive registered across all ledgers so far. */
  static allEntries(): readonly SyntheticPositive[] {
    return SyntheticPositiveLedger.#all.flatMap((ledger) => ledger.entries());
  }

  register(id: string, label: string, detail: string): SyntheticPositive {
    if (this.#entries.some((entry) => entry.id === id)) {
      throw new Error(`duplicate synthetic positive id: ${id}`);
    }
    const entry: SyntheticPositive = { id, label, detail };
    this.#entries.push(entry);
    return entry;
  }

  entries(): readonly SyntheticPositive[] {
    return [...this.#entries];
  }

  ids(): readonly string[] {
    return this.#entries.map((entry) => entry.id);
  }
}

/** The silent connector logger used across the mock suites. */
export const SILENT_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Per-test Config for the OMP factory/pool: repoPath pinned to the test's
 * temp dir so mode roots land under it (keeps deriveActualRecoveryTarget's
 * namespace math honest against the recorded namespace) and the factory's
 * mkdirSync side effects stay inside the temp dir.
 */
export function createOmpTestConfig(params: {
  tempRepoRoot: string;
  poolKey?: string;
}): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "mock" },
      misskey: { enabled: false, host: "http://localhost", token: "mock" },
    },
    agent: {
      defaultAgentType: "omp",
      model: "mock-model-canonical",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      ...(params.poolKey
        ? { sharedProcess: { jwtDir: `${params.tempRepoRoot}/skill-jwt`, reclaimIdleMs: 120_000 } }
        : {}),
    },
    memory: {},
    workspace: { repoPath: params.tempRepoRoot },
    logging: { level: "info" },
    replyPolicy: "channels",
    channels: [],
    // Partial launch-shape fixture: the OMP factory only consumes agent +
    // workspace; loader-gated fields stay at the harness default (same
    // pattern as shared-process.integration.test.ts).
  } as unknown as Config;
}

/**
 * Build the shipped-launch-posture OMP AgentConfig for a mode via the REAL
 * factory (workingDir is the mock subprocess's launch cwd; mode roots derive
 * from repoPath). Call AFTER asserting the pinned launch assets exist.
 */
export function buildOmpFactoryAgentConfig(params: {
  mode: OmpPermissionMode;
  tempRepoRoot: string;
  workingDir: string;
  poolKey?: string;
  sessionId?: string;
}): AgentConfig {
  const config = createOmpTestConfig({
    tempRepoRoot: params.tempRepoRoot,
    poolKey: params.poolKey,
  });
  return createAgentConfig(
    "omp",
    params.workingDir,
    config,
    params.mode === "native-yolo",
    undefined,
    params.sessionId,
    params.poolKey,
  );
}

/**
 * The OMP subprocess swap helper (sibling of the OpenCode useMockAgent, which
 * stays untouched): point the factory-built config at the mock agent over
 * stdio. `--allow-run` is added ONLY for the crash-witness tests (the mock
 * side-process spawn needs it); OpenCode tests keep their own arg list.
 */
export function useMockOmpAgent(
  agentConfig: AgentConfig,
  params: {
    stateDir: string;
    catalog?: "grouped" | "flat" | "miss" | "none";
    loadCatalog?: "grouped" | "flat" | "miss" | "none";
    recordRpcFile?: string;
    crashOnPrompt?: string;
    sidebro?: boolean;
    allowRun?: boolean;
  },
): AgentConfig {
  agentConfig.command = Deno.execPath();
  agentConfig.args = [
    "run",
    "--no-check",
    "--allow-env",
    "--allow-read",
    "--allow-write",
    ...(params.allowRun ? ["--allow-run"] : []),
    new URL("./mock-acp-agent.ts", import.meta.url).pathname,
  ];
  agentConfig.env = {
    ...agentConfig.env,
    MOCK_PROMPT_DELAY_MS: "0",
    MOCK_STATE_FILE: `${params.stateDir}/mock-state.json`,
  };
  if (params.catalog) agentConfig.env["MOCK_OMP_CONFIG_CATALOG"] = params.catalog;
  if (params.loadCatalog) agentConfig.env["MOCK_OMP_LOAD_CONFIG_CATALOG"] = params.loadCatalog;
  if (params.recordRpcFile) {
    agentConfig.env["MOCK_OMP_RECORD_RPC"] = params.recordRpcFile;
    agentConfig.env["MOCK_SIDEBRO"] = params.sidebro ? "1" : "0";
  }
  if (params.crashOnPrompt) agentConfig.env["MOCK_CRASH_ON_PROMPT"] = params.crashOnPrompt;
  return agentConfig;
}

/** Connection-tier input to the session builder. */
export interface OmpMockSessionInput {
  /** Mode-scoped launch identity for the connector's OMP env shape. */
  mode: OmpPermissionMode;
  /** Pool base root the namespace derives from (`{baseRoot}/omp-agent/{mode}`). */
  baseRoot: string;
  /** Script for the injected in-process connection (synthetic responses). */
  script: MockAcpConnectionScript;
  /**
   * Handler posture: "absent" (default) leaves the connector with NO handler
   * composition (the accepted residual); an object records a LABELED
   * synthetic-installed positive — never a native-invocation claim.
   */
  handler?: "absent" | { syntheticInstalled: true };
  /** Client config overrides for the real ChatbotClient under the connector. */
  clientConfig?: Partial<ClientConfig>;
  /** Session cwd for the client config. */
  cwd?: string;
}

export interface OmpMockSession {
  /** Real AgentConnector with the scripted connection + capabilities injected. */
  connector: AgentConnector;
  /** RPC recorder over the injected connection. */
  connection: MockAcpConnection;
  /** The labeled synthetic-positive ledger for this composition. */
  ledger: SyntheticPositiveLedger;
  /** The recorded launch posture for the requested mode (factory-shaped env). */
  agentConfig: AgentConfig;
  /** Ownership record consistent with this session's mode + namespace. */
  ownership: { agentType: "omp"; permissionMode: OmpPermissionMode; processNamespace: string };
  /**
   * Arm a manual crash signal on the connector: returns a fire() that rejects
   * the raced calls deterministically (no timers, no process).
   */
  armCrashSignal(): (message?: string) => void;
  /** Register a labeled synthetic positive (guarded at the builder edge). */
  registerPositive(id: string, label: string, detail: string): SyntheticPositive;
}

/**
 * Compose one connection-tier OMP mock session around a REAL AgentConnector.
 * The connector's connection is replaced with the scripted recorder;
 * capabilities carry loadSession so recovery paths are exercisable. Default
 * posture is fail-closed: no handler, no readiness, empty catalogs unless
 * scripted.
 */
export function buildOmpMockSession(input: OmpMockSessionInput): OmpMockSession {
  const ledger = new SyntheticPositiveLedger();
  const processNamespace = ompAgentDir(input.baseRoot, input.mode);
  const cwd = input.cwd ?? input.baseRoot;

  const agentConfig: AgentConfig = {
    command: "true",
    args: [],
    cwd,
    env: {
      // The mode-scoped identity the ownership derivation consumes.
      PI_CODING_AGENT_DIR: processNamespace,
      TMPDIR: `${processNamespace}/tmp`,
      XDG_DATA_HOME: `${processNamespace}/xdg`,
    },
  };

  const connector = new AgentConnector({
    agentConfig,
    clientConfig: {
      workingDir: cwd,
      platform: "discord",
      userId: "mock-user",
      channelId: "mock-channel",
      isDM: true,
      ...input.clientConfig,
    },
    skillRegistry: null,
    logger: SILENT_LOGGER,
    agentType: "omp",
    idleTimeoutConfig: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
  });

  const connection = createMockAcpConnection(input.script, {
    deliverNotification: (notification) => {
      // Route scripted follow-ups through the real client when one exists.
      const client = connector.getClient();
      if (client) {
        // Scripted in-process notification: shape is composed by this file's
        // own scripts, so the boundary cast is a test-harness certainty.
        const asNotification = notification as unknown as Parameters<
          typeof client.sessionUpdate
        >[0];
        void client.sessionUpdate(asNotification);
      }
    },
  });

  connector["connection"] = connection.connection as unknown as typeof connector["connection"];
  connector["capabilities"] = { loadSession: true } as typeof connector["capabilities"];

  if (input.handler === "absent" || input.handler === undefined) {
    // Default: nothing installed — the accepted-residual posture. Recorded in
    // the ledger as an ABSENCE fact so guards can name the composition.
    ledger.register(
      "handler-absent",
      "composition-boundary: no handler installed (accepted residual; not a native claim)",
      `mode=${input.mode}`,
    );
  } else {
    ledger.register(
      "handler-synthetic-installed",
      "composition-boundary: handler installation is a SYNTHETIC positive; nothing demonstrates the native binary invokes it",
      `mode=${input.mode}`,
    );
  }

  return {
    connector,
    connection,
    ledger,
    agentConfig,
    ownership: { agentType: "omp", permissionMode: input.mode, processNamespace },
    armCrashSignal: () => {
      const { promise, reject } = Promise.withResolvers<never>();
      promise.catch(() => {});
      connector["crashSignal"] = promise;
      // Keep the connection-tier liveness check coherent: isConnected reads
      // connection + process; a stub process keeps the surface honest without
      // a real subprocess.
      const stubProcess = {
        pid: -1,
        status: promise.then(() => ({ success: false, code: null, signal: "SIGKILL" as const })),
      } as unknown as typeof connector["process"];
      connector["process"] = stubProcess;
      return (message?: string) => {
        reject(new Error(message ?? "mock crash signal"));
      };
    },
    registerPositive: (id, label, detail) => ledger.register(id, label, detail),
  };
}

/** True while `pid` answers `kill -0` (ESRCH => dead; EPERM => alive-but-foreign). */
export function processAlive(pid: number): boolean {
  try {
    Deno.kill(pid, 0);
    return true;
  } catch (error) {
    // Deno maps ESRCH to Deno.errors.NotFound and EPERM to PermissionDenied.
    if (error instanceof Deno.errors.NotFound) return false;
    if (error instanceof Deno.errors.PermissionDenied) return true;
    throw error;
  }
}

/**
 * Bounded `kill -0` liveness probe (polls an observable fact; no fixed sleep
 * used to await state) with an explicit failure message naming the
 * kill/ESRCH dependence as part of the subprocess-tier guard.
 */
export async function expectProcessGone(
  pid: number,
  what: string,
  attempts = 120,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!processAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${what} (pid ${pid}) still live after bounded kill -0 observation`);
}
