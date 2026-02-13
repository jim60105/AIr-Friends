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
import { loadPromptFragments, replacePlaceholders } from "./config-loader.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import type { Config, SelfResearchConfig } from "../types/config.ts";
import type { NormalizedEvent, Platform } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { AgentConnectorOptions, ClientConfig } from "@acp/types.ts";
import { dirname, join } from "@std/path";
import type { RssItem } from "@utils/rss-fetcher.ts";

const logger = createLogger("SessionOrchestrator");

/**
 * Response from a session
 */
export interface SessionResponse {
  success: boolean;
  replySent: boolean;
  reactionSent?: boolean;
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
      const agentWorkspacePath = await this.workspaceManager.getOrCreateAgentWorkspace();
      sessionLogger.debug("Workspace ready", {
        workspaceKey: workspace.key,
        workingDir: workspace.path,
        agentWorkspacePath,
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
          agentWorkspacePath,
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
        agentWorkspacePath,
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
        isDM: event.isDm,
        yolo: this.yolo,
      };

      // 5. Build ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          this.yolo,
          agentWorkspacePath,
        ),
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

        // Clear reaction state before prompting
        const reactionHandler = this.skillRegistry.getReactionHandler();
        reactionHandler.clearReactionState(workspace.key, event.channelId);

        // Send prompt to agent
        const response = await connector.prompt(sessionId, fullPrompt);
        sessionLogger.info("Agent session completed", {
          sessionId,
          stopReason: response.stopReason,
        });

        // Check if reply or reaction was sent
        let replySent = replyHandler.hasReplySent(workspace.key, event.channelId);
        let reactionSent = reactionHandler.hasReactionSent(workspace.key, event.channelId);

        // Agent has responded if it sent a reply OR a reaction
        let hasResponded = replySent || reactionSent;

        // If agent completed without any response (no reply AND no reaction), retry
        if (!hasResponded && response.stopReason === "end_turn") {
          sessionLogger.warn(
            "Agent completed without sending reply or reaction, retrying with special prompt",
          );

          const retryStrategy = getRetryPromptStrategy(agentType);

          for (let attempt = 0; attempt < retryStrategy.maxRetries; attempt++) {
            // Clear reply state to allow retry (reaction state is NOT cleared)
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

            // Check if reply or reaction was sent after retry
            replySent = replyHandler.hasReplySent(workspace.key, event.channelId);
            reactionSent = reactionHandler.hasReactionSent(workspace.key, event.channelId);
            hasResponded = replySent || reactionSent;

            if (hasResponded) {
              sessionLogger.info("Response sent after retry", {
                sessionId,
                attempt: attempt + 1,
                replySent,
                reactionSent,
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

          // Re-evaluate after retry
          replySent = replyHandler.hasReplySent(workspace.key, event.channelId);
          reactionSent = reactionHandler.hasReactionSent(workspace.key, event.channelId);
          hasResponded = replySent || reactionSent;
        }

        if (hasResponded) {
          return {
            success: true,
            replySent,
            reactionSent,
          };
        }

        // Agent completed but didn't send reply or reaction even after retry
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
   * Process a spontaneous post without a user-triggered event.
   * Used by the SpontaneousScheduler to create unprompted posts.
   */
  async processSpontaneousPost(
    platform: Platform,
    channelId: string,
    platformAdapter: PlatformAdapter,
    options: {
      botId: string;
      fetchRecentMessages: boolean;
    },
  ): Promise<SessionResponse> {
    const sessionLoggerName = `spontaneous:${platform}:${channelId}`;
    const sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing spontaneous post", {
      platform,
      channelId,
      fetchRecentMessages: options.fetchRecentMessages,
    });

    try {
      // 1. Create workspace for the bot itself
      const botEvent: NormalizedEvent = {
        platform,
        channelId,
        userId: options.botId,
        messageId: `spontaneous_${Date.now()}`,
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      };
      const workspace = await this.workspaceManager.getOrCreateWorkspace(botEvent);
      const agentWorkspacePath = await this.workspaceManager.getOrCreateAgentWorkspace();

      // 2. Register session WITHOUT triggerEvent
      let shellSessionId: string | null = null;
      if (this.config.skillApi?.enabled) {
        shellSessionId = this.sessionRegistry.register({
          platform,
          channelId,
          userId: options.botId,
          isDm: false,
          workspace,
          platformAdapter,
          // triggerEvent is omitted (undefined)
          timeoutMs: this.config.skillApi.sessionTimeoutMs,
          agentWorkspacePath,
        });

        const sessionIdFile = join(workspace.path, "SESSION_ID");
        await Deno.writeTextFile(sessionIdFile, shellSessionId);
        sessionLogger.info("Shell session registered", { shellSessionId });
      }

      // 3. Assemble spontaneous context
      const context = await this.contextAssembler.assembleSpontaneousContext(
        platform,
        channelId,
        workspace,
        platformAdapter,
        { fetchRecentMessages: options.fetchRecentMessages },
      );

      // 4. Format context
      const formattedContext = this.contextAssembler.formatSpontaneousContext(context);
      const fullPrompt = this.buildSpontaneousPrompt(formattedContext, shellSessionId);

      sessionLogger.debug("Spontaneous prompt built", {
        estimatedTokens: formattedContext.estimatedTokens,
      });

      // 5. Create client config for ACP
      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform,
        userId: options.botId,
        channelId,
        isDM: false,
        yolo: this.yolo,
      };

      // 6. Build and execute ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          this.yolo,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");

        const sessionId = await connector.createSession();
        await connector.setSessionModel(sessionId, this.config.agent.model);

        // Clear reply state
        const replyHandler = this.skillRegistry.getReplyHandler();
        replyHandler.clearReplyState(workspace.key, channelId);

        // Send prompt
        const response = await connector.prompt(sessionId, fullPrompt);
        sessionLogger.info("Agent session completed", {
          stopReason: response.stopReason,
        });

        let replySent = replyHandler.hasReplySent(workspace.key, channelId);

        // Retry if no reply sent
        if (!replySent && response.stopReason === "end_turn") {
          sessionLogger.warn("Agent completed without reply, retrying");

          const retryStrategy = getRetryPromptStrategy(agentType);
          for (let attempt = 0; attempt < retryStrategy.maxRetries; attempt++) {
            replyHandler.clearReplyState(workspace.key, channelId);

            const retryResponse = await connector.prompt(
              sessionId,
              retryStrategy.retryPromptMessage,
            );

            replySent = replyHandler.hasReplySent(workspace.key, channelId);
            if (replySent || retryResponse.stopReason !== "end_turn") break;
          }

          replySent = replyHandler.hasReplySent(workspace.key, channelId);
        }

        return {
          success: replySent,
          replySent,
          error: replySent ? undefined : "Agent did not send a reply",
        };
      } finally {
        await connector.disconnect();
        sessionLogger.debug("Agent disconnected");

        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              sessionLogger.warn("Failed to remove SESSION_ID file", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    } catch (error) {
      sessionLogger.error("Spontaneous post session failed", {
        platform,
        channelId,
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
   * Process a self-research session.
   * The agent reads RSS materials, picks a topic, researches it, and writes notes.
   * This does NOT send any reply to any platform - it only writes to agent workspace.
   */
  async processSelfResearch(
    rssItems: RssItem[],
    selfResearchConfig: SelfResearchConfig,
  ): Promise<SessionResponse> {
    const sessionLoggerName = "self-research";
    const sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing self-research session", {
      rssItemCount: rssItems.length,
      model: selfResearchConfig.model,
    });

    try {
      // 1. Create workspace for self-research (uses special internal key)
      const botEvent: NormalizedEvent = {
        platform: "discord",
        channelId: "internal",
        userId: "self-research",
        messageId: `research_${Date.now()}`,
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      };
      const workspace = await this.workspaceManager.getOrCreateWorkspace(botEvent);
      const agentWorkspacePath = await this.workspaceManager.getOrCreateAgentWorkspace();

      // 2. Register session (for skill API access, mainly for memory-search)
      let shellSessionId: string | null = null;
      if (this.config.skillApi?.enabled) {
        shellSessionId = this.sessionRegistry.register({
          platform: "discord",
          channelId: "internal",
          userId: "self-research",
          isDm: false,
          workspace,
          platformAdapter: undefined as unknown as PlatformAdapter,
          timeoutMs: this.config.skillApi.sessionTimeoutMs,
          agentWorkspacePath,
        });

        const sessionIdFile = join(workspace.path, "SESSION_ID");
        await Deno.writeTextFile(sessionIdFile, shellSessionId);
        sessionLogger.info("Shell session registered", { shellSessionId });
      }

      // 3. Build self-research prompt
      const fullPrompt = await this.buildSelfResearchPrompt(
        rssItems,
        shellSessionId,
      );

      sessionLogger.debug("Self-research prompt built");

      // 4. Create client config for ACP
      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform: "discord",
        userId: "self-research",
        channelId: "internal",
        isDM: false,
        yolo: this.yolo,
      };

      // 5. Build and execute ACP connector (use selfResearch model)
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          this.yolo,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");

        const sessionId = await connector.createSession();
        // Use self-research specific model
        await connector.setSessionModel(sessionId, selfResearchConfig.model);

        // Send prompt
        const response = await connector.prompt(sessionId, fullPrompt);
        sessionLogger.info("Self-research agent session completed", {
          stopReason: response.stopReason,
        });

        // Success is determined by agent completing normally
        const success = response.stopReason === "end_turn";

        return {
          success,
          replySent: false,
          error: success ? undefined : `Unexpected stop reason: ${response.stopReason}`,
        };
      } finally {
        await connector.disconnect();
        sessionLogger.debug("Agent disconnected");

        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              sessionLogger.warn("Failed to remove SESSION_ID file", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    } catch (error) {
      sessionLogger.error("Self-research session failed", {
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
   * Create an AgentConnector instance.
   * Protected to allow test subclasses to inject mocks.
   */
  protected createConnector(options: AgentConnectorOptions): AgentConnector {
    return new AgentConnector(options);
  }

  /**
   * Build the full prompt to send to the agent for spontaneous posts
   */
  private buildSpontaneousPrompt(
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
    parts.push("# Context");
    parts.push("");
    parts.push(context.userMessage);
    parts.push("");

    // Instructions for spontaneous mode
    parts.push("# Instructions");
    parts.push("");
    parts.push("This is a spontaneous post session. You are NOT responding to any user message.");
    parts.push("- Create original content that fits your character and personality");
    parts.push("- Use the `send-reply` skill to post your content");
    parts.push("- Do NOT use the `react-message` skill (there is no message to react to)");
    parts.push("- Do NOT address or respond to any specific user");
    parts.push("You may use other available skills as needed.");

    return parts.join("\n");
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
    parts.push(
      "You may also use `react-message` to add an emoji reaction to the trigger message.",
    );
    parts.push(
      "You can react AND reply, or just react without replying, or just reply without reacting.",
    );
    parts.push("You may use other available skills as needed.");

    return parts.join("\n");
  }

  /**
   * Build the full prompt for a self-research session
   */
  private async buildSelfResearchPrompt(
    rssItems: RssItem[],
    sessionId: string | null,
  ): Promise<string> {
    // Read system_self_research.md
    const promptDir = dirname(this.config.agent.systemPromptPath);
    const instructionsPath = join(promptDir, "system_self_research.md");
    let instructions = await Deno.readTextFile(instructionsPath);

    // Replace {{placeholder}} tokens using the same prompt fragment mechanism
    const fragments = await loadPromptFragments(promptDir, "system_self_research.md");
    instructions = replacePlaceholders(instructions, fragments);

    // Format RSS items
    const rssBlock = rssItems.map((item, i) =>
      `${
        i + 1
      }. **${item.title}**\n   Source: ${item.sourceName}\n   URL: ${item.url}\n   ${item.description}`
    ).join("\n\n");

    // Replace RSS placeholder
    instructions = instructions.replace("{rss_items_placeholder}", rssBlock);

    const parts: string[] = [];
    parts.push(instructions);
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

    return parts.join("\n");
  }
}
