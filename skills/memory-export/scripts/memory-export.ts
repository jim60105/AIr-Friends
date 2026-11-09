#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

export interface MemoryExportArgs {
  sessionId?: string;
  apiUrl?: string;
  format: string;
  importance: string;
  enabledOnly: boolean;
}

export function parseMemoryExportArgs(argv: string[]): MemoryExportArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      format: { type: "string", short: "f" },
      importance: { type: "string" },
      "enabled-only": { type: "boolean" },
      "no-enabled-only": { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The previous parser treated an absent flag as the declared default and a
  // value-less flag as the empty string; keep both shapes.
  const format = values.format === undefined
    ? "markdown"
    : typeof values.format === "string"
      ? values.format
      : "";
  const importance = values.importance === undefined
    ? "all"
    : typeof values.importance === "string"
      ? values.importance
      : "";
  const enabledOnly = values["no-enabled-only"] === true
    ? false
    : values["enabled-only"] === undefined
      ? true
      : values["enabled-only"] === false || values["enabled-only"] === "false"
        ? false
        : true;

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    format,
    importance,
    enabledOnly,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { format, importance, enabledOnly } = parseMemoryExportArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    if (format !== "markdown" && format !== "json") {
      exitWithError("Invalid --format. Must be 'markdown' or 'json'");
    }

    if (importance !== "high" && importance !== "normal" && importance !== "all") {
      exitWithError("Invalid --importance. Must be 'high', 'normal', or 'all'");
    }

    const result = await callSkillApi(apiUrl, "memory-export", sessionId, {
      format,
      importance,
      enabled_only: enabledOnly,
    });

    outputResult(result);

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    exitWithError(
      error instanceof Error ? error.message : String(error),
      error instanceof SkillSessionUnresolvedError ? error.code : undefined,
    );
  }
}

if (import.meta.main) {
  main();
}
