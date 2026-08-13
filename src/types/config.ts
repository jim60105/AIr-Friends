// src/types/config.ts

import type { LogLevel } from "./logger.ts";
import type { AuditPhase } from "./audit.ts";

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
  /** Channel lurk reply configuration (Discord only) */
  channelLurk?: ChannelLurkConfig;
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
 * Git credential store configuration for agent subprocesses.
 */
export interface GitCredentialConfig {
  /** Enable git credential store setup at startup (default: false) */
  enabled: boolean;

  /**
   * Override the git host for credential store.
   * Default: extracted from gitBackup.remoteUrl, or "github.com" if not configured.
   */
  host?: string;
}

/**
 * Reasoning / thought-level effort for the ACP session.
 *
 * Resolved per-context through the same chain as model selection
 * (routing rule -> section -> global). Shared by every reasoning-effort field.
 *
 * - `"none" | "low" | "medium" | "high"`: normalized effort levels.
 * - `"default"`: sentinel meaning "do not configure reasoning effort"
 *   (let the agent/model use its own default). Empty/whitespace normalizes to this.
 * - Any other non-empty string is preserved as an agent-specific passthrough token.
 *
 * An *omitted* per-rule/per-section field stays `undefined` so the resolution
 * chain can fall through to the next level; this is distinct from the value
 * `"default"`, which terminates the chain.
 */
export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "default"
  // Allow agent-specific passthrough tokens while preserving editor autocomplete
  // for the known values above.
  // deno-lint-ignore ban-types
  | (string & {});

/**
 * Agent/LLM configuration
 */
export interface AgentConfig {
  /** Model identifier */
  model: string;

  /**
   * Global reasoning-effort default for ACP sessions (default: `"default"`).
   * Acts as the final fallback in the reasoning-effort resolution chain.
   */
  reasoningEffort?: ReasoningEffort;

  /** Path to system prompt file */
  systemPromptPath: string;

  /** Maximum tokens for context */
  tokenLimit: number;

  /** OpenCode Gemini provider API key (optional) */
  geminiApiKey?: string;

  /** OpenCode API key for OpenCode CLI (optional) */
  opencodeApiKey?: string;

  /** OpenRouter API key for OpenRouter provider (optional) */
  openRouterApiKey?: string;

  /** Default ACP agent type to use ("opencode") */
  defaultAgentType?: "opencode";

  /** Model routing configuration (optional) */
  modelRouting?: ModelRoutingConfig;

  /** External MCP servers to register with the ACP Agent (optional) */
  mcpServers?: UserMCPServerConfig[];

  /** Dry run / debug mode configuration (optional) */
  dryRun?: DryRunConfig;

  /** Git credential store config for agent subprocesses (optional) */
  gitCredential?: GitCredentialConfig;

  /** Sandbox settings for agent subprocess isolation (optional) */
  sandbox?: SandboxConfig;

  /** Path to skills directory (default: "skills") */
  skillsDir?: string;

  /** External skills to install at startup (optional) */
  externalSkills?: ExternalSkillConfig[];

  /** Idle timeout detection for ACP connections (optional) */
  idleTimeout?: IdleTimeoutConfig;

  /**
   * Maximum time in milliseconds to wait for the ACP handshake
   * (`connection.initialize()`) to complete during `connect()` (default: 30000 = 30 seconds).
   */
  connectTimeoutMs?: number;

  /** Skill names to auto-approve in restricted (non-YOLO) mode.
   *  When empty or undefined, falls back to scanning the built-in skills directory. */
  autoApproveSkills?: string[];
}

/**
 * External skill configuration for automatic installation at startup.
 * Each entry specifies a GitHub repo and skill name to install via `npx --yes --package=skills skills add`.
 */
export interface ExternalSkillConfig {
  /** GitHub repository (e.g. "jim60105/copilot-prompt") */
  repo: string;
  /** Skill name within the repository (e.g. "create-blog-post") */
  skill: string;
}

/**
 * Idle timeout detection configuration for ACP connections.
 * Detects silently disconnected Agent connections and attempts recovery.
 */
export interface IdleTimeoutConfig {
  /** Enable idle timeout detection (default: true) */
  enabled: boolean;

  /** Idle timeout in milliseconds before liveness check (default: 300000 = 5 minutes) */
  timeoutMs: number;

  /** Interval in milliseconds between idle checks (default: 30000 = 30 seconds) */
  checkIntervalMs: number;
}

/**
 * Sandbox configuration for agent subprocess isolation.
 * Controls environment variable filtering and network isolation.
 */
export interface SandboxConfig {
  /** Filter subprocess environment variables to allowed list only (default: true) */
  filterEnv: boolean;

  /** Enable full Linux network namespace isolation via unshare (default: false).
   * NOTE: full isolation gives the agent an empty network namespace, which also severs
   * its loopback access to the Skill API. Prefer `egressProxy` for a mediated posture that
   * keeps the Skill API working while blocking internal targets (F14). */
  networkIsolation: boolean;

  /** Additional environment variable names to allow through the filter */
  allowedEnvVars: string[];

  /** Allowed file extensions for agent workspace writes in restricted mode (default: [".md", ".txt"]) */
  allowedWriteExtensions: string[];

  /**
   * Confine the agent subprocess's filesystem view via a bubblewrap mount namespace so the
   * daemon's `/proc/1/environ` and other users' workspaces are not readable regardless of the
   * permission-layer configuration (F12 D4, default: FALSE — opt-in). The mechanism mounts a
   * fresh `/proc`, which is NOT possible inside a doubly-nested user namespace (e.g. rootless
   * podman); its viability must be verified against the real deployment runtime
   * (`scripts/probe-sandbox-caps.sh`) before enabling. When enabled but unavailable at runtime,
   * the system fails closed rather than spawning unconfined.
   */
  filesystemConfinement: boolean;

  /**
   * Mediate the agent's network egress through a local validating forward proxy that applies
   * SSRF rules to `webfetch`/`websearch`/`agent-browser` (F14 D1, default: true). The proxy
   * blocks loopback/private/link-local/metadata targets while allowing public destinations,
   * so the Skill API loopback channel keeps working (it bypasses the proxy via NO_PROXY).
   */
  egressProxy: boolean;

  /** Port for the validating egress proxy (0 = ephemeral; default: 0). */
  egressProxyPort: number;

  /**
   * Explicit operator opt-in to UNRESTRICTED agent egress (default: false). When true, the
   * agent reaches the network directly with no proxy mediation — only for trusted
   * single-tenant deployments that accept the SSRF risk. When neither `egressProxy` nor this
   * flag is set, the system fails closed rather than granting silent open egress.
   */
  unrestrictedEgress: boolean;

  /**
   * Operator-trusted egress destinations exempt from the validating proxy's disallowed-range
   * rejection (default: []). Each entry is a bare hostname or literal IP — no scheme, no port,
   * no path; entries carrying any of those can never match and are warned about at startup.
   * Matching is exact (case-insensitive, IPv6 brackets stripped) against the requested
   * destination host, never a range grant. Allowlisted hosts are also appended to the agent's
   * NO_PROXY so env-honoring clients connect directly. Resolved addresses in the cloud
   * metadata space (e.g. 169.254.169.254) remain blocked regardless of this list. This is an
   * operator-audited trust grant sourced only from deployment config; the agent and chat
   * users cannot extend it at runtime.
   */
  egressAllowHosts: string[];
}

/**
 * Session type for model routing rules
 */
export type SessionType =
  | "message"
  | "spontaneous"
  | "self-research"
  | "memory-maintenance"
  | "reminder"
  | "channelLurk";

/**
 * Match condition for a model routing rule.
 * All specified fields must match (AND logic).
 * Within contentKeywords, any keyword match is sufficient (OR logic).
 */
export interface ModelRoutingMatch {
  /** Match a specific channel entry (format: "{platform}/account/{id}" or "{platform}/channel/{id}") */
  channel?: string;
  /** Match a session type */
  sessionType?: SessionType;
  /** Match message content containing any of these keywords (case-insensitive, OR within array).
   *  Only effective for sessionType "message" — ignored in other session types. */
  contentKeywords?: string[];
}

/**
 * A single model routing rule
 */
export interface ModelRoutingRule {
  /** Match condition */
  match: ModelRoutingMatch;
  /** Model identifier to use when matched */
  model: string;
  /**
   * Reasoning effort to use when this rule matches (optional).
   * When omitted, resolution falls back to the section/global value.
   */
  reasoningEffort?: ReasoningEffort;
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

  /** Maximum number of working-tier entries to load at session start (default: 20) */
  workingTierLimit: number;

  /**
   * Channel-scoped memory write policy (F15). Controls whether ordinary
   * sessions may write `scope: "channel"` memory:
   * - `"sessions"` (default): ordinary channel sessions may write — entries are
   *   attributed, non-durable (decaying), bounded, and moderatable.
   * - `"curated"`: user-driven channel writes are rejected; durable channel
   *   knowledge comes only from an operator/curated flow.
   */
  channelWritePolicy?: "sessions" | "curated";
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

  /** GELF endpoint URL (e.g., "http://graylog.example.com:12202/gelf") */
  endpoint: string;

  /**
   * Hostname to include in GELF messages.
   * This identifies the source of the log message in the log server.
   * (default: "air-friends")
   */
  hostname?: string;

  /** Transport protocol: "http" for HTTP POST, "tcp" for raw TCP, "udp" for UDP (default: "http") */
  protocol?: "http" | "tcp" | "udp";

  /**
   * Enable GZIP compression for UDP transport.
   * Per GELF spec, GZIP is the default for UDP. Has no effect on HTTP or TCP transports.
   * (default: true when protocol is "udp")
   */
  compress?: boolean;
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
 * Channel lurk reply configuration (Discord only).
 * When enabled, the bot periodically checks whitelisted channels and
 * auto-replies when conditions are met.
 */
export interface ChannelLurkConfig {
  /** Enable channel lurk reply (default: false) */
  enabled: boolean;
  /** Check interval in milliseconds (default: 1800000 = 30 minutes) */
  intervalMs: number;
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

  /**
   * Idle timeout (ms) after which a session is treated as absent and rejected
   * with 401 (F13). Refreshed on each authenticated call. Should comfortably
   * exceed the longest legitimate agent turn. Defaults to 30 minutes.
   */
  sessionTimeoutMs?: number;
}

/**
 * Reply policy mode
 */
export type ReplyPolicy = "all" | "public" | "channels";

/**
 * Single channel configuration
 */
export interface ChannelConfig {
  /** Channel identifier: {platform}/account/{id}, {platform}/channel/{id}, or misskey/timeline/self */
  id: string;
  /** Whether this channel is enabled (enabled = allow reply) (default: true) */
  enabled?: boolean;
  /** Whether to enable Spontaneous Post on this channel (default: false) */
  spontaneousPost?: boolean;
  /** Whether to enable Channel Lurk on this channel (only valid for discord/channel/*) (default: false) */
  channelLurk?: boolean;
  /** Whether to bypass rate limiting (default: false) */
  rateLimitBypass?: boolean;
  /** Whether to run Agent in YOLO mode for this channel/account (default: false) */
  yolo?: boolean;
}

/**
 * Get enabled channels for a specific platform matching filter criteria
 */
export function getEnabledChannels(
  channels: ChannelConfig[],
  platform: string,
  filter?: Partial<Pick<ChannelConfig, "spontaneousPost" | "channelLurk">>,
): ChannelConfig[] {
  return channels.filter((ch) => {
    if (ch.enabled === false) return false;
    if (!ch.id.startsWith(`${platform}/`)) return false;
    if (filter?.spontaneousPost !== undefined && ch.spontaneousPost !== filter.spontaneousPost) {
      return false;
    }
    if (filter?.channelLurk !== undefined && ch.channelLurk !== filter.channelLurk) return false;
    return true;
  });
}

/**
 * Parse a channel ID string into structured components
 */
export function parseChannelId(
  id: string,
): { platform: string; type: string; value: string } | null {
  const match = id.match(/^(\w+)\/(account|channel|timeline)\/(.+)$/);
  if (!match) return null;
  return { platform: match[1], type: match[2], value: match[3] };
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

  /** Reasoning effort for self-research sessions (optional; falls back to agent.reasoningEffort) */
  reasoningEffort?: ReasoningEffort;

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

  /** Reasoning effort for memory-maintenance sessions (optional; falls back to agent.reasoningEffort) */
  reasoningEffort?: ReasoningEffort;

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
  /** HTTPS authentication username (fallback: authorEmail → "x-access-token") */
  authUser?: string;
  /** HTTPS authentication password/token (fallback: GITHUB_TOKEN env → empty string) */
  authPassword?: string;
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
 * Session audit log configuration.
 * When enabled, each session produces a JSONL audit log for replay and debugging.
 */
export interface AuditConfig {
  /** Enable audit logging (default: false) */
  enabled: boolean;
  /** Log retention in days, older files are auto-deleted (default: 7) */
  retentionDays: number;
  /** SHA-256 hash user content in audit entries (default: true) */
  hashContent: boolean;
  /** Only record these phases; empty array = record all */
  includedPhases: AuditPhase[];
}

/**
 * Conversation summary configuration.
 * Controls auto-generated summaries after each session.
 */
export interface ConversationSummaryConfig {
  /** Enable conversation summaries (default: true) */
  enabled: boolean;

  /** LLM model to use for summary generation (default: same as agent.model) */
  model?: string;

  /** Reasoning effort for conversation-summary generation (optional; falls back to agent.reasoningEffort) */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Web dashboard configuration
 */
export interface DashboardConfig {
  /** Enable web dashboard (default: false) */
  enabled: boolean;
  /** Dashboard HTTP port (default: 8090) */
  port: number;
  /**
   * Dashboard bind host (default: "127.0.0.1"). Binding to all interfaces requires
   * explicitly setting this to "0.0.0.0" (F8).
   */
  host: string;
  /** Login passphrase (required when enabled, minimum 16 characters when enabled) */
  passphrase: string;
  /**
   * Whether the dashboard is served behind an HTTPS-terminating reverse proxy (F10).
   * When true, the session cookie is issued with the `Secure` flag. This is NOT derived
   * from the spoofable `X-Forwarded-Proto` header. Default: false.
   */
  behindHttpsProxy: boolean;
  /**
   * Real connection addresses (reverse proxies) whose `X-Forwarded-For` header is trusted
   * for deriving the login rate-limit key (F5). When empty (default), `X-Forwarded-For`
   * is ignored and the real socket address is always used.
   */
  trustedProxies: string[];
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
  /** Reply policy mode */
  replyPolicy: ReplyPolicy;
  /** Channel configurations */
  channels: ChannelConfig[];
  selfResearch?: SelfResearchConfig;
  memoryMaintenance?: MemoryMaintenanceConfig;
  rateLimit?: RateLimitConfig;
  /** Metrics export configuration (optional) */
  metrics?: MetricsConfig;
  /** Git backup configuration (optional) */
  gitBackup?: GitBackupConfig;
  /** Scheduled reminders configuration (optional) */
  reminders?: RemindersConfig;
  /** Session audit log configuration (optional) */
  audit?: AuditConfig;
  /** Conversation summary configuration (optional) */
  conversationSummary?: ConversationSummaryConfig;
  /** Skills configuration (optional) */
  skills?: SkillsConfig;
  /** Web dashboard configuration (optional) */
  dashboard?: DashboardConfig;
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
  /**
   * Maximum number of files per send-file invocation (default: 10).
   * Matches Discord's per-message attachment cap.
   */
  maxFilesPerInvocation?: number;
  /**
   * Maximum aggregate size of all files in one invocation in MB (default: 50).
   * Checked before any file bytes are read.
   */
  maxTotalSizeMb?: number;
}

/**
 * Partial config for merging/overriding
 */
export type PartialConfig = {
  [K in keyof Config]?: Partial<Config[K]>;
};
