#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml

import { parseArgs } from "node:util";
import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";

export interface MemoryPatchArgs {
  sessionId?: string;
  apiUrl?: string;
  memoryId?: string;
  enabled: boolean;
  disabled: boolean;
  visibility?: string;
  importance?: string;
  tier?: string;
  category?: string;
  scope?: string;
  decay?: number;
  relatedTo?: string;
  supersedes?: string;
}

export function parseMemoryPatchArgs(argv: string[]): MemoryPatchArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string", short: "s" },
      "api-url": { type: "string", short: "a" },
      "memory-id": { type: "string", short: "m" },
      visibility: { type: "string" },
      importance: { type: "string" },
      "related-to": { type: "string" },
      supersedes: { type: "string" },
      tier: { type: "string" },
      category: { type: "string" },
      decay: { type: "string" },
      scope: { type: "string" },
      enabled: { type: "boolean" },
      disabled: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  // The previous parser returned "" for a value-less string flag, and a boolean
  // flag with no value is `true`; normalize both to those shapes.
  const decay = typeof values.decay === "string" && values.decay !== ""
    ? Number(values.decay)
    : undefined;

  return {
    sessionId: typeof values["session-id"] === "string" ? values["session-id"] : undefined,
    apiUrl: typeof values["api-url"] === "string" ? values["api-url"] : undefined,
    memoryId: typeof values["memory-id"] === "string" ? values["memory-id"] : undefined,
    enabled: values.enabled === true || values.enabled === "true",
    disabled: values.disabled === true || values.disabled === "true",
    visibility: typeof values.visibility === "string" ? values.visibility : undefined,
    importance: typeof values.importance === "string" ? values.importance : undefined,
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
    const parsed = parseMemoryPatchArgs(argv);
    const { sessionId, apiUrl } = parseBaseArgs(argv);

    const memoryId = parsed.memoryId;
    if (!memoryId) {
      exitWithError("Missing required argument: --memory-id");
    }

    const params: Record<string, unknown> = { memory_id: memoryId };

    // Handle enabled/disabled flags
    if (parsed.enabled) {
      params.enabled = true;
    } else if (parsed.disabled) {
      params.enabled = false;
    }

    if (parsed.visibility) {
      if (!["public", "private"].includes(parsed.visibility)) {
        exitWithError("Invalid visibility. Must be 'public' or 'private'");
      }
      params.visibility = parsed.visibility;
    }

    if (parsed.importance) {
      if (!["high", "normal"].includes(parsed.importance)) {
        exitWithError("Invalid importance. Must be 'high' or 'normal'");
      }
      params.importance = parsed.importance;
    }

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

    const result = await callSkillApi(apiUrl, "memory-patch", sessionId, params);

    outputResult(result);

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    exitWithError(
      error instanceof Error ? error.message : String(error),
      error instanceof SkillSessionUnresolvedError ? error.code : undefined,
    );
  }
}

if (import.meta.main) {
  main();
}
