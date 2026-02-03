// src/acp/agent-factory.ts

import type { AgentConfig, AgentType } from "./types.ts";
import type { Config } from "../types/config.ts";

/**
 * Create ACP Agent configuration based on agent type
 * NOTE: The comment in the issue mentioned using "gh copilot chat --agent-mode",
 * but the actual correct command is "copilot --acp" as clarified in the comments.
 */
export function createAgentConfig(
  type: AgentType,
  workingDir: string,
  appConfig: Config,
): AgentConfig {
  switch (type) {
    case "copilot": {
      // GitHub Copilot CLI in ACP mode
      // Command: copilot --acp (NOT "gh copilot chat --agent-mode")
      const githubToken = appConfig.agent.githubToken ??
        Deno.env.get("GITHUB_TOKEN");

      if (!githubToken) {
        throw new Error(
          "GitHub token not configured for Copilot agent. " +
            "Set agent.githubToken in config or GITHUB_TOKEN env var",
        );
      }

      return {
        command: "copilot",
        args: ["--acp"],
        cwd: workingDir,
        env: {
          GITHUB_TOKEN: githubToken,
        },
      };
    }

    case "gemini": {
      // Gemini CLI in ACP mode
      const geminiApiKey = appConfig.agent.geminiApiKey ??
        Deno.env.get("GEMINI_API_KEY");

      if (!geminiApiKey) {
        throw new Error(
          "Gemini API key not configured for Gemini agent. " +
            "Set agent.geminiApiKey in config or GEMINI_API_KEY env var",
        );
      }

      return {
        command: "gemini",
        args: ["cli", "--acp"],
        cwd: workingDir,
        env: {
          GEMINI_API_KEY: geminiApiKey,
        },
      };
    }

    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

/**
 * Get the default agent type from config, or fall back to "copilot"
 */
export function getDefaultAgentType(appConfig: Config): AgentType {
  return appConfig.agent.defaultAgentType ?? "copilot";
}
