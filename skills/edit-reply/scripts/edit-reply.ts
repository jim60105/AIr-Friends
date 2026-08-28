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
      string: ["session-id", "api-url", "message-id"],
      alias: { s: "session-id", a: "api-url" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const messageId = args["message-id"];
    if (!messageId) {
      exitWithError("Missing required argument: --message-id");
    }

    const message = await readPayloadArg(Deno.args, "message", {
      sessionId,
      alias: "m",
      fileName: "reply.md",
      example: `${Deno.env.get("HOME") ?? "~"}/.agents/skills/edit-reply/scripts/edit-reply.ts ` +
        `--session-id "$SESSION_ID" --message-id "$MESSAGE_ID" ` +
        `--message-file "$TMPDIR/$SESSION_ID/reply.md"`,
    });

    const result = await callSkillApi(apiUrl, "edit-reply", sessionId, {
      messageId,
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
