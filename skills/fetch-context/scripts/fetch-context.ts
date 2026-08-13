#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "type"],
      alias: { s: "session-id", a: "api-url", t: "type" },
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

    const query = await readPayloadArg(Deno.args, "query", {
      sessionId,
      alias: "q",
      required: false,
      fileName: "query.md",
      example:
        `${Deno.env.get("HOME") ?? "~"}/.agents/skills/fetch-context/scripts/fetch-context.ts ` +
        `--session-id "$SESSION_ID" --type search_messages ` +
        `--query-file "$TMPDIR/$SESSION_ID/query.md"`,
    });

    const params: Record<string, unknown> = { type };

    if (query !== undefined) {
      params.query = query;
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
    if (error instanceof PayloadError) {
      exitWithError(error.message, error.code);
    } else {
      exitWithError(error instanceof Error ? error.message : String(error));
    }
  }
}

main();
