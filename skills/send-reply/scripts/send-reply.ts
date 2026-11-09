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

export interface SendReplyArgs {
  sessionId?: string;
  apiUrl?: string;
}

export function parseSendReplyArgs(argv: string[]): SendReplyArgs {
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

    const message = await readPayloadArg(argv, "message", {
      sessionId,
      alias: "m",
      fileName: "reply.md",
      example: `Use the literal skill-script root rendered in your system prompt for the script ` +
        `path below (never a $HOME expression): <skill root rendered in your system prompt>/send-reply/scripts/send-reply.ts ` +
        `--session-id "<session id rendered in your system prompt>" --message-file "<absolute staging directory rendered in your system prompt>/reply.md"`,
    });

    // Call API
    const result = await callSkillApi(apiUrl, "send-reply", sessionId, {
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
