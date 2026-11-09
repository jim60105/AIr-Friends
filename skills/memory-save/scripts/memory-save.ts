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

export interface MemorySaveArgs {
  sessionId?: string;
  apiUrl?: string;
  importance: string;
  tier?: string;
  category?: string;
  scope?: string;
  decay?: number;
  relatedTo?: string;
  supersedes?: string;
}

export function parseMemorySaveArgs(argv: string[]): MemorySaveArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      importance: { type: "string", short: "i" },
      "related-to": { type: "string" },
      supersedes: { type: "string" },
      tier: { type: "string" },
      category: { type: "string" },
      scope: { type: "string" },
      decay: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The previous parser applied the declared "normal" default only when the
  // flag was absent; a value-less flag was the empty string and failed validation.
  const importance = values.importance === undefined
    ? "normal"
    : typeof values.importance === "string"
      ? values.importance
      : "";
  const decay = typeof values.decay === "string" && values.decay !== ""
    ? Number(values.decay)
    : undefined;

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    importance,
    tier: typeof values.tier === "string" ? values.tier : undefined,
    category: typeof values.category === "string" ? values.category : undefined,
    scope: typeof values.scope === "string" ? values.scope : undefined,
    decay,
    relatedTo: typeof values["related-to"] === "string" ? values["related-to"] : undefined,
    supersedes: typeof values.supersedes === "string" ? values.supersedes : undefined,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    const parsed = parseMemorySaveArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    const content = await readPayloadArg(argv, "content", {
      sessionId,
      alias: "c",
      fileName: "content.md",
      example: `Use the literal skill-script root rendered in your system prompt (never a $HOME expression): <skill root rendered in your system prompt>/memory-save/scripts/memory-save.ts ` +
        `--session-id "<session id rendered in your system prompt>" --importance normal ` +
        `--content-file "<absolute staging directory rendered in your system prompt>/content.md"`,
    });

    const importance = parsed.importance;

    // Validate values
    if (!["high", "normal"].includes(importance)) {
      exitWithError("Invalid importance. Must be 'high' or 'normal'");
    }

    // Visibility is auto-determined by the server based on conversation context
    const params: Record<string, unknown> = {
      content,
      importance,
    };

    if (parsed.tier) {
      if (!["core", "working", "archive"].includes(parsed.tier)) {
        exitWithError("Invalid tier. Must be 'core', 'working', or 'archive'");
      }
      params.tier = parsed.tier;
    }

    if (parsed.category) {
      if (!["fact", "preference", "episode", "summary", "relationship"].includes(parsed.category)) {
        exitWithError(
          "Invalid category. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
        );
      }
      params.category = parsed.category;
    }

    if (parsed.scope) {
      if (!["user", "channel"].includes(parsed.scope)) {
        exitWithError("Invalid scope. Must be 'user' or 'channel'");
      }
      params.scope = parsed.scope;
    }

    if (parsed.decay !== undefined) {
      const decay = parsed.decay;
      if (isNaN(decay) || decay < 0 || decay > 1) {
        exitWithError("Invalid decay. Must be a number between 0.0 and 1.0");
      }
      params.decay = decay;
    }

    if (parsed.relatedTo) {
      params.relatedTo = parsed.relatedTo.split(",").map((id: string) => id.trim());
    }

    if (parsed.supersedes) {
      params.supersedes = parsed.supersedes.split(",").map((id: string) => id.trim());
    }

    const result = await callSkillApi(apiUrl, "memory-save", sessionId, params);

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
