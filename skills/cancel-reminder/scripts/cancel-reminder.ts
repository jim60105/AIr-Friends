#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parse } from "jsr:@std/flags@^0.224.0";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "reminder-id"],
      alias: { s: "session-id", a: "api-url" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const reminderId = args["reminder-id"];
    if (!reminderId) {
      exitWithError("Missing required parameter: --reminder-id");
    }

    const result = await callSkillApi(apiUrl, "cancel-reminder", sessionId, {
      reminderId,
    });

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(
      error instanceof Error ? error.message : String(error),
      error instanceof SkillSessionUnresolvedError ? error.code : undefined,
    );
  }
}

main();
