// skills/memory-search/skill.ts

import { parse } from "jsr:@std/flags@1";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "query"],
      alias: { s: "session-id", a: "api-url", q: "query" },
      default: { limit: 10 },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const query = args.query;
    if (!query) {
      exitWithError("Missing required argument: --query");
    }

    const limit = Number(args.limit) || 10;

    const result = await callSkillApi(apiUrl, "memory-search", sessionId, {
      query,
      limit,
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
