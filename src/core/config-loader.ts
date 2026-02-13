// src/core/config-loader.ts

import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { basename, dirname, join } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { applyEnvOverrides, getEnvironment } from "@utils/env.ts";
import type { Config, MemoryMaintenanceConfig, RateLimitConfig } from "../types/config.ts";
import { ConfigError, ErrorCode } from "../types/errors.ts";

const logger = createLogger("ConfigLoader");

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<Config> = {
  memory: {
    searchLimit: 10,
    maxChars: 2000,
    recentMessageLimit: 20,
  },
  logging: {
    level: "INFO",
    gelf: {
      enabled: false,
      endpoint: "",
    },
  },
  health: {
    enabled: false,
    port: 8080,
  },
  skillApi: {
    enabled: true,
    port: 3001,
    host: "127.0.0.1",
    sessionTimeoutMs: 1800000, // 30 minutes
  },
  accessControl: {
    replyTo: "whitelist",
    whitelist: [],
  },
};

/**
 * Default spontaneous post configuration
 */
const DEFAULT_SPONTANEOUS_POST = {
  enabled: false,
  minIntervalMs: 10800000, // 3 hours
  maxIntervalMs: 43200000, // 12 hours
  contextFetchProbability: 0.5,
};

/**
 * Default self-research configuration
 */
const DEFAULT_SELF_RESEARCH = {
  enabled: false,
  model: "",
  rssFeeds: [],
  minIntervalMs: 43200000, // 12 hours
  maxIntervalMs: 86400000, // 24 hours
};

/**
 * Default memory maintenance configuration
 */
/**
 * Default rate limit configuration
 */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: false,
  maxRequestsPerWindow: 10,
  windowMs: 600000, // 10 minutes
  cooldownMs: 600000, // 10 minutes
};

const DEFAULT_MEMORY_MAINTENANCE: MemoryMaintenanceConfig = {
  enabled: false,
  model: "gpt-5-mini",
  minMemoryCount: 50,
  intervalMs: 604800000, // 7 days
};

/**
 * Required configuration fields that must be present
 */
const REQUIRED_FIELDS = [
  "platforms.discord.token",
  "agent.model",
  "agent.systemPromptPath",
  "workspace.repoPath",
  "workspace.workspacesDir",
] as const;

/**
 * Validate that all required fields are present
 */
function validateConfig(config: Record<string, unknown>): void {
  const missing: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const parts = field.split(".");
    let current: unknown = config;

    for (const part of parts) {
      if (current === null || typeof current !== "object") {
        missing.push(field);
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined || current === "") {
      missing.push(field);
    }
  }

  // Special case: at least one platform must be enabled
  const platforms = config.platforms as Record<string, { enabled?: boolean }> | undefined;
  const hasEnabledPlatform = platforms &&
    Object.values(platforms).some((p) => p?.enabled === true);

  if (!hasEnabledPlatform) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "At least one platform must be enabled",
      { platforms: Object.keys(platforms ?? {}) },
    );
  }

  if (missing.length > 0) {
    throw new ConfigError(
      ErrorCode.CONFIG_MISSING_FIELD,
      `Missing required configuration fields: ${missing.join(", ")}`,
      { missingFields: missing },
    );
  }

  // Validate accessControl.replyTo value
  const accessControl = config.accessControl as
    | { replyTo?: unknown; whitelist?: unknown[] }
    | undefined;
  if (accessControl?.replyTo !== undefined) {
    const validReplyPolicies = ["all", "public", "whitelist"];
    if (!validReplyPolicies.includes(String(accessControl.replyTo))) {
      throw new ConfigError(
        ErrorCode.CONFIG_INVALID,
        `Invalid accessControl.replyTo value: "${accessControl.replyTo}". Must be one of: ${
          validReplyPolicies.join(", ")
        }`,
        { replyTo: accessControl.replyTo, validValues: validReplyPolicies },
      );
    }
  }

  // Validate accessControl.whitelist entries format
  // Pattern allows alphanumeric, underscore, hyphen, and some special chars commonly used in IDs
  // Excludes whitespace, path separators, and other potentially dangerous characters
  const WHITELIST_ENTRY_PATTERN = /^(discord|misskey)\/(account|channel)\/[a-zA-Z0-9_\-@.]+$/;
  if (accessControl?.whitelist && Array.isArray(accessControl.whitelist)) {
    const validEntries: string[] = [];
    for (const entry of accessControl.whitelist) {
      if (typeof entry === "string" && WHITELIST_ENTRY_PATTERN.test(entry)) {
        validEntries.push(entry);
      } else {
        logger.warn("Invalid whitelist entry format, ignoring", {
          entry,
          expectedFormat: "{platform}/account/{id} or {platform}/channel/{id}",
        });
      }
    }
    // Replace whitelist with only valid entries
    accessControl.whitelist = validEntries;
  }

  // Validate spontaneous post config for each platform
  for (const platformName of ["discord", "misskey"] as const) {
    const platformConfig = (config.platforms as Record<string, Record<string, unknown>>)?.[
      platformName
    ];
    if (!platformConfig) continue;

    // Apply default spontaneous post config if not set
    if (!platformConfig.spontaneousPost) {
      platformConfig.spontaneousPost = { ...DEFAULT_SPONTANEOUS_POST };
    } else {
      // Merge with defaults for missing fields
      platformConfig.spontaneousPost = {
        ...DEFAULT_SPONTANEOUS_POST,
        ...(platformConfig.spontaneousPost as Record<string, unknown>),
      };
    }

    const sp = platformConfig.spontaneousPost as Record<string, unknown>;

    if (sp.minIntervalMs !== undefined && sp.maxIntervalMs !== undefined) {
      if ((sp.minIntervalMs as number) > (sp.maxIntervalMs as number)) {
        logger.warn("spontaneousPost.minIntervalMs > maxIntervalMs, swapping values", {
          platform: platformName,
        });
        [sp.minIntervalMs, sp.maxIntervalMs] = [sp.maxIntervalMs, sp.minIntervalMs];
      }
      if ((sp.minIntervalMs as number) < 60000) {
        logger.warn("spontaneousPost.minIntervalMs < 1 minute, clamping to 60000", {
          platform: platformName,
        });
        sp.minIntervalMs = 60000;
      }
    }
    if (sp.contextFetchProbability !== undefined) {
      if (
        (sp.contextFetchProbability as number) < 0 ||
        (sp.contextFetchProbability as number) > 1
      ) {
        logger.warn("spontaneousPost.contextFetchProbability out of range [0, 1], clamping", {
          platform: platformName,
        });
        sp.contextFetchProbability = Math.max(
          0,
          Math.min(1, sp.contextFetchProbability as number),
        );
      }
    }
  }

  // Validate selfResearch config
  if (!config.selfResearch) {
    config.selfResearch = { ...DEFAULT_SELF_RESEARCH };
  } else {
    config.selfResearch = {
      ...DEFAULT_SELF_RESEARCH,
      ...(config.selfResearch as Record<string, unknown>),
    };
  }

  const sr = config.selfResearch as Record<string, unknown>;

  if (sr.enabled === true) {
    // Disable if rssFeeds is empty
    if (!Array.isArray(sr.rssFeeds) || (sr.rssFeeds as unknown[]).length === 0) {
      logger.warn("selfResearch.enabled but rssFeeds is empty, disabling");
      sr.enabled = false;
    }
    // Disable if model is empty
    if (!sr.model || (sr.model as string).trim() === "") {
      logger.warn("selfResearch.enabled but model is empty, disabling");
      sr.enabled = false;
    }
    // Filter out RSS feeds with empty url
    if (Array.isArray(sr.rssFeeds)) {
      sr.rssFeeds = (sr.rssFeeds as { url?: string }[]).filter((f) => f.url && f.url.trim() !== "");
    }
  }

  if (sr.minIntervalMs !== undefined && sr.maxIntervalMs !== undefined) {
    if ((sr.minIntervalMs as number) < 3600000) {
      logger.warn("selfResearch.minIntervalMs < 1 hour, clamping to 3600000");
      sr.minIntervalMs = 3600000;
    }
    if ((sr.minIntervalMs as number) > (sr.maxIntervalMs as number)) {
      logger.warn("selfResearch.minIntervalMs > maxIntervalMs, swapping values");
      [sr.minIntervalMs, sr.maxIntervalMs] = [sr.maxIntervalMs, sr.minIntervalMs];
    }
  }

  // Memory Maintenance defaults and validation
  if (!config.memoryMaintenance) {
    config.memoryMaintenance = { ...DEFAULT_MEMORY_MAINTENANCE };
  } else {
    config.memoryMaintenance = {
      ...DEFAULT_MEMORY_MAINTENANCE,
      ...(config.memoryMaintenance as Record<string, unknown>),
    };
  }

  const mm = config.memoryMaintenance as Record<string, unknown>;

  if ((mm.intervalMs as number) < 3600000) {
    logger.warn("memoryMaintenance.intervalMs too small, clamping to 1 hour");
    mm.intervalMs = 3600000;
  }

  if ((mm.minMemoryCount as number) < 10) {
    logger.warn("memoryMaintenance.minMemoryCount too small, clamping to 10");
    mm.minMemoryCount = 10;
  }

  if (mm.enabled === true && (!mm.model || String(mm.model).trim() === "")) {
    logger.warn("memoryMaintenance enabled but no model specified, disabling");
    mm.enabled = false;
  }

  // Rate limit defaults
  if (!config.rateLimit) {
    config.rateLimit = { ...DEFAULT_RATE_LIMIT };
  } else {
    config.rateLimit = {
      ...DEFAULT_RATE_LIMIT,
      ...(config.rateLimit as Record<string, unknown>),
    };
  }
}

/**
 * Deep merge two objects
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(
        (result[key] as Record<string, unknown>) ?? {},
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Load configuration from YAML file
 */
async function loadYamlFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await Deno.readTextFile(path);
    const parsed = parseYaml(content);

    if (parsed === null || typeof parsed !== "object") {
      throw new ConfigError(
        ErrorCode.CONFIG_INVALID,
        "Configuration file must be a YAML object",
        { path },
      );
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ConfigError(
        ErrorCode.CONFIG_NOT_FOUND,
        `Configuration file not found: ${path}`,
        { path },
      );
    }
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Failed to parse configuration file: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { path },
    );
  }
}

/**
 * Load and validate configuration
 *
 * Loading order (later overrides earlier):
 * 1. Default configuration
 * 2. Base config file (config.yaml)
 * 3. Environment-specific config (config.{env}.yaml)
 * 4. Environment variables
 */
export async function loadConfig(basePath: string = "."): Promise<Config> {
  const env = getEnvironment();
  logger.info("Loading configuration", { environment: env, basePath });

  // Start with defaults
  let config = deepMerge({}, DEFAULT_CONFIG as Record<string, unknown>);

  // Load base config
  const baseConfigPath = `${basePath}/config.yaml`;
  if (await exists(baseConfigPath)) {
    logger.debug("Loading base config", { path: baseConfigPath });
    const baseConfig = await loadYamlFile(baseConfigPath);
    config = deepMerge(config, baseConfig);
  } else {
    logger.warn("Base config file not found", { path: baseConfigPath });
  }

  // Load environment-specific config
  const envConfigPath = `${basePath}/config.${env}.yaml`;
  if (await exists(envConfigPath)) {
    logger.debug("Loading environment config", { path: envConfigPath, environment: env });
    const envConfig = await loadYamlFile(envConfigPath);
    config = deepMerge(config, envConfig);
  }

  // Apply environment variable overrides
  applyEnvOverrides(config);

  // Validate final configuration
  validateConfig(config);

  logger.info("Configuration loaded successfully", {
    enabledPlatforms: Object.entries(
      (config.platforms as Record<string, { enabled?: boolean }>) ?? {},
    )
      .filter(([, v]) => v?.enabled)
      .map(([k]) => k),
  });

  return config as unknown as Config;
}

/**
 * Load system prompt from file, replacing {{placeholder}} tokens
 * with the content of corresponding .md files in the same directory.
 *
 * For example, if system.md contains {{character_name}}, it will be
 * replaced with the trimmed content of character_name.md in the prompts directory.
 * Placeholders without a corresponding file are left unchanged and a warning is logged.
 */
export async function loadSystemPrompt(path: string): Promise<string> {
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ConfigError(
        ErrorCode.CONFIG_NOT_FOUND,
        `System prompt file not found: ${path}`,
        { path },
      );
    }
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Failed to read system prompt: ${error instanceof Error ? error.message : String(error)}`,
      { path },
    );
  }

  // Build a map of available template fragment files in the same directory
  const promptDir = dirname(path);
  const systemFileName = basename(path);
  const fragments = await loadPromptFragments(promptDir, systemFileName);

  // Replace all {{placeholder}} tokens
  content = replacePlaceholders(content, fragments);

  return content.trim();
}

/**
 * Scan the prompt directory for .md files (excluding the system prompt file itself)
 * and return a map of { name (without extension) -> trimmed content }.
 */
export async function loadPromptFragments(
  dir: string,
  excludeFileName: string,
): Promise<Map<string, string>> {
  const fragments = new Map<string, string>();

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (
        !(entry.isFile || entry.isSymlink) ||
        !entry.name.endsWith(".md") ||
        entry.name === excludeFileName
      ) {
        continue;
      }

      const name = entry.name.slice(0, -3); // strip ".md"
      const filePath = join(dir, entry.name);
      try {
        const text = await Deno.readTextFile(filePath);
        fragments.set(name, text.trim());
      } catch (error) {
        logger.warn("Failed to read prompt fragment file", {
          file: entry.name,
          error: String(error),
        });
      }
    }
  } catch (error) {
    logger.warn("Failed to scan prompt directory for fragments", {
      dir,
      error: String(error),
    });
  }

  return fragments;
}

/**
 * Replace all {{key}} placeholders in content with values from the fragments map.
 * Placeholders without a matching fragment are left unchanged and a warning is logged.
 */
export function replacePlaceholders(
  content: string,
  fragments: Map<string, string>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = fragments.get(key);
    if (value !== undefined) {
      return value;
    }
    logger.warn("Prompt placeholder has no matching fragment file", {
      placeholder: match,
      expectedFile: `${key}.md`,
    });
    return match;
  });
}
