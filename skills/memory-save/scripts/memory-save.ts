#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { parse } from "jsr:@std/flags@^0.224.0";
import { callSkillApi, exitWithError, outputResult, parseBaseArgs } from "../../lib/client.ts";
import { PayloadError, readPayloadArg } from "../../lib/payload.ts";

async function main() {
  try {
    const args = parse(Deno.args, {
      string: [
        "session-id",
        "api-url",
        "importance",
        "related-to",
        "supersedes",
        "tier",
        "category",
        "scope",
        "decay",
      ],
      alias: { s: "session-id", a: "api-url", i: "importance" },
    });

    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    const content = await readPayloadArg(Deno.args, "content", {
      sessionId,
      alias: "c",
      fileName: "content.md",
      example: `${Deno.env.get("HOME") ?? "~"}/.agents/skills/memory-save/scripts/memory-save.ts ` +
        `--session-id "$SESSION_ID" --importance normal ` +
        `--content-file "$TMPDIR/$SESSION_ID/content.md"`,
    });

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

    if (args.scope) {
      if (!["user", "channel"].includes(args.scope)) {
        exitWithError("Invalid scope. Must be 'user' or 'channel'");
      }
      params.scope = args.scope;
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

    const result = await callSkillApi(apiUrl, "memory-save", sessionId, params);

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
