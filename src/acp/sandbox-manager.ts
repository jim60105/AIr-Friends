// src/acp/sandbox-manager.ts

import { createLogger } from "@utils/logger.ts";
import type { SandboxConfig } from "../types/config.ts";

const logger = createLogger("SandboxManager");

// Agent subprocess allowed base environment variables
const BASE_ALLOWED_ENV = [
  // System essentials
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  // Deno related
  "DENO_DIR",
  "DENO_NO_UPDATE_CHECK",
  // Skill API communication
  "SKILL_API_PORT",
  "SESSION_ID",
  // Per-session Skill API caller token (F13)
  "SKILL_API_TOKEN",
  // Agent workspace
  "AGENT_WORKSPACE",
  // Workspace-scoped temp directory
  "TMPDIR",
  // Browser automation
  "AGENT_BROWSER_EXECUTABLE_PATH",
];

// Agent-type-specific authentication environment variables.
// GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY are the OpenCode Gemini provider keys.
const AGENT_TYPE_ENV: Record<string, string[]> = {
  opencode: [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ],
};

export interface SpawnOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export class SandboxManager {
  constructor(private readonly config: SandboxConfig) {}

  /**
   * Build complete sandboxed spawn options.
   */
  buildSpawnOptions(
    agentType: string,
    originalCommand: string,
    originalArgs: string[],
    baseEnv: Record<string, string>,
    cwd: string,
  ): SpawnOptions {
    const env = this.config.filterEnv ? this.buildFilteredEnv(agentType, baseEnv) : baseEnv;

    const { command, args } = this.config.networkIsolation
      ? this.wrapWithNetworkIsolation(originalCommand, originalArgs)
      : { command: originalCommand, args: originalArgs };

    return { command, args, env, cwd };
  }

  /**
   * Filter env vars to only allowed ones.
   */
  private buildFilteredEnv(
    agentType: string,
    baseEnv: Record<string, string>,
  ): Record<string, string> {
    const allowed = new Set([
      ...BASE_ALLOWED_ENV,
      ...(AGENT_TYPE_ENV[agentType] ?? []),
      ...this.config.allowedEnvVars,
    ]);

    const filtered: Record<string, string> = {};
    for (const key of allowed) {
      if (key in baseEnv) {
        filtered[key] = baseEnv[key];
      }
    }
    return filtered;
  }

  /**
   * Wrap command with unshare --net for network namespace isolation.
   * Falls back gracefully on non-Linux or when unshare is not found.
   */
  private wrapWithNetworkIsolation(
    command: string,
    args: string[],
  ): { command: string; args: string[] } {
    if (Deno.build.os !== "linux") {
      logger.warn("Network isolation requested but not on Linux, skipping");
      return { command, args };
    }

    try {
      const check = new Deno.Command("which", { args: ["unshare"] });
      const output = check.outputSync();
      if (!output.success) {
        logger.warn("Network isolation requested but unshare not available");
        return { command, args };
      }
    } catch {
      logger.warn("Network isolation check failed, skipping");
      return { command, args };
    }

    logger.info("Wrapping agent command with unshare --net");
    return {
      command: "unshare",
      args: ["--net", command, ...args],
    };
  }
}
