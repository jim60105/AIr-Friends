// skills/fetch-context/skill.ts

import { parse } from "jsr:@std/flags@1";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "type", "query"],
      alias: { s: "session-id", a: "api-url", t: "type", q: "query" },
      default: { limit: 20 },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const type = args.type;
    if (!type) {
      exitWithError("Missing required argument: --type");
    }

    const validTypes = ["recent_messages", "search_messages", "user_info"];
    if (!validTypes.includes(type)) {
      exitWithError(`Invalid type. Must be one of: ${validTypes.join(", ")}`);
    }

    const params: Record<string, unknown> = { type };

    if (args.query) {
      params.query = args.query;
    }

    if (args.limit) {
      params.limit = Number(args.limit);
    }

    const result = await callSkillApi(apiUrl, "fetch-context", sessionId, params);

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
