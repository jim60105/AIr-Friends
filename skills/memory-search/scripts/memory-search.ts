#!/usr/bin/env -S deno run --allow-net --allow-env

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "query", "category", "scope"],
      alias: { s: "session-id", a: "api-url", q: "query" },
      default: { limit: 10 },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const query = args.query;
    if (!query) {
      exitWithError("Missing required argument: --query");
    }

    const limit = Number(args.limit) || 10;

    const params: Record<string, unknown> = { query, limit };

    if (args.category) {
      if (
        !["fact", "preference", "episode", "summary", "relationship"].includes(args.category)
      ) {
        exitWithError(
          "Invalid category. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
        );
      }
      params.category = args.category;
    }

    if (args.scope) {
      if (!["user", "channel"].includes(args.scope)) {
        exitWithError("Invalid scope. Must be 'user' or 'channel'");
      }
      params.scope = args.scope;
    }

    const result = await callSkillApi(apiUrl, "memory-search", sessionId, params);

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
