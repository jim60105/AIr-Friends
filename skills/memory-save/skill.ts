// skills/memory-save/skill.ts

import { parse } from "jsr:@std/flags@1";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "content", "visibility", "importance"],
      alias: { s: "session-id", a: "api-url", c: "content", v: "visibility", i: "importance" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const content = args.content;
    if (!content) {
      exitWithError("Missing required argument: --content");
    }

    const visibility = args.visibility ?? "public";
    const importance = args.importance ?? "normal";

    // Validate values
    if (!["public", "private"].includes(visibility)) {
      exitWithError("Invalid visibility. Must be 'public' or 'private'");
    }
    if (!["high", "normal"].includes(importance)) {
      exitWithError("Invalid importance. Must be 'high' or 'normal'");
    }

    const result = await callSkillApi(apiUrl, "memory-save", sessionId, {
      content,
      visibility,
      importance,
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
