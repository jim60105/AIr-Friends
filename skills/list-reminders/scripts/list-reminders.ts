#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

export interface ListRemindersArgs {
  sessionId?: string;
  apiUrl?: string;
}

export function parseListRemindersArgs(argv: string[]): ListRemindersArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    const result = await callSkillApi(apiUrl, "list-reminders", sessionId, {});

    outputResult(result);

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    exitWithError(
      error instanceof Error ? error.message : String(error),
      error instanceof SkillSessionUnresolvedError ? error.code : undefined,
    );
  }
}

if (import.meta.main) {
  main();
}
