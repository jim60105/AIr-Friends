// src/acp/agent-factory.ts

import type { AgentConfig, AgentType, RetryPromptStrategy } from "./types.ts";
import type { Config } from "../types/config.ts";
import { SandboxManager } from "./sandbox-manager.ts";

/**
 * Create ACP Agent configuration based on agent type.
 * Applies sandbox isolation (env filtering, network isolation) via SandboxManager.
 */
export function createAgentConfig(
  type: AgentType,
  workingDir: string,
  appConfig: Config,
  yolo = false,
  agentWorkspacePath?: string,
): AgentConfig {
  // Build the base (unfiltered) config for the agent type
  const baseConfig = buildBaseAgentConfig(type, workingDir, appConfig, yolo, agentWorkspacePath);

  // Apply sandbox if configured
  const sandboxConfig = appConfig.agent.sandbox;
  if (sandboxConfig) {
    const sandbox = new SandboxManager(sandboxConfig);
    const spawnOpts = sandbox.buildSpawnOptions(
      type,
      baseConfig.command,
      baseConfig.args,
      baseConfig.env ?? {},
      baseConfig.cwd,
    );
    return {
      command: spawnOpts.command,
      args: spawnOpts.args,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
    };
  }

  return baseConfig;
}

/**
 * Build base agent config with full environment (before sandbox filtering).
 */
function buildBaseAgentConfig(
  type: AgentType,
  workingDir: string,
  appConfig: Config,
  yolo: boolean,
  agentWorkspacePath?: string,
): AgentConfig {
  switch (type) {
    case "copilot": {
      const githubToken = appConfig.agent.githubToken ??
        Deno.env.get("GITHUB_TOKEN");

      if (!githubToken) {
        throw new Error(
          "GitHub token not configured for Copilot agent. " +
            "Set agent.githubToken in config or GITHUB_TOKEN env var",
        );
      }

      // Build full environment — SandboxManager will filter if enabled
      const env: Record<string, string> = {
        GITHUB_TOKEN: githubToken,
      };

      // Inherit all potentially needed environment variables
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      const args = [
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-color",
        "--no-auto-update",
        "--acp",
      ];

      if (!yolo) {
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
      const geminiApiKey = appConfig.agent.geminiApiKey ??
        Deno.env.get("GEMINI_API_KEY");

      if (!geminiApiKey) {
        throw new Error(
          "Gemini API key not configured for Gemini agent. " +
            "Set agent.geminiApiKey in config or GEMINI_API_KEY env var",
        );
      }

      const env: Record<string, string> = {
        GEMINI_API_KEY: geminiApiKey,
        GEMINI_SYSTEM_MD: "/app/prompts/system_prompt_override.md",
      };

      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      const args = ["--experimental-acp"];
      if (yolo) {
        args.push("--yolo");
      }

      return {
        command: "gemini",
        args,
        cwd: workingDir,
        env,
      };
    }

    case "opencode": {
      const env: Record<string, string> = {};

      const opencodeApiKey = appConfig.agent.opencodeApiKey ??
        Deno.env.get("OPENCODE_API_KEY");
      if (opencodeApiKey) {
        env["OPENCODE_API_KEY"] = opencodeApiKey;
      }
      const openRouterApiKey = appConfig.agent.openRouterApiKey ??
        Deno.env.get("OPENROUTER_API_KEY");
      if (openRouterApiKey) {
        env["OPENROUTER_API_KEY"] = openRouterApiKey;
      }
      const geminiApiKey = appConfig.agent.geminiApiKey ??
        Deno.env.get("GEMINI_API_KEY");
      if (geminiApiKey) {
        env["GEMINI_API_KEY"] = geminiApiKey;
        env["GOOGLE_GENERATIVE_AI_API_KEY"] = geminiApiKey;
      }

      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      const args = ["acp"];

      if (!yolo) {
        // OpenCode permissions are configured in opencode.json.
      } else {
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
  const skillsDir = `${import.meta.dirname}/../../skills`;

  let sendReplyContent: string;
  try {
    sendReplyContent = Deno.readTextFileSync(`${skillsDir}/send-reply/SKILL.md`);
  } catch {
    sendReplyContent = "# Send Reply Skill\n\nUse send-reply to send a message to the user.";
  }

  let reactMessageContent: string;
  try {
    reactMessageContent = Deno.readTextFileSync(`${skillsDir}/react-message/SKILL.md`);
  } catch {
    reactMessageContent =
      "# React Message Skill\n\nUse react-message to add an emoji reaction to the trigger message.";
  }

  const defaultRetryMessage =
    `System message: You have a special turn. You must communicate with the user by using send-reply or react-message before ending the session.\n\n---\n\n${sendReplyContent}\n\n---\n\n${reactMessageContent}`;

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
