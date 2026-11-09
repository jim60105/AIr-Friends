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

export interface SetReminderArgs {
  sessionId?: string;
  apiUrl?: string;
  scheduledAt?: string;
}

export function parseSetReminderArgs(argv: string[]): SetReminderArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      "scheduled-at": { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    scheduledAt: typeof values["scheduled-at"] === "string" ? values["scheduled-at"] : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { scheduledAt } = parseSetReminderArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    if (!scheduledAt) {
      exitWithError("Missing required parameter: --scheduled-at");
    }

    const message = await readPayloadArg(argv, "message", {
      sessionId,
      fileName: "reminder.md",
      example:
        `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/set-reminder/scripts/set-reminder.ts ` +
        `--session-id "<session id rendered in your system prompt>" --scheduled-at "2025-01-15T10:00:00Z" ` +
        `--message-file "<absolute staging directory rendered in your system prompt>/reminder.md"`,
    });

    const result = await callSkillApi(apiUrl, "set-reminder", sessionId, {
      scheduledAt,
      message,
    });

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
