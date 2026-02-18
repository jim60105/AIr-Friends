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
  /** Typing indicator configuration (Discord only) */
  typingIndicator?: TypingIndicatorConfig;
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
 * User-facing MCP Server configuration.
 * Uses explicit "transport" field as discriminator for clarity in YAML config.
 * Internally converted to MCPServerConfig (from src/acp/types.ts) at load time.
 */
export interface UserMCPServerConfig {
  /** Human-readable identifier for the server (must be unique) */
  name: string;

  /** Transport type: "stdio" (default), "http", or "sse" */
  transport?: "stdio" | "http" | "sse";

  /** Command to execute (required for stdio transport) */
  command?: string;

  /** Command-line arguments (required for stdio transport) */
  args?: string[];

  /** Environment variables for stdio transport (supports ${ENV_VAR} expansion) */
  env?: Record<string, string>;

  /** Server URL (required for http/sse transport, supports ${ENV_VAR} expansion) */
  url?: string;

  /** HTTP headers (for http/sse transport, values support ${ENV_VAR} expansion) */
  headers?: Record<string, string>;
}

/**
 * Dry run / debug mode configuration.
 * When enabled, the system assembles context but does NOT call the ACP Agent.
 * Instead, the assembled prompt is written to the output directory.
 */
export interface DryRunConfig {
  /** Enable dry run mode (default: false) */
  enabled: boolean;

  /** Directory path for writing assembled prompt output (default: "./data/dry-run/") */
  outputPath: string;

  /** Optional mock reply text to send via platform adapter (empty = no reply sent) */
  mockReply: string;
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

  /** Model routing configuration (optional) */
  modelRouting?: ModelRoutingConfig;

  /** External MCP servers to register with the ACP Agent (optional) */
  mcpServers?: UserMCPServerConfig[];

  /** Dry run / debug mode configuration (optional) */
  dryRun?: DryRunConfig;
}

/**
 * Session type for model routing rules
 */
export type SessionType =
  | "message"
  | "spontaneous"
  | "self-research"
  | "memory-maintenance"
  | "reminder";

/**
 * Match condition for a model routing rule.
 * Exactly one field must be set (mutually exclusive).
 */
export interface ModelRoutingMatch {
  /** Match a specific whitelist entry (format: "{platform}/account/{id}" or "{platform}/channel/{id}") */
  whitelist?: string;
  /** Match a session type */
  sessionType?: SessionType;
}

/**
 * A single model routing rule
 */
export interface ModelRoutingRule {
  /** Match condition */
  match: ModelRoutingMatch;
  /** Model identifier to use when matched */
  model: string;
}

/**
 * Model routing configuration
 */
export interface ModelRoutingConfig {
  /** Enable model routing (default: false) */
  enabled: boolean;
  /** Ordered list of routing rules (first-match wins) */
  rules: ModelRoutingRule[];
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
 * Typing indicator configuration.
 * When enabled, the bot shows a "typing..." indicator in Discord
 * while processing a message through the ACP Agent.
 */
export interface TypingIndicatorConfig {
  /** Enable typing indicator during ACP sessions (default: false) */
  enabled: boolean;
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
 * Memory maintenance configuration.
 * When enabled, the agent periodically summarizes and compacts old memories.
 */
export interface MemoryMaintenanceConfig {
  /** Enable memory maintenance feature (default: false) */
  enabled: boolean;

  /** LLM model to use for memory maintenance (separate from chat model, e.g. "gpt-5-mini") */
  model: string;

  /** Minimum enabled memory count required before maintenance runs */
  minMemoryCount: number;

  /** Fixed interval between maintenance runs in milliseconds */
  intervalMs: number;
}

/**
 * Rate limiting configuration.
 * Prevents excessive API usage per user via sliding window + cooldown.
 */
export interface RateLimitConfig {
  /** Enable rate limiting (default: false) */
  enabled: boolean;

  /** Maximum requests allowed per sliding window per user */
  maxRequestsPerWindow: number;

  /** Sliding window duration in milliseconds (default: 600000 = 10 min) */
  windowMs: number;

  /** Cooldown period in milliseconds after limit exceeded (default: 600000 = 10 min) */
  cooldownMs: number;
}

/**
 * Metrics export configuration
 */
export interface MetricsConfig {
  /** Enable Prometheus metrics endpoint (default: false) */
  enabled: boolean;
  /** Metrics endpoint path (default: "/metrics") */
  path: string;
}

/**
 * Git backup configuration.
 * When enabled, the data/ directory is periodically committed and pushed to a remote Git repository.
 */
export interface GitBackupConfig {
  /** Enable Git backup (default: false) */
  enabled: boolean;
  /** Remote Git repository URL (HTTPS format) */
  remoteUrl: string;
  /** Backup interval in milliseconds (default: 3600000 = 1 hour) */
  intervalMs: number;
  /** Git commit author name (default: "AIr-Friends Backup") */
  authorName: string;
  /** Git commit author email (default: "airfriends-backup@noreply.github.com") */
  authorEmail: string;
}

/**
 * Scheduled reminders configuration.
 * When enabled, the agent can set future reminders for users.
 */
export interface RemindersConfig {
  /** Enable scheduled reminders (default: false) */
  enabled: boolean;

  /** Maximum number of active reminders per user (default: 20) */
  maxRemindersPerUser: number;

  /** Minimum allowed reminder interval from now in milliseconds (default: 60000 = 1 minute) */
  minIntervalMs: number;

  /** File name for reminder persistence within each workspace (default: "reminders.jsonl") */
  persistPath: string;

  /** How often the scheduler checks for due reminders in milliseconds (default: 30000 = 30 seconds) */
  checkIntervalMs: number;
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
  memoryMaintenance?: MemoryMaintenanceConfig;
  rateLimit?: RateLimitConfig;
  /** Metrics export configuration (optional) */
  metrics?: MetricsConfig;
  /** Git backup configuration (optional) */
  gitBackup?: GitBackupConfig;
  /** Scheduled reminders configuration (optional) */
  reminders?: RemindersConfig;
  /** Skills configuration (optional) */
  skills?: SkillsConfig;
}

/**
 * Skills configuration namespace
 */
export interface SkillsConfig {
  sendFile?: SendFileSkillConfig;
}

/**
 * Send-file skill configuration
 */
export interface SendFileSkillConfig {
  /** Enable send-file skill (default: false) */
  enabled?: boolean;
  /** File size limit in MB, 0 = use platform default */
  maxFileSizeMb?: number;
  /** Allowed file extensions whitelist (e.g. [".png", ".jpg"]), empty = no restriction */
  allowedExtensions?: string[];
}

/**
 * Partial config for merging/overriding
 */
export type PartialConfig = {
  [K in keyof Config]?: Partial<Config[K]>;
};
