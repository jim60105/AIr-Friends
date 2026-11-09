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

export interface EditReplyArgs {
  sessionId?: string;
  apiUrl?: string;
  messageId?: string;
}

export function parseEditReplyArgs(argv: string[]): EditReplyArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      "message-id": { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    messageId: typeof values["message-id"] === "string" ? values["message-id"] : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { messageId } = parseEditReplyArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    if (!messageId) {
      exitWithError("Missing required argument: --message-id");
    }

    const message = await readPayloadArg(argv, "message", {
      sessionId,
      alias: "m",
      fileName: "reply.md",
      example: `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/edit-reply/scripts/edit-reply.ts ` +
        `--session-id "<session id rendered in your system prompt>" --message-id "$MESSAGE_ID" ` +
        `--message-file "<absolute staging directory rendered in your system prompt>/reply.md"`,
    });

    const result = await callSkillApi(apiUrl, "edit-reply", sessionId, {
      messageId,
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
