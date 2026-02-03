// src/acp/mod.ts

/**
 * ACP (Agent Client Protocol) module
 * Provides client-side integration with external ACP Agents
 */

export { ChatbotClient } from "./client.ts";
export { AgentConnector } from "./agent-connector.ts";
export { createAgentConfig, getDefaultAgentType } from "./agent-factory.ts";
export type { AgentConfig, AgentConnectorOptions, AgentType, ClientConfig } from "./types.ts";
