#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { parse } from "jsr:@std/flags@^0.224.0";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "category", "scope"],
      alias: { s: "session-id", a: "api-url" },
      default: { limit: 10 },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const query = await readPayloadArg(Deno.args, "query", {
      sessionId,
      alias: "q",
      fileName: "query.md",
      example:
        `${Deno.env.get("HOME") ?? "~"}/.agents/skills/memory-search/scripts/memory-search.ts ` +
        `--session-id "$SESSION_ID" --limit 10 --query-file "$TMPDIR/$SESSION_ID/query.md"`,
    });

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
    if (error instanceof PayloadError) {
      exitWithError(error.message, error.code);
    } else {
      exitWithError(
        error instanceof Error ? error.message : String(error),
        error instanceof SkillSessionUnresolvedError ? error.code : undefined,
      );
    }
  }
}

main();
