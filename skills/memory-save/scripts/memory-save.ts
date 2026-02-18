#!/usr/bin/env -S deno run --allow-net --allow-env

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "content", "importance", "related-to", "supersedes"],
      alias: { s: "session-id", a: "api-url", c: "content", i: "importance" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const content = args.content;
    if (!content) {
      exitWithError("Missing required argument: --content");
    }

    const importance = args.importance ?? "normal";

    // Validate values
    if (!["high", "normal"].includes(importance)) {
      exitWithError("Invalid importance. Must be 'high' or 'normal'");
    }

    // Visibility is auto-determined by the server based on conversation context
    const params: Record<string, unknown> = {
      content,
      importance,
    };

    if (args["related-to"]) {
      params.relatedTo = args["related-to"].split(",").map((id: string) => id.trim());
    }

    if (args.supersedes) {
      params.supersedes = args.supersedes.split(",").map((id: string) => id.trim());
    }

    const result = await callSkillApi(apiUrl, "memory-save", sessionId, params);

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
