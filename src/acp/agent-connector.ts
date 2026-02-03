// src/acp/agent-connector.ts

import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient } from "./client.ts";
import type { AgentConnectorOptions } from "./types.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";

/**
 * Timeout in milliseconds for graceful agent process shutdown
 * Following GitHub's ACP best practices
 */
const DISCONNECT_TIMEOUT_MS = 2000;

/**
 * AgentConnector manages the lifecycle of ACP Agent connections
 * Handles spawning, connecting, and communicating with external ACP Agents
 */
export class AgentConnector {
  private connection: acp.ClientSideConnection | null = null;
  private process: Deno.ChildProcess | null = null;
  private client: ChatbotClient | null = null;
  private options: AgentConnectorOptions;

  constructor(options: AgentConnectorOptions) {
    this.options = options;
  }

  /**
   * Connect to an ACP Agent by spawning a subprocess
   */
  async connect(): Promise<void> {
    const { agentConfig, clientConfig, skillRegistry, logger } = this.options;

    (logger as Logger).info("Spawning ACP agent", {
      command: agentConfig.command,
      args: agentConfig.args,
      cwd: agentConfig.cwd,
    });

    // Spawn the Agent subprocess
    const command = new Deno.Command(agentConfig.command, {
      args: agentConfig.args,
      cwd: agentConfig.cwd,
      env: agentConfig.env,
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    });

    this.process = command.spawn();

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

      (logger as Logger).info("Connected to ACP agent", {
        protocolVersion: initResult.protocolVersion,
        agentCapabilities: initResult.agentCapabilities,
      });
    } catch (error) {
      // Clean up on initialization failure
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Create a new session with the Agent
   */
  async createSession(): Promise<string> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    const result = await this.connection.newSession({
      cwd: this.options.agentConfig.cwd,
      mcpServers: [],
    });

    logger.info("Session created", { sessionId: result.sessionId });
    return result.sessionId;
  }

  /**
   * Send a prompt to the Agent and wait for response
   */
  async prompt(sessionId: string, text: string): Promise<acp.PromptResponse> {
    if (!this.connection) {
      throw new Error("Not connected to agent");
    }

    const logger = this.options.logger as Logger;

    // Reset client state for new prompt
    this.client?.reset();

    const result = await this.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }],
    });

    logger.info("Prompt completed", {
      sessionId,
      stopReason: result.stopReason,
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
  }

  /**
   * Check if connected to an Agent
   */
  get isConnected(): boolean {
    return this.connection !== null && this.process !== null;
  }

  /**
   * Get the Client instance
   */
  getClient(): ChatbotClient | null {
    return this.client;
  }
}
