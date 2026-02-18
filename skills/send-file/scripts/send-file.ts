#!/usr/bin/env -S deno run --allow-net --allow-env

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "file-path", "caption"],
      alias: { s: "session-id", a: "api-url", f: "file-path", c: "caption" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const filePath = args["file-path"];
    if (!filePath) {
      exitWithError("Missing required argument: --file-path");
    }

    const result = await callSkillApi(apiUrl, "send-file", sessionId, {
      filePath,
      caption: args.caption,
    });

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
