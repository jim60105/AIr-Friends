// src/types/config.ts

import type { LogLevel } from "./logger.ts";

/**
 * Base platform configuration
 */
export interface BasePlatformConfig {
  enabled: boolean;
}

/**
 * Discord platform configuration
 */
export interface DiscordConfig extends BasePlatformConfig {
  token: string;
  /** Optional: specific guild IDs to operate in (empty = all guilds) */
  guildIds?: string[];
}

/**
 * Misskey platform configuration
 */
export interface MisskeyConfig extends BasePlatformConfig {
  host: string;
  token: string;
}

/**
 * Platform configurations
 */
export interface PlatformsConfig {
  discord: DiscordConfig;
  misskey: MisskeyConfig;
}

/**
 * Agent/LLM configuration
 */
export interface AgentConfig {
  /** Model identifier */
  model: string;

  /** Path to system prompt file */
  systemPromptPath: string;

  /** Maximum tokens for context */
  tokenLimit: number;

  /** GitHub token for GitHub Copilot CLI (optional) */
  githubToken?: string;

  /** Gemini API key for Gemini CLI (optional) */
  geminiApiKey?: string;

  /** OpenCode API key for OpenCode CLI (optional) */
  opencodeApiKey?: string;

  /** OpenRouter API key for OpenRouter provider (optional) */
  openRouterApiKey?: string;

  /** Default ACP agent type to use ("copilot", "gemini", or "opencode") */
  defaultAgentType?: "copilot" | "gemini" | "opencode";
}

/**
 * Memory system configuration
 */
export interface MemoryConfig {
  /** Maximum number of search results to return */
  searchLimit: number;

  /** Maximum characters for memory content */
  maxChars: number;

  /** Number of recent messages to include in context */
  recentMessageLimit: number;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Root path for all data (local repo) */
  repoPath: string;

  /** Directory name for workspaces under repoPath */
  workspacesDir: string;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Log level (DEBUG, INFO, WARN, ERROR, FATAL) */
  level: keyof typeof LogLevel;
}

/**
 * Health check configuration
 */
export interface HealthConfig {
  /** Enable HTTP health check endpoint */
  enabled: boolean;

  /** Port for health check endpoint */
  port: number;
}

/**
 * Skill API configuration
 */
export interface SkillAPIConfig {
  /** Enable skill API server */
  enabled: boolean;

  /** Port for skill API server */
  port: number;

  /** Host for skill API server (should be localhost) */
  host: string;

  /** Session timeout in milliseconds */
  sessionTimeoutMs: number;
}

/**
 * Complete application configuration
 */
export interface Config {
  platforms: PlatformsConfig;
  agent: AgentConfig;
  memory: MemoryConfig;
  workspace: WorkspaceConfig;
  logging: LoggingConfig;
  health?: HealthConfig;
  skillApi?: SkillAPIConfig;
}

/**
 * Partial config for merging/overriding
 */
export type PartialConfig = {
  [K in keyof Config]?: Partial<Config[K]>;
};
