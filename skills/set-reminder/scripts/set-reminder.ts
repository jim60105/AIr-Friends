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
      string: ["session-id", "api-url", "scheduled-at"],
      alias: { s: "session-id", a: "api-url" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const scheduledAt = args["scheduled-at"];
    if (!scheduledAt) {
      exitWithError("Missing required parameter: --scheduled-at");
    }

    const message = await readPayloadArg(Deno.args, "message", {
      sessionId,
      fileName: "reminder.md",
      example:
        `${Deno.env.get("HOME") ?? "~"}/.agents/skills/set-reminder/scripts/set-reminder.ts ` +
        `--session-id "$SESSION_ID" --scheduled-at "2025-01-15T10:00:00Z" ` +
        `--message-file "$TMPDIR/$SESSION_ID/reminder.md"`,
    });

    const result = await callSkillApi(apiUrl, "set-reminder", sessionId, {
      scheduledAt,
      message,
    });

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
