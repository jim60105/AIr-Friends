#!/usr/bin/env -S deno run --allow-net --allow-env

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    // Parse arguments
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "emoji"],
      alias: { s: "session-id", a: "api-url", e: "emoji" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const emoji = args.emoji;
    if (!emoji) {
      exitWithError("Missing required argument: --emoji");
    }

    // Call API
    const result = await callSkillApi(apiUrl, "react-message", sessionId, {
      emoji,
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
