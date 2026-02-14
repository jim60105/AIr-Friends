// src/acp/client.ts

import * as acp from "@agentclientprotocol/sdk";
import { resolve } from "@std/path";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import type { ClientConfig } from "./types.ts";
import type { SkillContext } from "@skills/types.ts";

/**
 * ChatbotClient implements the ACP Client interface
 * Handles callbacks from external ACP Agents (GitHub Copilot CLI, Gemini CLI)
 */
export class ChatbotClient implements acp.Client {
  private skillRegistry: SkillRegistry;
  private logger: Logger;
  private config: ClientConfig;
  private replyAlreadySent: boolean = false;

  constructor(
    skillRegistry: SkillRegistry,
    logger: Logger,
    config: ClientConfig,
  ) {
    this.skillRegistry = skillRegistry;
    this.logger = logger;
    this.config = config;
  }

  /**
   * Handle permission requests from the Agent
   * Auto-approves our registered skills and access to skills directory
   * In YOLO mode, auto-approves ALL permission requests
   */
  requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.logger.debug("Permission requested", {
      toolCall: params.toolCall,
      kind: params.toolCall.kind,
      yolo: this.config.yolo,
    });

    // YOLO mode: auto-approve everything
    if (this.config.yolo) {
      this.logger.info("YOLO mode: auto-approving permission for {title}", {
        kind: params.toolCall.kind,
        title: params.toolCall.title,
      });

      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Auto-approve read access to skills directory
    // External agents need to read SKILL.md files to understand available skills
    if (params.toolCall.kind === "read" && params.toolCall.locations) {
      const skillsPath = "/home/deno/.copilot/skills";
      const isReadingSkills = params.toolCall.locations.some((loc) =>
        loc.path?.startsWith(skillsPath)
      );

      if (isReadingSkills) {
        this.logger.info("Auto-approving skills directory read: {path}", {
          path: params.toolCall.locations.map((l) => l.path).join(", "),
        });

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Auto-approve shell execution for our skill commands
    // Our skills are invoked via 'deno run skills/...' commands
    if (params.toolCall.kind === "execute") {
      const rawInput = params.toolCall.rawInput as
        | { command?: string; commands?: string[] }
        | undefined;
      const commands = rawInput?.commands ?? (rawInput?.command ? [rawInput.command] : []);

      // Check if all commands are our skill commands
      const isSkillCommand = commands.length > 0 &&
        commands.every((cmd) => cmd.includes("skills/") && cmd.includes("skill.ts"));

      if (isSkillCommand) {
        this.logger.info("Auto-approving skill shell execution: {command}", {
          command: commands.join("; "),
        });

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Extract skill name from tool call (only works for ToolCall, not ToolCallUpdate)
    let skillName = "";
    // Check if this is a complete ToolCall (not just an update)
    if ("rawInput" in params.toolCall && params.toolCall.rawInput) {
      skillName = this.extractSkillName(params.toolCall as acp.ToolCall);
    }

    // Check if this is one of our registered skills
    if (skillName && this.skillRegistry.hasSkill(skillName)) {
      this.logger.info("Auto-approving registered skill: {skillName}", { skillName });

      // Find "allow_once" option, or default to first option
      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // For unknown tool calls, reject
    this.logger.warn("Rejecting unknown tool call", {
      skillName,
      title: params.toolCall.title,
    });

    const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
      params.options[0];

    return Promise.resolve({
      outcome: {
        outcome: "selected",
        optionId: rejectOption.optionId,
      },
    });
  }

  /**
   * Handle session updates from the Agent
   * Logs various agent activities but doesn't send them externally
   */
  sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        // Agent is generating response - log but don't send
        if (update.content.type === "text") {
          this.logger.debug("Agent message chunk", {
            text: update.content.text.substring(0, 100),
          });
        }
        break;

      case "tool_call":
        this.logger.info(
          "Tool call started: {title} (id: {id}, kind: {kind})",
          {
            id: update.toolCallId,
            title: update.title,
            kind: update.kind,
            status: update.status,
          },
        );
        break;

      case "tool_call_update": {
        // Log tool call updates with full context
        const logContext: Record<string, unknown> = {
          id: update.toolCallId,
          status: update.status,
        };

        // Add error information if status is failed
        if (update.status === "failed") {
          // ACP SDK may include error details in various fields
          const updateAny = update as Record<string, unknown>;
          if (updateAny.output) {
            logContext.output = updateAny.output;
          }
          if (updateAny.error) {
            logContext.error = updateAny.error;
          }
          if (updateAny.exitCode !== undefined) {
            logContext.exitCode = updateAny.exitCode;
          }
          // Log full update object for debugging
          logContext.fullUpdate = JSON.stringify(update);
          this.logger.error("Tool call {id} failed", logContext);
        } else {
          this.logger.info("Tool call {id} updated to status {status}", logContext);
        }
        break;
      }

      case "plan":
        this.logger.debug("Agent plan", {
          entriesCount: update.entries?.length ?? 0,
        });
        break;

      case "agent_thought_chunk":
        // Agent's thinking process - only log
        this.logger.debug("Agent thought", {
          hasContent: update.content?.type === "text",
          text: update.content?.type === "text" ? update.content.text.substring(0, 100) : "",
        });
        break;

      case "usage_update": {
        // Token usage information from the agent
        const usageUpdate = update as unknown as {
          sessionUpdate: "usage_update";
          used?: number;
          size?: number;
          cost?: { amount: number; currency: string };
        };
        this.logger.info("Agent usage update: tokens {used}/{size}", {
          used: usageUpdate.used,
          size: usageUpdate.size,
          cost: usageUpdate.cost,
        });
        break;
      }

      default:
        this.logger.debug("Session update", {
          type: (update as { sessionUpdate?: string }).sessionUpdate,
        });
    }

    return Promise.resolve();
  }

  /**
   * Handle file read requests from the Agent
   * Only allows reading files within the working directory
   */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.logger.debug("Read file requested", { path: params.path });

    // Validate path is within working directory
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    try {
      const content = await Deno.readTextFile(params.path);
      return { content };
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle file write requests from the Agent
   * Only allows writing files within the working directory
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.logger.debug("Write file requested", { path: params.path });

    // Validate path is within working directory
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    try {
      await Deno.writeTextFile(params.path, params.content);
      return {};
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract skill name from tool call
   * Tries rawInput.skill field first, then falls back to title
   */
  private extractSkillName(toolCall: acp.ToolCall): string {
    const rawInput = toolCall.rawInput as { skill?: string } | undefined;
    return rawInput?.skill ?? toolCall.title ?? "";
  }

  /**
   * Create skill context for skill execution
   */
  private createSkillContext(): Partial<SkillContext> {
    return {
      channelId: this.config.channelId,
      userId: this.config.userId,
      // Note: workspace and platformAdapter should be added by caller
    };
  }

  /**
   * Validate that a path is within the allowed directories
   * Allows: user workspace OR agent global workspace
   */
  private isPathAllowed(path: string): boolean {
    try {
      const normalizedPath = resolve(path);
      const normalizedWorkingDir = resolve(this.config.workingDir);
      if (normalizedPath.startsWith(normalizedWorkingDir)) return true;

      if (this.config.agentWorkspacePath) {
        const normalizedAgentWorkspace = resolve(this.config.agentWorkspacePath);
        if (normalizedPath.startsWith(normalizedAgentWorkspace)) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Mark that a reply has been sent (for preventing duplicate replies)
   */
  markReplySent(): void {
    this.replyAlreadySent = true;
  }

  /**
   * Reset client state for new session
   */
  reset(): void {
    this.replyAlreadySent = false;
  }

  /**
   * Get whether reply has been sent
   */
  hasReplySent(): boolean {
    return this.replyAlreadySent;
  }
}
