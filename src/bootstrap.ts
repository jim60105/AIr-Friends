// src/bootstrap.ts

import { loadConfig } from "@core/config-loader.ts";
import type { Config } from "./types/config.ts";
import { AgentCore } from "@core/agent-core.ts";
import { getPlatformRegistry } from "@platforms/platform-registry.ts";
import { DiscordAdapter } from "@platforms/discord/index.ts";
import { MisskeyAdapter } from "@platforms/misskey/index.ts";
import { HealthCheckServer } from "./healthcheck.ts";
import { configureLogger, createLogger } from "@utils/logger.ts";

const logger = createLogger("Bootstrap");

/**
 * Application context containing all initialized components
 */
export interface AppContext {
  config: Config;
  agentCore: AgentCore;
  platformRegistry: ReturnType<typeof getPlatformRegistry>;
  healthCheckServer: HealthCheckServer | null;
  yolo: boolean;
}

/**
 * Bootstrap the application
 */
export async function bootstrap(configPath?: string, yolo = false): Promise<AppContext> {
  logger.info("Starting bootstrap", { yolo });

  // Load configuration
  const configFile = configPath ?? "./config.yaml";
  logger.info("Loading configuration", { path: configFile });
  const config = await loadConfig(configPath ? configPath.replace(/\/[^/]+$/, "") : ".");

  // Configure logger based on config
  configureLogger({
    level: config.logging.level,
    format: "json",
  });

  // Initialize agent core (this initializes all necessary components)
  logger.info("Initializing agent core");
  const agentCore = new AgentCore(config, yolo);

  // Initialize platform registry
  logger.info("Initializing platform registry");
  const platformRegistry = getPlatformRegistry();

  // Register Discord adapter if configured
  if (config.platforms.discord.enabled) {
    logger.info("Registering Discord adapter");
    const discordAdapter = new DiscordAdapter(config.platforms.discord);
    platformRegistry.register(discordAdapter);
    agentCore.registerPlatform(discordAdapter);
  }

  // Register Misskey adapter if configured
  if (config.platforms.misskey.enabled) {
    logger.info("Registering Misskey adapter");
    const misskeyAdapter = new MisskeyAdapter(config.platforms.misskey);
    platformRegistry.register(misskeyAdapter);
    agentCore.registerPlatform(misskeyAdapter);
  }

  // Initialize Health Check server if enabled
  let healthCheckServer: HealthCheckServer | null = null;
  if (config.health?.enabled) {
    logger.info("Initializing Health Check server", { port: config.health.port });
    healthCheckServer = new HealthCheckServer(config.health.port);
    healthCheckServer.start();
  }

  logger.info("Bootstrap completed");

  const context: AppContext = {
    config,
    agentCore,
    platformRegistry,
    healthCheckServer,
    yolo,
  };

  // Set Health Check server context after all components initialized
  if (healthCheckServer) {
    healthCheckServer.setContext(context);
  }

  return context;
}

/**
 * Connect all platforms and start listening
 */
export async function startPlatforms(context: AppContext): Promise<void> {
  const { platformRegistry } = context;
  const adapters = platformRegistry.getAllAdapters();

  if (adapters.length === 0) {
    logger.warn("No platform adapters configured");
    return;
  }

  logger.info("Connecting to platforms", { count: adapters.length });

  // Connect all platforms
  await platformRegistry.connectAll();

  logger.info("All platforms connected");
}
