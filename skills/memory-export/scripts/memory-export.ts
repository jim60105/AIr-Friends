#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "format", "importance"],
      boolean: ["enabled-only"],
      alias: { s: "session-id", a: "api-url", f: "format" },
      default: { format: "markdown", importance: "all", "enabled-only": true },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const format = args.format;
    if (format !== "markdown" && format !== "json") {
      exitWithError("Invalid --format. Must be 'markdown' or 'json'");
    }

    const importance = args.importance;
    if (importance !== "high" && importance !== "normal" && importance !== "all") {
      exitWithError("Invalid --importance. Must be 'high', 'normal', or 'all'");
    }

    const result = await callSkillApi(apiUrl, "memory-export", sessionId, {
      format,
      importance,
      enabled_only: args["enabled-only"],
    });

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
