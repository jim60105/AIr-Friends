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

export interface MemorySearchArgs {
  sessionId?: string;
  apiUrl?: string;
  limit: number;
  category?: string;
  scope?: string;
}

export function parseMemorySearchArgs(argv: string[]): MemorySearchArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      category: { type: "string" },
      scope: { type: "string" },
      limit: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const limit = values.limit === undefined
    ? 10
    : typeof values.limit === "string"
      ? Number(values.limit) || 10
      : 10;

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    limit,
    category: typeof values.category === "string" ? values.category : undefined,
    scope: typeof values.scope === "string" ? values.scope : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { limit, category, scope } = parseMemorySearchArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    const query = await readPayloadArg(argv, "query", {
      sessionId,
      alias: "q",
      fileName: "query.md",
      example:
        `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/memory-search/scripts/memory-search.ts ` +
        `--session-id "<session id rendered in your system prompt>" --limit 10 --query-file "<absolute staging directory rendered in your system prompt>/query.md"`,
    });

    const params: Record<string, unknown> = { query, limit };

    if (category) {
      if (
        !["fact", "preference", "episode", "summary", "relationship"].includes(category)
      ) {
        exitWithError(
          "Invalid category. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
        );
      }
      params.category = category;
    }

    if (scope) {
      if (!["user", "channel"].includes(scope)) {
        exitWithError("Invalid scope. Must be 'user' or 'channel'");
      }
      params.scope = scope;
    }

    const result = await callSkillApi(apiUrl, "memory-search", sessionId, params);

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
