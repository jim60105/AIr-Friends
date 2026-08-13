#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "file-path"],
      alias: { s: "session-id", a: "api-url", f: "file-path" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const filePath = args["file-path"];
    if (!filePath) {
      exitWithError("Missing required argument: --file-path");
    }

    const caption = await readPayloadArg(Deno.args, "caption", {
      sessionId,
      alias: "c",
      required: false,
      fileName: "caption.md",
      example: `${Deno.env.get("HOME") ?? "~"}/.agents/skills/send-file/scripts/send-file.ts ` +
        `--session-id "$SESSION_ID" --file-path "exports/report.pdf" ` +
        `--caption-file "$TMPDIR/$SESSION_ID/caption.md"`,
    });

    const result = await callSkillApi(apiUrl, "send-file", sessionId, {
      filePath,
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
