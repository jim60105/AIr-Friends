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
  /** Spontaneous posting configuration */
  spontaneousPost?: SpontaneousPostConfig;
}

/**
 * Misskey platform configuration
 */
export interface MisskeyConfig extends BasePlatformConfig {
  host: string;
  token: string;
  /** Spontaneous posting configuration */
  spontaneousPost?: SpontaneousPostConfig;
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
 * GELF (Graylog Extended Log Format) output configuration
 */
export interface GelfConfig {
  /** Enable GELF log output (default: false) */
  enabled: boolean;

  /** GELF HTTP endpoint URL (e.g., "http://graylog.example.com:12202/gelf") */
  endpoint: string;

  /**
   * Hostname to include in GELF messages.
   * This identifies the source of the log message in the log server.
   * (default: "air-friends")
   */
  hostname?: string;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /** Log level (DEBUG, INFO, WARN, ERROR, FATAL) */
  level: keyof typeof LogLevel;

  /** GELF output configuration (optional) */
  gelf?: GelfConfig;
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
 * Spontaneous post configuration for a platform.
 * When enabled, the agent will periodically post messages/notes without user triggers.
 */
export interface SpontaneousPostConfig {
  /** Enable spontaneous posting (default: false) */
  enabled: boolean;

  /** Minimum interval between posts in milliseconds (default: 10800000 = 3 hours) */
  minIntervalMs: number;

  /** Maximum interval between posts in milliseconds (default: 43200000 = 12 hours) */
  maxIntervalMs: number;

  /**
   * Probability (0.0 to 1.0) of fetching recent messages as context.
   * When not fetched, the agent creates content without conversation context.
   * (default: 0.5)
   */
  contextFetchProbability: number;
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
 * Reply policy mode
 */
export type ReplyPolicy = "all" | "public" | "whitelist";

/**
 * Access control configuration
 */
export interface AccessControlConfig {
  /** Reply policy mode (default: "whitelist") */
  replyTo: ReplyPolicy;

  /** Whitelist entries in format "{platform}/account/{id}" or "{platform}/channel/{id}" */
  whitelist: string[];
}

/**
 * RSS feed source configuration
 */
export interface RssFeedSource {
  /** RSS feed URL */
  url: string;
  /** Optional display name for the feed */
  name?: string;
}

/**
 * Self-research configuration.
 * When enabled, the agent periodically reads RSS feeds and researches topics.
 */
export interface SelfResearchConfig {
  /** Enable self-research feature (default: false) */
  enabled: boolean;

  /** LLM model to use for self-research (separate from chat model) */
  model: string;

  /** RSS feed sources */
  rssFeeds: RssFeedSource[];

  /** Minimum interval between research sessions in milliseconds (default: 43200000 = 12 hours) */
  minIntervalMs: number;

  /** Maximum interval between research sessions in milliseconds (default: 86400000 = 24 hours) */
  maxIntervalMs: number;
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
  accessControl: AccessControlConfig;
  selfResearch?: SelfResearchConfig;
}

/**
 * Partial config for merging/overriding
 */
export type PartialConfig = {
  [K in keyof Config]?: Partial<Config[K]>;
};
