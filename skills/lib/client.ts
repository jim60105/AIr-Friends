#!/usr/bin/env -S deno run --allow-net --allow-env
// This file is used by all skill scripts to interact with the Skill API

import { parse } from "jsr:@std/flags@^0.224.0";

/**
 * Skill API client configuration
 */
export interface SkillClientConfig {
  apiUrl: string;
  timeout: number;
}

/**
 * Default configuration
 * API URL can be overridden by --api-url flag or SKILL_API_URL env
 * Only localhost/127.0.0.1 URLs are allowed for security
 */
export function getDefaultConfig(): SkillClientConfig {
  const apiUrl = Deno.env.get("SKILL_API_URL") ?? "http://localhost:3001";

  // Validate that URL is localhost
  try {
    const url = new URL(apiUrl);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (!isLocalhost) {
      throw new Error(
        `Invalid API URL: ${apiUrl}. Only localhost URLs are allowed for security.`,
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid API URL format: ${apiUrl}`);
    }
    throw error;
  }

  return {
    apiUrl,
    timeout: 30_000,
  };
}

/**
 * Parse common CLI arguments
 */
export function parseBaseArgs(args: string[]): { sessionId: string; apiUrl: string } {
  const parsed = parse(args, {
    string: ["session-id", "api-url"],
    alias: { s: "session-id", a: "api-url" },
  });

  const sessionId = parsed["session-id"];
  if (!sessionId) {
    throw new Error("Missing required argument: --session-id");
  }

  const config = getDefaultConfig();
  const apiUrl = parsed["api-url"] ?? config.apiUrl;

  return { sessionId, apiUrl };
}

/**
 * Call the Skill API
 */
export async function callSkillApi(
  apiUrl: string,
  skillName: string,
  sessionId: string,
  parameters: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = `${apiUrl}/api/skill/${skillName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      parameters,
    }),
  });

  return await response.json();
}

/**
 * Output result to stdout (for Agent to read)
 */
export function outputResult(result: unknown): void {
  console.log(JSON.stringify(result));
}

/**
 * Output error and exit with non-zero code
 */
export function exitWithError(message: string): never {
  console.error(JSON.stringify({ success: false, error: message }));
  Deno.exit(1);
}
