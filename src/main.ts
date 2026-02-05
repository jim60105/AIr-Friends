// src/main.ts

import { bootstrap, startPlatforms } from "./bootstrap.ts";
import { shutdownHandler } from "./shutdown.ts";
import { configureLogger, createLogger } from "@utils/logger.ts";
import { parse } from "@std/flags";

const logger = createLogger("Main");

/**
 * Parse command line arguments
 */
function parseArgs(): { config?: string; help: boolean } {
  const args = parse(Deno.args, {
    string: ["config"],
    boolean: ["help"],
    alias: {
      c: "config",
      h: "help",
    },
  });

  return {
    config: args.config,
    help: args.help,
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
AI Friend - AI-powered chatbot supporting multiple platforms

Usage:
  deno run -A src/main.ts [options]

Options:
  -c, --config <path>   Path to configuration file (default: config.yaml)
  -h, --help            Show this help message

Environment Variables:
  LOG_LEVEL             Log level (DEBUG, INFO, WARN, ERROR, FATAL)
  DISCORD_TOKEN         Discord bot token
  MISSKEY_TOKEN         Misskey API token
  MISSKEY_HOST          Misskey instance host

Example:
  deno run -A src/main.ts --config ./my-config.yaml
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = parseArgs();

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  // Configure initial logging (will be reconfigured after config load)
  configureLogger({ level: "INFO", format: "json" });

  logger.info("Starting AI Friend");
  logger.info("Deno version", { version: Deno.version.deno });

  try {
    // Bootstrap application
    const context = await bootstrap(args.config);

    // Set up shutdown handler
    shutdownHandler.setContext(context);
    shutdownHandler.registerSignalHandlers();

    // Start platforms
    await startPlatforms(context);

    // Log startup complete
    logger.info("AI Friend is running", {
      platforms: context.platformRegistry.getAllAdapters().map((a) => a.platform),
    });

    // Keep process alive
    await new Promise<void>(() => {
      // This promise never resolves - the process will exit on signal
    });
  } catch (error) {
    logger.error("Fatal error during startup", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    Deno.exit(1);
  }
}

// Run main
if (import.meta.main) {
  main();
}
