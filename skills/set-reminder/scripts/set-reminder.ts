#!/usr/bin/env -S deno run --allow-net --allow-env

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "scheduled-at", "message"],
      alias: { s: "session-id", a: "api-url" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const scheduledAt = args["scheduled-at"];
    if (!scheduledAt) {
      exitWithError("Missing required parameter: --scheduled-at");
    }

    const message = args.message;
    if (!message) {
      exitWithError("Missing required parameter: --message");
    }

    const result = await callSkillApi(apiUrl, "set-reminder", sessionId, {
      scheduledAt,
      message,
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
