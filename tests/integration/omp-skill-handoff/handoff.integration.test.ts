// tests/integration/omp-skill-handoff/handoff.integration.test.ts
//
// The COMBINED consumer skill-handoff regression suite. It drives the REAL
// SessionOrchestrator delivery path, the REAL Skill API server + SessionRegistry
// + SkillRegistry + reply/file/reaction handlers, and the REAL skill scripts
// under the deployment-resolved root — in BOTH spawn shapes (per-spawn frozen
// identity vs pooled SKILL_SHARED_PROCESS + active.json pointer, NO SESSION_ID),
// with a call-ledger mock platform adapter and the shared mock ACP agent
// subprocess (mock-acp-agent consumed additively; omp-mock-session's
// `useMockOmpAgent` consumed unchanged). No real platform service, no real OMP
// binary, no provider, no container/bwrap, no image.
//
// Agent->client ACP requests here are REAL wire requests answered by the REAL
// ChatbotClient policy: the deployment-resolved skill-instruction read
// (`fs/read_text_file` of a SKILL.md under the same root observation the
// factory builds into `AgentConfig.skillsRoot` and the OMP connector feeds its
// session callbacks as the trusted skills root), the quoted absolute
// skill-script invocation (`session/request_permission` auto-approved for the
// enumerated entrypoint), and the bounded client-policy denials.
//
// Honesty boundary (spec: "Claims never attribute actions to the native
// binary"): every payload/file below is staged by the MOCK FIXTURE with its
// own fs access — a stand-in for the agent's write, whose authorization
// decision under test is the CLIENT-SIDE gate (payload containment + JWT +
// handler/workspace scoping), never simulated native enforcement. The mock
// never claims the native binary staged, invoked, delivered, or enforced
// anything, and nothing observed here is native binary, image or platform
// acceptance evidence.
//
// Non-duplication baseline: the component delivery test
// (tests/skills/end-to-end-delivery.test.ts) stops at the script→server→
// handler→mock-adapter chain; tests/skills/* + tests/skill-api/* own the
// single-component quota/anchor/registry/containment units; tests/core/*
// own the retry-strategy text units. This suite's observables are
// ORCHESTRATOR-level: the platform-call ledger with exact intended content
// across BOTH spawn shapes, retry-prompt LITERALNESS recorded under the real
// retry loop (pooled headline), the file-only summary skip inside a full
// session, reaction-gate composition, auth-failure × retry composition,
// sibling JWT/staging denials, and OpenCode byte-identity through the real
// orchestrator spawn path.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentConnector } from "@acp/agent-connector.ts";
import { AgentProcessPool } from "@core/agent-process-pool.ts";
import { ConnectionState } from "../../../src/types/platform.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { observeTrustedSkillsRoot, resolveTrustedSkillsRoot } from "@core/skills-root.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { createAgentConfig } from "@acp/agent-factory.ts";
import { SkillAPIServer } from "../../../src/skill-api/server.ts";
import { SessionRegistry } from "../../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../../src/skills/registry.ts";
import { PlatformAdapter } from "../../../src/platforms/platform-adapter.ts";
import type { NormalizedEvent, Platform } from "../../../src/types/events.ts";
import type {
  PlatformCapabilities,
  ReactionResult,
  ReplyOptions,
  ReplyResult,
  SendFileOptions,
  SendFilePayload,
  SendFileResult,
} from "../../../src/types/platform.ts";
import type { AgentConfig, AgentConnectorOptions } from "../../../src/acp/types.ts";
import type { Config } from "../../../src/types/config.ts";
import { createSkillJwt } from "@utils/skill-jwt.ts";
import { mockOmpNativeCache, useMockOmpAgent } from "../../mocks/omp-mock-session.ts";
import { createFilesystemTestCalls } from "../../acp/filesystem-test-calls.ts";

// ---------------------------------------------------------------------------
// Subprocess-tier guard (row-21/23 precedent): dumb-init + deno only. No live
// agent/provider/platform/container/bwrap is ever invoked by this file.
// ---------------------------------------------------------------------------

async function binaryAvailable(name: string): Promise<boolean> {
  try {
    const res = await new Deno.Command("which", { args: [name] }).output();
    return res.code === 0;
  } catch {
    return false;
  }
}
const CAN_RUN_SUBPROCESS = await binaryAvailable("dumb-init") && await binaryAvailable("deno");

const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01"; // 36 bytes (>= 32)

// ---------------------------------------------------------------------------
// Platform call ledger (method + payload + count). Capability shape mirrors
// the shared-process suite's in-file adapter (reactions supported so the
// react-message skill reaches the handler; edit/fetch surfaces behave like
// the shipped mock: edits succeed, fetches return nothing).
// ---------------------------------------------------------------------------

interface LedgerCall {
  method: string;
  payload: unknown[];
}

class LedgerAdapter extends PlatformAdapter {
  readonly platform: Platform = "discord";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: true,
    maxMessageLength: 2000,
  };
  readonly calls: LedgerCall[] = [];

  #record(method: string, payload: unknown[]): void {
    this.calls.push({ method, payload });
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  /** Every recorded call as "method:payload" — the ledger assertion surface. */
  trace(): string[] {
    return this.calls.map((c) => `${c.method}:${JSON.stringify(c.payload)}`);
  }

  override getConnectionStatus() {
    return { state: ConnectionState.CONNECTED, reconnectAttempts: 0 };
  }
  determineSpontaneousTarget(_config: unknown) {
    return Promise.resolve(null);
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  sendTyping() {
    return Promise.resolve();
  }
  sendReply(_channelId: string, content: string, options?: ReplyOptions): Promise<ReplyResult> {
    this.#record("sendReply", [content, options?.replyToMessageId ?? null]);
    return Promise.resolve({ success: true, messageId: `mock-reply-${this.count("sendReply")}` });
  }
  sendFile(
    _channelId: string,
    files: SendFilePayload[],
    _options?: SendFileOptions,
  ): Promise<SendFileResult> {
    this.#record("sendFile", files.map((f) => f.fileName));
    return Promise.resolve({
      success: true,
      messageId: "mock-file-1",
      messageIds: ["mock-file-1"],
    });
  }
  addReaction(_channelId: string, messageId: string, emoji: string): Promise<ReactionResult> {
    this.#record("addReaction", [messageId, emoji]);
    return Promise.resolve({ success: true });
  }
  editMessage(
    _channelId: string,
    messageId: string,
    content: string,
  ): Promise<ReplyResult> {
    this.#record("editMessage", [messageId, content]);
    return Promise.resolve({ success: true, messageId });
  }
  fetchRecentMessages(_channelId: string, _limit: number) {
    return Promise.resolve([]);
  }
  fetchEmojis() {
    return Promise.resolve([]);
  }
  getUsername(_userId: string) {
    return Promise.resolve("tester");
  }
  isSelf(_userId: string) {
    return false;
  }
  getBotId() {
    return null;
  }
  getDmChannelId(userId: string) {
    return Promise.resolve(`dm:${userId}`);
  }
  hasBotReaction(_channelId: string, _messageId: string) {
    return Promise.resolve(false);
  }
  hasBotMention(_channelId: string, _messageId: string) {
    return Promise.resolve(false);
  }
  fetchMessage(_channelId: string, _messageId: string) {
    return Promise.resolve(null);
  }
}

// ---------------------------------------------------------------------------
// Ephemeral Skill API server (never the fixed 3001 of existing suites).
// SkillAPIServer does not expose its bound port, so the harness PRE-PROBES a
// free ephemeral loopback port (bind port 0 with Deno.serve, read the port,
// shut down immediately) and hands that port to the server. This is a
// harness-side technique, NOT a production seam (task 1.3: NO-SEAM decision —
// the ephemeral port reaches mock and skill scripts through the existing
// SKILL_API_URL env input the skill client already honors).
// ---------------------------------------------------------------------------

async function probeEphemeralPort(): Promise<number> {
  const probe = Deno.serve({ port: 0, hostname: "127.0.0.1" }, () => new Response("probe"));
  // deno-lint-ignore no-explicit-any
  const port = (probe as any).addr.port as number;
  await probe.shutdown();
  return port;
}

// No readiness sleep exists: `Deno.serve` binds its port synchronously by the
// time `SkillAPIServer.start()` returns (the harness's own port probe above
// already relies on that contract), so ONE awaited fetch either gets an HTTP
// answer (any status, even 404, proves the handler loop is live) or the
// harness is genuinely broken and must surface immediately — no wall-clock
// retry, no timer to fake-time.
async function assertServerLive(port: number): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/skill/probe`);
    await response.body?.cancel();
  } catch (cause) {
    throw new Error("skill API server not live after synchronous bind", { cause });
  }
}

// ---------------------------------------------------------------------------
// Scripted skill-invocation step (mock-agent MOCK_SKILL_CALLS_FILE schema):
// one step is consumed per session/prompt; each step stages an optional
// payload file, then spawns each listed REAL skill-script invocation in
// order. "@SESSION_ID" / "@STAGING_DIR" resolve inside the mock from the
// identity material the BOT writes before the first prompt (per-spawn: the
// unique {sessionId}.jwt filename; pooled: the active.json pointer), so the
// recorded argv carries the literal the run actually used.
// ---------------------------------------------------------------------------

interface SkillInvocation {
  script: string;
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/** Mirror of the mock's scripted agent->client ACP request (mock-acp-agent
 * MockAcpRequest): wire methods answered by the REAL ChatbotClient over the
 * live stdio connection. `expect` settles per the mock's rules — "ok" (success
 * required), "error:<substring>" (bounded denial error required),
 * "result:<substring>" (successful result containing the substring —
 * permission denials are NORMAL selected-reject results, never errors).
 * `@ACP_SESSION_ID` / `@SESSION_ID` / `@STAGING_DIR` expand inside the mock;
 * raw `$TMPDIR`/`$SESSION_ID` tokens pass through UNtouched, so a step can
 * hand the client a legacy shell-token path and exercise the shipped
 * `resolveSessionPath()` expansion in the client's own resolver. */
interface AcpRequest {
  method: "session/request_permission" | "fs/read_text_file" | "fs/write_text_file";
  params?: Record<string, unknown>;
  expect?: string;
  copyResultTo?: string;
}

interface SkillCallStep {
  stagePayload?: { file: string; content: string } | { file: string; content: string }[];
  invocations?: SkillInvocation[];
  acpRequests?: AcpRequest[];
}

// ---------------------------------------------------------------------------
// Registry snapshot subclass: captures the Skill API session id at
// registration (SessionRegistry.register mints a fresh UUID; the suite needs
// the id for post-run assertions and negative vectors without guessing).
// ---------------------------------------------------------------------------

class SnapshotRegistry extends SessionRegistry {
  readonly registered: string[] = [];
  /** Live ActiveSession objects seen via get() DURING the run. The
   * orchestrator removes its registry entry at finalization, so post-run
   * state assertions read these same-object references. */
  readonly observed = new Map<string, ReturnType<SessionRegistry["get"]>>();
  override register(
    session: Parameters<SessionRegistry["register"]>[0],
  ): string {
    const id = super.register(session);
    this.registered.push(id);
    return id;
  }
  override get(sessionId: string): ReturnType<SessionRegistry["get"]> {
    const session = super.get(sessionId);
    if (session) this.observed.set(sessionId, session);
    return session;
  }
  /** First-registered session's observed object (the run's subject). */
  subject(index = 0): NonNullable<ReturnType<SessionRegistry["get"]>> | undefined {
    return this.observed.get(this.registered[index]);
  }
}

// ---------------------------------------------------------------------------
// Mock-agent swap for orchestrator-driven tiers: composes the shipped
// factory posture via the REAL createAgentConfig at the shipped call site,
// then applies the row-21 useMockOmpAgent swap plus this suite's additive
// scripted skill-call fields — all harness-side, applied through the
// protected createConnector hook / the pool's injectable connectorFactory,
// exactly like row 21's launch-override precedent. NO production seam exists
// or is needed.
// ---------------------------------------------------------------------------

/** Shipped test seam (ClientConfig.nativeCalls, as the row-23 lifecycle suite
 * uses): the offline native-call model the filesystem suites already run on,
 * so the fs/read + fs/write RPC machinery exercises its REAL authorization +
 * access pipeline without libc/openat2 FFI. Policy denials all happen before
 * any native call, so honest-posture denials are untouched by the seam;
 * allow-side content IO is likewise seam-backed — an "allow landed"
 * observation here is never evidence about the production FFI layer. */
function applyFilesystemTestSeam(options: AgentConnectorOptions): void {
  options.clientConfig.nativeCalls = createFilesystemTestCalls();
}

function applySkillMock(params: {
  agentConfig: AgentConfig;
  stateDir: string;
  rpcFile: string;
  callsFile: string;
  skillEnvFile: string;
  /** Same content, but the scenario may overwrite it mid-run to forge a
   * client env (3.5) — env resolves per spawn, so the swap lands. */
  forgeableSkillEnvFile?: string;
  skillRecordFile: string;
  stagingBase: string;
}): void {
  useMockOmpAgent(params.agentConfig, {
    stateDir: params.stateDir,
    recordRpcFile: params.rpcFile, // every session/prompt recorded: retry auditable
    allowRun: true, // scripted skill spawn needs `deno run` of the child script
  });
  params.agentConfig.env ??= {};
  Object.assign(params.agentConfig.env, {
    MOCK_SKILL_CALLS_FILE: params.callsFile,
    MOCK_SKILL_ENV_FILE: params.forgeableSkillEnvFile ?? params.skillEnvFile,
    MOCK_SKILL_RECORD_FILE: params.skillRecordFile,
    // Mock fixture aid (read-only): the workspace tmp root the prompts render
    // as the staging base. The OMP per-spawn process cwd is the factory's
    // neutral launch dir, so the fixture cannot derive it from cwd there.
    MOCK_STAGING_BASE: params.stagingBase,
  });
}

/** Orchestrator subclass whose ONLY override routes connector construction
 * through the mock swap (protected-hook tier: no production change). */
class MockSwapOrchestrator extends SessionOrchestrator {
  mockParams: Omit<Parameters<typeof applySkillMock>[0], "agentConfig"> | null = null;
  /** The connector-composed agentConfig of every spawn (env/command audit). */
  spawnedConfigs: AgentConfig[] = [];
  /** Every session/prompt text the real prompt path handed its connectors. */
  promptTexts: string[] = [];
  /** Every connector this harness created (per-spawn hook + pooled factory):
   * the honest-posture scenarios read the REAL ChatbotClient off the live
   * connector — the rejection buffer the shipped retry prompt itself consumes. */
  readonly connectors: AgentConnector[] = [];
  /** Rejection reasons snapshotted at each connector's disconnect(): the
   * per-spawn tier disconnects when the run ends, nulling the client before
   * assertions run, so the buffer must be captured at teardown-entry too. */
  readonly disconnectedRejections: string[] = [];

  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    // Pre-swap snapshot of the orchestrator-composed (factory) posture: the
    // 3.6 byte-identity baseline. applySkillMock mutates this same object, so
    // capture the fields the shipped launch would have used first.
    this.spawnedConfigs.push({
      ...options.agentConfig,
      env: options.agentConfig.env ? { ...options.agentConfig.env } : undefined,
    });
    if (this.mockParams) {
      applySkillMock({ ...this.mockParams, agentConfig: options.agentConfig });
    }
    applyFilesystemTestSeam(options);
    return this.wrapPromptRecording(new AgentConnector(options));
  }

  wrapPromptRecording(connector: AgentConnector): AgentConnector {
    this.connectors.push(connector);
    const originalPrompt = connector.prompt.bind(connector);
    connector.prompt = (sessionId, content) => {
      this.promptTexts.push(
        typeof content === "string"
          ? content
          : content.map((block) => ("text" in block ? block.text : "") ?? "").join("\n"),
      );
      return originalPrompt(sessionId, content);
    };
    const originalDisconnect = connector.disconnect.bind(connector);
    connector.disconnect = () => {
      for (const r of connector.getClient()?.getRecentPermissionRejections() ?? []) {
        this.disconnectedRejections.push(r.reason);
      }
      return originalDisconnect();
    };
    return connector;
  }

  /** All bounded permission rejections this harness's REAL clients recorded:
   * disconnect-time snapshots first, then live connector buffers. The merge
   * never double counts — disconnect() nulls the client, so a reason is only
   * ever in ONE of the two sources — and a mid-run reconnect that clears a
   * client buffer (row-11 recovery) still keeps the pre-recovery rejections
   * in the merged view instead of silently dropping them. */
  observedPermissionRejections(): string[] {
    const live = this.connectors.flatMap(
      (c) => (c.getClient()?.getRecentPermissionRejections() ?? []).map((r) => r.reason),
    );
    return [...this.disconnectedRejections, ...live];
  }
}

// ---------------------------------------------------------------------------
// Full-stack harness.
// ---------------------------------------------------------------------------

interface Harness {
  tempDir: string;
  jwtDir: string;
  workspacePath: string;
  stateDir: string;
  rpcFile: string;
  callsFile: string;
  skillRecordFile: string;
  skillEnvFile: string;
  forgeableSkillEnvFile: string;
  config: Config;
  sessionRegistry: SnapshotRegistry;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  workspaceManager: WorkspaceManager;
  orchestrator: MockSwapOrchestrator;
  pool: AgentProcessPool | null;
  ledger: LedgerAdapter;
  server: SkillAPIServer;
  port: number;
  event: NormalizedEvent;
  /** The deployed external-skill root this harness resolved, when installed. */
  skillsRoot: string | null;
}

function buildHarnessConfig(params: {
  tempDir: string;
  jwtDir: string;
  agentType: "opencode" | "omp";
  shared: boolean;
  /** The deployment-RESOLVED skill root (defaults to the repo `skills/` tree). */
  skillsDir?: string;
}): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "mock" },
      misskey: { enabled: false, host: "http://localhost", token: "mock" },
    },
    agent: {
      defaultAgentType: params.agentType,
      model: "mock-model-canonical",
      systemPromptPath: join(params.tempDir, "prompts", "system_reply.md"),
      tokenLimit: 20000,
      // The shipped `omp` factory requires the ONE shared prepared native payload before it
      // spawns; this suite selects the synthetic process-scoped one (a fixture, never native
      // evidence). OpenCode ignores it.
      ompNativeCache: mockOmpNativeCache(),
      // jwtDir is consumed in BOTH shapes (per-spawn JWT issuance uses the
      // same dir); `enabled` marks the pooled deployment.
      sharedProcess: { enabled: params.shared, jwtDir: params.jwtDir, reclaimIdleMs: 120_000 },
      idleTimeout: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
      // ONE resolved root for BOTH agent types (`unify-skill-root-and-inventory`
      // D1); the shared-root scenario points it at an installed external skill.
      ...(params.skillsDir ? { skillsDir: params.skillsDir } : {}),
      // Isolated agent-workspace root (the shipped optional knob): every
      // harness run is single-shot, but keeping ownership out of the test
      // tree mirrors the shared-process suite's deployment shape.
      agentWorkspacePath: join(params.tempDir, "agent-workspace"),
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: params.tempDir, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
    skillApi: { enabled: true },
    conversationSummary: { enabled: false },
    audit: { enabled: false },
    skills: {
      // send-file ships disabled unless configured; the file scenarios enable
      // it with generous limits (byte sizes here are a few bytes).
      sendFile: { enabled: true, maxFilesPerInvocation: 4, maxFileSizeMb: 1, maxTotalSizeMb: 4 },
    },
  } as unknown as Config;
}

async function createHarness(params: {
  name: string;
  agentType: "opencode" | "omp";
  /** pooled = deployment pooled pool (pooled pool keys enabled); per-spawn =
   * no pool (createConnector-hook swap tier). */
  shape: "pooled" | "per-spawn";
  conversationSummaryEnabled?: boolean;
  /**
   * Install ONE runtime-installed external skill into a deployment-resolved
   * root and point `agent.skillsDir` at it (`align-omp-skill-trust-to-shared-
   * root` 4.1/4.2): the tree carries the shared root's own writable posture
   * (directories `0775`, files `0664`, never root-owned) so the fixtures prove
   * admission on identity alone.
   */
  installExternalSkill?: boolean;
}): Promise<Harness> {
  const shared = params.shape === "pooled";
  const tempDir = await Deno.makeTempDir({ prefix: `omp-handoff-${params.name}-` });
  const jwtDir = join(tempDir, "skill-jwt");
  Deno.mkdirSync(jwtDir, { mode: 0o700 });
  const stateDir = join(tempDir, "mock-state");
  Deno.mkdirSync(stateDir, { recursive: true });
  let skillsRoot: string | null = null;
  if (params.installExternalSkill) {
    const skillDirectory = join(tempDir, "skills", "external-skill");
    const scriptsDirectory = join(skillDirectory, "scripts");
    Deno.mkdirSync(scriptsDirectory, { recursive: true });
    Deno.writeTextFileSync(join(skillDirectory, "SKILL.md"), "# external-skill\n");
    Deno.writeTextFileSync(
      join(scriptsDirectory, "external-skill.ts"),
      "#!/usr/bin/env deno\n",
    );
    for (const directory of [join(tempDir, "skills"), skillDirectory, scriptsDirectory]) {
      Deno.chmodSync(directory, 0o775);
    }
    for (
      const file of [join(skillDirectory, "SKILL.md"), join(scriptsDirectory, "external-skill.ts")]
    ) {
      Deno.chmodSync(file, 0o664);
    }
    skillsRoot = Deno.realPathSync(join(tempDir, "skills"));
  }
  const promptsDir = join(tempDir, "prompts");
  Deno.mkdirSync(promptsDir, { recursive: true });
  // Harness templates render the literal pair the shipped system_reply.md
  // renders (Session Information section): literal `{{ sessionId }}` + the
  // absolute `{{ tmpDir }}` staging dir — the payload-file contract — plus the
  // literal trusted skill-script root every classified render must carry
  // (`render-delivered-skill-root-contract`).
  Deno.writeTextFileSync(
    join(promptsDir, "system_reply.md"),
    "Reply as the mock assistant.\n" +
      "Use `--session-id {{ sessionId }}` when calling skills.\n" +
      "{{ if tmpDir -}}\n" +
      "Your payload staging directory is `{{ tmpDir }}`.\n" +
      "{{- /if }}\n" +
      "Skill root: {{ skillsDir }}\n",
  );
  Deno.writeTextFileSync(
    join(promptsDir, "system_summary.md"),
    "Summarize this conversation.\nSkill root: {{ skillsDir }}",
  );

  const config = buildHarnessConfig({
    tempDir,
    jwtDir,
    agentType: params.agentType,
    shared,
    ...(skillsRoot ? { skillsDir: skillsRoot } : {}),
  });
  if (params.conversationSummaryEnabled !== undefined) {
    config.conversationSummary = { enabled: params.conversationSummaryEnabled };
  }

  // The workspace path is deterministic from the event below, so the harness
  // (and skill-script cwds in step fixtures) know it a priori.
  const workspaceManager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
  const event: NormalizedEvent = {
    platform: "discord",
    channelId: `chan-${params.name}`,
    userId: "u-handoff",
    messageId: `msg_trigger_${params.name}`,
    isDm: false,
    guildId: "g1",
    content: `handoff probe ${params.name}`,
    timestamp: new Date(),
  };
  const workspacePath = workspaceManager.getWorkspacePath(
    workspaceManager.getWorkspaceKeyFromEvent(event),
  );

  const port = await probeEphemeralPort();
  const ledger = new LedgerAdapter();
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(
    memoryStore,
    undefined,
    undefined,
    config.skills?.sendFile,
  );
  const sessionRegistry = new SnapshotRegistry();
  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: config.agent.systemPromptPath,
    // The ONE deployment-resolved skill-script root
    // (`unify-skill-root-and-inventory`): the same value the orchestrator, the
    // connector inventory and the retry assertions below resolve, for either
    // agent type — so the delivered root and the resolved root are one value.
    skillsDir: resolveTrustedSkillsRoot(
      config.agent.defaultAgentType ?? "opencode",
      config.agent.skillsDir,
    ),
    recentMessageLimit: 20,
    tokenLimit: 20000,
  });

  const skillEnvFile = join(stateDir, "skill-env.json");
  // Base env for skill-script spawns (mock spawns with clearEnv + this map +
  // per-invocation overrides). Pooled shape: pointer is the sole identity
  // source, NO SESSION_ID anywhere.
  const skillBaseEnv: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    HOME: Deno.env.get("HOME") ?? "/tmp",
    SKILL_API_URL: `http://127.0.0.1:${port}`,
    SKILL_JWT_DIR: jwtDir,
  };
  if (shared) skillBaseEnv.SKILL_SHARED_PROCESS = "1";
  const forgeableSkillEnvFile = join(stateDir, "skill-env-forgeable.json");
  Deno.writeTextFileSync(skillEnvFile, JSON.stringify(skillBaseEnv));
  Deno.writeTextFileSync(forgeableSkillEnvFile, JSON.stringify(skillBaseEnv));

  const server = new SkillAPIServer(
    sessionRegistry,
    skillRegistry,
    { port, host: "127.0.0.1" },
    TEST_SKILL_SECRET,
  );
  server.start();
  await assertServerLive(port);

  // One orchestrator; the pooled tier wires the pool through the shipped
  // constructor arg (arg 10). The pool's injectable connectorFactory — the
  // row-21 precedent for the mock swap under pooled spawn — receives the
  // orchestrator-composed agentConfig through the SAME options object
  // production uses; the per-spawn tier swaps through the protected
  // createConnector hook instead.
  // The pooled connector factory closes over the orchestrator, which is
  // constructed with the pool: a late-bound reference box breaks the cycle.
  const orchestratorRef: { current?: MockSwapOrchestrator } = {};
  let pool: AgentProcessPool | null = null;
  if (params.shape !== "per-spawn") {
    pool = new AgentProcessPool(config, sessionRegistry, TEST_SKILL_SECRET, (options) => {
      const orchestrator = orchestratorRef.current!;
      // Same pre-swap snapshot + prompt-recording treatment the protected
      // createConnector hook applies in the per-spawn tier.
      orchestrator.spawnedConfigs.push({
        ...options.agentConfig,
        env: options.agentConfig.env ? { ...options.agentConfig.env } : undefined,
      });
      if (orchestrator.mockParams) {
        applySkillMock({ ...orchestrator.mockParams, agentConfig: options.agentConfig });
      }
      applyFilesystemTestSeam(options);
      return orchestrator.wrapPromptRecording(new AgentConnector(options));
    }, 30_000);
  }
  const orchestrator = new MockSwapOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
    false,
    undefined,
    TEST_SKILL_SECRET,
    pool,
  );
  orchestratorRef.current = orchestrator;
  orchestrator.mockParams = {
    stateDir,
    rpcFile: join(stateDir, "rpc.jsonl"),
    callsFile: join(stateDir, "calls.json"),
    skillEnvFile,
    skillRecordFile: join(stateDir, "skill-record.jsonl"),
    stagingBase: join(workspacePath, "tmp"),
  };

  return {
    tempDir,
    jwtDir,
    workspacePath,
    stateDir,
    rpcFile: join(stateDir, "rpc.jsonl"),
    callsFile: join(stateDir, "calls.json"),
    skillRecordFile: join(stateDir, "skill-record.jsonl"),
    skillEnvFile,
    forgeableSkillEnvFile,
    config,
    sessionRegistry,
    skillRegistry,
    memoryStore,
    workspaceManager,
    orchestrator,
    pool,
    ledger,
    server,
    port,
    event,
    skillsRoot,
  };
}

/** Script the mock's per-prompt behavior; consumed one step per session/prompt. */
function scriptSteps(h: Harness, steps: SkillCallStep[]): void {
  Deno.writeTextFileSync(h.callsFile, JSON.stringify(steps));
}

async function teardownHarness(h: Harness): Promise<void> {
  if (h.pool) {
    // Wait for the lease release path (pointer clear, JWT delete, child drain)
    // to finish before stopping the pool (row-23 pattern).
    for (let i = 0; i < 400 && !h.pool.isIdle(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    h.pool.stop();
  }
  await h.server.stop();
  h.sessionRegistry.stop();
  try {
    await Deno.remove(h.tempDir, { recursive: true });
  } catch {
    // Temp-dir cleanup is best effort (a still-flushing mock child can race
    // the recursive remove; the OS reclaims the dir otherwise).
  }
}

interface RpcEntry {
  gen: string;
  seq: number;
  pid: number;
  method: string;
  params?: { prompt?: Array<{ type: string; text?: string }> } & Record<string, unknown>;
}

function readRpcEntries(h: Harness): RpcEntry[] {
  try {
    return Deno.readTextFileSync(h.rpcFile)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RpcEntry);
  } catch {
    return [];
  }
}

interface SkillRecord {
  gen: string;
  seq: number;
  script: string;
  argv: string[];
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
}

function readSkillRecords(h: Harness): SkillRecord[] {
  try {
    return Deno.readTextFileSync(h.skillRecordFile)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as SkillRecord);
  } catch {
    return [];
  }
}

function scriptUrl(name: "send-reply" | "send-file" | "react-message" | "edit-reply"): string {
  return new URL(`../../../skills/${name}/scripts/${name}.ts`, import.meta.url).pathname;
}

/** Assert recorded skill-invocation argv is literal-first (task 3.1):
 * contains the run's literal session id, no unexpanded token. */
function assertLiteralArgv(record: SkillRecord, sessionId: string): void {
  const argv = record.argv.join(" ");
  assertStringIncludes(argv, sessionId);
  assert(!argv.includes("@SESSION_ID"), "token must have expanded before spawn");
  assert(!argv.includes("@STAGING_DIR"), "token must have expanded before spawn");
  assert(!argv.includes("$TMPDIR"), "argv must not carry an unexpanded $TMPDIR token");
  assert(!argv.includes("$SESSION_ID"), "argv must not carry an unexpanded $SESSION_ID");
}

/**
 * Classified retry contract (`render-delivered-skill-root-contract`): the
 * delivered retry guidance quotes the COMPLETE executable path and its
 * payload/id arguments with the same POSIX formatter the templates use,
 * names the session's literal root and staging directory, and never carries
 * an unexpanded shell token.
 */
const literalRetryAssertions = (
  text: string,
  sessionId: string,
  stagingDir: string,
  skillsRoot: string,
): void => {
  assertStringIncludes(text, `'${skillsRoot}/send-reply/scripts/send-reply.ts'`);
  assertStringIncludes(text, `--session-id '${sessionId}'`);
  assertStringIncludes(text, `--message-file '${stagingDir}/reply.md'`);
  assert(!text.includes("$TMPDIR"), "retry guidance must not carry an unexpanded $TMPDIR token");
  assert(!text.includes("$SESSION_ID"), "retry guidance must not carry an unexpanded $SESSION_ID");
};

// ---------------------------------------------------------------------------
// 3.1 + spec scenarios: happy-path handoff in BOTH shapes (3.6 adds the
// OpenCode spawn-env audit inside the per-spawn shape run).
// ---------------------------------------------------------------------------

async function runHappyPath(shape: "per-spawn" | "pooled"): Promise<void> {
  const h = await createHarness({
    name: `happy-${shape}`,
    agentType: "omp",
    shape,
    // Summary gate stays on replySent: with it enabled, the happy reply turn
    // also produces the summary prompt — 3.3's file-only skip assertion then
    // means something against a summary path that is live in this file.
    conversationSummaryEnabled: true,
  });
  try {
    // Literal content incl. a `$` sequence: delivered verbatim through the
    // payload-file contract (never a command line).
    const replyContent = "handoff reply verbatim $HOME contents";
    // The deployment-resolved trusted root, observed exactly as the REAL
    // factory/orchestration observe it (one resolver for both agent types).
    const skillsRoot = resolveTrustedSkillsRoot(
      h.config.agent.defaultAgentType ?? "opencode",
      h.config.agent.skillsDir,
    );
    const instructionPath = join(skillsRoot, "send-reply", "SKILL.md");
    const instructionReadCopy = join(h.stateDir, `skill-instruction-read-${shape}.md`);
    const instructionBytes = Deno.readTextFileSync(instructionPath);
    const stagedPayloadCopy = join(h.stateDir, `staged-payload-${shape}.md`);
    // One step, NO fixture pre-staging: the payload is created ONLY by the
    // ACP `fs/write_text_file` request below — the session staging directory
    // already exists because PRODUCTION orchestration pre-creates
    // `{workspace}/tmp/{sessionId}` right after session registration
    // (src/core/session-orchestrator.ts, "Pre-create the session-scoped
    // payload staging directory"), so no harness provisioning is needed and a
    // client write that silently no-ops cannot be masked by a staged file. The
    // REAL client staging-write gate is also what the send-reply invocation
    // then consumes, and the quoted absolute script invocation is approved by
    // the same client. The client-write audit copy is the durable
    // staging-creation evidence: the payload file is DELETED by the skill
    // client once consumed (skills/lib/payload.ts) and the workspace tmp tree
    // is removed at session finalization (`cleanupWorkspaceTmp`), so only an
    // in-run read-back can witness it.
    scriptSteps(h, [
      {
        acpRequests: [
          {
            // Staging file creation through the REAL client — the ONLY writer
            // of this payload: the bytes go to the session's OWN staging path
            // under the shared write policy, and the audit copy re-reads the
            // file AT THAT PATH, so a success-without-write cannot satisfy it.
            method: "fs/write_text_file",
            params: {
              sessionId: "@ACP_SESSION_ID",
              path: "@STAGING_DIR/reply.md",
              content: replyContent,
            },
            expect: "ok",
            copyResultTo: stagedPayloadCopy,
          },
          {
            // Skill-instruction read under the deployment-resolved trusted
            // root: the REAL client authorizes it from the root observation the
            // factory carried, and the audit copy is the client's own returned
            // content.
            method: "fs/read_text_file",
            params: { sessionId: "@ACP_SESSION_ID", path: instructionPath },
            expect: "result:Send Reply Skill",
            copyResultTo: instructionReadCopy,
          },
          {
            // Quoted absolute script invocation, the same POSIX form the
            // delivered retry guidance renders: the REAL client auto-approves
            // the enumerated entrypoint of the resolved root and selects allow.
            method: "session/request_permission",
            params: {
              sessionId: "@ACP_SESSION_ID",
              toolCall: {
                toolCallId: `happy-${shape}-send-reply`,
                title: "Execute shell command",
                kind: "execute",
                rawInput: {
                  commands: [
                    `'${skillsRoot}/send-reply/scripts/send-reply.ts' --session-id '@SESSION_ID' --message-file '@STAGING_DIR/reply.md'`,
                  ],
                },
              },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            },
            expect: 'result:"optionId":"allow"',
          },
        ],
        invocations: [
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
            // Per-spawn agent processes carry the authoritative SESSION_ID
            // (shipped factory env); pooled processes carry none.
            env: shape === "per-spawn" ? { SESSION_ID: "@SESSION_ID" } : {},
          },
        ],
      },
      // The summary prompt rides the SAME connector/process: this silent step
      // absorbs the summary turn so the mock spawns nothing for it.
      {},
    ]);

    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    assertEquals(result.success, true);
    assertEquals(result.replySent, true);
    assertEquals(result.fileSent ?? false, false);

    // ONE intended platform response with the exact intended content.
    assertEquals(h.ledger.count("sendReply"), 1, `ledger: ${h.ledger.trace().join(" | ")}`);
    assertEquals(h.ledger.calls[0].payload[0], replyContent);
    assertEquals(h.ledger.count("sendFile"), 0);
    assertEquals(h.ledger.count("addReaction"), 0);
    assertEquals(h.ledger.count("editMessage"), 0);

    // Two session/prompt entries — the delivery turn plus the awaited
    // conversation-summary turn (the summary is awaited inline before
    // processMessage returns): NO retry prompt exists between them, and no
    // fallback or duplicate delivery. The delivery prompt itself carries the
    // literal id + absolute staging dir (handoff-prompt scenario).
    const sessionId = h.sessionRegistry.registered[0];
    assert(sessionId, "session registered");
    const promptText = h.orchestrator.promptTexts[0] ?? "";
    assertStringIncludes(promptText, `--session-id ${sessionId}`);
    // The delivered reply prompt carries the literal trusted skill-script root
    // the whole deployment resolves (`unify-skill-root-and-inventory`).
    assertStringIncludes(promptText, skillsRoot);
    const stagingDir = `${h.workspacePath}/tmp/${sessionId}`;
    assertStringIncludes(promptText, stagingDir);

    // The instruction read really crossed the live stdio boundary and was
    // authorized: the audit copy is byte-equal to the instruction file under
    // the deployment-resolved root, and the root observation the connector
    // composed into its config is that same resolved root + identity.
    assertEquals(
      Deno.readTextFileSync(instructionReadCopy),
      instructionBytes,
      "client-returned instruction content equals the file under the resolved root",
    );
    const composed = h.orchestrator.spawnedConfigs[0];
    assert(composed, "connector-composed config recorded");
    assertEquals(
      composed.skillsRoot,
      observeTrustedSkillsRoot(
        h.config.agent.defaultAgentType ?? "opencode",
        h.config.agent.skillsDir,
      ),
      "factory root observation == deployment-resolved root observation",
    );
    // Staging file creation: the client-written payload landed at the
    // session's OWN staging path with the exact bytes the real handler chain
    // then consumed. Nothing pre-staged this file: the audit copy is the mock
    // re-reading the requested staging path AFTER the client's write settled
    // "ok", so it exists only if the REAL client actually created it.
    assertEquals(
      Deno.readTextFileSync(stagedPayloadCopy),
      replyContent,
      "client-written staging payload equals the delivered reply content",
    );
    // Nothing was refused: the quoted invocation was approved, not denied.
    assertEquals(
      h.orchestrator.observedPermissionRejections(),
      [],
      "happy path records zero permission rejections",
    );

    // Real invocation accepted by real JWT auth + containment; argv literal.
    const records = readSkillRecords(h);
    assertEquals(records.length, 1);
    assertEquals(records[0].code, 0, records[0].stderr);
    assertLiteralArgv(records[0], sessionId);
    assertStringIncludes(records[0].argv.join(" "), stagingDir);

    // Registry state: replySent true, quota at 1, anchors reply-side only.
    // (The orchestrator removes the registry entry at finalization; the
    // observed-object reference carries the in-run state.)
    const session = h.sessionRegistry.subject();
    assert(session, "session observed during run");
    assertEquals(session.replySent, true);
    assertEquals(session.replyCount, 1);
    assertEquals(session.fileSent, false);
    assertEquals(session.lastFileMessageId, undefined);
    assertEquals(session.lastSentMessageId, "mock-reply-1");

    // Summary path is live (enabled) and ran exactly once after the reply —
    // the second prompt — and added no further platform action.
    const prompts = readRpcEntries(h).filter((e) => e.method === "session/prompt");
    assertEquals(prompts.length, 2, "delivery turn + one summary turn, zero retries");
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 3.2 Missing-reply retry exactly once, literal-first, BOTH shapes (the
// pooled case is the rows-16/10 headline: no frozen env identity exists).
// ---------------------------------------------------------------------------

async function runRetryOnce(
  shape: "per-spawn" | "pooled",
  secondTurnDelivers: boolean,
): Promise<void> {
  const h = await createHarness({
    name: `retry-${shape}-${secondTurnDelivers}`,
    agentType: "omp",
    shape,
  });
  try {
    if (secondTurnDelivers) {
      // Turn 1 silent (no step spawns anything); the retry turn delivers.
      scriptSteps(h, [
        {},
        {
          stagePayload: { file: "@STAGING_DIR/reply.md", content: "delivered after retry" },
          invocations: [
            {
              script: scriptUrl("send-reply"),
              argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
              cwd: h.workspacePath,
              // The harness spawns scripts with clearEnv; the shipped
              // agent-process env carries SESSION_ID per-spawn — model it.
              env: shape === "per-spawn" ? { SESSION_ID: "@SESSION_ID" } : {},
            },
          ],
        },
      ]);
    } else {
      // Both turns silent: failure with zero deliveries.
      scriptSteps(h, [{}, {}]);
    }

    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    const sessionId = h.sessionRegistry.registered[0];
    assert(sessionId, "session registered");
    const stagingDir = `${h.workspacePath}/tmp/${sessionId}`;

    const rpc = readRpcEntries(h);
    const prompts = rpc.filter((e) => e.method === "session/prompt");
    assertEquals(prompts.length, 2, "exactly one retry prompt after the silent turn");
    literalRetryAssertions(
      h.orchestrator.promptTexts[1] ?? "",
      sessionId,
      stagingDir,
      resolveTrustedSkillsRoot(
        h.config.agent.defaultAgentType ?? "opencode",
        h.config.agent.skillsDir,
      ),
    );

    if (secondTurnDelivers) {
      assertEquals(result.success, true);
      assertEquals(result.replySent, true);
      assertEquals(h.ledger.count("sendReply"), 1, "at-least-one gate met by the retried delivery");
      assertEquals(h.ledger.calls[0].payload[0], "delivered after retry");
    } else {
      assertEquals(result.success, false);
      assertEquals(result.replySent, false);
      assertEquals(h.ledger.calls.length, 0, "silent retry ends with zero platform deliveries");
    }
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 3.3 Send-file invariants (pooled shape: file quota, anchors, summary skip,
// edit-reply-on-file rejection). Orchestrator-level ledger + registry only;
// quota-counter unit internals stay with tests/skill-api.
// ---------------------------------------------------------------------------

async function runFileOnly(): Promise<void> {
  const h = await createHarness({
    name: "file-only",
    agentType: "omp",
    shape: "pooled",
    conversationSummaryEnabled: true,
  });
  try {
    // Turn 1: send-file of a file INSIDE the workspace (handler validates the
    // workspace boundary; the mock's staging write stands in for the agent's
    // export). Step 2 on the same turn? No — one step per prompt: step 1
    // sends the file, step 2 (retry never comes: fileSent satisfies the
    // gate) is not consumed. Then a SECOND message exercises the 429 and the
    // edit-reply scoping rejection against the new session's own quota? The
    // quota is per-session — so 429 + edit-reject happen on the FIRST
    // session's turn via a second invocation inside the same step, keeping
    // everything inside one message (the registry state stays observable).
    Deno.mkdirSync(join(h.workspacePath, "exports"), { recursive: true });
    // One step, three invocations, all inside the FIRST turn:
    //   1. send-file (relative path) — accepted by the REAL workspace-
    //      containment + quota gates, delivered through the recording adapter
    //   2. send-file again — the REAL per-session quota (MAX_FILE_SENDS=1)
    //      rejects 429; the script exits nonzero (client.ts exits 1 on !success)
    //   3. edit-reply against the FILE message id — rejected by the REAL
    //      lastSentMessageId scoping (file ids never live in that anchor), so
    //      the edit never reaches the platform (its payload stages with the
    //      step; the scoping gate rejects before the edit reaches the adapter)
    // fileSent satisfies the at-least-one gate, so no retry prompt steals the
    // turn; the summary gate is replySent-only, so the summary prompt never
    // runs (asserted via the RPC prompt count below).
    scriptSteps(h, [
      {
        stagePayload: [
          { file: `${h.workspacePath}/exports/report.txt`, content: "report bytes" },
          { file: "@STAGING_DIR/reply.md", content: "attempted edit against a file message" },
        ],
        invocations: [
          {
            script: scriptUrl("send-file"),
            argv: ["--session-id", "@SESSION_ID", "--file-paths", "exports/report.txt"],
            cwd: h.workspacePath,
          },
          {
            script: scriptUrl("send-file"),
            argv: ["--session-id", "@SESSION_ID", "--file-paths", "exports/report.txt"],
            cwd: h.workspacePath,
          },
          {
            script: scriptUrl("edit-reply"),
            argv: [
              "--session-id",
              "@SESSION_ID",
              "--message-id",
              "mock-file-1",
              "--message-file",
              "@STAGING_DIR/reply.md",
            ],
            cwd: h.workspacePath,
          },
        ],
      },
    ]);
    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    assert(h.sessionRegistry.registered[0], "session registered");

    assertEquals(result.success, true, "fileSent satisfies the at-least-one gate");
    assertEquals(result.fileSent, true);
    assertEquals(result.replySent, false);
    const rpc = readRpcEntries(h);
    const prompts = rpc.filter((e) => e.method === "session/prompt");
    assertEquals(prompts.length, 1, "file-only turn: no retry prompt, no summary prompt");

    // Exactly ONE platform file delivery; the rejected calls never reach the
    // platform adapter.
    assertEquals(h.ledger.count("sendFile"), 1);
    assertEquals(h.ledger.count("editMessage"), 0, "rejected edit never reaches the platform");
    const records = readSkillRecords(h);
    assertEquals(records.length, 3, "three invocations recorded");
    assertEquals(
      records[0].code,
      0,
      `first send-file failed: ${records[0].stderr} ${records[0].stdout}`,
    );
    assert(records[1].code !== 0, "second send-file rejected (exit nonzero on !success)");
    assertStringIncludes(records[1].stdout + records[1].stderr, "File send limit reached");
    assert(records[2].code !== 0, "edit-reply on a file id rejected before delivery");
    // File-only session: the REAL handler rejects edit-reply at the
    // no-reply-yet gate first (anchor scoping is the second gate and applies
    // once a reply exists — both keep the FILE message id unreachable).
    assertStringIncludes(records[2].stdout + records[2].stderr, "No reply has been sent yet");

    // Anchors: the delivered id lands in lastFileMessageId, NEVER in
    // lastSentMessageId. The registry deletes its entry when the orchestrator
    // finalizes, so assert against the observed object captured in-run.
    const live = h.sessionRegistry.subject();
    assert(live, "session observed during run");
    assertEquals(live.fileSent, true);
    assertEquals(live.fileSendCount, 2, "quota attempts counted even when rejected");
    assertEquals(live.lastFileMessageId, "mock-file-1");
    assertEquals(live.lastSentMessageId, undefined);
    assertEquals(live.replySent, false, "summary gate stays false for a file-only turn");
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 3.4 Reaction-only and reply+reaction turns.
// ---------------------------------------------------------------------------

async function runReactionOnly(): Promise<void> {
  const h = await createHarness({
    name: "reaction-only",
    agentType: "omp",
    shape: "pooled",
    conversationSummaryEnabled: true,
  });
  try {
    scriptSteps(h, [
      {
        invocations: [
          {
            script: scriptUrl("react-message"),
            argv: ["--session-id", "@SESSION_ID", "--emoji", "👍"],
            cwd: h.workspacePath,
          },
        ],
      },
    ]);
    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    const sessionId = h.sessionRegistry.registered[0];
    assert(sessionId, "session registered");

    // Reaction satisfies the gate against the workspace-channel dedupe map.
    assertEquals(result.success, true);
    assertEquals(result.reactionSent, true);
    assertEquals(result.replySent, false);
    assertEquals(h.ledger.count("addReaction"), 1);
    assertEquals(h.ledger.calls[0].payload[0], h.event.messageId, "reacts to the trigger message");
    const rpc = readRpcEntries(h);
    assertEquals(
      rpc.filter((e) => e.method === "session/prompt").length,
      1,
      "reaction-only: zero retry prompts",
    );
    // Summary gate triggers ONLY on a text reply: reaction never summarizes.
    assertEquals(
      rpc.filter((e) => e.method === "session/prompt").length,
      1,
      "reaction-only never triggers the summary prompt",
    );
    assert(
      h.skillRegistry.getReactionHandler().hasReactionSent(
        h.workspaceManager.getWorkspaceKeyFromEvent(h.event),
        h.event.channelId,
      ),
      "workspace-channel dedupe map marks the reaction",
    );
    assertEquals(h.ledger.count("sendReply"), 0);
  } finally {
    await teardownHarness(h);
  }
}

async function runReplyPlusReaction(): Promise<void> {
  const h = await createHarness({
    name: "reply-reaction",
    agentType: "omp",
    shape: "pooled",
    conversationSummaryEnabled: true,
  });
  try {
    scriptSteps(h, [
      {
        stagePayload: { file: "@STAGING_DIR/reply.md", content: "reply with reaction" },
        invocations: [
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
          },
          {
            script: scriptUrl("react-message"),
            argv: ["--session-id", "@SESSION_ID", "--emoji", "🎉"],
            cwd: h.workspacePath,
          },
        ],
      },
      // Absorb the summary turn (same connector/process) — delivery trace
      // must show the summary added ZERO platform actions.
      {},
    ]);
    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    assertEquals(result.success, true);
    assertEquals(result.replySent, true);
    assertEquals(result.reactionSent, true);

    // Exactly those two platform actions, nothing added by the retry path.
    assertEquals(h.ledger.count("sendReply"), 1);
    assertEquals(h.ledger.count("addReaction"), 1);
    assertEquals(h.ledger.calls.length, 2, `trace: ${h.ledger.trace().join(" | ")}`);
    const rpc = readRpcEntries(h);
    const prompts = rpc.filter((e) => e.method === "session/prompt").length;
    assertEquals(prompts, 2, "delivery turn + summary turn, never a retry");
    assertEquals(h.ledger.count("sendReply"), 1, "the summary turn added no delivery");
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 3.5 Auth failure composition + retry gate (both shapes): the scripted turn
// delivers with a CREDENTIAL THAT FAILS THE REAL SERVER'S JWT BINDING: the
// harness registers a FOREIGN session (same channel, own caller token) during
// setup, signs a genuine per-session JWT for it (bot-side issuer helper), and
// plants that token over the SUBJECT session's credential file mid-run — so
// the subject presents a validly-signed token whose `sub` names a different
// session: `sub_mismatch` 403 (signature/claim-scoped rejection, not
// "unknown session"). The rejected call must (a) be refused by the REAL
// server BEFORE handler execution — zero platform deliveries — and (b) leave
// the session unanswered, so the retry gate fires exactly once and the turn
// ends in failure. After the run, the harness replays the forged request
// itself against the foreign session id + the subject's caller-scoped token,
// pinning the rejection reason and confirming neither registry state nor the
// platform saw it.
// ---------------------------------------------------------------------------

async function runAuthFailureComposition(shape: "per-spawn" | "pooled"): Promise<void> {
  const h = await createHarness({ name: `authfail-${shape}`, agentType: "omp", shape });
  try {
    // Foreign session: same channel, its own caller token. Registered BEFORE
    // the run so its JWT is issuable, and never touched by the run itself.
    const workspace = await h.workspaceManager.getOrCreateWorkspace(h.event);
    const foreignId = h.sessionRegistry.register({
      platform: "discord",
      channelId: h.event.channelId,
      userId: h.event.userId,
      guildId: h.event.guildId,
      isDm: false,
      workspace,
      platformAdapter: h.ledger,
      triggerEvent: h.event,
    });
    // A genuine credential — but bound to the FOREIGN session. Kept OUTSIDE
    // jwtDir: in the per-spawn shape the mock's fixture resolver identifies
    // the subject from the single *.jwt file inside jwtDir, and planting a
    // second file there would collide with that resolution.
    const foreignJwt = await createSkillJwt(TEST_SKILL_SECRET, {
      sub: foreignId,
      channel: h.event.channelId,
      jti: h.sessionRegistry.get(foreignId)!.callerToken,
    });
    const forgedCredFile = join(h.stateDir, "forged-credential.jwt");
    Deno.writeTextFileSync(forgedCredFile, foreignJwt);

    // Step 1 (first prompt): the swap helper overwrites the SUBJECT's
    // credential file with the forged token (identity resolved from
    // bot-written material: active.json pointer in pooled shape, the unique
    // *.jwt stem in per-spawn shape), then the scripted reply attempt runs
    // with the real session id: client presents {real id, forged token} →
    // REAL server `sub_mismatch` 403, script exits nonzero.
    // Step 2: the retry turn is silent (nothing to attempt with a poisoned
    // credential) → turn ends unanswered → run fails after one retry.
    const helperPath = new URL("./skill-credential-swap.ts", import.meta.url).pathname;
    scriptSteps(h, [
      {
        stagePayload: { file: "@STAGING_DIR/reply.md", content: "forged delivery" },
        invocations: [
          {
            script: helperPath,
            argv: [],
            cwd: h.workspacePath,
            env: { FORGED_CRED_FILE: forgedCredFile },
          },
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
            env: shape === "per-spawn" ? { SESSION_ID: "@SESSION_ID" } : {},
          },
        ],
      },
      {},
    ]);

    const result = await h.orchestrator.processMessage(h.event, h.ledger);

    // Zero deliveries: the REAL server refuses before any handler runs.
    assertEquals(h.ledger.calls.length, 0, `trace: ${h.ledger.trace().join(" | ")}`);
    assertEquals(result.success, false);
    assertEquals(result.replySent, false);

    // Exactly one retry after the refused turn (composition-level gate).
    const rpc = readRpcEntries(h);
    assertEquals(
      rpc.filter((e) => e.method === "session/prompt").length,
      2,
      "refused turn + exactly one retry prompt (not native enforcement)",
    );

    // The refused call left the subject session untouched (never marked
    // replySent; the poisoned credential never delivered anything). Index 1:
    // registered[0] is the harness's own foreign session.
    const subject = h.sessionRegistry.subject(1);
    assert(subject, "subject session observed during run");
    assertEquals(subject.replySent, false, "refused call never marks replySent");
    assertEquals(subject.replyCount, 0);

    // Skill-record ledger: the script exited nonzero on the 403, and the
    // server-side reason is `sub_mismatch` — replaying the identical request
    // post-run proves the exact rejection signature. The subject is removed
    // from the registry at finalization, so replay against the LIVE foreign
    // session with ITS OWN valid credential first (control), then confirm the
    // forged pairing is what failed: the record's stderr carries the client-
    // surfaced rejection.
    const records = readSkillRecords(h);
    assertEquals(records.length, 2, "swap helper + refused send-reply recorded");
    assertEquals(records[0].code, 0, `swap helper failed: ${records[0].stderr}`);
    assert(records[1].code !== 0, "send-reply with mismatched credential exits nonzero");
    assertStringIncludes(records[1].stdout + records[1].stderr, "JWT verification failed");

    // Control: the forged token is genuinely valid FOR its own session —
    // replay the exact request against the foreign session id. The foreign
    // session remains registered (the run never touched it), so a valid
    // pairing succeeds: the subject's rejection is signature/claim scoped,
    // not endpoint breakage. (send-reply on the foreign session WILL deliver
    // once to the ledger — assert exactly that, it is the control's job.)
    const control = await fetch(`http://127.0.0.1:${h.port}/api/skill/send-reply`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${foreignJwt}` },
      body: JSON.stringify({ sessionId: foreignId, parameters: { message: "control delivery" } }),
    });
    assertEquals(control.status, 200, "forged token is valid for its OWN session");
    const controlBody = await control.json() as { success: boolean };
    assertEquals(controlBody.success, true);
    assertEquals(h.ledger.count("sendReply"), 1, "only the control delivery reached the platform");
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 4.1 Honest-posture + gate fit (row-21 posture consumed, never restated):
// the pinned NON-YOLO native approval launch posture survives the harness
// swap untouched; an unauthorized ACP-mediated skill request (a credential
// whose HMAC signature is simply wrong for the deployment secret) is denied
// by the REAL server with zero side effects — zero platform calls, registry
// never marked answered — and the composition carries NO readiness
// tuple/state/channel (neither fixture nor harness introduces one; the mock
// never loads the extension, so every allow-side tool observation in this
// file stays labeled synthetic in the ledger, and the 5.2 guard rejects any
// unregistered one). This proves composition only: the mock's absent-handler
// default is never claimed equal to native default-deny or callback cover-
// age, and fallback posture remains weaker than installed-handler
// default-deny.
// ---------------------------------------------------------------------------

async function runHonestPostureDenial(): Promise<void> {
  const h = await createHarness({ name: "posture-deny", agentType: "omp", shape: "pooled" });
  try {
    // A credential forged with the WRONG secret: verification fails at the
    // HMAC signature check — the strictest unauthorized vector, independent
    // of any claim binding.
    const wrongSecret = "fedcba9876543210fedcba9876543210fedcba98";
    const forgedJwt = await createSkillJwt(wrongSecret, {
      sub: "sess_forged_not_in_any_registry",
      channel: h.event.channelId,
      jti: "forged-jti-not-a-caller-token",
    });
    const forgedCredFile = join(h.stateDir, "wrong-secret.jwt");
    Deno.writeTextFileSync(forgedCredFile, forgedJwt);

    const helperPath = new URL("./skill-credential-swap.ts", import.meta.url).pathname;
    scriptSteps(h, [
      {
        stagePayload: { file: "@STAGING_DIR/reply.md", content: "should never deliver" },
        invocations: [
          {
            script: helperPath,
            argv: [],
            cwd: h.workspacePath,
            env: { FORGED_CRED_FILE: forgedCredFile },
          },
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
          },
        ],
      },
      {},
    ]);

    const result = await h.orchestrator.processMessage(h.event, h.ledger);

    // Denied end to end: zero platform side effects, run fails after the
    // single retry (the registry stayed unanswered).
    assertEquals(h.ledger.calls.length, 0, `trace: ${h.ledger.trace().join(" | ")}`);
    assertEquals(result.success, false);
    assertEquals(result.replySent, false);
    const subject = h.sessionRegistry.subject();
    assert(subject, "subject session observed during run");
    assertEquals(subject.replySent, false);

    const records = readSkillRecords(h);
    assertEquals(
      records.length,
      2,
      `records: ${JSON.stringify(records.map((r) => [r.script, r.code]))}`,
    );
    assert(records[1].code !== 0, "unauthorized call exits nonzero");
    assertStringIncludes(records[1].stdout + records[1].stderr, "JWT verification failed");

    // Pinned non-YOLO launch posture survived the swap (pre-swap snapshot):
    // restricted config, no yolo flag anywhere in argv.
    const preSwap = h.orchestrator.spawnedConfigs[0];
    assert(preSwap, "connector-composed config recorded");
    assert(
      preSwap.args.some((a) => a.includes("agent-config/omp/restricted.yml")),
      `restricted launch posture expected: ${preSwap.args.join(" ")}`,
    );
    assert(!preSwap.args.some((a) => a.includes("yolo")), "non-YOLO posture must be retained");
    // No readiness tuple/state/channel introduced: the factory-side config
    // carries no readiness handshake inputs of any kind.
    for (const key of Object.keys(preSwap.env ?? {})) {
      assert(!key.startsWith("MOCK_OMP"), `readiness/env leak: ${key}`);
    }
    // Skill-script completion is asserted from the RECORDED invocation ledger
    // (records above), never a poll — every observed spawn here completed
    // before its notification (the mock awaits each child to exit).
    // Evidence posture: mock ACP composition only — the mock never loads the native extension, so this denial is client/handler composition, never native default-deny evidence.
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 4.1 (spec scenario "Absent-handler ACP policy denial prevents unauthorized
// skill effects"): an unauthorized ACP-MEDIATED operation evaluated by client
// policy over the live stdio connection — the mock sends REAL fs/write_text_file,
// fs/read_text_file and session/request_permission requests, including a write
// to a SIBLING session's staging path; the REAL ChatbotClient gate denies each
// with its bounded denial (write error / read error / sibling-staging
// restriction / selected-reject outcome), zero skill invocations and zero
// platform deliveries follow, and the run fails after exactly one retry. The denial
// observability is the shipped retry-prompt diagnostic section (the same
// client rejection buffer the production retry consumes), so the scenario
// asserts the exact bounded reasons the client recorded. This is client-policy
// composition only: no readiness handshake of any kind, and never an
// attribution of the denial to native enforcement.
// ---------------------------------------------------------------------------

async function runUnauthorizedAcpMediatedDenial(shape: "per-spawn" | "pooled"): Promise<void> {
  const h = await createHarness({
    name: `acp-deny-${shape}`,
    agentType: "omp",
    shape,
  });
  try {
    const outsideWrite = `$TMPDIR/../escape.md`; // expands CLIENT-side → workspace-root write
    const outsideRead = `/etc/hostname`; // outside every session root
    // A pre-existing SIBLING session's staging payload: the subject's own
    // shared write rule (direct user-workspace writes outside THIS session's
    // staging root are restricted) must refuse the overwrite and leave the
    // sibling bytes untouched.
    const siblingStagingDir = join(h.workspacePath, "tmp", "sibling-session");
    const siblingStagingWrite = join(siblingStagingDir, "reply.md");
    const siblingAfterCopy = join(h.stateDir, "sibling-payload-after.md");
    Deno.mkdirSync(siblingStagingDir, { recursive: true });
    Deno.writeTextFileSync(siblingStagingWrite, "sibling payload untouched");
    scriptSteps(h, [
      {
        acpRequests: [
          {
            method: "fs/write_text_file",
            params: {
              sessionId: "@ACP_SESSION_ID",
              path: outsideWrite,
              content: "unauthorized workspace-root write",
            },
            expect: "error:rejected_workspace_write_restricted",
          },
          {
            method: "fs/read_text_file",
            params: { sessionId: "@ACP_SESSION_ID", path: outsideRead },
            expect: "error:rejected_filesystem_path_unavailable",
          },
          {
            method: "session/request_permission",
            params: {
              sessionId: "@ACP_SESSION_ID",
              toolCall: {
                toolCallId: "acp-deny-1",
                title: "unrecognized-native-tool",
                kind: "other",
              },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            },
            // A permission denial is a NORMAL selected-reject result on the
            // ACP wire, never a JSON-RPC error. Pinned to the exact selected
            // optionId, so an allow-path result (optionId "allow") can never
            // satisfy it — not just the word "reject" appearing anywhere.
            expect: 'result:"optionId":"reject"',
          },
          {
            method: "fs/write_text_file",
            params: {
              sessionId: "@ACP_SESSION_ID",
              path: siblingStagingWrite,
              content: "forged sibling write",
            },
            expect: "error:rejected_workspace_write_restricted",
          },
          {
            // Mid-run post-condition of the refused sibling write: the
            // workspace `.md` READ rule admits the file, so the REAL client
            // returns the sibling payload byte-identical — the refused WRITE
            // (another session's staging path) is what the shared isolation
            // rule denies. Observed here because session finalization removes
            // the workspace tmp tree.
            method: "fs/read_text_file",
            params: { sessionId: "@ACP_SESSION_ID", path: siblingStagingWrite },
            expect: "result:sibling payload untouched",
            copyResultTo: siblingAfterCopy,
          },
        ],
      },
      {}, // retry turn: silent again → run fails after the single retry
    ]);

    const result = await h.orchestrator.processMessage(h.event, h.ledger);

    // Denied end to end: zero skill invocations, zero platform deliveries.
    assertEquals(result.success, false);
    assertEquals(result.replySent, false);
    assertEquals(readSkillRecords(h).length, 0, "zero skill-script invocations");
    assertEquals(h.ledger.calls.length, 0, `trace: ${h.ledger.trace().join(" | ")}`);

    // The bounded client-policy denials are exactly the four expected reasons
    // (read straight off the REAL client's rejection buffer — the same one the
    // shipped retry prompt consumes; per-spawn shape reads the disconnect-time
    // snapshot since the run's finalization already nulled the client), and the
    // pinned workspace escape file was never created.
    assertEquals(h.orchestrator.observedPermissionRejections(), [
      "rejected_workspace_write_restricted",
      "rejected_filesystem_path_unavailable",
      "rejected_unknown",
      "rejected_workspace_write_restricted",
    ]);
    let escaped = true;
    try {
      await Deno.stat(join(h.workspacePath, "escape.md"));
    } catch {
      escaped = false;
    }
    assert(!escaped, "restricted client policy must not create the escaped file");
    // The sibling's staged payload is byte-identical: the refusal was a
    // refusal, never a silent overwrite of another session's staging file.
    assertEquals(
      Deno.readTextFileSync(siblingAfterCopy),
      "sibling payload untouched",
      "a sibling session's staging payload is never written by this session",
    );

    // Exactly one retry, and it carries the shipped permission-rejection
    // diagnostic section naming every bounded denial (literal-first posture is
    // the row's shared contract; the section proves the client evaluated the
    // operations it refused).
    const rpc = readRpcEntries(h);
    assertEquals(rpc.filter((e) => e.method === "session/prompt").length, 2, "one retry only");
    assertEquals(h.orchestrator.promptTexts.length, 2);
    const retryText = h.orchestrator.promptTexts[1] ?? "";
    assertStringIncludes(retryText, "Recent permission rejections in this session");
    assertStringIncludes(retryText, "rejected_workspace_write_restricted");
    assertStringIncludes(retryText, "rejected_filesystem_path_unavailable");
    assertStringIncludes(retryText, "rejected_unknown");

    // No readiness handshake anywhere in the composition (factory-posture
    // audit like 4.1): no readiness/namespace env reached the spawn.
    const preSwap = h.orchestrator.spawnedConfigs[0];
    assert(preSwap, "connector-composed config recorded");
    for (const key of Object.keys(preSwap.env ?? {})) {
      assert(!key.startsWith("MOCK_OMP"), `readiness/env leak: ${key}`);
    }
    // Evidence posture: mock ACP composition only — these agent-initiated ACP requests exercise the REAL ChatbotClient gate, but the mock never loads the native extension, so the denials are client-policy composition, never native enforcement evidence.
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 3.6 OpenCode regression flow: per-spawn message flow through the harness —
// spawn env/command byte-compared against a independently composed shipped
// createAgentConfig; legacy token-path payload still delivers (row-16 pinned
// compat, end to end); zero readiness/extension involvement.
// ---------------------------------------------------------------------------

async function runOpenCodeRegression(): Promise<void> {
  const h = await createHarness({ name: "opencode", agentType: "opencode", shape: "per-spawn" });
  try {
    // Legacy token-path payload: what bash hands the script when an older
    // OpenCode prompt still instructs `$TMPDIR/$SESSION_ID/x.md`. The pin is
    // exercised on BOTH consumers of the legacy contract:
    //  (a) the shipped CLIENT resolver — the mock sends a REAL
    //      fs/read_text_file whose path is the LITERAL `$TMPDIR/$SESSION_ID/
    //      reply.md` token string (the mock expands only its own `@`-tokens,
    //      never `$` ones), so only ChatbotClient's own
    //      `resolveSessionPath()` legacy expansion can answer it: the
    //      expected content coming back PROVES the client expanded the raw
    //      tokens into the canonical staging path and authorized the read;
    //  (b) the spawn-argv channel — the fixture stages at the canonical path
    //      and passes it as the already-expanded legacy argv value (what a
    //      real shell hands the script), which must resolve/read/deliver
    //      identically inside the canonical staging root (row-16 pin).
    scriptSteps(h, [
      {
        stagePayload: { file: "@STAGING_DIR/reply.md", content: "legacy token-path delivery" },
        acpRequests: [
          {
            method: "fs/read_text_file",
            // Client-resolver pin: a future tightening of the ALLOWED read
            // posture lands HERE as a refused delivery turn — that coupling
            // is intentional, not an OpenCode-launch regression.
            params: {
              sessionId: "@ACP_SESSION_ID",
              path: "$TMPDIR/$SESSION_ID/reply.md",
            },
            expect: "result:legacy token-path delivery",
          },
        ],
        invocations: [
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
            env: { TMPDIR: `${h.workspacePath}/tmp`, SESSION_ID: "@SESSION_ID" },
          },
        ],
      },
    ]);

    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    assertEquals(result.success, true);
    assertEquals(h.ledger.count("sendReply"), 1);
    assertEquals(h.ledger.calls[0].payload[0], "legacy token-path delivery");

    const sessionId = h.sessionRegistry.registered[0];
    const records = readSkillRecords(h);
    assertEquals(records.length, 1);
    assertEquals(records[0].code, 0, records[0].stderr);
    assertLiteralArgv(records[0], sessionId);

    // Spawn-posture byte-identity (row-16 regression pin): the config the
    // orchestrator composed for its connector — BEFORE the harness swap —
    // must equal an independently composed shipped createAgentConfig for the
    // same inputs, field for field. The mock swap only replaces command/args
    // and adds MOCK_* env; the shipped OpenCode posture itself is untouched
    // by any OMP namespace/readiness involvement.
    const shipped = createAgentConfig(
      "opencode",
      h.workspacePath,
      h.config,
      false,
      join(h.tempDir, "agent-workspace"),
      sessionId,
      undefined,
    );
    const preSwap = h.orchestrator.spawnedConfigs[0];
    assert(preSwap, "connector-composed config recorded");
    assertEquals(preSwap.command, "opencode", "factory composes the shipped binary");
    assertEquals(preSwap.args, shipped.args);
    assertEquals(preSwap.cwd, shipped.cwd);
    assertEquals(preSwap.env, shipped.env);
    // Shipped OpenCode per-spawn identity env: authoritative SESSION_ID,
    // no shared-process marker, no readiness/namespace env of any kind.
    assertEquals(preSwap.env?.["SESSION_ID"], sessionId);
    assert(!("SKILL_SHARED_PROCESS" in (preSwap.env ?? {})), "per-spawn never carries the marker");
    for (const key of Object.keys(preSwap.env ?? {})) {
      assert(!key.startsWith("MOCK_OMP"), `OMP readiness/env leak into OpenCode: ${key}`);
    }
    // The retry guidance never depends on shell tokens (literal-first pin).
    // (The harness disables the conversation summary by default; the OpenCode
    // shape runs with it off, so the delivery turn is the ONLY prompt.)
    const retryFreeRpc = readRpcEntries(h);
    assertEquals(
      retryFreeRpc.filter((e) => e.method === "session/prompt").length,
      1,
      "delivery turn only, zero retries",
    );
    const promptText = h.orchestrator.promptTexts[0] ?? "";
    assertStringIncludes(promptText, `--session-id ${sessionId}`);
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// 4.1/4.2 (`align-omp-skill-trust-to-shared-root`): ONE runtime-installed
// external skill published into the deployment-RESOLVED skill root is usable by
// BOTH agent types from that single root, on the shared tree's own writable
// posture (directories `0775`, files `0664`), while the retained
// identity/containment denials still hold. Every scripted ACP expectation is
// consumed by the REAL ChatbotClient over the live stdio connection, and the
// mock REFUSES its prompt response on any mismatch — so a successful run is the
// aggregate proof. A live `send-reply` invocation on either agent remains
// user-owned runtime acceptance.
// ---------------------------------------------------------------------------

async function runSharedRootUsability(agentType: "omp" | "opencode"): Promise<void> {
  const h = await createHarness({
    name: `shared-root-${agentType}`,
    agentType,
    shape: "per-spawn",
    installExternalSkill: true,
  });
  const skillsRoot = h.skillsRoot;
  assert(skillsRoot !== null, "the shared-root fixture installs its resolved root");
  try {
    const instruction = join(skillsRoot, "external-skill", "SKILL.md");
    const entrypoint = join(skillsRoot, "external-skill", "scripts", "external-skill.ts");
    const options = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ];
    const acpRequests: AcpRequest[] = [
      {
        // The installed skill's instruction, read for the SAME root. OMP admits
        // it through the trusted-skills role over the resolved writable root;
        // OpenCode has no such role, so the read stays denied — the shared root
        // never widens another agent type's workspace reads.
        method: "fs/read_text_file",
        params: { sessionId: "@ACP_SESSION_ID", path: instruction },
        expect: agentType === "omp" ? "ok" : "error:rejected_filesystem_path_unavailable",
      },
      {
        // The enumerated script from that root is approved…
        method: "session/request_permission",
        params: {
          sessionId: "@ACP_SESSION_ID",
          toolCall: {
            toolCallId: "shared-root-enumerated",
            title: "Execute shell command",
            kind: "execute",
            rawInput: { commands: [`deno run ${entrypoint} --session-id @SESSION_ID`] },
          },
          options,
        },
        expect: 'result:"optionId":"allow"',
      },
      {
        // …while a sibling-prefix planted root at the same suffix stays
        // rejected: the retired suffix matcher's bypass is not re-introduced.
        method: "session/request_permission",
        params: {
          sessionId: "@ACP_SESSION_ID",
          toolCall: {
            toolCallId: "shared-root-planted",
            title: "Execute shell command",
            kind: "execute",
            rawInput: {
              commands: [`deno run ${skillsRoot}-evil/external-skill/scripts/external-skill.ts`],
            },
          },
          options,
        },
        expect: 'result:"optionId":"reject"',
      },
    ];
    scriptSteps(h, [
      {
        stagePayload: { file: "@STAGING_DIR/reply.md", content: "shared-root reply" },
        invocations: [
          {
            script: scriptUrl("send-reply"),
            argv: ["--session-id", "@SESSION_ID", "--message-file", "@STAGING_DIR/reply.md"],
            cwd: h.workspacePath,
            env: { SESSION_ID: "@SESSION_ID" },
          },
        ],
        acpRequests,
      },
      {},
    ]);
    const result = await h.orchestrator.processMessage(h.event, h.ledger);
    assertEquals(result.success, true);
    // The ONE resolved root is the literal this agent type was delivered.
    assertStringIncludes(h.orchestrator.promptTexts[0] ?? "", skillsRoot);
    // The enumerated external script really ran through the real skill path.
    const records = readSkillRecords(h);
    assert(records.length >= 1, `expected the external script to run: ${JSON.stringify(records)}`);
  } finally {
    await teardownHarness(h);
  }
}

// ---------------------------------------------------------------------------
// Evidence posture: this suite's fixtures compose the CLIENT side only and the
// mock never loads the native extension; every allow path it depends on (mock
// fixture staging standing in for the agent's write) is mock ACP composition,
// never native evidence.
//
// Scenario registrations (subprocess tier).
// ---------------------------------------------------------------------------

const scenarios: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: "3.1 happy-path handoff (pooled shape)", fn: () => runHappyPath("pooled") },
  { name: "3.1 happy-path handoff (per-spawn shape)", fn: () => runHappyPath("per-spawn") },
  {
    name: "3.2 retry once, literal-first, retried delivery lands (pooled)",
    fn: () => runRetryOnce("pooled", true),
  },
  {
    name: "3.2 retry once, literal-first, retried delivery lands (per-spawn)",
    fn: () => runRetryOnce("per-spawn", true),
  },
  {
    name: "3.2 silent retry ends failure with zero deliveries (pooled)",
    fn: () => runRetryOnce("pooled", false),
  },
  {
    name: "3.2 silent retry ends failure with zero deliveries (per-spawn)",
    fn: () => runRetryOnce("per-spawn", false),
  },
  { name: "3.3 file-only turn: gate, 429, anchors, edit-reject, summary skip", fn: runFileOnly },
  { name: "3.4 reaction-only turn satisfies the gate", fn: runReactionOnly },
  { name: "3.4 reply+reaction turn produces exactly two actions", fn: runReplyPlusReaction },
  {
    name: "3.5 auth failure composes with retry gate (pooled)",
    fn: () => runAuthFailureComposition("pooled"),
  },
  {
    name: "3.5 auth failure composes with retry gate (per-spawn)",
    fn: () => runAuthFailureComposition("per-spawn"),
  },
  {
    name: "4.1 honest posture: pinned non-YOLO launch + unauthorized denial zero side effects",
    fn: runHonestPostureDenial,
  },
  {
    name: "4.1 ACP-mediated unauthorized write/read/permission denied by client policy (pooled)",
    fn: () => runUnauthorizedAcpMediatedDenial("pooled"),
  },
  {
    name: "4.1 ACP-mediated unauthorized write/read/permission denied by client policy (per-spawn)",
    fn: () => runUnauthorizedAcpMediatedDenial("per-spawn"),
  },
  {
    name: "3.6 OpenCode per-spawn regression byte-identity + legacy payload",
    fn: runOpenCodeRegression,
  },
  {
    name: "4.1/4.2 one installed external skill over the shared resolved root (omp)",
    fn: () => runSharedRootUsability("omp"),
  },
  {
    name: "4.1/4.2 one installed external skill over the shared resolved root (opencode)",
    fn: () => runSharedRootUsability("opencode"),
  },
];

for (const scenario of scenarios) {
  Deno.test({
    name: `omp-skill-handoff - ${scenario.name}`,
    ignore: !CAN_RUN_SUBPROCESS,
    async fn() {
      await scenario.fn();
    },
  });
}
