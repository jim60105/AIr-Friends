// src/acp/types.ts

/**
 * Configuration for ACP Client
 */
export interface ClientConfig {
  /** Working directory for the session */
  workingDir: string;

  /** Platform identifier */
  platform: string;

  /** User ID */
  userId: string;

  /** Channel ID */
  channelId: string;

  /** Whether this is a DM conversation */
  isDM: boolean;
}

/**
 * Configuration for ACP Agent
 */
export interface AgentConfig {
  /** Command to execute (e.g., "copilot", "gemini") */
  command: string;

  /** Arguments to pass to the command */
  args: string[];

  /** Working directory for the agent */
  cwd: string;

  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Supported ACP Agent types
 */
export type AgentType = "copilot" | "gemini";

/**
 * Options for AgentConnector
 */
export interface AgentConnectorOptions {
  agentConfig: AgentConfig;
  clientConfig: ClientConfig;
  skillRegistry: unknown; // SkillRegistry type - using unknown to avoid circular deps
  logger: unknown; // Logger type - using unknown to avoid circular deps
}
