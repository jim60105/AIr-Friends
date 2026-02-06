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

      const args = ["--acp", "--disable-builtin-mcps", "--no-ask-user", "--no-color"];
      if (yolo) {
        args.push("--allow-all-tools");
        args.push("--allow-all-urls");
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
      // OpenCode can work without API key by using GitHub/Gemini providers
      const opencodeApiKey = appConfig.agent.opencodeApiKey ??
        Deno.env.get("OPENCODE_API_KEY");

      // Build environment: inherit critical env vars
      // Agent needs PATH to find deno, HOME for skills directory discovery
      const env: Record<string, string> = {};

      // OPENCODE_API_KEY is optional since OpenCode can use GitHub/Gemini providers
      if (opencodeApiKey) {
        env["OPENCODE_API_KEY"] = opencodeApiKey;
      }

      // Inherit critical environment variables
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      const args = ["acp"];
      if (yolo) {
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
