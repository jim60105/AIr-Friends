// skills/memory-patch/skill.ts

import { parse } from "jsr:@std/flags@1";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: ["session-id", "api-url", "memory-id", "visibility", "importance"],
      boolean: ["enabled", "disabled"],
      alias: { s: "session-id", a: "api-url", m: "memory-id" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const memoryId = args["memory-id"];
    if (!memoryId) {
      exitWithError("Missing required argument: --memory-id");
    }

    const params: Record<string, unknown> = { memory_id: memoryId };

    // Handle enabled/disabled flags
    if (args.enabled) {
      params.enabled = true;
    } else if (args.disabled) {
      params.enabled = false;
    }

    if (args.visibility) {
      if (!["public", "private"].includes(args.visibility)) {
        exitWithError("Invalid visibility. Must be 'public' or 'private'");
      }
      params.visibility = args.visibility;
    }

    if (args.importance) {
      if (!["high", "normal"].includes(args.importance)) {
        exitWithError("Invalid importance. Must be 'high' or 'normal'");
      }
      params.importance = args.importance;
    }

    const result = await callSkillApi(apiUrl, "memory-patch", sessionId, params);

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}

main();
