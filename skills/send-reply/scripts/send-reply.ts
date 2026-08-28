#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

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
    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const message = await readPayloadArg(Deno.args, "message", {
      sessionId,
      alias: "m",
      fileName: "reply.md",
      example: `${Deno.env.get("HOME") ?? "~"}/.agents/skills/send-reply/scripts/send-reply.ts ` +
        `--session-id "$SESSION_ID" --message-file "$TMPDIR/$SESSION_ID/reply.md"`,
    });

    // Call API
    const result = await callSkillApi(apiUrl, "send-reply", sessionId, {
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
