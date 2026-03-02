// src/acp/agent-connector.ts

import * as acp from "@agentclientprotocol/sdk";
import { join } from "@std/path";
import { buildSkillAutoApproveList, ChatbotClient } from "./client.ts";
import type { AgentCapabilities, AgentConnectorOptions, MCPServerConfig } from "./types.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";

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
 * AgentConnector manages the lifecycle of ACP Agent connections
 * Handles spawning, connecting, and communicating with external ACP Agents
 */
export class AgentConnector {
  private connection: acp.ClientSideConnection | null = null;
  private process: Deno.ChildProcess | null = null;
  private client: ChatbotClient | null = null;
  private options: AgentConnectorOptions;
  private capabilities: AgentCapabilities | null = null;
  private currentIdleMonitorIntervalId: ReturnType<typeof setInterval> | null = null;
  private promptCompleted = false;

  constructor(options: AgentConnectorOptions) {
    this.options = options;
  }

  /**
   * Connect to an ACP Agent by spawning a subprocess
   */
  async connect(): Promise<void> {
    const { agentConfig, clientConfig, skillRegistry, logger } = this.options;

    (logger as Logger).info("Spawning ACP agent via dumb-init", {
      command: agentConfig.command,
      args: agentConfig.args,
      cwd: agentConfig.cwd,
    });

    // Spawn the Agent subprocess wrapped with dumb-init for proper signal
    // forwarding and child process reaping (prevents memory leaks from orphaned processes)
    const command = new Deno.Command(DUMB_INIT_PATH, {
      args: ["--", agentConfig.command, ...agentConfig.args],
      cwd: agentConfig.cwd,
      env: agentConfig.env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped", // Capture stderr to log error messages
    });

    this.process = command.spawn();

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

    // Create ClientSideConnection with proper stream order
    const stream = acp.ndJsonStream(output, input);
    this.connection = new acp.ClientSideConnection(
      (_agent) => this.client!,
      stream,
    );

    // Initialize the connection
    try {
      const initResult = await this.connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: false,
        },
      });
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
   * Create a new session with the Agent
   * @param mcpServers Optional MCP servers to connect to
   */
  async createSession(mcpServers: MCPServerConfig[] = []): Promise<string> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    // Filter out MCP servers with unsupported transports (skip + warn)
    const supportedServers = this.filterSupportedMCPServers(mcpServers);

    const result = await this.connection.newSession({
      cwd: this.options.agentConfig.cwd,
      mcpServers: supportedServers.map((server) => this.convertMCPServerConfig(server)),
    });

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
   * Set the model for a session
   */
  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    await this.connection.unstable_setSessionModel({
      sessionId,
      modelId,
    });

    logger.info("Session model set to {modelId} for session {sessionId}", { sessionId, modelId });
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
    this.promptCompleted = false;

    // If content is a plain string, wrap as text ContentBlock (backward compatible)
    const prompt: acp.ContentBlock[] = typeof content === "string"
      ? [{ type: "text", text: content }]
      : content;

    try {
      let result: acp.PromptResponse;

      if (this.idleTimeoutEnabled) {
        result = await Promise.race([
          this.connection.prompt({ sessionId, prompt }),
          this.monitorIdleTimeout(sessionId, logger),
        ]);
      } else {
        result = await this.connection.prompt({ sessionId, prompt });
      }

      this.promptCompleted = true;

      logger.info("Prompt completed for session {sessionId} with stopReason {stopReason}", {
        sessionId,
        stopReason: result.stopReason,
        contentBlockCount: prompt.length,
      });

      return result;
    } finally {
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

    await this.connection.cancel({ sessionId });
    logger.info("Session {sessionId} cancelled", { sessionId });
  }

  /**
   * Disconnect from the Agent and clean up resources
   * Uses best-effort cleanup with timeout (following GitHub's ACP example)
   */
  async disconnect(): Promise<void> {
    this.clearIdleMonitor();

    if (this.process) {
      try {
        this.process.kill("SIGTERM");

        // Best-effort cleanup with timeout (following GitHub's example)
        await Promise.race([
          this.process.status,
          new Promise<void>((resolve) => setTimeout(() => resolve(), DISCONNECT_TIMEOUT_MS)),
        ]);
      } catch (error) {
        // Ignore kill errors - best effort cleanup
        const logger = this.options.logger as Logger;
        logger.warn("Error killing agent process", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.process = null;
    }
    this.connection = null;
    this.client = null;
    this.capabilities = null;
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
      if (this.process !== null && !this.promptCompleted) {
        logger.error("Agent process exited unexpectedly", {
          code: status.code,
          signal: status.signal,
          success: status.success,
        });
      } else if (this.process !== null) {
        logger.debug("Agent process exited after prompt completion", {
          code: status.code,
          signal: status.signal,
          success: status.success,
        });
      }
    }).catch(() => {/* Ignore */});
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
   * Attempt to reconnect and resume an existing session.
   * Returns true if reconnection succeeded and session was loaded.
   * Returns false if session resumption is not supported.
   */
  async reconnectAndResumeSession(sessionId: string): Promise<boolean> {
    const logger = this.options.logger as Logger;

    logger.info("Attempting to reconnect and resume session {sessionId}", { sessionId });

    // Disconnect old connection
    await this.disconnect();

    // Spawn new process and initialize
    await this.connect();

    // Check if agent supports loading previous sessions
    if (!this.supportsLoadSession()) {
      logger.warn(
        "Agent does not support loadSession. Cannot resume session {sessionId}.",
        { sessionId },
      );
      await this.disconnect();
      return false;
    }

    // TODO: Call connection.loadSession() when ACP SDK supports it.
    // For now, since SDK v0.14.1 doesn't have this method,
    // this path is unreachable (supportsLoadSession() returns false for all current agents).
    await this.disconnect();
    return false;
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
}
