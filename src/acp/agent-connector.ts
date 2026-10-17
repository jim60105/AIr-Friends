// src/acp/agent-connector.ts

import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient, type SessionGateContext } from "./client.ts";
import { buildSkillAutoApproveList, type SkillAutoApproveList } from "./skill-inventory.ts";
import {
  type AgentCapabilities,
  type AgentConnectorOptions,
  type AgentType,
  isSupportedAgentType,
  type MCPServerConfig,
} from "./types.ts";
import { EMAIL_INTENT_AGENT_NAME, EMAIL_INTENT_PROFILE } from "./agent-factory.ts";
import {
  OMP_INTENT_PROFILE_FLAG,
  OMP_INTENT_PROFILE_FLAG_VALUE,
} from "./omp/extension/native-registration.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import {
  deriveActualRecoveryTarget,
  mapOwnershipVerdictToReason,
  RecoveryOwnershipError,
  type SessionRecoveryOwnership,
  verifyRecoveryOwnership,
} from "./recovery-ownership.ts";
import type { TrustedSkillsSource } from "./filesystem-policy.ts";
import type { OmpNativeStateProvenance } from "./filesystem-roots.ts";
import { resolveOmpSessionArtifacts } from "./omp/session-artifacts.ts";
import {
  collectOptionValues,
  findOptionByCategory,
  formatAdvertisedValuesPreview,
  KNOWN_REASONING_EFFORT_TOKENS,
  MODEL_CATEGORY,
  resolveModelSelection,
  resolveReasoningValue,
  THOUGHT_LEVEL_CATEGORY,
} from "./session-config.ts";

/**
 * Timeout in milliseconds for graceful agent process shutdown
 * Following GitHub's ACP best practices
 */
const DISCONNECT_TIMEOUT_MS = 2000;

/**
 * Default path to dumb-init binary for wrapping agent subprocesses.
 * dumb-init ensures proper signal forwarding and zombie process reaping,
 * preventing memory leaks from orphaned child processes.
 */
const DUMB_INIT_PATH = "dumb-init";

/**
 * Default idle timeout in milliseconds (5 minutes)
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default interval in milliseconds between idle checks (30 seconds)
 */
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Default timeout in milliseconds to wait for the ACP handshake
 * (`connection.initialize()`) to complete during `connect()` (30 seconds).
 * Configurable via `agent.connectTimeoutMs` / `AGENT_CONNECT_TIMEOUT_MS`.
 */
const CONNECT_TIMEOUT_MS = 30 * 1000;

/** Fraction of connectTimeoutMs elapsed before an early advance-warning WARN is logged. */
const CONNECT_TIMEOUT_WARN_FRACTION = 0.8;

/**
 * Gate-context restore failure (restore-mode-owned-acp-sessions): the recovered
 * session's own gate context could not be established — either the caller-supplied
 * context disagrees with the recovery cwd, or no context exists at all for a
 * recovery that supplied a recovery context. Fail closed for THIS session only;
 * other sessions' cached contexts stay registered and replayed unchanged.
 * Bounded single-line message: session id + cwd detail, no secrets.
 */
export class GateContextRestoreError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, detail: string) {
    super(`Gate-context restore failed for session ${sessionId}: ${detail}`);
    this.name = "GateContextRestoreError";
    this.sessionId = sessionId;
  }
}

/**
 * The named post-restore recovery hook rejected. Wraps the hook's own error so the
 * orchestrator can classify it as `post_restore_hook_failed` and fail ONLY this
 * session. The hook exists solely as the post-restore attach point — it asserts no
 * readiness, gates no prompt, and promises no later handshake.
 */
export class RecoveryHookError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, cause: unknown) {
    super(
      `Post-restore recovery hook failed for session ${sessionId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "RecoveryHookError";
    this.sessionId = sessionId;
  }
}

/**
 * Bounded machine-readable causes of an intent-profile identity failure. Each
 * names a contract that was NOT observed positively; none of them is a
 * permission decision.
 */
export type EmailIntentProfileMismatchReason =
  /** The factory-produced launch did not carry the intent-profile identity at all. */
  | "launch_profile"
  /** The intent profile was not paired with the intent capture seam (or vice versa). */
  | "capture_agreement"
  /** The host-only OMP launch marker was missing or carried a foreign value. */
  | "omp_launch_marker"
  /** The OpenCode session advertised no session-mode selector at all. */
  | "mode_selector_missing"
  /** The OpenCode session's active mode was not the authored intent agent. */
  | "mode_mismatch"
  /** The OpenCode session advertised a selectable mode other than the intent agent. */
  | "mode_selector_roster"
  /** The requested model selection is not offered by the advertised catalog. */
  | "model_selection_rejected";

/**
 * An internal email-intent profile launch did not prove its own identity, or
 * the session it created could not be pinned to the requested model selection.
 *
 * Both cases are fail-closed BEFORE any prompt is sent: the interpretation
 * runtime maps this error to an `unavailable` result instead of letting a
 * session that may not be the authored deny-all profile interpret authored
 * text. The message carries bounded diagnostics (session id, reason, counts)
 * and never a path, a prompt or model output.
 */
export class EmailIntentProfileMismatchError extends Error {
  readonly sessionId: string;
  readonly reason: EmailIntentProfileMismatchReason;

  constructor(sessionId: string, reason: EmailIntentProfileMismatchReason, detail?: string) {
    super(
      `Email intent profile identity check failed for session ${sessionId} (${reason})` +
        (detail === undefined ? "" : `: ${detail}`),
    );
    this.name = "EmailIntentProfileMismatchError";
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/**
 * Outcome of a reasoning-effort application attempt.
 * - `applied`: the value was sent to the agent.
 * - `unsupported`: the agent advertised no `thought_level` config option.
 * - `skipped`: requested value was empty/`"default"` (do not configure).
 * - `skipped_unavailable`: a known value was not among the option's advertised values.
 * - `failed`: the agent rejected the value or another error occurred (caught, not thrown).
 */
export type ReasoningEffortOutcome =
  | "applied"
  | "unsupported"
  | "skipped"
  | "skipped_unavailable"
  | "failed";

/**
 * Export KNOWN_REASONING_EFFORT_TOKENS from session-config for backward-compatibility.
 */
export { KNOWN_REASONING_EFFORT_TOKENS };

/**
 * Wrapper-process evidence a connector reports for producer teardown.
 * `generations` is the number of wrapper processes spawned in this connector's
 * lifetime (0 when none ever started); `pid` is the current live wrapper, if
 * any. See {@link AgentConnector.getProcessEvidence}.
 */
export interface AgentProcessEvidence {
  generations: number;
  pid: number | undefined;
  /**
   * Whether the LAST `disconnect()` POSITIVELY observed the wrapper it had
   * spawned exiting within `DISCONNECT_TIMEOUT_MS`. `undefined` means no
   * disconnect has run since the last spawn, so termination is unproven.
   *
   * A consumer that must decide whether files a live producer could still be
   * reading are safe to reclaim may treat `terminationConfirmed === true` (or
   * `generations === 0`, i.e. no producer ever started) as evidence of
   * quiescence. Anything else — including a wrapper that required SIGKILL
   * after the grace period, and a spawn whose `disconnect()` no longer exposes
   * a PID — is UNCERTAIN teardown and must keep its workspace protection.
   */
  terminationConfirmed?: boolean;
}

/**
 * AgentConnector manages the lifecycle of ACP Agent connections
 * Handles spawning, connecting, and communicating with external ACP Agents
 */
export class AgentConnector {
  private connection: acp.ClientSideConnection | null = null;
  private process: Deno.ChildProcess | null = null;
  private client: ChatbotClient | null = null;
  /**
   * Positive observation of the LAST spawned wrapper's exit, recorded by
   * `disconnect()` (see `AgentProcessEvidence.terminationConfirmed`). Reset on
   * every spawn so a stale confirmation can never vouch for a new generation.
   */
  private terminationConfirmed: boolean | undefined = undefined;
  private options: AgentConnectorOptions;
  private capabilities: AgentCapabilities | null = null;
  /**
   * Per-ACP-session config-options cache (shared-process mode).
   * In shared mode one connector serves many ACP sessions on the same stdio
   * connection, so the mutable state (config options, current model ID, idle
   * monitor) is indexed by ACP session ID — a later session's setup calls cannot
   * clobber the in-flight session's state.
   */
  private sessionConfigOptions: Map<string, acp.SessionConfigOption[]> = new Map();
  /** Per-ACP-session model ID (set by `setSessionModel`); included in warning context */
  private sessionModelIds: Map<string, string> = new Map();
  /**
   * Per-ACP-session gate contexts (shared-process mode). Cached here so a
   * reconnect (which builds a fresh ChatbotClient) can replay them onto the
   * new client — session-scoped cwd, owning skill session id, and permission
   * flags must survive crash recovery.
   */
  private sessionGateContexts: Map<string, SessionGateContext> = new Map();
  private currentIdleMonitorIntervalId: ReturnType<typeof setInterval> | null = null;
  /**
   * Rejects unconditionally whenever the current subprocess exits, for any reason
   * (crash or a deliberate `disconnect()`). Raced against every outbound ACP call via
   * `raceAgainstCrash()` so a dead subprocess never leaves a call pending forever.
   * Rebuilt fresh on each `connect()`; a no-op `.catch()` is attached at creation so it
   * never surfaces as an unhandled rejection when nothing is currently racing against it.
   */
  private crashSignal: Promise<never> | null = null;
  /**
   * Set at the start of `disconnect()`, reset at the start of `connect()`.
   * Affects ONLY the log severity chosen in `monitorProcessExit()` — it must never gate
   * whether `crashSignal` rejects, since a doom-loop `disconnect()` call while a prompt is
   * still in flight must still unstick that prompt.
   */
  private intentionalShutdown = false;
  /**
   * How many wrapper processes this connector has spawned. Teardown evidence:
   * a discarded generation's tool children were never drained, so cleanup must
   * treat it as unconfirmed producer teardown (see {@link getProcessEvidence}).
   */
  private spawnGeneration = 0;

  constructor(options: AgentConnectorOptions) {
    this.options = options;
  }

  /**
   * Connect to an ACP Agent by spawning a subprocess
   */
  async connect(): Promise<void> {
    const { agentConfig, clientConfig, skillRegistry, logger } = this.options;

    // INTERNAL email-intent profile (`email-intent-runtime`): the profile
    // provisions NO skill tree, so this launch has no trusted root to observe
    // and no script inventory to build — an EMPTY one is the whole contract,
    // because an interpreter session must never reach a skill surface. The two
    // intent markers must agree in BOTH directions before anything is spawned:
    // an intent-profile config paired with an ordinary client would otherwise
    // spawn successfully and then use the ordinary logging and permission
    // shortcuts, and an ordinary config carrying an intent capture would get
    // the deny-all callbacks without the private launch shape.
    const intentLaunch = agentConfig.executionProfile === EMAIL_INTENT_PROFILE;
    const intentCapture = clientConfig.intentCapture !== undefined;
    if (intentLaunch || intentCapture) {
      if (intentLaunch !== intentCapture) {
        throw new EmailIntentProfileMismatchError(
          "(pre-spawn)",
          "capture_agreement",
          intentLaunch
            ? "the intent profile launch carries no intent capture seam"
            : "an intent capture seam was supplied for a non-intent launch",
        );
      }
      if (this.options.agentType === "omp") {
        this.assertOmpIntentLaunchMarker(agentConfig);
      }
    }

    const autoApproveList: SkillAutoApproveList = intentLaunch
      ? {
        // Never consulted for a grant: the client's intent branches refuse every
        // permission and filesystem callback before any inventory decision, and
        // both grant sets below are empty. The spelling is only the anchor the
        // inventory type requires.
        root: { root: agentConfig.cwd, canonicalPath: agentConfig.cwd },
        scripts: [],
        commandPrefixes: new Set<string>(),
      }
      : this.buildOrdinaryInventory(clientConfig);

    (logger as Logger).info("Spawning ACP agent via dumb-init", {
      command: agentConfig.command,
      args: agentConfig.args,
      cwd: agentConfig.cwd,
    });

    // Spawn the Agent subprocess wrapped with dumb-init for proper signal
    // forwarding and child process reaping (prevents memory leaks from orphaned processes).
    //
    // Security (F1): `clearEnv: true` ensures the child receives ONLY the explicitly-built
    // allowlisted `agentConfig.env` and inherits NO variables from the parent bot process.
    // Without this, `Deno.Command` MERGES `env` into the inherited parent environment, which
    // would leak every secret the bot holds (bot tokens, provider keys, git credentials) to
    // the agent subprocess — defeating the SandboxManager env allowlist entirely.
    const command = new Deno.Command(DUMB_INIT_PATH, {
      args: ["--", agentConfig.command, ...agentConfig.args],
      cwd: agentConfig.cwd,
      clearEnv: true,
      env: agentConfig.env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped", // Capture stderr to log error messages
    });

    this.process = command.spawn();
    this.spawnGeneration++;
    // A new generation has no termination evidence yet.
    this.terminationConfirmed = undefined;

    // Reset shutdown-intent tracking and build a fresh crash signal tied to this
    // subprocess (not any stale signal from a previously disconnected one).
    this.intentionalShutdown = false;
    this.crashSignal = this.buildCrashSignal();

    // Monitor for unexpected process exit
    this.monitorProcessExit(logger as Logger);

    // Pipe stderr to logger (doesn't block the process). An intent launch's
    // stream is DRAINED but never logged: engine diagnostics can quote the
    // authored text or model output, and no content of an interpretation may
    // reach a log. The stream is still read to completion so the child never
    // blocks on a full pipe.
    this.readStderr(this.process.stderr, logger as Logger, intentLaunch).catch((error) => {
      (logger as Logger).error("Failed to read stderr", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Create streams for JSON-RPC communication
    // ACP uses: output (to agent) = WritableStream, input (from agent) = ReadableStream
    const output = this.process.stdin; // WritableStream - we send messages to agent
    const input = this.process.stdout; // ReadableStream - we receive messages from agent

    // Create the Client implementation
    // (inventory built pre-spawn above; the client receives it as the
    // mandatory fourth argument — there is no implicit scan default)
    this.client = new ChatbotClient(
      skillRegistry as SkillRegistry,
      logger as Logger,
      // The configured connector agent type is supplied AFTER the spread so a
      // duplicate `clientConfig.agentType` field can never override it
      // (`normalize-omp-destructive-acp-ingress`): request/config metadata must
      // not select the destructive-ingress decoder.
      { ...clientConfig, agentType: this.options.agentType },
      autoApproveList,
    );

    // Keep cached session config options fresh from agent-initiated updates.
    // The config_option_update notification carries the ACP session id, so the
    // cache is kept per-ACP-session (shared-process mode).
    this.client.setConfigOptionsListener((sessionId, configOptions) => {
      this.refreshSessionConfigOptions(sessionId, configOptions);
    });

    // Replay cached per-session gate contexts onto the fresh client (reconnect).
    this.replaySessionGateContexts();

    // Create ClientSideConnection with proper stream order
    const stream = acp.ndJsonStream(output, input);
    this.connection = new acp.ClientSideConnection(
      (_agent) => this.client!,
      stream,
    );

    // Initialize the connection.
    // Raced against the crash signal (rejects if the subprocess exits before the
    // handshake completes) AND a bounded timeout (rejects if the subprocess is alive
    // but never completes the handshake — a hang the crash signal cannot catch).
    try {
      const initResult = await this.raceWithConnectTimeout(
        this.raceAgainstCrash(this.connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
            terminal: false,
          },
        })),
        logger as Logger,
      );
      // Store agent capabilities for transport validation
      this.capabilities = initResult.agentCapabilities ?? {};

      (logger as Logger).info("Connected to ACP agent", {
        protocolVersion: initResult.protocolVersion,
        agentCapabilities: this.capabilities,
      });

      (logger as Logger).info("Agent prompt capabilities", {
        image: this.capabilities?.promptCapabilities?.image ?? false,
        audio: this.capabilities?.promptCapabilities?.audio ?? false,
      });

      (logger as Logger).info("Agent MCP transport capabilities", {
        http: this.capabilities?.mcpCapabilities?.http ?? false,
        sse: this.capabilities?.mcpCapabilities?.sse ?? false,
      });
    } catch (error) {
      // Clean up on initialization failure
      await this.disconnect();
      throw error;
    }
  }

  /**
   * The active select value of one config option, or `undefined` when the
   * option is a group (no single active value). Narrowed rather than asserted,
   * because the ACP `SessionConfigOption` union carries `currentValue` on its
   * select arm only.
   */
  private static currentOptionValue(
    option: acp.SessionConfigOption | undefined,
  ): string | undefined {
    if (option === undefined) return undefined;
    if (!("currentValue" in option)) return undefined;
    return typeof option.currentValue === "string" ? option.currentValue : undefined;
  }

  /**
   * Build the ordinary root-exact auto-approve inventory. Unchanged behavior
   * for every non-intent launch: a launch without the mandatory trusted-root
   * observation fails here, with zero processes spawned.
   *
   * MANDATORY root-exact inventory (`unify-skill-root-and-inventory` D2/D4,
   * generalizing `unify-omp-skill-root-resolution` D1/D3, post-implementation
   * review B6): built BEFORE the subprocess exists. The trusted root is the
   * canonical observation the factory resolved for the deployment — the SAME
   * one both agent types resolve — and the inventory carries no agent-type
   * selector. A launch without it — or whose root cannot be enumerated —
   * fails connect() explicitly with ZERO processes spawned, and no
   * observation between spawn and the initialization try/catch can orphan a
   * child. The connector NEVER re-discovers a root (no HOME, no
   * `Deno.cwd()/skills`, no alternate observation).
   */
  private buildOrdinaryInventory(
    clientConfig: AgentConnectorOptions["clientConfig"],
  ): SkillAutoApproveList {
    const skillsRoot = this.options.agentConfig.skillsRoot;
    if (skillsRoot === undefined) {
      throw new Error(
        `AgentConfig for agent type "${this.options.agentType}" is missing the mandatory ` +
          "selected-agent skills-root observation — preparation fails explicitly " +
          "instead of discovering another root",
      );
    }
    return buildSkillAutoApproveList({
      rootObservation: skillsRoot,
      configuredSkills: clientConfig.autoApproveSkills,
    });
  }

  /**
   * Require the host-only OMP intent marker on an intent-profile launch, with
   * its EXACT value. The marker is the OMP arm's launch identity: the pinned
   * extension classifies an unobservable marker as an ORDINARY launch, which
   * would select the restricted capability callback instead of the deny-all
   * one. The connector spawns `agentConfig.env` verbatim under `clearEnv`
   * semantics, so a marker present here is a marker the child observes.
   */
  private assertOmpIntentLaunchMarker(agentConfig: AgentConnectorOptions["agentConfig"]): void {
    const observed = agentConfig.env?.[OMP_INTENT_PROFILE_FLAG];
    if (observed !== OMP_INTENT_PROFILE_FLAG_VALUE) {
      throw new EmailIntentProfileMismatchError(
        "(pre-spawn)",
        "omp_launch_marker",
        `the launch environment carries ${JSON.stringify(observed)} instead of ` +
          `${JSON.stringify(OMP_INTENT_PROFILE_FLAG_VALUE)} for "${OMP_INTENT_PROFILE_FLAG}"`,
      );
    }
  }

  /**
   * Prove the intent session's own identity before it can interpret anything.
   * OpenCode advertises the profile's authored agent as its only session mode,
   * so the active mode AND the advertised roster are both pinned here to that
   * single value: a missing selector, a different active mode, an empty roster
   * and a roster offering anything else are all mismatches rather than silent
   * passes. OMP owns no ACP session-mode override (the launch's native settings
   * document and the marker-verified extension are the identity), so it has
   * nothing to assert beyond the pre-spawn marker check.
   */
  private assertIntentSessionProfile(sessionId: string): void {
    if (this.options.agentType !== "opencode") return;

    const modeOption = this.intentModeOption(sessionId);
    if (modeOption === undefined) {
      throw new EmailIntentProfileMismatchError(sessionId, "mode_selector_missing");
    }
    const current = AgentConnector.currentOptionValue(modeOption);
    if (current !== EMAIL_INTENT_AGENT_NAME) {
      throw new EmailIntentProfileMismatchError(
        sessionId,
        "mode_mismatch",
        `the active session mode is ${JSON.stringify(current)}`,
      );
    }
    const selectable = collectOptionValues(modeOption);
    if (selectable.length !== 1 || selectable[0] !== EMAIL_INTENT_AGENT_NAME) {
      throw new EmailIntentProfileMismatchError(
        sessionId,
        "mode_selector_roster",
        `the session advertises ${selectable.length} selectable mode` +
          `${selectable.length === 1 ? "" : "s"}`,
      );
    }
  }

  /** The session-mode config option of one intent session, or `undefined`. */
  private intentModeOption(
    sessionId: string,
  ): acp.SessionConfigOption | undefined {
    return this.sessionConfigOptions.get(sessionId)?.find((option) =>
      option.category === "mode" || option.id === "mode"
    );
  }

  /** The session's model config option, or `undefined` when none is advertised. */
  private intentModelOption(
    sessionId: string,
  ): acp.SessionConfigOption | undefined {
    const options = this.sessionConfigOptions.get(sessionId);
    return findOptionByCategory(options, MODEL_CATEGORY) ??
      options?.find((option) => option.id === "model");
  }

  /**
   * Pin the session to the requested `${providerID}/${modelID}` selection when
   * the engine advertises a model selector that is not already on it.
   *
   * A session that advertises NO model selector is NOT an error: the profile's
   * own provisioning (the OpenCode configuration override, or the byte-copied
   * OMP model file) is then the whole model contract. When a selector IS
   * advertised, a refused selection fails the session closed before the
   * prompt instead of interpreting with an engine default.
   */
  private async applyIntentModelSelection(sessionId: string, selection: string): Promise<void> {
    const modelOption = this.intentModelOption(sessionId);
    if (modelOption === undefined) return;
    const current = AgentConnector.currentOptionValue(modelOption);
    if (current !== undefined && current.toLowerCase() === selection.toLowerCase()) return;
    try {
      await this.setSessionModel(sessionId, selection);
    } catch (error) {
      throw new EmailIntentProfileMismatchError(
        sessionId,
        "model_selection_rejected",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Require the session's ACTIVE model selector to be the requested selection.
   * Runs after the pin, because `setSessionModel()` replaces the cached option
   * set with the engine's response: an engine that answers with another active
   * model (or replaces the verified profile) must not reach the prompt. A
   * session advertising no model selector keeps the profile's own provisioning
   * as its whole model contract.
   */
  private assertIntentModelActive(sessionId: string, selection: string): void {
    const modelOption = this.intentModelOption(sessionId);
    if (modelOption === undefined) return;
    const current = AgentConnector.currentOptionValue(modelOption);
    if (current === undefined || current.toLowerCase() !== selection.toLowerCase()) {
      throw new EmailIntentProfileMismatchError(
        sessionId,
        "model_selection_rejected",
        `the active model is ${JSON.stringify(current)}`,
      );
    }
  }

  /**
   * Race `operation` (the ACP `initialize()` call, already raced against the crash
   * signal) against `connectTimeoutMs`. Logs a WARN once elapsed time passes
   * {@link CONNECT_TIMEOUT_WARN_FRACTION} of the timeout, and clears both timers as soon
   * as the race settles by any arm so a fast/successful connect doesn't leave a dangling
   * timer alive.
   */
  private raceWithConnectTimeout<T>(operation: Promise<T>, logger: Logger): Promise<T> {
    const connectTimeoutMs = this.connectTimeoutMs;
    let warnHandle: ReturnType<typeof setTimeout> | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutSignal = new Promise<never>((_resolve, reject) => {
      warnHandle = setTimeout(() => {
        logger.warn(
          "connect() approaching connectTimeoutMs without a completed ACP handshake",
          {
            elapsedMs: Math.round(connectTimeoutMs * CONNECT_TIMEOUT_WARN_FRACTION),
            connectTimeoutMs,
          },
        );
      }, Math.round(connectTimeoutMs * CONNECT_TIMEOUT_WARN_FRACTION));

      timeoutHandle = setTimeout(() => {
        reject(new Error(`ACP handshake did not complete within ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);
    });

    return Promise.race([operation, timeoutSignal]).finally(() => {
      clearTimeout(warnHandle);
      clearTimeout(timeoutHandle);
    });
  }

  /**
   * Create a new ACP session on this connection.
   * @param mcpServers Optional MCP servers to connect to
   * @param cwd Optional per-session working directory override (shared-process mode:
   *   each user's session carries their own workspace as the session cwd).
   */
  async createSession(mcpServers: MCPServerConfig[] = [], cwd?: string): Promise<string> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    // Filter out MCP servers with unsupported transports (skip + warn)
    const supportedServers = this.filterSupportedMCPServers(mcpServers);
    const sessionCwd = cwd ?? this.options.agentConfig.cwd;

    // Start a fresh rejection record per logical session (Design Decision 2).
    // Cleared HERE, NOT in `reset()`: `reset()` runs at the start of every prompt
    // (including the retry prompt) and must not wipe the records the retry prompt
    // needs. createSession() is the one place that marks a new logical session.
    this.client?.clearPermissionRejections();

    const result = await this.raceAgainstCrash(this.connection.newSession({
      cwd: sessionCwd,
      mcpServers: supportedServers.map((server) => this.convertMCPServerConfig(server)),
    }));

    // Shared-process mode: register the per-session working directory with the client
    // so the permission gate confines this session to the session's own workspace.
    // For OMP the registration also carries this session's native-state
    // reservation and, when a unique persisted journal is proven for the id OMP
    // just returned, the current-session bash-artifact provenance. Discovery
    // failure is a bounded diagnostic only: it never fails session creation and
    // never widens a root.
    this.setSessionGateContext(result.sessionId, {
      cwd: sessionCwd,
      shellSessionId: this.options.clientConfig?.sessionId,
      yolo: this.options.clientConfig?.yolo,
      canWriteAgentWorkspace: this.options.clientConfig?.canWriteAgentWorkspace,
      allowedWriteExtensions: this.options.clientConfig?.allowedWriteExtensions,
      hiddenSkills: this.options.clientConfig?.hiddenSkills,
      trustedSkills: this.options.clientConfig?.trustedSkills,
      ompNativeState: await this.resolveOmpNativeState(result.sessionId, sessionCwd),
    });

    // Capture initial config options (session-scoped); refreshed later via
    // config_option_update notifications and set_config_option responses.
    this.refreshSessionConfigOptions(result.sessionId, result.configOptions);

    // INTERNAL email-intent profile (`email-intent-runtime`): the session must
    // PROVE the profile identity and the requested model selection BEFORE any
    // prompt is sent. A mismatch throws out of `createSession`, so the
    // interpretation runtime tears the session down without ever dispatching
    // the authored text.
    if (this.options.agentConfig.executionProfile === EMAIL_INTENT_PROFILE) {
      this.assertIntentSessionProfile(result.sessionId);
      const selection = this.options.intentModelSelection;
      if (selection !== undefined) {
        await this.applyIntentModelSelection(result.sessionId, selection);
        // The pin's response replaced the cached option set, so the profile
        // identity and the resulting active model are re-verified against THAT
        // evidence before any prompt can be dispatched.
        this.assertIntentSessionProfile(result.sessionId);
        this.assertIntentModelActive(result.sessionId, selection);
      }
    }

    logger.info("Session {sessionId} created with {mcpServerCount} MCP servers", {
      sessionId: result.sessionId,
      mcpServerCount: supportedServers.length,
    });
    return result.sessionId;
  }

  /**
   * Filter MCP servers to only those with transports supported by the Agent.
   * Unsupported servers are skipped with a warning log instead of throwing errors,
   * following the design principle that a single error should not crash the session.
   */
  filterSupportedMCPServers(servers: MCPServerConfig[]): MCPServerConfig[] {
    const logger = this.options.logger as Logger;
    const supported: MCPServerConfig[] = [];

    for (const server of servers) {
      // Stdio transport is always supported
      if (!("type" in server)) {
        supported.push(server);
        continue;
      }

      // Check HTTP transport support
      if (server.type === "http") {
        if (!this.supportsHTTPTransport()) {
          logger.warn(
            "Skipping MCP server {serverName}: Agent does not support HTTP transport",
            { serverName: server.name },
          );
          continue;
        }
        logger.debug("HTTP transport validated for server {serverName}", {
          serverName: server.name,
        });
      }

      // Check SSE transport support
      if (server.type === "sse") {
        if (!this.supportsSSETransport()) {
          logger.warn(
            "Skipping MCP server {serverName}: Agent does not support SSE transport",
            { serverName: server.name },
          );
          continue;
        }
        logger.debug("SSE transport validated for server {serverName}", {
          serverName: server.name,
        });
      }

      supported.push(server);
    }

    if (supported.length < servers.length) {
      logger.info(
        "{skippedCount} MCP server(s) skipped due to unsupported transport",
        { skippedCount: servers.length - supported.length },
      );
    }

    return supported;
  }

  /**
   * Convert our MCPServerConfig to ACP SDK format
   */
  private convertMCPServerConfig(
    server: MCPServerConfig,
  ): acp.McpServer {
    // Stdio transport (no type field)
    if (!("type" in server)) {
      return {
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env ?? [],
      };
    }

    // HTTP transport
    if (server.type === "http") {
      return {
        type: "http",
        name: server.name,
        url: server.url,
        headers: server.headers ?? [],
      };
    }

    // SSE transport
    return {
      type: "sse",
      name: server.name,
      url: server.url,
      headers: server.headers ?? [],
    };
  }

  /**
   * Check if Agent supports HTTP transport for MCP servers
   */
  supportsHTTPTransport(): boolean {
    return this.capabilities?.mcpCapabilities?.http === true;
  }

  /**
   * Check if Agent supports SSE transport for MCP servers
   */
  supportsSSETransport(): boolean {
    return this.capabilities?.mcpCapabilities?.sse === true;
  }

  /**
   * Check if Agent supports loading previous sessions
   */
  supportsLoadSession(): boolean {
    return this.capabilities?.loadSession === true;
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapabilities | null {
    return this.capabilities;
  }

  /**
   * Set the model for a session using stable-first canonical selection.
   *
   * If the session's latest cached config options advertise a `category: "model"` option,
   * the requested model ID is matched case-insensitively and the canonical advertised
   * value is sent via `setSessionConfigOption`, refreshing the cache from the response.
   * If the advertised catalog does not contain the requested model under any casing,
   * this method throws a descriptive Error and does NOT fall back to unstable.
   *
   * Only when no stable `category: "model"` option is advertised does this fall back
   * to `unstable_setSessionModel`.
   */
  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;
    const cachedOptions = this.sessionConfigOptions.get(sessionId);
    const selection = resolveModelSelection(cachedOptions, modelId);

    if (selection.kind === "stable") {
      const response = await this.raceAgainstCrash(this.connection.setSessionConfigOption({
        sessionId,
        configId: selection.configId,
        value: selection.value,
      }));
      this.refreshFromConfigOptionResponse(sessionId, response);
      this.sessionModelIds.set(sessionId, selection.value);
      logger.info(
        "Session model set to {modelId} (canonical: {canonical}) for session {sessionId}",
        {
          sessionId,
          modelId,
          canonical: selection.value,
        },
      );
    } else if (selection.kind === "unstable-fallback") {
      await this.raceAgainstCrash(this.connection.unstable_setSessionModel({
        sessionId,
        modelId,
      }));
      this.sessionModelIds.set(sessionId, modelId);
      logger.info("Session model set to {modelId} via unstable fallback for session {sessionId}", {
        sessionId,
        modelId,
      });
    } else {
      logger.warn(
        "Requested model {modelId} not offered in advertised catalog for session {sessionId}",
        {
          sessionId,
          modelId,
          agentType: this.options.agentType,
          advertisedValues: selection.advertisedValues,
        },
      );
      const preview = formatAdvertisedValuesPreview(selection.advertisedValues);
      throw new Error(
        `Requested model '${modelId}' is not offered in advertised catalog for agent '${this.options.agentType}'. Available: ${preview}`,
      );
    }
  }

  /**
   * Set the mode for a session (e.g., switch to YOLO agent in OpenCode)
   */
  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    await this.raceAgainstCrash(this.connection.setSessionMode({
      sessionId,
      modeId,
    }));

    logger.info("Session mode set to {modeId} for session {sessionId}", { sessionId, modeId });
  }

  /**
   * Refresh the cached session config options (session-scoped) from a complete list.
   * Used by both `config_option_update` notifications and `set_config_option` responses.
   * A nullish list clears the cache for that session.
   */
  private refreshSessionConfigOptions(
    sessionId: string,
    configOptions: acp.SessionConfigOption[] | null | undefined,
  ): void {
    this.sessionConfigOptions.set(sessionId, Array.isArray(configOptions) ? configOptions : []);
  }

  /**
   * Refresh config options cache from a `set_config_option` response object.
   */
  private refreshFromConfigOptionResponse(sessionId: string, response: unknown): void {
    const configOptions = response && typeof response === "object" && "configOptions" in response
      ? (response as { configOptions?: unknown }).configOptions
      : undefined;
    this.refreshSessionConfigOptions(
      sessionId,
      Array.isArray(configOptions) ? (configOptions as acp.SessionConfigOption[]) : undefined,
    );
  }

  /**
   * Find the currently advertised `thought_level` config option for a session, if any.
   */
  private findThoughtLevelOption(sessionId: string): acp.SessionConfigOption | undefined {
    return findOptionByCategory(this.sessionConfigOptions.get(sessionId), THOUGHT_LEVEL_CATEGORY);
  }

  /**
   * Apply a reasoning effort (ACP `thought_level`) to the session via Session Config Options.
   *
   * Best-effort and non-fatal: never throws. Re-discovers the `thought_level` option from the
   * latest cached config options at call time, so it reflects any updates that arrived after
   * the model was set.
   *
   * @returns the {@link ReasoningEffortOutcome} describing what happened
   */
  async setReasoningEffort(
    sessionId: string,
    value: string,
  ): Promise<ReasoningEffortOutcome> {
    const logger = this.options.logger as Logger;

    const trimmed = (value ?? "").trim();
    // "default" (or empty) means: do not configure reasoning effort.
    if (trimmed === "" || trimmed.toLowerCase() === "default") {
      return "skipped";
    }

    if (!this.connection) {
      logger.warn("Cannot set reasoning effort: not connected to agent", { sessionId });
      return "failed";
    }

    const option = this.findThoughtLevelOption(sessionId);
    if (!option) {
      logger.info(
        "Reasoning effort not supported by agent for session {sessionId} (no thought_level option)",
        { sessionId, requested: trimmed },
      );
      return "unsupported";
    }

    const availableValues = collectOptionValues(option);
    const resolved = resolveReasoningValue(trimmed, availableValues);

    if (resolved.kind === "not-offered") {
      logger.warn(
        "Requested reasoning effort {requested} not offered by model; skipping",
        {
          sessionId,
          requested: trimmed,
          availableValues,
          configId: option.id,
          model: this.sessionModelIds.get(sessionId),
          agentType: this.options.agentType,
        },
      );
      return "skipped_unavailable";
    }

    const valueToSend = resolved.value;

    try {
      const response = await this.raceAgainstCrash(this.connection.setSessionConfigOption({
        sessionId,
        configId: option.id,
        value: valueToSend,
      }));
      this.refreshFromConfigOptionResponse(sessionId, response);
      logger.info(
        "Reasoning effort {requested} applied for session {sessionId}",
        { sessionId, requested: trimmed, sent: valueToSend, configId: option.id },
      );
      return "applied";
    } catch (error) {
      logger.warn(
        "Failed to apply reasoning effort {requested} for session {sessionId}",
        {
          sessionId,
          requested: trimmed,
          configId: option.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return "failed";
    }
  }

  /**
   * Whether a reasoning-effort value is "active" (i.e. would attempt to configure the agent).
   * Returns false for empty / `"default"`.
   */
  static isReasoningEffortActive(value: string | undefined): boolean {
    if (value === undefined) return false;
    const trimmed = value.trim().toLowerCase();
    return trimmed !== "" && trimmed !== "default";
  }

  /**
   * Check if the connected Agent supports image content in prompts
   */
  supportsImageContent(): boolean {
    return this.capabilities?.promptCapabilities?.image === true;
  }

  /**
   * Send a prompt to the Agent and wait for response.
   * Accepts either a plain text string or an array of ContentBlock.
   * Includes idle timeout detection when enabled.
   */
  async prompt(
    sessionId: string,
    content: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    // Reset client state for new prompt
    this.client?.reset();

    // If content is a plain string, wrap as text ContentBlock (backward compatible)
    const prompt: acp.ContentBlock[] = typeof content === "string"
      ? [{ type: "text", text: content }]
      : content;

    try {
      // The crash-signal race arm applies unconditionally, independent of idle-timeout
      // configuration, so a subprocess crash mid-prompt rejects promptly even when idle
      // timeout is disabled. In shared-process mode the orchestrator matches this
      // error class too and runs controlled recovery (restart + session/load +
      // respond-gated re-issue — shared-acp-process-pool spec); in per-spawn mode
      // the reconnect detour is futile (fresh process, per-session data dirs), so
      // the message stays distinct from the idle-timeout triggers for that mode.
      const promptCall = this.raceAgainstCrash(this.connection.prompt({ sessionId, prompt }));
      const result = this.idleTimeoutEnabled
        ? await Promise.race([promptCall, this.monitorIdleTimeout(sessionId, logger)])
        : await promptCall;

      logger.info("Prompt completed for session {sessionId} with stopReason {stopReason}", {
        sessionId,
        stopReason: result.stopReason,
        contentBlockCount: prompt.length,
      });

      return result;
    } finally {
      // Flush any remaining agent thought or message chunks accumulated during this prompt.
      // Placed in finally to ensure buffer is flushed even when prompt fails (e.g., idle timeout).
      this.client?.flushThoughtBuffer();
      this.client?.flushMessageBuffer();
      this.clearIdleMonitor();
    }
  }

  /**
   * Cancel an ongoing operation
   */
  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    await this.raceAgainstCrash(this.connection.cancel({ sessionId }));
    logger.info("Session {sessionId} cancelled", { sessionId });
  }

  /**
   * Disconnect from the Agent and clean up resources
   * Uses best-effort cleanup with timeout (following GitHub's ACP example)
   */
  async disconnect(): Promise<void> {
    // Mark the shutdown as intentional before anything else (including SIGTERM), so
    // monitorProcessExit() logs at DEBUG rather than ERROR. This flag affects log
    // severity ONLY — it must never gate whether `crashSignal` rejects (see its
    // declaration): a doom-loop `disconnect()` call while a prompt is still in flight
    // must still unstick that prompt.
    this.intentionalShutdown = true;
    this.clearIdleMonitor();
    const logger = this.options.logger as Logger;

    if (this.process) {
      try {
        this.process.kill("SIGTERM");

        // Best-effort cleanup with timeout (following GitHub's example).
        // The timer handle is cleared once the race settles so a fast exit does
        // not leave a dangling timer behind. On timeout, escalate to SIGKILL
        // (spec: 2-second SIGTERM timeout before force-killing the subprocess).
        let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let exited = false;
        const statusRace = Promise.race([
          this.process.status.then(() => {
            exited = true;
          }),
          new Promise<void>((resolve) => {
            disconnectTimer = setTimeout(() => resolve(), DISCONNECT_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(disconnectTimer));
        await statusRace;
        // The ONLY positive termination observation this connector can offer:
        // the wrapper exited within its own grace period. A wrapper that had to
        // be SIGKILLed (or whose exit was never observed) records `false`, so a
        // consumer never treats an unproven teardown as quiescence.
        this.terminationConfirmed = exited;
        if (!exited) {
          logger.warn("Agent process did not exit within SIGTERM timeout, sending SIGKILL", {
            timeoutMs: DISCONNECT_TIMEOUT_MS,
          });
          try {
            this.process.kill("SIGKILL");
          } catch {
            // Best effort — the process may have exited between the race and here.
          }
          // An intent-profile launch additionally observes the SIGKILLed
          // wrapper's exit, because its consumer may reclaim private roots
          // ONLY on proven quiescence. Ordinary launches keep their unchanged
          // disconnect timing.
          if (this.options.agentConfig.executionProfile === EMAIL_INTENT_PROFILE) {
            let killedExited = false;
            const escalated = Promise.withResolvers<void>();
            const escalatedTimer = setTimeout(() => escalated.resolve(), DISCONNECT_TIMEOUT_MS);
            await Promise.race([
              this.process.status.then(() => {
                killedExited = true;
              }),
              escalated.promise,
            ]);
            clearTimeout(escalatedTimer);
            this.terminationConfirmed = killedExited;
          }
        }
      } catch (error) {
        // Ignore kill errors - best effort cleanup
        logger.warn("Error killing agent process", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.process = null;
    }
    this.connection = null;
    // Revoke the discarded epoch's registrations on the client itself before it
    // is dropped: an in-flight callback that still holds this client must fail
    // its generation currency check instead of reading content after the
    // disconnect (D4).
    this.client?.revokeAllSessionContexts();
    this.client = null;
    this.capabilities = null;
    this.sessionConfigOptions = new Map();
    this.sessionModelIds = new Map();
    // The connection (and the client that held this epoch's registrations) is
    // gone. Cached artifact authority is revoked here so neither a later
    // `connect()` replay nor a sibling session can act on provenance from the
    // discarded epoch; the recovered session re-resolves its own.
    this.revokeCachedArtifactAuthority();
  }

  /**
   * Register the session's gate context (cwd + owning skill session id +
   * per-session permission flags) on the client and cache it for replay after
   * a reconnect. Shared-process mode: every session MUST call this — one
   * ChatbotClient serves all sessions of the pooled process.
   */
  setSessionGateContext(acpSessionId: string, ctx: SessionGateContext): void {
    const existing = this.sessionGateContexts.get(acpSessionId);
    // OMP's callback trusted root is the factory-produced shared observation
    // already used by inventory and confinement — the SAME configured root the
    // deployment mounts read-only — never the settings plan or a workspace/
    // config/model selector. An unavailable identity stays unavailable and
    // follows the existing shared callback denial. OpenCode's supplied
    // `ctx.trustedSkills` choice is preserved unchanged.
    const trustedSkills = this.options.agentType === "omp"
      ? this.sharedSkillsRootSource()
      : ctx.trustedSkills;
    const merged: SessionGateContext = {
      ...existing,
      ...ctx,
      allowedWriteExtensions: (ctx.allowedWriteExtensions ?? existing?.allowedWriteExtensions)
        ?.slice(),
      trustedSkills,
    };
    this.sessionGateContexts.set(acpSessionId, merged);
    this.client?.setSessionContext(acpSessionId, merged);
  }

  /**
   * The OMP callback trusted root, derived from the one shared deployment
   * skill-root observation the connector already received. No discovery
   * fallback: an absent root or identity is passed through as-is and denied by
   * the existing shared callback checks.
   */
  private sharedSkillsRootSource(): TrustedSkillsSource | undefined {
    const observation = this.options.agentConfig.skillsRoot;
    if (!observation) return undefined;
    return {
      ownedRootPath: observation.root,
      canonicalOwnedRootPath: observation.root,
      source: "deployment_owned",
      rootIdentity: observation.identity,
    };
  }

  /**
   * Derive one session's OMP native-state reservation and, when a unique
   * persisted journal is proven for the ACP id, its bash-artifact provenance
   * (design D1/D2).
   *
   * Every input is trusted lifecycle state: the factory-selected
   * `XDG_DATA_HOME`, the ACP session id and the registered cwd. A discovery
   * failure returns the reservation alone — a bounded diagnostic that neither
   * fails session creation/recovery nor authorizes a broader root. `undefined`
   * for a non-OMP connector, so OpenCode callbacks are untouched.
   */
  private async resolveOmpNativeState(
    acpSessionId: string,
    sessionCwd: string,
  ): Promise<OmpNativeStateProvenance | undefined> {
    if (this.options.agentType !== "omp") return undefined;
    const logger = this.options.logger as Logger;
    const nativeDataRoot = this.options.agentConfig.env?.["XDG_DATA_HOME"];
    const reservation: OmpNativeStateProvenance = {
      cwd: sessionCwd,
      ...(nativeDataRoot === undefined ? {} : { nativeDataRoot }),
    };
    try {
      const resolution = await resolveOmpSessionArtifacts({
        agentType: "omp",
        xdgDataHome: nativeDataRoot,
        acpSessionId,
        sessionCwd,
        nativeCalls: this.options.clientConfig?.nativeCalls,
      });
      if (!resolution.ok) {
        logger.info(
          "OMP artifact provenance unavailable for session {sessionId}: {reason}",
          { sessionId: acpSessionId, reason: resolution.reason },
        );
        return reservation;
      }
      return {
        cwd: sessionCwd,
        ...(nativeDataRoot === undefined
          ? {}
          : { nativeDataRoot, dataRootIdentity: resolution.dataRootIdentity }),
        artifacts: resolution.provenance,
      };
    } catch (error) {
      logger.warn("OMP artifact discovery failed for session {sessionId}", {
        sessionId: acpSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return reservation;
    }
  }

  /**
   * Revoke the cached artifact capability of the connection epoch that is being
   * discarded (D4). A reconnect replays ordinary gate context identity, never
   * artifact authority from the prior client epoch; the recovered session
   * re-resolves its own provenance after a successful `session/load`, and the
   * native-state reservation itself is retained so sibling state stays private.
   */
  private revokeCachedArtifactAuthority(): void {
    for (const [sessionId, ctx] of this.sessionGateContexts) {
      const nativeState = ctx.ompNativeState;
      if (nativeState?.artifacts === undefined) continue;
      this.sessionGateContexts.set(sessionId, {
        ...ctx,
        ompNativeState: {
          cwd: nativeState.cwd,
          ...(nativeState.nativeDataRoot === undefined
            ? {}
            : { nativeDataRoot: nativeState.nativeDataRoot }),
          ...(nativeState.dataRootIdentity === undefined
            ? {}
            : { dataRootIdentity: nativeState.dataRootIdentity }),
        },
      });
    }
  }

  /**
   * Replay the cached per-session gate contexts onto the current client. The client is
   * fresh after a respawn and assigns fresh registration generations, so replayed
   * contexts are re-bound to the new instance's current generation. The replay restores
   * context identity, never trust.
   */
  private replaySessionGateContexts(): void {
    for (const [sid, ctx] of this.sessionGateContexts) {
      this.client?.setSessionContext(sid, ctx);
    }
  }

  /**
   * Check if connected to an Agent
   */
  get isConnected(): boolean {
    return this.connection !== null && this.process !== null;
  }

  /**
   * Monitor agent subprocess for unexpected exit.
   * Logs an error when the process exits while still referenced.
   */
  private monitorProcessExit(logger: Logger): void {
    if (!this.process) return;
    this.process.status.then((status) => {
      if (this.process !== null && !this.intentionalShutdown) {
        logger.error("Agent process exited unexpectedly", {
          code: status.code,
          signal: status.signal,
          success: status.success,
        });
      } else if (this.process !== null) {
        logger.debug("Agent process exited after intentional shutdown", {
          code: status.code,
          signal: status.signal,
          success: status.success,
        });
      }
    }).catch(() => {/* Ignore */});
  }

  /**
   * Build a crash signal tied to the current subprocess: rejects unconditionally
   * whenever the process exits, for any reason (crash or intentional `disconnect()`).
   * A no-op `.catch()` is attached at creation so this never surfaces as an unhandled
   * rejection when nothing is currently racing against it. Does not log — the exit is
   * logged exactly once, in `monitorProcessExit()`, to avoid duplicate log lines.
   */
  private buildCrashSignal(): Promise<never> {
    const signal = this.process!.status.then((status): never => {
      throw new Error(
        `Agent process exited unexpectedly (code=${status.code}, signal=${status.signal}) ` +
          "while awaiting a response",
      );
    });
    signal.catch(() => {/* Prevent unhandled rejection when nothing races against this signal */});
    return signal;
  }

  /**
   * Race an outbound ACP call against the current crash signal, so an unexpected
   * subprocess exit rejects the call promptly instead of leaving it pending forever.
   * Falls back to the bare operation when no crash signal exists yet (not connected).
   */
  private raceAgainstCrash<T>(operation: Promise<T>): Promise<T> {
    if (!this.crashSignal) return operation;
    return Promise.race([operation, this.crashSignal]);
  }

  /**
   * Read stderr stream from the agent process and log errors
   * This runs asynchronously in the background
   *
   * `privateStream` (the internal email-intent profile) drains the same bytes
   * and logs NONE of them: not the engine's diagnostics and not the read
   * error's own message, which can quote stream content on some decoders.
   * Ordinary launches keep their existing WARN/ERROR logging unchanged.
   */
  private async readStderr(
    stderr: ReadableStream<Uint8Array>,
    logger: Logger,
    privateStream = false,
  ): Promise<void> {
    try {
      const decoder = new TextDecoder();
      const reader = stderr.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (privateStream) continue;

        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          // Log stderr output as warnings (they're usually errors)
          logger.warn("Agent stderr", { message: text.trim() });
        }
      }
    } catch (error) {
      // Only log if it's not a cancellation error
      if (error instanceof Error && error.message !== "operation canceled") {
        if (privateStream) {
          logger.warn(
            "Agent stderr stream ended with a read error (intent profile; contents withheld)",
          );
        } else {
          logger.error("Error reading stderr stream", {
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Get the Client instance
   */
  getClient(): ChatbotClient | null {
    return this.client;
  }

  /**
   * Get the agent subprocess PID (undefined when not connected).
   * Used by the process pool to wait for / kill the agent's child process tree
   * before clearing the current-session pointer file.
   */
  getProcessPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Wrapper-process evidence for producer teardown. Per-spawn drain and pooled
   * release need more than the current PID: `generations` counts the wrappers
   * this connector actually spawned (0 = no producer ever started, so no tool
   * child can hold this session's files), while a wrapper that was spawned and
   * is no longer observable — or a generation that was replaced — means its
   * tool children were never drained and the workspace must stay protected.
   */
  getProcessEvidence(): AgentProcessEvidence {
    return {
      generations: this.spawnGeneration,
      pid: this.process?.pid,
      ...(this.terminationConfirmed === undefined
        ? {}
        : { terminationConfirmed: this.terminationConfirmed }),
    };
  }

  /**
   * Monitor for idle timeout. Only rejects (never resolves normally).
   * Used with Promise.race() against the actual prompt call.
   */
  private monitorIdleTimeout(
    sessionId: string,
    logger: Logger,
  ): Promise<acp.PromptResponse> {
    return new Promise((_resolve, reject) => {
      const intervalId = setInterval(async () => {
        const lastActivity = this.client?.getLastActivityTimestamp() ?? Date.now();
        const idleMs = Date.now() - lastActivity;

        if (idleMs < this.idleTimeoutMs) return;

        logger.warn(
          "Idle timeout reached for session {sessionId}, idle for {idleMs}ms. Performing liveness check...",
          { sessionId, idleMs },
        );

        // Liveness check 1: Process alive?
        const processAlive = await this.isProcessAlive();
        if (!processAlive) {
          clearInterval(intervalId);
          logger.error("Agent process exited unexpectedly for session {sessionId}", { sessionId });
          reject(
            new Error(
              `ACP agent process exited unexpectedly after ${idleMs}ms of inactivity`,
            ),
          );
          return;
        }

        // Liveness check 2: cancel() as connectivity probe
        try {
          await this.connection?.cancel({ sessionId });
          // cancel() succeeded → agent alive but slow, grant another window
          logger.info(
            "Liveness check passed for session {sessionId}: Agent is alive but slow.",
            { sessionId },
          );
          this.client?.touchActivity();
        } catch (error) {
          // cancel() failed → connection is dead
          clearInterval(intervalId);
          logger.error(
            "Liveness check failed for session {sessionId}: cancel() threw error",
            { sessionId, error: error instanceof Error ? error.message : String(error) },
          );
          reject(
            new Error(
              `ACP connection dead: no activity for ${idleMs}ms and liveness check failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      }, this.idleCheckIntervalMs);

      this.currentIdleMonitorIntervalId = intervalId;
    });
  }

  /**
   * Check if the agent subprocess is still alive.
   */
  private async isProcessAlive(): Promise<boolean> {
    if (!this.process) return false;
    const result = await Promise.race([
      this.process.status.then(() => "exited" as const),
      new Promise<"running">((resolve) => setTimeout(() => resolve("running"), 100)),
    ]);
    return result === "running";
  }

  private clearIdleMonitor(): void {
    if (this.currentIdleMonitorIntervalId !== null) {
      clearInterval(this.currentIdleMonitorIntervalId);
      this.currentIdleMonitorIntervalId = null;
    }
  }

  /**
   * Attempt to reconnect and resume an existing session (shared-process mode).
   * Restarts the pool key's process, resumes the in-flight session via ACP
   * `session/load` (history replayed to the client), and applies controlled
   * recovery: the prompt is re-issued ONLY if no response has been recorded
   * for the session (the caller decides via `hasResponded`).
   *
   * Row-11 recovery context (restore-mode-owned-acp-sessions): OpenCode callers
   * that supply a recovery context keep the pre-change ownership checks — the
   * recorded acquisition mode/namespace is verified against this connector's own
   * recovery target BEFORE any teardown (and again after the respawn), and a
   * mismatch or missing provenance throws {@link RecoveryOwnershipError} with
   * zero disconnect/spawn/load/gate side effects. An OMP deployment recovers
   * from this connector's own options through the shared load-capability path:
   * legacy ownership is not an authorization input, so an OMP call proceeds to
   * teardown and `session/load`, and returns the capability-absence `false` when
   * load is unsupported. After the load a supplied gate context is restored for
   * the recovered id (never another session's cached context, never the
   * process-frozen client fallback) before the named post-restore hook runs and
   * success is reported; without a supplied context the existing cwd-only
   * restore is used. OpenCode callers keep the same observable recovery behavior
   * and ordering — optional context, cwd-only restore without options, and the
   * capability-absence `false` return.
   *
   * @param sessionId the ACP session to resume
   * @param cwd the session's working directory (required by `session/load`); a
   *   supplied `gateContext.cwd` must agree with it
   * @param mcpServers the session's MCP servers (required by `session/load`)
   * @param opts recovery options: `reasoningEffort` (row 6, consumed unchanged),
   *   `ownership` (recorded acquisition context, verified read-only for OpenCode),
   *   `gateContext` (the session's full gate context to restore),
   *   `onGateContextRestored` (named post-restore hook — no readiness assertion).
   *   Optional for both agent types; OpenCode's context-free legacy path is
   *   preserved.
   * @returns true if reconnection succeeded and the session was loaded.
   * @throws RecoveryOwnershipError on an OpenCode ownership violation (pre-teardown, zero side effects)
   * @throws GateContextRestoreError when a supplied gate context disagrees with the recovery cwd, or a supplied-context recovery has no context for the recovered id
   * @throws RecoveryHookError when the post-restore hook rejects
   * @throws Error if model re-establishment fails against the post-load catalog
   */
  async reconnectAndResumeSession(
    sessionId: string,
    cwd: string,
    mcpServers: MCPServerConfig[] = [],
    opts?: {
      reasoningEffort?: string;
      ownership?: SessionRecoveryOwnership;
      gateContext?: SessionGateContext;
      onGateContextRestored?: (sessionId: string) => void | Promise<void>;
    },
  ): Promise<boolean> {
    const logger = this.options.logger as Logger;

    // ── Ownership verification BEFORE any teardown (row 11, D2) ──────────────
    // OpenCode-only: the FIRST statement, ahead of `disconnect()`, so a violation
    // cannot kill the opposite mode's live process, drop the session's gate
    // context, or reach the respond-gated re-prompt path. The recorded values are
    // the TARGET: never re-resolved from configuration, never mutated.
    //
    // The trigger is a supplied recovery context — OpenCode's pre-change trigger,
    // so its context-free recovery is preserved. An OMP deployment ignores legacy
    // ownership: it recovers from this connector's own options and derives the
    // supplied-context signal from `gateContext` alone.
    const ompRecovery = this.options.agentType === "omp";
    const recoveryContextSupplied = ompRecovery
      ? opts?.gateContext !== undefined
      : opts?.ownership !== undefined || opts?.gateContext !== undefined;
    if (!ompRecovery && recoveryContextSupplied) {
      this.verifyRecoveryOwnership(sessionId, opts?.ownership);
    }

    logger.info("Attempting to reconnect and resume session {sessionId}", { sessionId });

    // Capture prior model ID before disconnect() resets sessionModelIds map
    const priorModelId = this.sessionModelIds.get(sessionId);
    // Disconnect old connection (kills the dead/dying process)
    await this.disconnect();

    // Spawn new process and initialize
    await this.connect();

    // Same-mode respawn re-check (row 11, D3), OpenCode-only: `connect()`
    // respawns from this connector's own options, so the freshly spawned env
    // namespace must still equal the recorded one. Today `agentConfig.env` is the
    // same immutable object the pre-teardown check read — this is an invariant
    // ASSERTION, the documented hook point for a future connect() that rebuilds
    // env. Drift aborts here, strictly BEFORE any `session/load` is issued; the
    // process already respawned in the drifted env is torn down by the pool's
    // release path (the recovery path itself never calls disconnect for these
    // classes).
    if (!ompRecovery && opts?.ownership) {
      this.verifyRecoveryOwnership(sessionId, opts.ownership);
    }

    // Check if agent supports loading previous sessions
    if (!this.supportsLoadSession()) {
      logger.warn(
        "Agent does not support loadSession. Cannot resume session {sessionId}.",
        { sessionId },
      );
      await this.disconnect();
      return false;
    }

    // Resume the session: `session/load` replays history into the client.
    // The OpenCode channel-scoped data root (XDG_DATA_HOME under the pool key)
    // persists the session state, so the load survives the process restart.
    if (!this.connection) {
      logger.warn("Reconnect failed: no live connection after respawn", { sessionId });
      await this.disconnect();
      return false;
    }
    const supportedServers = this.filterSupportedMCPServers(mcpServers);
    const loadResponse = await this.raceAgainstCrash(this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers: supportedServers.map((server) => this.convertMCPServerConfig(server)),
    }));
    // Config restoration = pure row-6 consumption (never forked): restore the
    // cache from the load response, reapply the prior model through the same
    // stable-first selection (a catalog miss throws, isolated to this session),
    // then best-effort reasoning from the supplied `opts.reasoningEffort`.
    this.refreshFromConfigOptionResponse(sessionId, loadResponse);

    // Legacy cwd-only restore for callers WITHOUT a supplied gate context
    // (OpenCode and OpenCode-unaware sites, and an OMP call that carries no
    // context): kept in master's exact position — immediately after the cache
    // refresh, before model reapplication — so the legacy sequence is strictly
    // byte-identical even on a post-load catalog miss.
    if (!recoveryContextSupplied && !opts?.gateContext) {
      this.setSessionGateContext(sessionId, {
        cwd,
        shellSessionId: this.sessionGateContexts.get(sessionId)?.shellSessionId ??
          this.options.clientConfig?.sessionId,
        yolo: this.sessionGateContexts.get(sessionId)?.yolo ?? this.options.clientConfig?.yolo,
        canWriteAgentWorkspace: this.sessionGateContexts.get(sessionId)?.canWriteAgentWorkspace ??
          this.options.clientConfig?.canWriteAgentWorkspace,
        allowedWriteExtensions: this.sessionGateContexts.get(sessionId)?.allowedWriteExtensions ??
          this.options.clientConfig?.allowedWriteExtensions,
        hiddenSkills: this.sessionGateContexts.get(sessionId)?.hiddenSkills ??
          this.options.clientConfig?.hiddenSkills,
        trustedSkills: this.options.clientConfig?.trustedSkills,
        ompNativeState: await this.resolveOmpNativeState(sessionId, cwd),
      });
    }

    if (priorModelId !== undefined) {
      await this.setSessionModel(sessionId, priorModelId);
    }

    // Reapply reasoning effort best-effort if supplied and active
    if (opts?.reasoningEffort && AgentConnector.isReasoningEffortActive(opts.reasoningEffort)) {
      const outcome = await this.setReasoningEffort(sessionId, opts.reasoningEffort);
      logger.info(
        "Reasoning effort reapplication outcome {outcome} for resumed session {sessionId}",
        {
          sessionId,
          requested: opts.reasoningEffort,
          outcome,
        },
      );
    }

    // ── Gate-context restore (row 11, D5) ────────────────────────────────────
    // Ordering: load → cache/model/reasoning → gate restore → hook → true.
    // The recovered id's OWN context is re-registered via the existing merge
    // path (so it also survives later `connect()` replays). Other sessions'
    // cached contexts are never substituted for it and replay unchanged.
    //
    // OMP re-resolves its native provenance here (D4): the prior epoch's
    // artifact authority was revoked on disconnect, and this one registration
    // re-binds the restored context to the journal and artifact directory the
    // native runtime actually holds after the load. A failed re-resolution
    // carries the reservation alone — never a retry trigger, never a recovery
    // failure — and stale generations still never authorize IO.
    if (opts?.gateContext) {
      // A supplied context that disagrees with the recovery cwd is a restore
      // failure for this session — never a silent overwrite of either value.
      // Post-load for every agent type: no recovery prevalidation remains.
      if (opts.gateContext.cwd !== cwd) {
        throw new GateContextRestoreError(
          sessionId,
          `supplied context cwd "${opts.gateContext.cwd}" disagrees with recovery cwd "${cwd}"`,
        );
      }
      this.setSessionGateContext(sessionId, {
        ...opts.gateContext,
        ompNativeState: await this.resolveOmpNativeState(sessionId, cwd),
      });
    } else if (recoveryContextSupplied && !this.sessionGateContexts.has(sessionId)) {
      // No context supplied AND none cached for the recovered id (fresh
      // connector): fail closed instead of resuming on the process-frozen
      // client fallback — that would be another session's default context.
      // OpenCode-only: OMP derives `recoveryContextSupplied` from its gate
      // context, so an OMP call without one skips this arm entirely.
      throw new GateContextRestoreError(
        sessionId,
        "no gate context supplied or cached for the recovered session id; refusing the process-frozen fallback",
      );
    }

    // Named post-restore recovery hook (row 11, D6): exists with NO readiness
    // assertion, request, channel, or prompt gate. A rejecting hook fails only
    // this session (wrapped for the orchestrator's `post_restore_hook_failed`
    // classification).
    if (opts?.onGateContextRestored) {
      try {
        await opts.onGateContextRestored(sessionId);
      } catch (cause) {
        throw new RecoveryHookError(sessionId, cause);
      }
    }

    logger.info("Session {sessionId} resumed via session/load", { sessionId });
    return true;
  }

  /**
   * Verify a session's recorded acquisition ownership against this connector's
   * own recovery target — the mode-scoped namespace its spawn configuration
   * carries, read from the factory-produced `agentConfig.env` (the single
   * namespace formula row 10 recorded from; never recomputed, never re-resolved).
   * Throws {@link RecoveryOwnershipError} on any non-`match` verdict. Pure with
   * respect to the connection: performs no disconnect, spawn, load, or gate
   * mutation, and consumes the recorded fields read-only.
   */
  private verifyRecoveryOwnership(
    sessionId: string,
    ownership: SessionRecoveryOwnership | undefined,
  ): void {
    const configuredAgentType: AgentType | undefined =
      isSupportedAgentType(this.options.agentType ?? "")
        ? this.options.agentType as AgentType
        : undefined;
    // Only non-OMP deployments reach ownership verification (OMP ignores legacy
    // ownership entirely), so the rule is selected by the supplied record's agent
    // type, falling back to the configured deployment type. A record written
    // under a different agent type still fails as unmatched provenance.
    const agentType: AgentType | undefined = ownership?.agentType ?? configuredAgentType;
    // An unknown deployment agent type cannot prove same-mode recovery: model it
    // as an underivable OMP-style target so the verdict fails closed.
    const actual = agentType === undefined
      ? { agentType: "omp" as const, permissionMode: "", processNamespace: "" }
      : deriveActualRecoveryTarget(agentType, this.options.agentConfig?.env);
    const verdict = verifyRecoveryOwnership(ownership, actual);
    if (verdict !== "match") {
      throw new RecoveryOwnershipError({
        sessionId,
        expectedMode: ownership?.permissionMode,
        expectedNamespace: ownership?.processNamespace,
        actualMode: actual.permissionMode,
        actualNamespace: actual.processNamespace,
        reason: mapOwnershipVerdictToReason(verdict),
      });
    }
  }

  private get idleTimeoutMs(): number {
    return this.options.idleTimeoutConfig?.timeoutMs ?? IDLE_TIMEOUT_MS;
  }

  private get idleCheckIntervalMs(): number {
    return this.options.idleTimeoutConfig?.checkIntervalMs ?? IDLE_CHECK_INTERVAL_MS;
  }

  private get idleTimeoutEnabled(): boolean {
    return this.options.idleTimeoutConfig?.enabled !== false;
  }

  private get connectTimeoutMs(): number {
    return this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }
}
