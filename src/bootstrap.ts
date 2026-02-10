// src/bootstrap.ts

import { loadConfig } from "@core/config-loader.ts";
import type { Config } from "./types/config.ts";
import { AgentCore } from "@core/agent-core.ts";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import { determineSpontaneousTarget } from "@core/spontaneous-target.ts";
import { getPlatformRegistry } from "@platforms/platform-registry.ts";
import { DiscordAdapter } from "@platforms/discord/index.ts";
import { MisskeyAdapter } from "@platforms/misskey/index.ts";
import { HealthCheckServer } from "./healthcheck.ts";
import { configureLogger, createLogger } from "@utils/logger.ts";
import { GelfTransport } from "@utils/gelf-transport.ts";
import type { Platform } from "./types/events.ts";

const logger = createLogger("Bootstrap");

/**
 * Application context containing all initialized components
 */
export interface AppContext {
  config: Config;
  agentCore: AgentCore;
  platformRegistry: ReturnType<typeof getPlatformRegistry>;
  healthCheckServer: HealthCheckServer | null;
  spontaneousScheduler: SpontaneousScheduler | null;
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

  // Initialize GELF transport if configured
  let gelfTransport: GelfTransport | undefined;
  if (config.logging.gelf?.enabled && config.logging.gelf.endpoint) {
    gelfTransport = new GelfTransport(config.logging.gelf);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      module: "Bootstrap",
      message: "GELF transport initialized",
      context: {
        endpoint: config.logging.gelf.endpoint,
        hostname: config.logging.gelf.hostname ?? "air-friends",
      },
    }));
  }

  // Configure logger based on config
  configureLogger({
    level: config.logging.level,
    format: "json",
    gelfTransport,
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

  // Initialize Spontaneous Scheduler
  const spontaneousScheduler = new SpontaneousScheduler(config);
  spontaneousScheduler.setCallback(async (platform: Platform) => {
    const adapter = platformRegistry.getAdapter(platform);
    if (!adapter) {
      logger.warn("Platform adapter not found", { platform });
      return;
    }

    if (adapter.getConnectionStatus().state !== "connected") {
      logger.warn("Platform not connected, skipping spontaneous post", { platform });
      return;
    }

    const botId = adapter.getBotId();
    if (!botId) {
      logger.warn("Bot ID not available, skipping spontaneous post", { platform });
      return;
    }

    const target = await determineSpontaneousTarget(platform, adapter, config);
    if (!target) {
      logger.warn("No valid target for spontaneous post", { platform });
      return;
    }

    const sp = config.platforms[platform].spontaneousPost!;
    const fetchRecentMessages = Math.random() < sp.contextFetchProbability;

    logger.info("Triggering spontaneous post", {
      platform,
      channelId: target.channelId,
      fetchRecentMessages,
    });

    const response = await agentCore.getOrchestrator().processSpontaneousPost(
      platform,
      target.channelId,
      adapter,
      { botId, fetchRecentMessages },
    );

    if (!response.success) {
      logger.warn("Spontaneous post did not succeed", {
        platform,
        error: response.error,
      });
    }
  });

  logger.info("Bootstrap completed");

  const context: AppContext = {
    config,
    agentCore,
    platformRegistry,
    healthCheckServer,
    spontaneousScheduler,
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

  // Start spontaneous scheduler after platforms are connected
  if (context.spontaneousScheduler) {
    context.spontaneousScheduler.start();
  }

  logger.info("All platforms connected");
}
