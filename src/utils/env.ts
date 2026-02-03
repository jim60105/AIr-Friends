// src/utils/env.ts

/**
 * Environment variable mapping for config overrides
 */
export const ENV_MAPPINGS = {
  DISCORD_TOKEN: "platforms.discord.token",
  MISSKEY_TOKEN: "platforms.misskey.token",
  MISSKEY_HOST: "platforms.misskey.host",
  AGENT_MODEL: "agent.model",
  AGENT_API_KEY: "agent.apiKey",
  LOG_LEVEL: "logging.level",
  HEALTH_PORT: "health.port",
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

      setNestedProperty(config, configPath, parsedValue);
    }
  }
}
