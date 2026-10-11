// src/acp/agent-connector.ts

import * as acp from "@agentclientprotocol/sdk";
import { join } from "@std/path";
import { buildSkillAutoApproveList, ChatbotClient, type SessionGateContext } from "./client.ts";
import {
  type AgentCapabilities,
  type AgentConnectorOptions,
  type AgentType,
  isSupportedAgentType,
  type MCPServerConfig,
} from "./types.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import {
  deriveActualRecoveryTarget,
  mapOwnershipVerdictToReason,
  RecoveryOwnershipError,
  type SessionRecoveryOwnership,
  verifyRecoveryOwnership,
} from "./recovery-ownership.ts";
import {
  type AcceptedOverlayIdentity,
  assertOmpSettingsSourcesVisible,
} from "./omp/settings-sources.ts";
import {
  collectOptionValues,
  findOptionByCategory,
  formatAdvertisedValuesPreview,
  KNOWN_REASONING_EFFORT_TOKENS,
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
 * AgentConnector manages the lifecycle of ACP Agent connections
 * Handles spawning, connecting, and communicating with external ACP Agents
 */
export class AgentConnector {
  private connection: acp.ClientSideConnection | null = null;
  private process: Deno.ChildProcess | null = null;
  private client: ChatbotClient | null = null;
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
   * Row 26: identities of the owned overlays accepted by the most recent
   * settings-source check on this connector. Every later check re-verifies
   * them, so an overlay replaced between checks fails closed
   * (`overlay_identity_mismatch`) — the repository-triggered rediscovery
   * recheck the design records. Identity tracking deliberately spans
   * `disconnect()`/respawn: the accepted deployment posture keeps the owned
   * overlays stable for the process lifetime, so a replacement across a
   * restart must also fail closed rather than reset the baseline.
   */
  private acceptedOverlayIdentities: readonly AcceptedOverlayIdentity[] | null = null;

  constructor(options: AgentConnectorOptions) {
    this.options = options;
  }

  /**
   * Row 26 (D3): the pre-native-request settings-source gate. Runs strictly
   * BEFORE any native protected request — spawn, `session/new`,
   * `session/load`/recovery, or repository-triggered rediscovery — for OMP
   * connectors only (OpenCode never consults the plan). The connector's
   * factory-produced `agentConfig.settingsSourcePlan` is mandatory: an OMP
   * connector whose config carries no plan cannot prove the owned-only
   * posture and fails closed with a bounded reason BEFORE any side effect.
   * A check failure throws `SettingsSourceRejectionError`; no user file is
   * touched and no native request is sent.
   */
  private async verifyOmpSettingsSourcesBeforeRequest(sessionCwd: string): Promise<void> {
    if (this.options.agentType !== "omp") return;
    const plan = this.options.agentConfig.settingsSourcePlan;
    if (!plan) {
      throw new Error(
        "OMP connector refuses the native request: agentConfig carries no settings-source plan, " +
          "so the owned-only settings posture cannot be verified (fail closed).",
      );
    }
    const identities = await assertOmpSettingsSourcesVisible(
      plan,
      sessionCwd,
      this.acceptedOverlayIdentities ? { expectedOverlayIdentities: this.acceptedOverlayIdentities } : {},
    );
    this.acceptedOverlayIdentities = identities;
  }

  /**
   * Connect to an ACP Agent by spawning a subprocess
   */
  async connect(): Promise<void> {
    const { agentConfig, clientConfig, skillRegistry, logger } = this.options;

    // Row 26 (D3): settings-source preflight BEFORE the spawn — the neutral
    // launch cwd is the plan's own root here; the actual session workspace is
    // re-checked per `createSession`/load below.
    await this.verifyOmpSettingsSourcesBeforeRequest(agentConfig.cwd);

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

    // Reset shutdown-intent tracking and build a fresh crash signal tied to this
    // subprocess (not any stale signal from a previously disconnected one).
    this.intentionalShutdown = false;
    this.crashSignal = this.buildCrashSignal();

    // Monitor for unexpected process exit
    this.monitorProcessExit(logger as Logger);

    // Pipe stderr to logger (doesn't block the process)
    this.readStderr(this.process.stderr, logger as Logger).catch((error) => {
      (logger as Logger).error("Failed to read stderr", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Create streams for JSON-RPC communication
    // ACP uses: output (to agent) = WritableStream, input (from agent) = ReadableStream
    const output = this.process.stdin; // WritableStream - we send messages to agent
    const input = this.process.stdout; // ReadableStream - we receive messages from agent

    // Create the Client implementation
    const autoApproveList = buildSkillAutoApproveList(
      join(Deno.cwd(), "skills"),
      clientConfig.autoApproveSkills,
    );
    this.client = new ChatbotClient(
      skillRegistry as SkillRegistry,
      logger as Logger,
      clientConfig,
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

    // Start a fresh rejection record per logical session (Design Decision 2).
    // Cleared HERE, NOT in `reset()`: `reset()` runs at the start of every prompt
    // (including the retry prompt) and must not wipe the records the retry prompt
    // needs. createSession() is the one place that marks a new logical session.
    this.client?.clearPermissionRejections();

    // Filter out MCP servers with unsupported transports (skip + warn)
    const supportedServers = this.filterSupportedMCPServers(mcpServers);
    const sessionCwd = cwd ?? this.options.agentConfig.cwd;

    // Row 26 (D3): the ACTUAL session workspace is re-checked before the
    // native `session/new` — the neutral launch cwd never covers it. The
    // previously accepted overlay identities are re-verified here, so an
    // owned-overlay replacement between lifecycle steps fails closed.
    await this.verifyOmpSettingsSourcesBeforeRequest(sessionCwd);

    const result = await this.raceAgainstCrash(this.connection.newSession({
      cwd: sessionCwd,
      mcpServers: supportedServers.map((server) => this.convertMCPServerConfig(server)),
    }));

    // Shared-process mode: register the per-session working directory with the client
    // so the permission gate confines this session to the session's own workspace.
    this.setSessionGateContext(result.sessionId, {
      cwd: sessionCwd,
      shellSessionId: this.options.clientConfig?.sessionId,
      yolo: this.options.clientConfig?.yolo,
      canWriteAgentWorkspace: this.options.clientConfig?.canWriteAgentWorkspace,
      allowedWriteExtensions: this.options.clientConfig?.allowedWriteExtensions,
      trustedSkills: this.options.clientConfig?.trustedSkills,
    });

    // Capture initial config options (session-scoped); refreshed later via
    // config_option_update notifications and set_config_option responses.
    this.refreshSessionConfigOptions(result.sessionId, result.configOptions);

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
        if (!exited) {
          logger.warn("Agent process did not exit within SIGTERM timeout, sending SIGKILL", {
            timeoutMs: DISCONNECT_TIMEOUT_MS,
          });
          try {
            this.process.kill("SIGKILL");
          } catch {
            // Best effort — the process may have exited between the race and here.
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
    this.client = null;
    this.capabilities = null;
    this.sessionConfigOptions = new Map();
    this.sessionModelIds = new Map();
  }

  /**
   * Register the session's gate context (cwd + owning skill session id +
   * per-session permission flags) on the client and cache it for replay after
   * a reconnect. Shared-process mode: every session MUST call this — one
   * ChatbotClient serves all sessions of the pooled process.
   */
  setSessionGateContext(acpSessionId: string, ctx: SessionGateContext): void {
    const existing = this.sessionGateContexts.get(acpSessionId);
    const merged: SessionGateContext = {
      ...existing,
      ...ctx,
      allowedWriteExtensions: (ctx.allowedWriteExtensions ?? existing?.allowedWriteExtensions)
        ?.slice(),
      trustedSkills: ctx.trustedSkills
        ? {
          ...ctx.trustedSkills,
          criticalSkills: ctx.trustedSkills.criticalSkills.map((reference) => ({ ...reference })),
        }
        : ctx.trustedSkills,
    };
    this.sessionGateContexts.set(acpSessionId, merged);
    this.client?.setSessionContext(acpSessionId, merged);
  }

  /**
   * Replay the cached per-session gate contexts onto the current client. The client is
   * fresh after a respawn and assigns fresh registration generations, so replayed
   * critical-skill references — which keep the previous instance's generation verbatim —
   * stay denied. The replay restores context identity, never trust.
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
   */
  private async readStderr(
    stderr: ReadableStream<Uint8Array>,
    logger: Logger,
  ): Promise<void> {
    try {
      const decoder = new TextDecoder();
      const reader = stderr.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          // Log stderr output as warnings (they're usually errors)
          logger.warn("Agent stderr", { message: text.trim() });
        }
      }
    } catch (error) {
      // Only log if it's not a cancellation error
      if (error instanceof Error && error.message !== "operation canceled") {
        logger.error("Error reading stderr stream", {
          error: error.message,
        });
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
   * Row-11 recovery context (restore-mode-owned-acp-sessions): when the caller
   * supplies a recovery context (`ownership` and/or `gateContext`), the recorded
   * acquisition mode/namespace is verified against this connector's own recovery
   * target BEFORE any teardown — a mismatch or missing provenance throws
   * {@link RecoveryOwnershipError} with zero disconnect/spawn/load/gate side
   * effects — and after the load the recovered id's OWN full gate context is
   * restored (never another session's cached context, never the process-frozen
   * client fallback) before the named post-restore hook runs and success is
   * reported. Callers with no recovery context keep the pre-change behavior
   * byte-identically, including the capability-absence `false` return.
   *
   * @param sessionId the ACP session to resume
   * @param cwd the session's working directory (required by `session/load`)
   * @param mcpServers the session's MCP servers (required by `session/load`)
   * @param opts optional recovery options: `reasoningEffort` (row 6, consumed
   *   unchanged), `ownership` (recorded acquisition context, verified
   *   read-only), `gateContext` (the session's full gate context to restore),
   *   `onGateContextRestored` (named post-restore hook — no readiness assertion)
   * @returns true if reconnection succeeded and the session was loaded.
   * @throws RecoveryOwnershipError on an ownership violation (pre-teardown, zero side effects)
   * @throws GateContextRestoreError when the recovered session's own gate context cannot be established
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
    // The FIRST statement, ahead of `disconnect()`: a violation cannot kill the
    // opposite mode's live process, drop the session's gate context, or reach
    // the respond-gated re-prompt path. The trigger is the supplied recovery
    // context (`ownership` and/or `gateContext`) — a pure no-context call keeps
    // the legacy path regardless of agent type (per-spawn callers and OpenCode
    // unaware call sites). The recorded values are the TARGET: never re-resolved
    // from configuration, never mutated.
    const recoveryContextSupplied = opts?.ownership !== undefined ||
      opts?.gateContext !== undefined;
    if (recoveryContextSupplied) {
      this.verifyRecoveryOwnership(sessionId, opts?.ownership);
    }

    // ── Settings-source recheck BEFORE any teardown (row 26, D3) ────────────
    // Recovery is a native `session/load`: the owned-only posture is verified
    // against the ACTUAL recovery cwd ahead of `disconnect()`, the respawn, and
    // the load itself, so a rejection has zero disconnect/spawn/load side
    // effects (the same zero-side-effect discipline row 11 established for
    // ownership). The previously accepted overlay identities ride the recheck.
    await this.verifyOmpSettingsSourcesBeforeRequest(cwd);

    logger.info("Attempting to reconnect and resume session {sessionId}", { sessionId });

    // Capture prior model ID before disconnect() resets sessionModelIds map
    const priorModelId = this.sessionModelIds.get(sessionId);
    // Disconnect old connection (kills the dead/dying process)
    await this.disconnect();

    // Spawn new process and initialize
    await this.connect();

    // Same-mode respawn re-check (row 11, D3): `connect()` respawns from this
    // connector's own options, so the freshly spawned env namespace must still
    // equal the recorded one. Today `agentConfig.env` is the same immutable
    // object the pre-teardown check read — this is an invariant ASSERTION, the
    // documented hook point for a future connect() that rebuilds env. Drift
    // aborts here, strictly BEFORE any `session/load` is issued; the process
    // already respawned in the drifted env is torn down by the pool's release
    // path (the recovery path itself never calls disconnect for these classes).
    if (opts?.ownership) {
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

    // Legacy cwd-only restore for callers WITHOUT a recovery context (per-spawn
    // and OpenCode-unaware sites): kept in master's exact position — immediately
    // after the cache refresh, before model reapplication — so the legacy
    // sequence is strictly byte-identical even on a post-load catalog miss.
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
        trustedSkills: this.options.clientConfig?.trustedSkills,
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
    if (opts?.gateContext) {
      // A supplied context that disagrees with the recovery cwd is a restore
      // failure for this session — never a silent overwrite of either value.
      if (opts.gateContext.cwd !== cwd) {
        throw new GateContextRestoreError(
          sessionId,
          `supplied context cwd "${opts.gateContext.cwd}" disagrees with recovery cwd "${cwd}"`,
        );
      }
      this.setSessionGateContext(sessionId, opts.gateContext);
    } else if (recoveryContextSupplied && !this.sessionGateContexts.has(sessionId)) {
      // No context supplied AND none cached for the recovered id (fresh
      // connector): fail closed instead of resuming on the process-frozen
      // client fallback — that would be another session's default context.
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
