// src/utils/env.ts

// Config-path constants for the two API-key environment overrides. Kept as
// named constants so the mapping object references variables rather than
// inlined secret-looking string literals.
const GEMINI_API_KEY_PATH = "agent.geminiApiKey";
const OPENROUTER_API_KEY_PATH = "agent.openRouterApiKey";

/**
 * Environment variable mapping for config overrides
 */
export const ENV_MAPPINGS = {
  DISCORD_TOKEN: "platforms.discord.token",
  DISCORD_ENABLED: "platforms.discord.enabled",
  MISSKEY_TOKEN: "platforms.misskey.token",
  MISSKEY_HOST: "platforms.misskey.host",
  MISSKEY_ENABLED: "platforms.misskey.enabled",
  AGENT_MODEL: "agent.model",
  AGENT_REASONING_EFFORT: "agent.reasoningEffort",
  GEMINI_API_KEY: GEMINI_API_KEY_PATH,
  OPENROUTER_API_KEY: OPENROUTER_API_KEY_PATH,
  AGENT_DEFAULT_TYPE: "agent.defaultAgentType",
  AGENT_SKILLS_DIR: "agent.skillsDir",
  LOG_LEVEL: "logging.level",
  HEALTH_PORT: "health.port",
  REPLY_POLICY: "replyPolicy",
  REPLY_TO: "replyPolicy",
  CHANNELS: "channels",

  // Spontaneous post settings - Discord
  DISCORD_SPONTANEOUS_ENABLED: "platforms.discord.spontaneousPost.enabled",
  DISCORD_SPONTANEOUS_MIN_INTERVAL_MS: "platforms.discord.spontaneousPost.minIntervalMs",
  DISCORD_SPONTANEOUS_MAX_INTERVAL_MS: "platforms.discord.spontaneousPost.maxIntervalMs",
  DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY:
    "platforms.discord.spontaneousPost.contextFetchProbability",

  // Typing indicator settings - Discord
  DISCORD_TYPING_INDICATOR_ENABLED: "platforms.discord.typingIndicator.enabled",

  // Channel lurk reply settings - Discord
  DISCORD_CHANNEL_LURK_ENABLED: "platforms.discord.channelLurk.enabled",
  DISCORD_CHANNEL_LURK_INTERVAL_MS: "platforms.discord.channelLurk.intervalMs",

  // Spontaneous post settings - Misskey
  MISSKEY_SPONTANEOUS_ENABLED: "platforms.misskey.spontaneousPost.enabled",
  MISSKEY_SPONTANEOUS_MIN_INTERVAL_MS: "platforms.misskey.spontaneousPost.minIntervalMs",
  MISSKEY_SPONTANEOUS_MAX_INTERVAL_MS: "platforms.misskey.spontaneousPost.maxIntervalMs",
  MISSKEY_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY:
    "platforms.misskey.spontaneousPost.contextFetchProbability",

  // GELF log output settings
  GELF_ENABLED: "logging.gelf.enabled",
  GELF_ENDPOINT: "logging.gelf.endpoint",
  GELF_HOSTNAME: "logging.gelf.hostname",
  GELF_PROTOCOL: "logging.gelf.protocol",
  GELF_COMPRESS: "logging.gelf.compress",

  // Per-chunk agent stream debug logging
  LOGGING_AGENT_STREAM_CHUNKS: "logging.agentStreamChunks",

  // Self-research settings
  SELF_RESEARCH_ENABLED: "selfResearch.enabled",
  SELF_RESEARCH_MODEL: "selfResearch.model",
  SELF_RESEARCH_RSS_FEEDS: "selfResearch.rssFeeds",
  SELF_RESEARCH_MIN_INTERVAL_MS: "selfResearch.minIntervalMs",
  SELF_RESEARCH_MAX_INTERVAL_MS: "selfResearch.maxIntervalMs",
  SELF_RESEARCH_VERIFY_COMPLETION: "selfResearch.verifyCompletion",

  // Memory maintenance settings
  MEMORY_MAINTENANCE_ENABLED: "memoryMaintenance.enabled",
  MEMORY_MAINTENANCE_MODEL: "memoryMaintenance.model",
  MEMORY_MAINTENANCE_MIN_MEMORY_COUNT: "memoryMaintenance.minMemoryCount",
  MEMORY_MAINTENANCE_INTERVAL_MS: "memoryMaintenance.intervalMs",

  // Metrics settings
  METRICS_ENABLED: "metrics.enabled",
  METRICS_PATH: "metrics.path",

  // Rate limit settings
  RATE_LIMIT_ENABLED: "rateLimit.enabled",
  RATE_LIMIT_MAX_REQUESTS_PER_WINDOW: "rateLimit.maxRequestsPerWindow",
  RATE_LIMIT_WINDOW_MS: "rateLimit.windowMs",
  RATE_LIMIT_COOLDOWN_MS: "rateLimit.cooldownMs",

  // Model routing settings
  MODEL_ROUTING_ENABLED: "agent.modelRouting.enabled",
  MODEL_ROUTING_RULES: "agent.modelRouting.rules",

  // MCP Server configuration
  AGENT_MCP_SERVERS: "agent.mcpServers",

  // Dry run / debug mode settings
  DRY_RUN_ENABLED: "agent.dryRun.enabled",
  DRY_RUN_OUTPUT_PATH: "agent.dryRun.outputPath",
  DRY_RUN_MOCK_REPLY: "agent.dryRun.mockReply",

  // Git credential store for agent subprocesses
  AGENT_GIT_CREDENTIAL_ENABLED: "agent.gitCredential.enabled",
  AGENT_GIT_CREDENTIAL_HOST: "agent.gitCredential.host",

  // Git backup settings
  GIT_BACKUP_ENABLED: "gitBackup.enabled",
  GIT_BACKUP_REMOTE_URL: "gitBackup.remoteUrl",
  GIT_BACKUP_INTERVAL_MS: "gitBackup.intervalMs",
  GIT_BACKUP_AUTHOR_NAME: "gitBackup.authorName",
  GIT_BACKUP_AUTHOR_EMAIL: "gitBackup.authorEmail",
  GIT_BACKUP_AUTH_USER: "gitBackup.authUser",
  GIT_BACKUP_AUTH_PASSWORD: "gitBackup.authPassword",

  // Send-file skill settings
  SKILL_SEND_FILE_ENABLED: "skills.sendFile.enabled",
  SKILL_SEND_FILE_MAX_SIZE_MB: "skills.sendFile.maxFileSizeMb",
  SKILL_SEND_FILE_ALLOWED_EXTENSIONS: "skills.sendFile.allowedExtensions",
  SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION: "skills.sendFile.maxFilesPerInvocation",
  SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB: "skills.sendFile.maxTotalSizeMb",

  // External skills installation
  AGENT_EXTERNAL_SKILLS: "agent.externalSkills",

  // Agent sandbox settings
  AGENT_SANDBOX_FILTER_ENV: "agent.sandbox.filterEnv",
  AGENT_SANDBOX_NETWORK_ISOLATION: "agent.sandbox.networkIsolation",
  AGENT_SANDBOX_ALLOWED_ENV_VARS: "agent.sandbox.allowedEnvVars",
  AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS: "agent.sandbox.allowedWriteExtensions",
  AGENT_SANDBOX_FILESYSTEM_CONFINEMENT: "agent.sandbox.filesystemConfinement",
  AGENT_SANDBOX_EGRESS_PROXY: "agent.sandbox.egressProxy",
  AGENT_SANDBOX_EGRESS_PROXY_PORT: "agent.sandbox.egressProxyPort",
  AGENT_SANDBOX_UNRESTRICTED_EGRESS: "agent.sandbox.unrestrictedEgress",
  AGENT_SANDBOX_EGRESS_ALLOW_HOSTS: "agent.sandbox.egressAllowHosts",

  // Agent skill auto-approve list
  AGENT_AUTO_APPROVE_SKILLS: "agent.autoApproveSkills",

  // Agent idle timeout settings
  AGENT_IDLE_TIMEOUT_ENABLED: "agent.idleTimeout.enabled",
  AGENT_IDLE_TIMEOUT_MS: "agent.idleTimeout.timeoutMs",
  AGENT_IDLE_TIMEOUT_CHECK_INTERVAL_MS: "agent.idleTimeout.checkIntervalMs",

  // Agent connect-time handshake timeout
  AGENT_CONNECT_TIMEOUT_MS: "agent.connectTimeoutMs",

  // Shared ACP process pool settings
  AGENT_SHARED_PROCESS_ENABLED: "agent.sharedProcess.enabled",
  AGENT_SHARED_PROCESS_RECLAIM_IDLE_MS: "agent.sharedProcess.reclaimIdleMs",
  AGENT_SHARED_PROCESS_JWT_DIR: "agent.sharedProcess.jwtDir",
  AGENT_SHARED_PROCESS_SECRET_PATH: "agent.sharedProcess.secretPath",
  AGENT_SHARED_PROCESS_QUEUE_DEADLINE_MS: "agent.sharedProcess.queueDeadlineMs",

  // Scheduled reminders settings
  REMINDERS_ENABLED: "reminders.enabled",
  REMINDERS_MAX_PER_USER: "reminders.maxRemindersPerUser",
  REMINDERS_MIN_INTERVAL_MS: "reminders.minIntervalMs",
  REMINDERS_PERSIST_PATH: "reminders.persistPath",
  REMINDERS_CHECK_INTERVAL_MS: "reminders.checkIntervalMs",

  // Conversation summary settings
  CONVERSATION_SUMMARY_ENABLED: "conversationSummary.enabled",
  CONVERSATION_SUMMARY_MODEL: "conversationSummary.model",

  // Session audit log settings
  AUDIT_ENABLED: "audit.enabled",
  AUDIT_RETENTION_DAYS: "audit.retentionDays",
  AUDIT_HASH_CONTENT: "audit.hashContent",
  AUDIT_INCLUDED_PHASES: "audit.includedPhases",
  // Dashboard settings
  DASHBOARD_ENABLED: "dashboard.enabled",
  DASHBOARD_PORT: "dashboard.port",
  DASHBOARD_HOST: "dashboard.host",
  DASHBOARD_PASSPHRASE: "dashboard.passphrase",
  DASHBOARD_BEHIND_HTTPS_PROXY: "dashboard.behindHttpsProxy",
  DASHBOARD_TRUSTED_PROXIES: "dashboard.trustedProxies",
} as const;

/**
 * Get required environment variable or throw
 */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
export function getEnv(name: string, defaultValue: string): string {
  return Deno.env.get(name) ?? defaultValue;
}

/**
 * Get current environment name
 */
export function getEnvironment(): string {
  return Deno.env.get("DENO_ENV") ?? Deno.env.get("ENV") ?? "development";
}

/**
 * Set a nested property in an object using dot notation path
 */
export function setNestedProperty(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Apply environment variable overrides to config object
 */
export function applyEnvOverrides(config: Record<string, unknown>): void {
  for (const [envName, configPath] of Object.entries(ENV_MAPPINGS)) {
    const value = Deno.env.get(envName);
    if (value !== undefined && value !== "") {
      // Handle special cases for boolean/number conversion
      let parsedValue: unknown = value;
      if (value === "true") parsedValue = true;
      else if (value === "false") parsedValue = false;
      else if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);
      else if (/^\d+\.\d+$/.test(value)) parsedValue = parseFloat(value);
      // Handle strict boolean-only overrides: any other value is ignored with a warning.
      else if (envName === "SELF_RESEARCH_VERIFY_COMPLETION") {
        console.warn(
          `Invalid ${envName} value "${value}" (expected "true" or "false"); ignoring override`,
        );
        continue;
      } // Handle comma-separated arrays
      else if (
        envName === "SKILL_SEND_FILE_ALLOWED_EXTENSIONS" ||
        envName === "AGENT_SANDBOX_ALLOWED_ENV_VARS" ||
        envName === "AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS" ||
        envName === "AUDIT_INCLUDED_PHASES" ||
        envName === "AGENT_AUTO_APPROVE_SKILLS" ||
        envName === "DASHBOARD_TRUSTED_PROXIES" ||
        envName === "AGENT_SANDBOX_EGRESS_ALLOW_HOSTS"
      ) {
        parsedValue = value.split(",").map((s) => s.trim()).filter((s) => s !== "");
      } // Handle REPLY_POLICY / REPLY_TO: map "whitelist" → "channels" for backward compat
      else if (envName === "REPLY_POLICY" || envName === "REPLY_TO") {
        parsedValue = value === "whitelist" ? "channels" : value;
      } // Handle JSON string for CHANNELS
      else if (envName === "CHANNELS") {
        try {
          parsedValue = JSON.parse(value);
          if (!Array.isArray(parsedValue)) {
            continue;
          }
        } catch {
          continue;
        }
      } // Handle JSON string for MODEL_ROUTING_RULES
      else if (envName === "MODEL_ROUTING_RULES") {
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If JSON parse fails, skip this override
          continue;
        }
      } // Handle JSON string for SELF_RESEARCH_RSS_FEEDS
      else if (envName === "SELF_RESEARCH_RSS_FEEDS") {
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If JSON parse fails, skip this override
          continue;
        }
      } // Handle JSON string for AGENT_EXTERNAL_SKILLS
      else if (envName === "AGENT_EXTERNAL_SKILLS") {
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If JSON parse fails, skip this override
          continue;
        }
      } // Handle JSON string for AGENT_MCP_SERVERS
      else if (envName === "AGENT_MCP_SERVERS") {
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If JSON parse fails, skip this override
          continue;
        }
      }

      setNestedProperty(config, configPath, parsedValue);
    }
  }
}
