// src/main.ts
// Entry point for Agent Chatbot

import { AgentCore } from "@core/agent-core.ts";
import { loadConfig } from "@core/config-loader.ts";
import { createLogger } from "@utils/logger.ts";

const logger = createLogger("main");

/**
 * Main entry point for Agent Chatbot
 */
async function main() {
  logger.info("Agent Chatbot starting...");

  try {
    // Load configuration
    const config = await loadConfig(".");
    logger.info("Configuration loaded", {
      enabledPlatforms: Object.entries(config.platforms)
        .filter(([_, platformConfig]) => platformConfig.enabled)
        .map(([name]) => name),
    });

    // Initialize Agent Core
    const agentCore = new AgentCore(config);
    logger.info("Agent Core initialized");

    // Initialize and register platform adapters
    const enabledPlatforms: string[] = [];

    // Discord Platform
    if (config.platforms.discord.enabled) {
      try {
        const { DiscordAdapter } = await import("@platforms/discord/discord-adapter.ts");
        const discordAdapter = new DiscordAdapter(config.platforms.discord);
        agentCore.registerPlatform(discordAdapter);
        await discordAdapter.connect();
        enabledPlatforms.push("discord");
        logger.info("Discord platform connected");
      } catch (error) {
        logger.error("Failed to initialize Discord platform", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Misskey Platform
    if (config.platforms.misskey.enabled) {
      try {
        const { MisskeyAdapter } = await import("@platforms/misskey/misskey-adapter.ts");
        const misskeyAdapter = new MisskeyAdapter(config.platforms.misskey);
        agentCore.registerPlatform(misskeyAdapter);
        await misskeyAdapter.connect();
        enabledPlatforms.push("misskey");
        logger.info("Misskey platform connected");
      } catch (error) {
        logger.error("Failed to initialize Misskey platform", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (enabledPlatforms.length === 0) {
      throw new Error("No platforms were successfully initialized");
    }

    logger.info("Agent Chatbot started successfully", {
      platforms: enabledPlatforms,
    });

    // Keep process running
    await new Promise(() => {}); // Infinite wait
  } catch (error) {
    logger.fatal("Failed to start Agent Chatbot", {
      error: error instanceof Error ? error.message : String(error),
    });
    Deno.exit(1);
  }
}

// Handle graceful shutdown
const shutdown = () => {
  logger.info("Shutting down Agent Chatbot...");
  // Platform adapters will handle their own cleanup
  Deno.exit(0);
};

// Register signal handlers
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Start the application
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
