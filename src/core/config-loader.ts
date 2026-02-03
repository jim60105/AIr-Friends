// src/core/config-loader.ts

import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import { createLogger } from "@utils/logger.ts";
import { applyEnvOverrides, getEnvironment } from "@utils/env.ts";
import type { Config } from "../types/config.ts";
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
  },
  health: {
    enabled: false,
    port: 8080,
  },
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

    if (
      current === undefined || current === "" ||
      current === "${" + field.split(".").pop()?.toUpperCase() + "}"
    ) {
      // Check if it's a template variable that wasn't replaced
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
 * Load system prompt from file
 */
export async function loadSystemPrompt(path: string): Promise<string> {
  try {
    const content = await Deno.readTextFile(path);
    return content.trim();
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
}
