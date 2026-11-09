// src/main.ts

import { bootstrap, startPlatforms } from "./bootstrap.ts";
import { shutdownHandler } from "./shutdown.ts";
import { configureLogger, createLogger } from "@utils/logger.ts";
import { parseArgs } from "node:util";

const logger = createLogger("Main");

/**
 * The command line arguments the entry point reads.
 */
export interface CliArgs {
  config?: string;
  help: boolean;
  yolo: boolean;
  dryRun: boolean;
}

const CLI_OPTIONS = {
  config: { type: "string", short: "c" },
  help: { type: "boolean", short: "h" },
  yolo: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

const BOOLEAN_FLAGS: Record<string, true> = {
  "--help": true,
  "-h": true,
  "--yolo": true,
  "--dry-run": true,
};

/**
 * Reproduce the value rules the entry point's previous flags parser relied on,
 * which `node:util` `parseArgs` does not share:
 *
 * - a string option never consumes a value that starts with `-`, so a bare
 *   `--config`/`-c` yields `""` (the `start:config` script passes one);
 * - a boolean option consumes a separate `true`/`false` token, and everything
 *   after `--` stays a positional.
 */
function normalizeArgv(argv: readonly string[]): string[] {
  const normalized: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      normalized.push(...argv.slice(i));
      break;
    }

    const next = argv[i + 1];
    if (BOOLEAN_FLAGS[arg] === true && (next === "true" || next === "false")) {
      const flag = arg.startsWith("--") ? arg : "--help";
      normalized.push(`${flag}=${next}`);
      i++;
      continue;
    }

    if ((arg === "--config" || arg === "-c") && (next === undefined || next.startsWith("-"))) {
      normalized.push("--config=");
      continue;
    }

    normalized.push(arg);
  }
  return normalized;
}

/**
 * The previous flags parser treated a boolean option as `false` only for the
 * exact token `false`; any other value (an explicit one or none) enabled it.
 */
function parseBooleanFlag(value: unknown): boolean {
  return value !== undefined && value !== false && value !== "false";
}

/**
 * Parse command line arguments
 */
export function parseCliArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const { values } = parseArgs({
    args: normalizeArgv(argv),
    options: CLI_OPTIONS,
    strict: false,
    allowPositionals: true,
  });

  return {
    config: typeof values.config === "string" ? values.config : undefined,
    help: parseBooleanFlag(values.help),
    yolo: parseBooleanFlag(values.yolo),
    dryRun: parseBooleanFlag(values["dry-run"]),
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
AIr-Friends - AI-powered chatbot supporting multiple platforms

Usage:
  bun run start [-- options]

Options:
  -c, --config <path>   Path to configuration file (default: config.yaml)
  -h, --help            Show this help message
  --yolo                Auto-approve all permission requests (for container environments)
  --dry-run             Enable dry run mode (assemble context without calling Agent)

Environment Variables:
  LOG_LEVEL             Log level (DEBUG, INFO, WARN, ERROR, FATAL)
  DISCORD_TOKEN         Discord bot token
  MISSKEY_TOKEN         Misskey API token
  MISSKEY_HOST          Misskey instance host

Example:
  bun run start -- --config ./my-config.yaml --yolo
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Configure initial logging (will be reconfigured after config load)
  configureLogger({ level: "INFO", format: "json" });

  logger.info("Starting AIr-Friends");
  logger.info("Bun version", { version: Bun.version });

  try {
    // Bootstrap application
    const context = await bootstrap(args.config, args.yolo, args.dryRun);

    // Set up shutdown handler
    shutdownHandler.setContext(context);
    shutdownHandler.registerSignalHandlers();

    // Start platforms
    await startPlatforms(context);

    // Log startup complete
    logger.info("AIr-Friends is running", {
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
    process.exit(1);
  }
}

// Run main
if (import.meta.main) {
  main();
}
