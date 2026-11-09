#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

export interface GetMessageArgs {
  sessionId?: string;
  apiUrl?: string;
  messageId?: string;
}

export function parseGetMessageArgs(argv: string[]): GetMessageArgs {
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
    const { messageId } = parseGetMessageArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    // messageId is optional — defaults to last sent message in session
    const params: Record<string, string> = {};
    if (messageId) {
      params.messageId = messageId;
    }

    const result = await callSkillApi(apiUrl, "get-message", sessionId, params);

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
