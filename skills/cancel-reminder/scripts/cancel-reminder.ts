#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

export interface CancelReminderArgs {
  sessionId?: string;
  apiUrl?: string;
  reminderId?: string;
}

export function parseCancelReminderArgs(argv: string[]): CancelReminderArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      "reminder-id": { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    reminderId: typeof values["reminder-id"] === "string" ? values["reminder-id"] : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { reminderId } = parseCancelReminderArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    if (!reminderId) {
      exitWithError("Missing required parameter: --reminder-id");
    }

    const result = await callSkillApi(apiUrl, "cancel-reminder", sessionId, {
      reminderId,
    });

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
