#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "file-paths"],
      collect: ["file-paths"],
      alias: { s: "session-id", a: "api-url", f: "file-paths" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    // Reject the removed singular --file-path flag (both forms) BEFORE any API
    // call with an instructive error teaching the repeatable --file-paths form.
    for (const token of Deno.args) {
      if (token === "--file-path" || token.startsWith("--file-path=")) {
        exitWithError(
          `The --file-path flag is no longer supported: it was replaced by the repeatable ` +
          `--file-paths flag, because the skill now supports sending multiple files in one ` +
          `invocation. Use --file-paths once per file, for example:\n` +
          `${Deno.env.get("HOME") ?? "~"}/.agents/skills/send-file/scripts/send-file.ts ` +
          `--session-id "$SESSION_ID" --file-paths "exports/report.pdf" ` +
          `--file-paths "exports/chart.png"`,
          "SKILL_SINGLE_FILE_FLAG",
        );
      }
    }

    const filePaths = args["file-paths"];
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      exitWithError(
        "Missing required argument: --file-paths (repeatable, one occurrence per file, " +
        "at least one required). Example: --file-paths \"a.png\" --file-paths \"b.png\"",
      );
    }

    const caption = await readPayloadArg(Deno.args, "caption", {
      sessionId,
      alias: "c",
      required: false,
      fileName: "caption.md",
      example: `${Deno.env.get("HOME") ?? "~"}/.agents/skills/send-file/scripts/send-file.ts ` +
        `--session-id "$SESSION_ID" --file-paths "exports/report.pdf" ` +
        `--file-paths "exports/chart.png" ` +
        `--caption-file "$TMPDIR/$SESSION_ID/caption.md"`,
    });

    const result = await callSkillApi(apiUrl, "send-file", sessionId, {
      filePaths,
      caption: caption ?? undefined,
    });

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof PayloadError) {
      exitWithError(error.message, error.code);
    } else {
      exitWithError(error instanceof Error ? error.message : String(error));
    }
  }
}

main();
