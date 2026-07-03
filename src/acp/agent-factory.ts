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
  sessionId?: string,
): AgentConfig {
  // Build the base (unfiltered) config for the agent type
  const baseConfig = buildBaseAgentConfig(
    type,
    workingDir,
    appConfig,
    yolo,
    agentWorkspacePath,
    sessionId,
  );

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
  sessionId?: string,
): AgentConfig {
  switch (type) {
    case "opencode": {
      const env: Record<string, string> = {};

      const opencodeApiKey = appConfig.agent.opencodeApiKey ??
        Deno.env.get("OPENCODE_API_KEY");
      if (opencodeApiKey) {
        env["OPENCODE_API_KEY"] = opencodeApiKey;
      }
      // Pioneer provider (agent-config/opencode.json references {env:PIONEER_API_KEY}).
      // Must be forwarded explicitly because clearEnv:true no longer inherits it (F1).
      const pioneerApiKey = Deno.env.get("PIONEER_API_KEY");
      if (pioneerApiKey) {
        env["PIONEER_API_KEY"] = pioneerApiKey;
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

      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER", "TMPDIR"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      // Set TMPDIR to workspace-scoped tmp directory
      env["TMPDIR"] = `${workingDir}/tmp`;

      if (sessionId) {
        env["SESSION_ID"] = sessionId;
      }

      const args = ["acp"];

      if (!yolo) {
        // OpenCode permissions are configured in agent-config/opencode.json.
        // The restricted "build" agent is used by default (set via default_agent in opencode.json).
      } else {
        // OpenCode YOLO mode is achieved by switching to the "yolo" agent via ACP setSessionMode()
        // in SessionOrchestrator. The "yolo" agent is defined in agent-config/opencode.json with
        // permissive permissions ("*": "allow"), bypassing Layer 2 restrictions.
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
 * Returns the ACP session mode override for the given agent type and YOLO state.
 * Returns null if no mode override is needed (agent uses its default mode).
 */
export function getSessionModeOverride(agentType: AgentType, yolo: boolean): string | null {
  if (agentType === "opencode" && yolo) {
    return "yolo";
  }
  return null;
}

/**
 * Get the default agent type from config, or fall back to "opencode"
 */
export function getDefaultAgentType(appConfig: Config): AgentType {
  return appConfig.agent.defaultAgentType ?? "opencode";
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
    case "opencode":
      return {
        retryPromptMessage: defaultRetryMessage,
        maxRetries: 1,
      };

    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}
