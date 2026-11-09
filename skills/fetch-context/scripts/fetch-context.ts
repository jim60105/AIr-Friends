#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

export interface FetchContextArgs {
  sessionId?: string;
  apiUrl?: string;
  type?: string;
  limit: number;
}

export function parseFetchContextArgs(argv: string[]): FetchContextArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      type: { type: "string", short: "t" },
      limit: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The previous parser returned the declared default 20 when `--limit` was
  // absent and an empty value when the flag had no argument; keep both shapes.
  const limit = values.limit === undefined
    ? 20
    : typeof values.limit === "string"
      ? Number(values.limit)
      : 0;

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    type: typeof values.type === "string" ? values.type : undefined,
    limit,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { type, limit } = parseFetchContextArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    if (!type) {
      exitWithError("Missing required argument: --type");
    }

    const validTypes = ["recent_messages", "search_messages", "user_info"];
    if (!validTypes.includes(type)) {
      exitWithError(`Invalid type. Must be one of: ${validTypes.join(", ")}`);
    }

    const query = await readPayloadArg(argv, "query", {
      sessionId,
      alias: "q",
      required: false,
      fileName: "query.md",
      example:
        `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/fetch-context/scripts/fetch-context.ts ` +
        `--session-id "<session id rendered in your system prompt>" --type search_messages ` +
        `--query-file "<absolute staging directory rendered in your system prompt>/query.md"`,
    });

    const params: Record<string, unknown> = { type };

    if (query !== undefined) {
      params.query = query;
    }

    if (limit) {
      params.limit = limit;
    }

    const result = await callSkillApi(apiUrl, "fetch-context", sessionId, params);

    outputResult(result);

    if (!result.success) {
      process.exit(1);
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

if (import.meta.main) {
  main();
}
