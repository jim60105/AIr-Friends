#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: [
        "session-id",
        "api-url",
        "memory-id",
        "visibility",
        "importance",
        "related-to",
        "supersedes",
        "tier",
        "category",
        "decay",
      ],
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

    if (args.tier) {
      if (!["core", "working", "archive"].includes(args.tier)) {
        exitWithError("Invalid tier. Must be 'core', 'working', or 'archive'");
      }
      params.tier = args.tier;
    }

    if (args.category) {
      if (!["fact", "preference", "episode", "summary", "relationship"].includes(args.category)) {
        exitWithError(
          "Invalid category. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
        );
      }
      params.category = args.category;
    }

    if (args.decay) {
      const decay = Number(args.decay);
      if (isNaN(decay) || decay < 0 || decay > 1) {
        exitWithError("Invalid decay. Must be a number between 0.0 and 1.0");
      }
      params.decay = decay;
    }

    if (args["related-to"]) {
      params.relatedTo = args["related-to"].split(",").map((id: string) => id.trim());
    }

    if (args.supersedes) {
      params.supersedes = args.supersedes.split(",").map((id: string) => id.trim());
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
