// src/utils/env.ts

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
  GITHUB_TOKEN: "agent.githubToken",
  GEMINI_API_KEY: "agent.geminiApiKey",
  OPENROUTER_API_KEY: "agent.openRouterApiKey",
  AGENT_DEFAULT_TYPE: "agent.defaultAgentType",
  LOG_LEVEL: "logging.level",
  HEALTH_PORT: "health.port",
  REPLY_TO: "accessControl.replyTo",
  WHITELIST: "accessControl.whitelist",

  // Spontaneous post settings - Discord
  DISCORD_SPONTANEOUS_ENABLED: "platforms.discord.spontaneousPost.enabled",
  DISCORD_SPONTANEOUS_MIN_INTERVAL_MS: "platforms.discord.spontaneousPost.minIntervalMs",
  DISCORD_SPONTANEOUS_MAX_INTERVAL_MS: "platforms.discord.spontaneousPost.maxIntervalMs",
  DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY:
    "platforms.discord.spontaneousPost.contextFetchProbability",

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

  // Self-research settings
  SELF_RESEARCH_ENABLED: "selfResearch.enabled",
  SELF_RESEARCH_MODEL: "selfResearch.model",
  SELF_RESEARCH_RSS_FEEDS: "selfResearch.rssFeeds",
  SELF_RESEARCH_MIN_INTERVAL_MS: "selfResearch.minIntervalMs",
  SELF_RESEARCH_MAX_INTERVAL_MS: "selfResearch.maxIntervalMs",

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
      // Handle comma-separated array for WHITELIST
      else if (envName === "WHITELIST") {
        parsedValue = value.split(",").map((s) => s.trim()).filter((s) => s !== "");
      } // Handle JSON string for SELF_RESEARCH_RSS_FEEDS
      else if (envName === "SELF_RESEARCH_RSS_FEEDS") {
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
