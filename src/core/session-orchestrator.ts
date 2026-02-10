// src/core/session-orchestrator.ts

import { createLogger } from "@utils/logger.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import {
  createAgentConfig,
  getDefaultAgentType,
  getRetryPromptStrategy,
} from "@acp/agent-factory.ts";
import { ContextAssembler } from "./context-assembler.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import type { Config } from "../types/config.ts";
import type { NormalizedEvent } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { ClientConfig } from "@acp/types.ts";
import { join } from "@std/path";

const logger = createLogger("SessionOrchestrator");

/**
 * Response from a session
 */
export interface SessionResponse {
  success: boolean;
  replySent: boolean;
  error?: string;
}

/**
 * SessionOrchestrator coordinates the entire conversation flow
 * from receiving a message to sending a reply
 */
export class SessionOrchestrator {
  private workspaceManager: WorkspaceManager;
  private contextAssembler: ContextAssembler;
  private skillRegistry: SkillRegistry;
  private sessionRegistry: SessionRegistry;
  private config: Config;
  private yolo: boolean;

  constructor(
    workspaceManager: WorkspaceManager,
    contextAssembler: ContextAssembler,
    skillRegistry: SkillRegistry,
    config: Config,
    sessionRegistry: SessionRegistry,
    yolo = false,
  ) {
    this.workspaceManager = workspaceManager;
    this.contextAssembler = contextAssembler;
    this.skillRegistry = skillRegistry;
    this.sessionRegistry = sessionRegistry;
    this.config = config;
    this.yolo = yolo;
  }

  /**
   * Process a message event through the full orchestration flow
   */
  async processMessage(
    event: NormalizedEvent,
    platformAdapter: PlatformAdapter,
  ): Promise<SessionResponse> {
    const sessionLoggerName = `${event.platform}:${event.channelId}`;
    const sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing message", {
      platform: event.platform,
      userId: event.userId,
      channelId: event.channelId,
      messageId: event.messageId,
    });

    // Check if the trigger message is a /clear command
    // If so, exit immediately without calling agent or replying
    if (event.content.trimStart().startsWith("/clear")) {
      sessionLogger.info("Trigger message is /clear command, skipping agent execution");
      return {
        success: true,
        replySent: false,
      };
    }

    try {
      // 1. Get or create workspace
      const workspace = await this.workspaceManager.getOrCreateWorkspace(event);
      sessionLogger.debug("Workspace ready", {
        workspaceKey: workspace.key,
        workingDir: workspace.path,
      });

      // 2. Register session in SessionRegistry (if skill API is enabled)
      let shellSessionId: string | null = null;
      if (this.config.skillApi?.enabled) {
        shellSessionId = this.sessionRegistry.register({
          platform: event.platform,
          channelId: event.channelId,
          userId: event.userId,
          guildId: event.guildId || undefined,
          isDm: event.isDm,
          workspace,
          platformAdapter,
          triggerEvent: event,
          timeoutMs: this.config.skillApi.sessionTimeoutMs,
        });

        // Create SESSION_ID file in workspace
        const sessionIdFile = join(workspace.path, "SESSION_ID");
        await Deno.writeTextFile(sessionIdFile, shellSessionId);

        sessionLogger.info("Shell session registered", {
          shellSessionId,
          sessionIdFile,
        });
      }

      // 3. Assemble initial context
      const context = await this.contextAssembler.assembleContext(
        event,
        workspace,
        platformAdapter,
      );
      sessionLogger.debug("Context assembled", {
        memoriesCount: context.importantMemories.length,
        recentMessagesCount: context.recentMessages.length,
        relatedMessagesCount: context.relatedMessages?.length ?? 0,
        estimatedTokens: context.estimatedTokens,
      });

      // 3. Format context for prompt
      const formattedContext = this.contextAssembler.formatContext(context);
      const fullPrompt = this.buildPrompt(formattedContext, shellSessionId);

      sessionLogger.debug("Prompt built", {
        estimatedTokens: formattedContext.estimatedTokens,
      });

      sessionLogger.debug("Full prompt content", {
        fullPrompt,
      });

      // 4. Create client config for ACP
      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
        isDM: event.isDm,
        yolo: this.yolo,
      };

      // 5. Build ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = new AgentConnector({
        agentConfig: createAgentConfig(agentType, workspace.path, this.config, this.yolo),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
      });

      // 6. Execute agent session
      try {
        await connector.connect();
        sessionLogger.info("Agent connected");

        const sessionId = await connector.createSession();
        sessionLogger.info("Agent session created", { sessionId });

        // Set the model for the session
        await connector.setSessionModel(sessionId, this.config.agent.model);
        sessionLogger.info("Agent session model set", {
          sessionId,
          model: this.config.agent.model,
        });

        // Clear reply state before prompting
        const replyHandler = this.skillRegistry.getReplyHandler();
        replyHandler.clearReplyState(workspace.key, event.channelId);

        // Send prompt to agent
        const response = await connector.prompt(sessionId, fullPrompt);
        sessionLogger.info("Agent session completed", {
          sessionId,
          stopReason: response.stopReason,
        });

        // Check if reply was sent
        let replySent = replyHandler.hasReplySent(workspace.key, event.channelId);

        // If agent completed without reply, retry with a special prompt
        if (!replySent && response.stopReason === "end_turn") {
          sessionLogger.warn(
            "Agent completed without sending reply, retrying with special prompt",
          );

          const retryStrategy = getRetryPromptStrategy(agentType);

          for (let attempt = 0; attempt < retryStrategy.maxRetries; attempt++) {
            // Clear reply state to allow retry
            replyHandler.clearReplyState(workspace.key, event.channelId);

            sessionLogger.info("Sending retry prompt", {
              sessionId,
              attempt: attempt + 1,
              maxRetries: retryStrategy.maxRetries,
            });

            // Send retry prompt on the same session
            const retryResponse = await connector.prompt(
              sessionId,
              retryStrategy.retryPromptMessage,
            );

            sessionLogger.info("Retry prompt completed", {
              sessionId,
              attempt: attempt + 1,
              stopReason: retryResponse.stopReason,
            });

            // Check if reply was sent after retry
            replySent = replyHandler.hasReplySent(workspace.key, event.channelId);

            if (replySent) {
              sessionLogger.info("Reply sent after retry", {
                sessionId,
                attempt: attempt + 1,
              });
              break;
            }

            // If the retry was cancelled or had unexpected stop reason, stop retrying
            if (retryResponse.stopReason !== "end_turn") {
              sessionLogger.warn("Retry stopped with unexpected stop reason", {
                sessionId,
                stopReason: retryResponse.stopReason,
              });
              break;
            }
          }
        }

        if (replySent) {
          return {
            success: true,
            replySent: true,
          };
        }

        // Agent completed but didn't send reply even after retry
        if (response.stopReason === "end_turn") {
          sessionLogger.warn("Agent completed without sending reply after retry");
          return {
            success: false,
            replySent: false,
            error: "Agent did not generate a reply",
          };
        }

        if (response.stopReason === "cancelled") {
          return {
            success: false,
            replySent: false,
            error: "Session was cancelled",
          };
        }

        return {
          success: false,
          replySent: false,
          error: `Unexpected stop reason: ${response.stopReason}`,
        };
      } finally {
        await connector.disconnect();
        sessionLogger.debug("Agent disconnected");

        // Clean up shell session if it exists
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          sessionLogger.debug("Shell session cleaned up", { shellSessionId });

          // Remove SESSION_ID file
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch (error) {
            // Only ignore NotFound errors; log other errors
            if (!(error instanceof Deno.errors.NotFound)) {
              sessionLogger.warn("Failed to remove SESSION_ID file", {
                error: error instanceof Error ? error.message : String(error),
                path: sessionIdFile,
              });
            }
          }
        }
      }
    } catch (error) {
      sessionLogger.error("Session failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Build the full prompt to send to the agent
   */
  private buildPrompt(
    context: {
      systemMessage: string;
      userMessage: string;
    },
    sessionId: string | null,
  ): string {
    const parts: string[] = [];

    // System prompt
    parts.push(context.systemMessage);
    parts.push("");

    // Session information
    if (sessionId) {
      parts.push("# Session Information");
      parts.push("");
      parts.push(`Your session ID is: ${sessionId}`);
      parts.push(
        "Use this session ID when calling skills that require --session-id parameter.",
      );
      parts.push("");
    }

    // User message with context
    parts.push("# Context and Message");
    parts.push("");
    parts.push(context.userMessage);
    parts.push("");

    // Instructions
    parts.push("# Instructions");
    parts.push("");
    parts.push("Please respond to the current message above.");
    parts.push("Use the `send-reply` skill to deliver your final response.");
    parts.push("You may use other available skills as needed:");
    parts.push("- `memory-save`: Save important information");
    parts.push("- `memory-search`: Search for saved memories");
    parts.push("- `memory-patch`: Update memory metadata");
    parts.push("- `fetch-context`: Get additional context from the platform");

    return parts.join("\n");
  }
}
