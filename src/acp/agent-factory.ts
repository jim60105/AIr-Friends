// src/acp/agent-factory.ts

import type { AgentConfig, AgentType, RetryPromptStrategy } from "./types.ts";
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
  yolo = false,
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

      // Build environment: inherit critical env vars and add GITHUB_TOKEN
      // Agent needs PATH to find deno, HOME for skills directory discovery
      const env: Record<string, string> = {
        GITHUB_TOKEN: githubToken,
      };

      // Inherit critical environment variables
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      // Copilot seems doesn't have a solution to override system prompt.

      const args = [
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-color",
        "--no-auto-update",
        "--acp",
      ];

      if (!yolo) {
        // We need at least bash tool to run deno scripts for skills.
        args.push("--available-tools");
        args.push("write_bash");
        args.push("--available-tools");
        args.push("read_bash");
        args.push("--available-tools");
        args.push("stop_bash");
        args.push("--available-tools");
        args.push("bash");
      } else {
        args.push("--yolo");
      }

      return {
        command: "copilot",
        args,
        cwd: workingDir,
        env,
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

      // Build environment: inherit critical env vars and add GEMINI_API_KEY
      // Agent needs PATH to find deno, HOME for skills directory discovery
      const env: Record<string, string> = {
        GEMINI_API_KEY: geminiApiKey,
        GEMINI_SYSTEM_MD: "/app/prompts/system_prompt_override.md",
      };

      // Inherit critical environment variables
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      const args = ["task", "gemini", "--experimental-acp"];
      if (yolo) {
        args.push("--yolo");
      }

      return {
        command: "deno",
        args,
        cwd: workingDir,
        env,
      };
    }

    case "opencode": {
      // OpenCode CLI in ACP mode
      // Build environment: inherit critical env vars
      const env: Record<string, string> = {};

      // OpenCode can work without API key by using other providers
      const opencodeApiKey = appConfig.agent.opencodeApiKey ??
        Deno.env.get("OPENCODE_API_KEY");
      if (opencodeApiKey) {
        env["OPENCODE_API_KEY"] = opencodeApiKey;
      }
      // OpenRouter
      const openRouterApiKey = appConfig.agent.openRouterApiKey ??
        Deno.env.get("OPENROUTER_API_KEY");
      if (openRouterApiKey) {
        env["OPENROUTER_API_KEY"] = openRouterApiKey;
      }
      // Gemini
      const geminiApiKey = appConfig.agent.geminiApiKey ??
        Deno.env.get("GEMINI_API_KEY");
      if (geminiApiKey) {
        env["GEMINI_API_KEY"] = geminiApiKey;
      }
      // GitHub
      const githubToken = appConfig.agent.githubToken ??
        Deno.env.get("GITHUB_TOKEN");
      if (githubToken) {
        env["GITHUB_TOKEN"] = githubToken;
      }

      // Inherit critical environment variables
      // Agent needs PATH to find deno, HOME for skills directory discovery
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      const args = ["acp"];

      if (!yolo) {
        // OpenCode permissions are configured in opencode.json.
      } else {
        // OpenCode currently does not have a YOLO mode. This will be available after this PR is merged:
        // https://github.com/anomalyco/opencode/pull/11833
        env["OPENCODE_YOLO"] = "true";
      }

      return {
        command: "opencode",
        args,
        cwd: workingDir,
        env,
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

/**
 * Get the retry prompt strategy for a specific agent type.
 * Used when an agent completes a prompt turn without sending a reply.
 * Each agent type may need different retry prompt messages or behaviors.
 */
export function getRetryPromptStrategy(type: AgentType): RetryPromptStrategy {
  const defaultRetryMessage =
    "System message: You have a special turn. Regardless of whether you have already sent-reply, please send another send-reply.";

  switch (type) {
    case "copilot":
      return {
        retryPromptMessage: defaultRetryMessage,
        maxRetries: 1,
      };

    case "opencode":
      return {
        retryPromptMessage: defaultRetryMessage,
        maxRetries: 1,
      };

    case "gemini":
      return {
        retryPromptMessage: defaultRetryMessage,
        maxRetries: 1,
      };

    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}
