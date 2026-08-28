#!/usr/bin/env -S deno run --allow-net --allow-env

import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

async function main() {
  try {
    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const result = await callSkillApi(apiUrl, "memory-stats", sessionId, {});

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
