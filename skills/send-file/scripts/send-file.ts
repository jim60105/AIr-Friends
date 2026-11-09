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

export interface SendFileArgs {
  sessionId?: string;
  apiUrl?: string;
  filePaths?: string[];
}

export function parseSendFileArgs(argv: string[]): SendFileArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      "file-paths": { type: "string", short: "f", multiple: true },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    filePaths: Array.isArray(values["file-paths"])
      ? values["file-paths"] as string[]
      : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const { filePaths } = parseSendFileArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    // Reject the removed singular --file-path flag (both forms) BEFORE any API
    // call with an instructive error teaching the repeatable --file-paths form.
    for (const token of argv) {
      if (token === "--file-path" || token.startsWith("--file-path=")) {
        exitWithError(
          `The --file-path flag is no longer supported: it was replaced by the repeatable ` +
            `--file-paths flag, because the skill now supports sending multiple files in one ` +
            `invocation. Use --file-paths once per file, for example:\n` +
            `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/send-file/scripts/send-file.ts ` +
            `--session-id "<session id rendered in your system prompt>" --file-paths "exports/report.pdf" ` +
            `--file-paths "exports/chart.png"`,
          "SKILL_SINGLE_FILE_FLAG",
        );
      }
    }

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      exitWithError(
        "Missing required argument: --file-paths (repeatable, one occurrence per file, " +
          'at least one required). Example: --file-paths "a.png" --file-paths "b.png"',
      );
    }

    const caption = await readPayloadArg(argv, "caption", {
      sessionId,
      alias: "c",
      required: false,
      fileName: "caption.md",
      example: `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/send-file/scripts/send-file.ts ` +
        `--session-id "<session id rendered in your system prompt>" --file-paths "exports/report.pdf" ` +
        `--file-paths "exports/chart.png" ` +
        `--caption-file "<absolute staging directory rendered in your system prompt>/caption.md"`,
    });

    const result = await callSkillApi(apiUrl, "send-file", sessionId, {
      filePaths,
      caption: caption ?? undefined,
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
