// src/core/config-loader.ts

import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { dirname } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { applyEnvOverrides, getEnvironment } from "@utils/env.ts";
import { createTemplateEngine, renderTemplate } from "./template-renderer.ts";
import type { TemplateVariables } from "../types/template.ts";
import type {
  Config,
  DryRunConfig,
  GitBackupConfig,
  MemoryMaintenanceConfig,
  RateLimitConfig,
  RemindersConfig,
  SandboxConfig,
  UserMCPServerConfig,
} from "../types/config.ts";
import type { MCPServerConfig } from "../acp/types.ts";
import { ConfigError, ErrorCode } from "../types/errors.ts";
import { DISCORD_WHITELIST_PATTERN } from "../platforms/discord/discord-config.ts";
import { MISSKEY_WHITELIST_PATTERN } from "../platforms/misskey/misskey-config.ts";

const logger = createLogger("ConfigLoader");

function isValidWhitelistEntry(entry: string): boolean {
  return DISCORD_WHITELIST_PATTERN.test(entry) || MISSKEY_WHITELIST_PATTERN.test(entry);
}

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
 * Default channel lurk configuration
 */
const DEFAULT_CHANNEL_LURK = {
  enabled: false,
  intervalMs: 1800000, // 30 minutes
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
 * Default git backup configuration
 */
const DEFAULT_GIT_BACKUP: GitBackupConfig = {
  enabled: false,
  remoteUrl: "",
  intervalMs: 3600000, // 1 hour
  authorName: "AIr-Friends Backup",
  authorEmail: "airfriends-backup@noreply.github.com",
};

/**
 * Default reminders configuration
 */
const DEFAULT_REMINDERS: RemindersConfig = {
  enabled: false,
  maxRemindersPerUser: 20,
  minIntervalMs: 60000, // 1 minute
  persistPath: "reminders.jsonl",
  checkIntervalMs: 30000, // 30 seconds
};

/**
 * Default dry run configuration
 */
const DEFAULT_DRY_RUN: DryRunConfig = {
  enabled: false,
  outputPath: "./data/dry-run/",
  mockReply: "（Dry run 模式 — 此為測試回覆）",
};

/**
 * Default sandbox configuration
 */
const DEFAULT_SANDBOX: SandboxConfig = {
  filterEnv: true,
  networkIsolation: false,
  allowedEnvVars: [],
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
 * Expand ${ENV_VAR} references in a string with actual environment variable values.
 * Unresolved references (env var not set) are replaced with empty string.
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return Deno.env.get(varName) ?? "";
  });
}

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
  // Discord IDs are Snowflake format: 17-20 digit integers
  // Misskey IDs vary by instance (aid, aidx, meid, ulid, etc.), keep generic pattern
  if (accessControl?.whitelist && Array.isArray(accessControl.whitelist)) {
    const validEntries: string[] = [];
    for (const entry of accessControl.whitelist) {
      if (typeof entry === "string" && isValidWhitelistEntry(entry)) {
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

  // Apply default channel lurk config for Discord only
  {
    const discordConfig = (config.platforms as Record<string, Record<string, unknown>>)?.discord;
    if (discordConfig) {
      if (!discordConfig.channelLurk) {
        discordConfig.channelLurk = { ...DEFAULT_CHANNEL_LURK };
      } else {
        discordConfig.channelLurk = {
          ...DEFAULT_CHANNEL_LURK,
          ...(discordConfig.channelLurk as Record<string, unknown>),
        };
      }

      const cl = discordConfig.channelLurk as Record<string, unknown>;
      if ((cl.intervalMs as number) < 60000) {
        logger.warn("channelLurk.intervalMs < 1 minute, clamping to 60000");
        cl.intervalMs = 60000;
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

  // Metrics defaults
  if (!config.metrics) {
    config.metrics = { enabled: false, path: "/metrics" };
  }
  (config.metrics as Record<string, unknown>).path =
    (config.metrics as Record<string, unknown>).path ?? "/metrics";

  // Rate limit defaults
  if (!config.rateLimit) {
    config.rateLimit = { ...DEFAULT_RATE_LIMIT };
  } else {
    config.rateLimit = {
      ...DEFAULT_RATE_LIMIT,
      ...(config.rateLimit as Record<string, unknown>),
    };
  }

  // Git backup defaults
  if (!config.gitBackup) {
    config.gitBackup = { ...DEFAULT_GIT_BACKUP };
  } else {
    config.gitBackup = {
      ...DEFAULT_GIT_BACKUP,
      ...(config.gitBackup as Record<string, unknown>),
    };
  }

  // Reminders defaults and validation
  if (!config.reminders) {
    config.reminders = { ...DEFAULT_REMINDERS };
  } else {
    config.reminders = {
      ...DEFAULT_REMINDERS,
      ...(config.reminders as Record<string, unknown>),
    };
  }

  const rem = config.reminders as Record<string, unknown>;
  if ((rem.minIntervalMs as number) < 10000) {
    logger.warn("reminders.minIntervalMs too small, clamping to 10000");
    rem.minIntervalMs = 10000;
  }
  if ((rem.checkIntervalMs as number) < 5000) {
    logger.warn("reminders.checkIntervalMs too small, clamping to 5000");
    rem.checkIntervalMs = 5000;
  }
  if ((rem.maxRemindersPerUser as number) < 1) {
    logger.warn("reminders.maxRemindersPerUser too small, clamping to 1");
    rem.maxRemindersPerUser = 1;
  }

  // Model routing defaults and validation
  const agentConfig = config.agent as Record<string, unknown>;
  if (!agentConfig.modelRouting) {
    agentConfig.modelRouting = { enabled: false, rules: [] };
  } else {
    const mr = agentConfig.modelRouting as Record<string, unknown>;
    if (mr.enabled === undefined) mr.enabled = false;
    if (!Array.isArray(mr.rules)) mr.rules = [];

    if (mr.enabled === true) {
      const validSessionTypes = [
        "message",
        "spontaneous",
        "self-research",
        "memory-maintenance",
        "reminder",
        "channelLurk",
      ];

      const validRules: unknown[] = [];

      for (const rule of mr.rules as Record<string, unknown>[]) {
        const match = rule.match as Record<string, unknown> | undefined;
        const model = rule.model;

        // Validate basic structure
        if (!match || typeof model !== "string" || model.trim() === "") {
          logger.warn("Invalid model routing rule (missing match or model), skipping", { rule });
          continue;
        }

        // Validate at least one condition
        const matchKeys = Object.keys(match).filter((k) =>
          match[k] !== undefined && match[k] !== null
        );
        if (matchKeys.length === 0) {
          logger.warn("Model routing rule match must have at least one field, skipping", { match });
          continue;
        }

        // Validate whitelist format
        if (match.whitelist !== undefined) {
          if (typeof match.whitelist !== "string" || !isValidWhitelistEntry(match.whitelist)) {
            logger.warn("Invalid whitelist format in model routing rule, skipping", {
              whitelist: match.whitelist,
            });
            continue;
          }
        }

        // Validate sessionType
        if (match.sessionType !== undefined) {
          if (!validSessionTypes.includes(match.sessionType as string)) {
            logger.warn("Invalid sessionType in model routing rule, skipping", {
              sessionType: match.sessionType,
              validValues: validSessionTypes,
            });
            continue;
          }
        }

        // Validate contentKeywords
        if (match.contentKeywords !== undefined) {
          if (!Array.isArray(match.contentKeywords)) {
            logger.warn("contentKeywords must be an array in model routing rule, skipping", {
              contentKeywords: match.contentKeywords,
            });
            continue;
          }
          const validKeywords = (match.contentKeywords as unknown[]).filter(
            (kw): kw is string => typeof kw === "string" && kw.trim() !== "",
          );
          if (validKeywords.length === 0 && match.contentKeywords.length > 0) {
            logger.warn("contentKeywords contains no valid keywords, removing field", {
              contentKeywords: match.contentKeywords,
            });
            delete match.contentKeywords;
          } else {
            match.contentKeywords = validKeywords;
          }
        }

        validRules.push(rule);
      }

      mr.rules = validRules;
    }
  }

  // Dry run defaults
  if (!agentConfig.dryRun) {
    agentConfig.dryRun = { ...DEFAULT_DRY_RUN };
  } else {
    agentConfig.dryRun = { ...DEFAULT_DRY_RUN, ...(agentConfig.dryRun as Record<string, unknown>) };
  }

  // Sandbox defaults
  if (!agentConfig.sandbox) {
    agentConfig.sandbox = { ...DEFAULT_SANDBOX };
  } else {
    agentConfig.sandbox = {
      ...DEFAULT_SANDBOX,
      ...(agentConfig.sandbox as Record<string, unknown>),
    };
  }

  // MCP Servers validation
  const mcpServers = agentConfig.mcpServers as unknown[] | undefined;
  if (mcpServers && Array.isArray(mcpServers)) {
    const validServers: unknown[] = [];
    const seenNames = new Set<string>();

    for (const server of mcpServers as Record<string, unknown>[]) {
      // Validate name (required, unique)
      if (typeof server.name !== "string" || server.name.trim() === "") {
        logger.warn("MCP server config missing name, skipping", { server });
        continue;
      }
      if (seenNames.has(server.name)) {
        logger.warn("Duplicate MCP server name, skipping", { name: server.name });
        continue;
      }

      const transport = (server.transport as string) ?? "stdio";

      // Expand environment variables before validation
      if (server.env && typeof server.env === "object" && !Array.isArray(server.env)) {
        const expandedEnv: Record<string, string> = {};
        for (const [key, val] of Object.entries(server.env as Record<string, unknown>)) {
          expandedEnv[key] = expandEnvVars(String(val));
        }
        server.env = expandedEnv;
      }
      if (server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)) {
        const expandedHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(server.headers as Record<string, unknown>)) {
          expandedHeaders[key] = expandEnvVars(String(val));
        }
        server.headers = expandedHeaders;
      }
      if (server.url && typeof server.url === "string") {
        server.url = expandEnvVars(server.url);
      }

      if (transport === "stdio") {
        // Validate stdio: command is required
        if (typeof server.command !== "string" || server.command.trim() === "") {
          logger.warn("Stdio MCP server missing command, skipping", { name: server.name });
          continue;
        }
        if (!Array.isArray(server.args)) {
          server.args = [];
        }
      } else if (transport === "http" || transport === "sse") {
        // Validate http/sse: url is required
        if (typeof server.url !== "string" || server.url.trim() === "") {
          logger.warn("{transport} MCP server missing url, skipping", {
            transport,
            name: server.name,
          });
          continue;
        }
      } else {
        logger.warn("Unknown MCP server transport, skipping", {
          transport,
          name: server.name,
        });
        continue;
      }

      seenNames.add(server.name as string);
      validServers.push(server);
    }

    agentConfig.mcpServers = validServers;

    if (validServers.length > 0) {
      logger.info("Validated {count} MCP server(s)", { count: validServers.length });
    }
  }
}

/**
 * Convert user-facing MCP server config to internal MCPServerConfig format.
 * User format uses explicit "transport" field and Record for env/headers.
 * Internal format uses union type discrimination (type field presence) and Array<{name, value}>.
 */
export function convertUserMCPServerConfigs(
  userConfigs: UserMCPServerConfig[],
): MCPServerConfig[] {
  return userConfigs.map((cfg) => {
    const transport = cfg.transport ?? "stdio";

    if (transport === "stdio") {
      return {
        name: cfg.name,
        command: cfg.command!,
        args: cfg.args ?? [],
        env: cfg.env
          ? Object.entries(cfg.env).map(([name, value]) => ({ name, value }))
          : undefined,
      };
    }

    if (transport === "http") {
      return {
        type: "http" as const,
        name: cfg.name,
        url: cfg.url!,
        headers: cfg.headers
          ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value }))
          : undefined,
      };
    }

    // sse
    return {
      type: "sse" as const,
      name: cfg.name,
      url: cfg.url!,
      headers: cfg.headers
        ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value }))
        : undefined,
    };
  });
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
 * Load system prompt from file, rendering it with Vento template engine.
 *
 * Template files can use Vento syntax including {{ include }}, {{ if }},
 * {{ set }}, and variable interpolation with {{ variableName }}.
 */
export async function loadSystemPrompt(
  path: string,
  variables: TemplateVariables,
): Promise<string> {
  try {
    await Deno.stat(path);
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

  const promptDir = dirname(path);
  const env = createTemplateEngine(promptDir);
  return await renderTemplate(env, path, variables as unknown as Record<string, unknown>);
}
