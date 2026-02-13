// src/acp/types.ts

/**
 * Configuration for ACP Client
 */
export interface ClientConfig {
  /** Working directory for the session */
  workingDir: string;

  /** Agent global workspace path */
  agentWorkspacePath?: string;

  /** Platform identifier */
  platform: string;

  /** User ID */
  userId: string;

  /** Channel ID */
  channelId: string;

  /** Whether this is a DM conversation */
  isDM: boolean;

  /** YOLO mode: auto-approve all permission requests */
  yolo?: boolean;
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
export type AgentType = "copilot" | "gemini" | "opencode";

/**
 * MCP transport capabilities reported by Agent
 */
export interface MCPCapabilities {
  /** Whether the Agent supports HTTP transport for MCP servers */
  http?: boolean;
  /** Whether the Agent supports SSE transport for MCP servers */
  sse?: boolean;
}

/**
 * Prompt content capabilities (image, audio, embeddedContext)
 * Reported by Agent during initialization
 */
export interface PromptCapabilities {
  /** Agent supports ContentBlock::Image in prompt requests */
  image?: boolean;
  /** Agent supports ContentBlock::Audio in prompt requests */
  audio?: boolean;
  /** Agent supports ContentBlock::Resource (embedded context) */
  embeddedContext?: boolean;
}

/**
 * Agent capabilities reported during initialization
 */
export interface AgentCapabilities {
  /** Whether the Agent supports loading previous sessions */
  loadSession?: boolean;
  /** MCP transport capabilities */
  mcpCapabilities?: MCPCapabilities;
  /** Prompt content type capabilities */
  promptCapabilities?: PromptCapabilities;
}

/**
 * MCP Server configuration base
 */
export interface BaseMCPServerConfig {
  /** Human-readable identifier for the server */
  name: string;
}

/**
 * MCP Server using stdio transport (required support by all Agents)
 */
export interface StdioMCPServerConfig extends BaseMCPServerConfig {
  /** The absolute path to the MCP server executable */
  command: string;
  /** Command-line 引數 to pass to the server */
  args: string[];
  /** Environment 變數 to set when launching the server */
  env?: Array<{ name: string; value: string }>;
}

/**
 * MCP Server using HTTP transport (optional capability)
 */
export interface HTTPMCPServerConfig extends BaseMCPServerConfig {
  /** Must be "http" to indicate HTTP transport */
  type: "http";
  /** The URL of the MCP server */
  url: string;
  /** HTTP headers to include in requests */
  headers?: Array<{ name: string; value: string }>;
}

/**
 * MCP Server using SSE transport (optional capability, deprecated)
 */
export interface SSEMCPServerConfig extends BaseMCPServerConfig {
  /** Must be "sse" to indicate SSE transport */
  type: "sse";
  /** The URL of the SSE endpoint */
  url: string;
  /** HTTP headers to include when establishing the SSE connection */
  headers?: Array<{ name: string; value: string }>;
}

/**
 * Union type for all MCP server configurations
 */
export type MCPServerConfig =
  | StdioMCPServerConfig
  | HTTPMCPServerConfig
  | SSEMCPServerConfig;

/**
 * Retry prompt strategy for different agent types.
 * Used when an agent completes without sending a reply.
 */
export interface RetryPromptStrategy {
  /** The prompt message to send when retrying */
  retryPromptMessage: string;

  /** Maximum number of retry attempts (should be 1 to avoid infinite loops) */
  maxRetries: number;
}

/**
 * Options for AgentConnector
 */
export interface AgentConnectorOptions {
  agentConfig: AgentConfig;
  clientConfig: ClientConfig;
  skillRegistry: unknown; // SkillRegistry type - using unknown to avoid circular deps
  logger: unknown; // Logger type - using unknown to avoid circular deps
}
