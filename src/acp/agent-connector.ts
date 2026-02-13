// src/acp/agent-connector.ts

import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient } from "./client.ts";
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
 * AgentConnector manages the lifecycle of ACP Agent connections
 * Handles spawning, connecting, and communicating with external ACP Agents
 */
export class AgentConnector {
  private connection: acp.ClientSideConnection | null = null;
  private process: Deno.ChildProcess | null = null;
  private client: ChatbotClient | null = null;
  private options: AgentConnectorOptions;
  private capabilities: AgentCapabilities | null = null;

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
    this.client = new ChatbotClient(
      skillRegistry as SkillRegistry,
      logger as Logger,
      clientConfig,
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
    } catch (error) {
      // Clean up on initialization failure
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Create a new session with the Agent
   * @param mcpServers Optional MCP servers to connect to
   * @throws Error if MCP servers use unsupported transport types
   */
  async createSession(mcpServers: MCPServerConfig[] = []): Promise<string> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    // Validate MCP server transports before creating session
    if (mcpServers.length > 0) {
      this.validateMCPServerTransports(mcpServers);
    }

    const result = await this.connection.newSession({
      cwd: this.options.agentConfig.cwd,
      mcpServers: mcpServers.map((server) => this.convertMCPServerConfig(server)),
    });

    logger.info("Session created", {
      sessionId: result.sessionId,
      mcpServerCount: mcpServers.length,
    });
    return result.sessionId;
  }

  /**
   * Validate that all MCP server transports are supported by the Agent
   * @throws Error if any server uses unsupported transport type
   */
  private validateMCPServerTransports(servers: MCPServerConfig[]): void {
    const logger = this.options.logger as Logger;

    for (const server of servers) {
      // Stdio transport is always supported
      if (!("type" in server)) {
        continue;
      }

      // Check HTTP transport support
      if (server.type === "http") {
        if (!this.supportsHTTPTransport()) {
          throw new Error(
            `Agent does not support HTTP transport for MCP servers (server: ${server.name})`,
          );
        }
        logger.debug("HTTP transport validated", { serverName: server.name });
      }

      // Check SSE transport support
      if (server.type === "sse") {
        if (!this.supportsSSETransport()) {
          throw new Error(
            `Agent does not support SSE transport for MCP servers (server: ${server.name})`,
          );
        }
        logger.debug("SSE transport validated", { serverName: server.name });
      }
    }
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

    logger.info("Session model set", { sessionId, modelId });
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

    const result = await this.connection.prompt({
      sessionId,
      prompt,
    });

    logger.info("Prompt completed", {
      sessionId,
      stopReason: result.stopReason,
      contentBlockCount: prompt.length,
    });

    return result;
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
    logger.info("Session cancelled", { sessionId });
  }

  /**
   * Disconnect from the Agent and clean up resources
   * Uses best-effort cleanup with timeout (following GitHub's ACP example)
   */
  async disconnect(): Promise<void> {
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
}
