// src/core/session-orchestrator.ts

import { createLogger } from "@utils/logger.ts";
import type { ReplyPolicyEvaluator, YoloDecision } from "./reply-policy.ts";
import {
  activeSessionsGauge,
  remindersDeliveredTotal,
  sessionDurationSeconds,
  sessionsTotal,
} from "@utils/metrics.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import * as acp from "@agentclientprotocol/sdk";
import {
  createAgentConfig,
  getDefaultAgentType,
  getRetryPromptStrategy,
} from "@acp/agent-factory.ts";
import { ContextAssembler } from "./context-assembler.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { MemoryStore } from "./memory-store.ts";
import { convertUserMCPServerConfigs } from "./config-loader.ts";
import { createTemplateEngine, renderTemplate } from "./template-renderer.ts";
import type { TemplateVariables } from "../types/template.ts";
import { resolveModel } from "./model-router.ts";
import type { ModelRoutingContext } from "./model-router.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import type { Config, MemoryMaintenanceConfig, SelfResearchConfig } from "../types/config.ts";
import { isValidPlatform } from "../types/events.ts";
import type { NormalizedEvent, Platform } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { AgentConnectorOptions, ClientConfig, MCPServerConfig } from "@acp/types.ts";
import { dirname, join } from "@std/path";
import type { RssItem } from "@utils/rss-fetcher.ts";
import type { WorkspaceInfo } from "../types/workspace.ts";
import type { ResolvedReminder } from "../types/reminder.ts";
import type { ReminderStore } from "./reminder-store.ts";
import { SessionAuditWriter } from "./audit-logger.ts";

const logger = createLogger("SessionOrchestrator");

/** Maximum image size in bytes for downloading (20MB) */
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

/** Timeout for image download in milliseconds */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

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
  private memoryStore: MemoryStore;
  private config: Config;
  private yolo: boolean;
  private replyPolicy?: ReplyPolicyEvaluator;

  constructor(
    workspaceManager: WorkspaceManager,
    contextAssembler: ContextAssembler,
    skillRegistry: SkillRegistry,
    config: Config,
    sessionRegistry: SessionRegistry,
    memoryStore: MemoryStore,
    yolo = false,
    replyPolicy?: ReplyPolicyEvaluator,
  ) {
    this.workspaceManager = workspaceManager;
    this.contextAssembler = contextAssembler;
    this.skillRegistry = skillRegistry;
    this.sessionRegistry = sessionRegistry;
    this.memoryStore = memoryStore;
    this.config = config;
    this.yolo = yolo;
    this.replyPolicy = replyPolicy;
  }

  /**
   * Compute effective YOLO mode for a given context.
   *
   * Resolution order:
   *  1. Global --yolo CLI flag  → always wins, bypasses all checks.
   *  2. Per-channel config      → account-level or channel-level yolo: true.
   *  3. Default                 → YOLO disabled.
   *
   * Returns a structured {@link YoloDecision} so callers can log & audit the reason.
   */
  private getEffectiveYolo(platform: string, userId: string, channelId: string): YoloDecision {
    // 1. Global flag takes precedence over everything.
    if (this.yolo) {
      logger.info(
        "YOLO enabled via global --yolo flag for {platform} user {userId} channel {channelId}",
        { platform, userId, channelId },
      );
      return { enabled: true, source: "global_flag" };
    }

    // 2. Delegate to per-channel config evaluation.
    if (this.replyPolicy) {
      const decision = this.replyPolicy.resolveYoloDecision(platform, userId, channelId);
      logger.info(
        "YOLO resolution for {platform} user {userId} channel {channelId}: {yoloEnabled} via {yoloSource}",
        {
          platform,
          userId,
          channelId,
          yoloEnabled: decision.enabled,
          yoloSource: decision.source,
          matchedConfigId: decision.matchedConfigId,
        },
      );
      return decision;
    }

    // 3. No reply policy configured — YOLO stays off.
    logger.debug(
      "YOLO disabled (no reply policy) for {platform} user {userId} channel {channelId}",
      { platform, userId, channelId },
    );
    return { enabled: false, source: "none" };
  }

  private getMCPServers(): MCPServerConfig[] {
    if (!this.config.agent.mcpServers || this.config.agent.mcpServers.length === 0) {
      return [];
    }
    return convertUserMCPServerConfigs(this.config.agent.mcpServers);
  }

  /**
   * Handle dry run mode: write assembled prompt to file and optionally send mock reply.
   * Returns a SessionResponse if dry run is active, or null if normal execution should proceed.
   */
  private async handleDryRun(
    sessionType: string,
    fullPrompt: string,
    sessionLogger: ReturnType<typeof logger.child>,
    options?: {
      workspaceKey?: string;
      channelId?: string;
      shellSessionId?: string | null;
      event?: NormalizedEvent;
    },
  ): Promise<SessionResponse | null> {
    const dryRunConfig = this.config.agent.dryRun;
    if (!dryRunConfig?.enabled) {
      return null;
    }

    sessionLogger.warn("🧪 Dry run mode — skipping Agent execution");

    // Ensure output directory exists
    await Deno.mkdir(dryRunConfig.outputPath, { recursive: true });

    // Generate output filename with timestamp and session type
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = options?.shellSessionId ? `_${options.shellSessionId.slice(0, 8)}` : "";
    const outputFile = join(
      dryRunConfig.outputPath,
      `${sessionType}_${timestamp}${suffix}.md`,
    );

    // Write the full prompt to file
    await Deno.writeTextFile(outputFile, fullPrompt);
    sessionLogger.info("Dry run prompt written to {outputFile}", { outputFile });

    // Optionally send mock reply via platform adapter
    let replySent = false;
    if (
      dryRunConfig.mockReply &&
      options?.workspaceKey &&
      options?.channelId
    ) {
      const replyHandler = this.skillRegistry.getReplyHandler();
      replyHandler.clearReplyState(options.workspaceKey, options.channelId);

      try {
        const session = options.shellSessionId
          ? this.sessionRegistry.get(options.shellSessionId)
          : null;

        if (session?.platformAdapter && options.event) {
          await session.platformAdapter.sendReply(
            options.event.channelId,
            dryRunConfig.mockReply,
            { replyToMessageId: options.event.messageId },
          );
          replySent = true;
          sessionLogger.info("Dry run mock reply sent");
        }
      } catch (error) {
        sessionLogger.warn("Dry run mock reply failed (non-fatal)", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      replySent,
    };
  }

  /**
   * Process a message event through the full orchestration flow
   */
  processMessage(
    event: NormalizedEvent,
    platformAdapter: PlatformAdapter,
  ): Promise<SessionResponse> {
    return this.processMessageInternal(event, platformAdapter, "message");
  }

  /**
   * Process a channel lurk message (same as processMessage but with channelLurk session type)
   */
  processChannelLurkMessage(
    event: NormalizedEvent,
    platformAdapter: PlatformAdapter,
  ): Promise<SessionResponse> {
    return this.processMessageInternal(event, platformAdapter, "channelLurk");
  }

  private async processMessageInternal(
    event: NormalizedEvent,
    platformAdapter: PlatformAdapter,
    sessionType: "message" | "channelLurk",
  ): Promise<SessionResponse> {
    const sessionLoggerName = `${event.platform}:${event.channelId}`;
    let sessionLogger = logger.child(sessionLoggerName);

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

    const sessionStartTime = Date.now();
    activeSessionsGauge.inc();
    let result: SessionResponse;
    let auditWriter: SessionAuditWriter | null = null;

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

        sessionLogger.info("Shell session {shellSessionId} registered", {
          shellSessionId,
          sessionIdFile,
        });

        sessionLogger = sessionLogger.withContext({ shellSessionId });
      }

      // Create audit writer if enabled
      auditWriter = shellSessionId
        ? this.createAuditWriter(event.platform, event.userId, shellSessionId)
        : null;

      // Attach audit writer to session registry for skill-level auditing
      if (auditWriter && shellSessionId) {
        this.sessionRegistry.setAuditWriter(shellSessionId, auditWriter);
      }

      // Pre-resolve model for template variables and later session model assignment
      const routingContext: ModelRoutingContext = {
        sessionType,
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
        messageContent: event.content,
      };
      const resolvedModel = resolveModel(
        this.config.agent.modelRouting,
        routingContext,
        this.config.agent.model,
      );

      // Compute YOLO decision early so it's available for context assembly and prompt rendering
      const yoloDecision = this.getEffectiveYolo(
        event.platform,
        event.userId,
        event.channelId,
      );

      // Audit: yolo_resolution
      await auditWriter?.write("yolo_resolution", {
        yoloEnabled: yoloDecision.enabled,
        yoloSource: yoloDecision.source,
        matchedConfigId: yoloDecision.matchedConfigId,
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
      });

      // 3. Assemble initial context
      const context = await this.contextAssembler.assembleContext(
        event,
        workspace,
        platformAdapter,
        shellSessionId ?? undefined,
        resolvedModel,
        yoloDecision.enabled,
      );
      sessionLogger.debug("Context assembled", {
        memoriesCount: context.importantMemories.length,
        recentMessagesCount: context.recentMessages.length,
        relatedMessagesCount: context.relatedMessages?.length ?? 0,
        estimatedTokens: context.estimatedTokens,
      });

      // Audit: context_assembly
      await auditWriter?.write("context_assembly", {
        memoriesCount: context.importantMemories.length,
        recentMessagesCount: context.recentMessages.length,
        relatedMessagesCount: context.relatedMessages?.length ?? 0,
        estimatedTokens: context.estimatedTokens,
      });

      // 3. Format context for prompt
      const formattedContext = this.contextAssembler.formatContext(context);

      // 4. Re-render system prompt with user context to produce the full prompt
      const fullPrompt = await this.contextAssembler.renderFullPrompt(
        event,
        shellSessionId ?? undefined,
        formattedContext.userMessage,
        resolvedModel,
        yoloDecision.enabled,
      );

      sessionLogger.debug("Prompt built", {
        estimatedTokens: formattedContext.estimatedTokens,
      });

      sessionLogger.debug("Full prompt content", {
        fullPrompt,
      });

      // === DRY RUN CHECK ===
      const dryRunResult = await this.handleDryRun(
        sessionType,
        fullPrompt,
        sessionLogger,
        {
          workspaceKey: workspace.key,
          channelId: event.channelId,
          shellSessionId,
          event,
        },
      );
      if (dryRunResult) {
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch { /* ignore NotFound */ }
        }
        result = dryRunResult;
        return result;
      }
      // === END DRY RUN CHECK ===

      // 4. Create client config for ACP

      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
        isDM: event.isDm,
        yolo: yoloDecision.enabled,
        autoApproveSkills: this.config.agent.autoApproveSkills,
      };

      // 5. Build ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          yoloDecision.enabled,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
        idleTimeoutConfig: this.config.agent.idleTimeout,
      });

      // Start typing indicator if platform supports it
      let typingInterval: ReturnType<typeof setInterval> | undefined;
      if (platformAdapter.supportsTypingIndicator()) {
        platformAdapter.sendTyping(event.channelId);
        typingInterval = setInterval(() => {
          platformAdapter.sendTyping(event.channelId);
        }, 10_000);
      }

      // 6. Execute agent session
      try {
        await connector.connect();
        sessionLogger.info("Agent connected");

        // Audit: agent_connect
        await auditWriter?.write("agent_connect", {
          agentType: getDefaultAgentType(this.config),
        });

        // Inject audit writer for permission decision auditing
        if (auditWriter) {
          connector.getClient()?.setAuditWriter(auditWriter);
        }

        // Check Agent image capability
        const supportsImage = connector.supportsImageContent();
        sessionLogger.info("Agent capabilities checked", { supportsImage });

        const sessionId = await connector.createSession(this.getMCPServers());
        sessionLogger.info("Agent session {sessionId} created", { sessionId });
        sessionLogger = sessionLogger.withContext({ sessionId });

        // Set the model for the session (using pre-resolved model)
        await connector.setSessionModel(sessionId, resolvedModel);
        sessionLogger.info("Agent session {sessionId} model set to {model}", {
          sessionId,
          model: resolvedModel,
        });

        // Clear reply state before prompting
        const replyHandler = this.skillRegistry.getReplyHandler();
        replyHandler.clearReplyState(workspace.key, event.channelId);

        // Clear reaction state before prompting
        const reactionHandler = this.skillRegistry.getReactionHandler();
        reactionHandler.clearReactionState(workspace.key, event.channelId);

        // Clear reminder session state before prompting
        const reminderHandler = this.skillRegistry.getReminderHandler();
        if (reminderHandler) {
          reminderHandler.clearSessionState(workspace.key, event.channelId);
        }

        // Send prompt to agent (with image ContentBlocks if supported)
        const promptContent = await this.buildPromptContent(
          fullPrompt,
          supportsImage,
          event,
          sessionLogger,
        );

        // Audit: prompt_sent
        const promptLen = typeof promptContent === "string"
          ? promptContent.length
          : promptContent.filter((b) => b.type === "text").reduce(
            (sum, b) => sum + ("text" in b ? (b as { text: string }).text.length : 0),
            0,
          );
        const imageCount = typeof promptContent === "string"
          ? 0
          : promptContent.filter((b) => b.type === "image").length;
        await auditWriter?.write("prompt_sent", {
          promptLength: promptLen,
          imageCount,
          modelId: resolvedModel,
        });

        const response = await this.promptWithIdleTimeoutHandling(
          connector,
          sessionId,
          promptContent,
        );

        if (response === null) {
          sessionLogger.warn(
            "Session {sessionId} ended without agent response after reconnect",
            { sessionId },
          );
          return {
            success: false,
            replySent: false,
            error: "Session lost due to idle timeout and reconnection failure",
          };
        }

        sessionLogger.info("Agent session {sessionId} completed with stopReason {stopReason}", {
          sessionId,
          stopReason: response.stopReason,
        });

        // Audit: agent_response
        await auditWriter?.write("agent_response", {
          stopReason: response.stopReason,
          isRetry: false,
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
          // Audit: session_end (success with response)
          await auditWriter?.write("session_end", {
            success: true,
            replySent,
            reactionSent,
            durationMs: Date.now() - sessionStartTime,
          });
          result = {
            success: true,
            replySent,
            reactionSent,
          };
          return result;
        }

        // Agent completed but didn't send reply or reaction even after retry
        if (response.stopReason === "end_turn") {
          sessionLogger.warn("Agent completed without sending reply after retry");
          await auditWriter?.write("session_end", {
            success: false,
            replySent: false,
            durationMs: Date.now() - sessionStartTime,
            error: "Agent did not generate a reply",
          });
          result = {
            success: false,
            replySent: false,
            error: "Agent did not generate a reply",
          };
          return result;
        }

        if (response.stopReason === "cancelled") {
          await auditWriter?.write("session_end", {
            success: false,
            replySent: false,
            durationMs: Date.now() - sessionStartTime,
            error: "Session was cancelled",
          });
          result = {
            success: false,
            replySent: false,
            error: "Session was cancelled",
          };
          return result;
        }

        await auditWriter?.write("session_end", {
          success: false,
          replySent: false,
          durationMs: Date.now() - sessionStartTime,
          error: `Unexpected stop reason: ${response.stopReason}`,
        });
        result = {
          success: false,
          replySent: false,
          error: `Unexpected stop reason: ${response.stopReason}`,
        };
        return result;
      } finally {
        // Clear typing indicator interval
        if (typingInterval) {
          clearInterval(typingInterval);
        }

        await connector.disconnect();
        sessionLogger.debug("Agent disconnected");

        // Clean up shell session if it exists
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          sessionLogger.debug("Shell session {shellSessionId} cleaned up", { shellSessionId });

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
      // Audit: session_end (exception) — auditWriter may be null if error occurs before creation
      await auditWriter?.write("session_end", {
        success: false,
        durationMs: Date.now() - sessionStartTime,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return result;
    } finally {
      activeSessionsGauge.dec();
      const durationSec = (Date.now() - sessionStartTime) / 1000;
      const status = result!.success ? "success" : "failure";
      sessionsTotal.labels(event.platform, sessionType, status).inc();
      sessionDurationSeconds.labels(event.platform, sessionType, status).observe(durationSec);
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
    let sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing spontaneous post", {
      platform,
      channelId,
      fetchRecentMessages: options.fetchRecentMessages,
    });

    const sessionStartTime = Date.now();
    activeSessionsGauge.inc();
    let result: SessionResponse;
    let auditWriter: SessionAuditWriter | null = null;

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
        sessionLogger.info("Shell session {shellSessionId} registered", { shellSessionId });

        sessionLogger = sessionLogger.withContext({ shellSessionId });
      }

      // Create audit writer
      auditWriter = shellSessionId
        ? this.createAuditWriter(platform, options.botId, shellSessionId)
        : null;
      if (auditWriter && shellSessionId) {
        this.sessionRegistry.setAuditWriter(shellSessionId, auditWriter);
      }

      // Pre-resolve model for template variables and later session model assignment
      const routingContext: ModelRoutingContext = {
        sessionType: "spontaneous",
        platform,
        userId: options.botId,
        channelId,
      };
      const resolvedModel = resolveModel(
        this.config.agent.modelRouting,
        routingContext,
        this.config.agent.model,
      );

      // Compute YOLO decision early so it's available for context assembly and prompt rendering
      const yoloDecision = this.getEffectiveYolo(platform, options.botId, channelId);

      // Audit: yolo_resolution
      await auditWriter?.write("yolo_resolution", {
        yoloEnabled: yoloDecision.enabled,
        yoloSource: yoloDecision.source,
        matchedConfigId: yoloDecision.matchedConfigId,
        platform,
        userId: options.botId,
        channelId,
      });

      // 3. Assemble spontaneous context
      const context = await this.contextAssembler.assembleSpontaneousContext(
        platform,
        channelId,
        workspace,
        platformAdapter,
        { fetchRecentMessages: options.fetchRecentMessages },
        shellSessionId ?? undefined,
        resolvedModel,
        yoloDecision.enabled,
      );

      // 4. Build prompt from template
      const fullPrompt = await this.buildSpontaneousPromptFromTemplate(
        context,
        shellSessionId,
        resolvedModel,
        yoloDecision.enabled,
      );

      sessionLogger.debug("Spontaneous prompt built", {
        estimatedTokens: context.estimatedTokens,
      });

      // === DRY RUN CHECK ===
      const dryRunResult = await this.handleDryRun(
        "spontaneous",
        fullPrompt,
        sessionLogger,
        {
          workspaceKey: workspace.key,
          channelId,
          shellSessionId,
        },
      );
      if (dryRunResult) {
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch { /* ignore NotFound */ }
        }
        result = dryRunResult;
        return result;
      }
      // === END DRY RUN CHECK ===

      // 5. Create client config for ACP

      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform,
        userId: options.botId,
        channelId,
        isDM: false,
        yolo: yoloDecision.enabled,
        autoApproveSkills: this.config.agent.autoApproveSkills,
      };

      // 6. Build and execute ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          yoloDecision.enabled,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
        idleTimeoutConfig: this.config.agent.idleTimeout,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");

        // Audit: agent_connect
        await auditWriter?.write("agent_connect", {
          agentType: getDefaultAgentType(this.config),
        });

        // Inject audit writer for permission decision auditing
        if (auditWriter) {
          connector.getClient()?.setAuditWriter(auditWriter);
        }

        const sessionId = await connector.createSession(this.getMCPServers());
        sessionLogger = sessionLogger.withContext({ sessionId });
        // Set the model for the session (using pre-resolved model)
        await connector.setSessionModel(sessionId, resolvedModel);

        // Clear reply state
        const replyHandler = this.skillRegistry.getReplyHandler();
        replyHandler.clearReplyState(workspace.key, channelId);

        // Audit: prompt_sent
        await auditWriter?.write("prompt_sent", {
          promptLength: fullPrompt.length,
          modelId: resolvedModel,
        });

        // Send prompt
        const response = await this.promptWithIdleTimeoutHandling(
          connector,
          sessionId,
          fullPrompt,
        );

        if (response === null) {
          sessionLogger.warn("Spontaneous session ended without response after reconnect");
          return { success: false, replySent: false, error: "Session lost due to idle timeout" };
        }

        sessionLogger.info("Agent session completed with stopReason {stopReason}", {
          stopReason: response.stopReason,
        });

        // Audit: agent_response
        await auditWriter?.write("agent_response", {
          stopReason: response.stopReason,
          isRetry: false,
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

        // Audit: session_end
        await auditWriter?.write("session_end", {
          success: replySent,
          replySent,
          durationMs: Date.now() - sessionStartTime,
          error: replySent ? undefined : "Agent did not send a reply",
        });

        result = {
          success: replySent,
          replySent,
          error: replySent ? undefined : "Agent did not send a reply",
        };
        return result;
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
      await auditWriter?.write("session_end", {
        success: false,
        durationMs: Date.now() - sessionStartTime,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return result;
    } finally {
      activeSessionsGauge.dec();
      const durationSec = (Date.now() - sessionStartTime) / 1000;
      const status = result!.success ? "success" : "failure";
      sessionsTotal.labels(platform, "spontaneous", status).inc();
      sessionDurationSeconds.labels(platform, "spontaneous", status).observe(durationSec);
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
    let sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing self-research session", {
      rssItemCount: rssItems.length,
      model: selfResearchConfig.model,
    });

    const sessionStartTime = Date.now();
    activeSessionsGauge.inc();
    let result: SessionResponse;
    let auditWriter: SessionAuditWriter | null = null;

    try {
      // 1. Create workspace for self-research (uses special internal key)
      // Self-research doesn't belong to any real platform.
      // "discord" is used as a placeholder to satisfy NormalizedEvent's required
      // platform field. The workspace key becomes "discord/self-research", which
      // is functionally correct but semantically imprecise.
      // A proper fix would require extending Platform type or redesigning
      // workspace key generation for non-platform sessions.
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
          platform: "discord", // Placeholder — see comment above on botEvent
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
        sessionLogger.info("Shell session {shellSessionId} registered", { shellSessionId });

        sessionLogger = sessionLogger.withContext({ shellSessionId });
      }

      // Create audit writer
      auditWriter = shellSessionId
        ? this.createAuditWriter("discord", "self-research", shellSessionId) // Placeholder platform
        : null;
      if (auditWriter && shellSessionId) {
        this.sessionRegistry.setAuditWriter(shellSessionId, auditWriter);
      }

      // Pre-resolve model for template variables and later session model assignment
      // Fallback chain: routing rules → selfResearch.model → agent.model
      const routingContext: ModelRoutingContext = {
        sessionType: "self-research",
      };
      const sectionFallback = selfResearchConfig.model || this.config.agent.model;
      const resolvedModel = resolveModel(
        this.config.agent.modelRouting,
        routingContext,
        sectionFallback,
      );

      // 3. Build self-research prompt
      const fullPrompt = await this.buildSelfResearchPrompt(
        rssItems,
        shellSessionId,
        resolvedModel,
        this.yolo,
      );

      sessionLogger.debug("Self-research prompt built");

      // === DRY RUN CHECK ===
      const dryRunResult = await this.handleDryRun(
        "self_research",
        fullPrompt,
        sessionLogger,
        { shellSessionId },
      );
      if (dryRunResult) {
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch { /* ignore NotFound */ }
        }
        result = dryRunResult;
        return result;
      }
      // === END DRY RUN CHECK ===

      // 4. Create client config for ACP
      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform: "discord",
        userId: "self-research",
        channelId: "internal",
        isDM: false,
        yolo: this.yolo,
        autoApproveSkills: this.config.agent.autoApproveSkills,
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
        idleTimeoutConfig: this.config.agent.idleTimeout,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");
        await auditWriter?.write("agent_connect", { agentType: getDefaultAgentType(this.config) });

        // Inject audit writer for permission decision auditing
        if (auditWriter) {
          connector.getClient()?.setAuditWriter(auditWriter);
        }

        const sessionId = await connector.createSession(this.getMCPServers());
        sessionLogger = sessionLogger.withContext({ sessionId });
        // Set the model for the session (using pre-resolved model)
        await connector.setSessionModel(sessionId, resolvedModel);

        // Audit: prompt_sent
        await auditWriter?.write("prompt_sent", {
          promptLength: fullPrompt.length,
          modelId: resolvedModel,
        });

        // Send prompt
        const response = await this.promptWithIdleTimeoutHandling(
          connector,
          sessionId,
          fullPrompt,
        );

        if (response === null) {
          sessionLogger.warn("Self-research session ended without response after reconnect");
          return { success: false, replySent: false, error: "Session lost due to idle timeout" };
        }

        sessionLogger.info("Self-research agent session completed with stopReason {stopReason}", {
          stopReason: response.stopReason,
        });
        await auditWriter?.write("agent_response", {
          stopReason: response.stopReason,
          isRetry: false,
        });

        // Success is determined by agent completing normally
        const success = response.stopReason === "end_turn";

        await auditWriter?.write("session_end", {
          success,
          replySent: false,
          durationMs: Date.now() - sessionStartTime,
          error: success ? undefined : `Unexpected stop reason: ${response.stopReason}`,
        });

        result = {
          success,
          replySent: false,
          error: success ? undefined : `Unexpected stop reason: ${response.stopReason}`,
        };
        return result;
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
      await auditWriter?.write("session_end", {
        success: false,
        durationMs: Date.now() - sessionStartTime,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return result;
    } finally {
      activeSessionsGauge.dec();
      const durationSec = (Date.now() - sessionStartTime) / 1000;
      const status = result!.success ? "success" : "failure";
      sessionsTotal.labels("internal", "self_research", status).inc();
      sessionDurationSeconds.labels("internal", "self_research", status).observe(durationSec);
    }
  }

  /**
   * Process a memory maintenance session for one workspace.
   * The agent summarizes/compacts memories and patches originals using memory skills.
   */
  async processMemoryMaintenance(
    workspaceKey: string,
    memoryMaintenanceConfig: MemoryMaintenanceConfig,
  ): Promise<SessionResponse> {
    const sessionLoggerName = `memory-maintenance:${workspaceKey}`;
    let sessionLogger = logger.child(sessionLoggerName);

    const [platformStr, userId] = workspaceKey.split("/");
    if (!isValidPlatform(platformStr) || !userId) {
      return {
        success: false,
        replySent: false,
        error: `Invalid workspace key: ${workspaceKey}`,
      };
    }
    const platform = platformStr;

    sessionLogger.info("Processing memory maintenance session", {
      workspaceKey,
      model: memoryMaintenanceConfig.model,
    });

    const sessionStartTime = Date.now();
    activeSessionsGauge.inc();
    let result: SessionResponse;
    let auditWriter: SessionAuditWriter | null = null;

    try {
      // Create synthetic DM event to ensure private memory access
      const syntheticEvent: NormalizedEvent = {
        platform,
        channelId: "internal",
        userId,
        messageId: `maintenance_${Date.now()}`,
        isDm: true,
        guildId: "",
        content: "",
        timestamp: new Date(),
      };
      const workspace = await this.workspaceManager.getOrCreateWorkspace(syntheticEvent);
      const agentWorkspacePath = await this.workspaceManager.getOrCreateAgentWorkspace();

      let shellSessionId: string | null = null;
      if (this.config.skillApi?.enabled) {
        shellSessionId = this.sessionRegistry.register({
          platform,
          channelId: "internal",
          userId,
          isDm: true,
          workspace,
          platformAdapter: undefined as unknown as PlatformAdapter,
          timeoutMs: this.config.skillApi.sessionTimeoutMs,
          agentWorkspacePath,
        });

        const sessionIdFile = join(workspace.path, "SESSION_ID");
        await Deno.writeTextFile(sessionIdFile, shellSessionId);
        sessionLogger.info("Shell session {shellSessionId} registered", { shellSessionId });

        sessionLogger = sessionLogger.withContext({ shellSessionId });
      }

      // Create audit writer
      auditWriter = shellSessionId
        ? this.createAuditWriter(platform, userId, shellSessionId)
        : null;
      if (auditWriter && shellSessionId) {
        this.sessionRegistry.setAuditWriter(shellSessionId, auditWriter);
      }

      // Pre-resolve model for template variables and later session model assignment
      // Fallback chain: routing rules → memoryMaintenance.model → agent.model
      const routingContext: ModelRoutingContext = {
        sessionType: "memory-maintenance",
      };
      const sectionFallback = memoryMaintenanceConfig.model || this.config.agent.model;
      const resolvedModel = resolveModel(
        this.config.agent.modelRouting,
        routingContext,
        sectionFallback,
      );

      const fullPrompt = await this.buildMemoryMaintenancePrompt(
        workspaceKey,
        shellSessionId,
        workspace,
        resolvedModel,
        this.yolo,
      );

      // === DRY RUN CHECK ===
      const dryRunResult = await this.handleDryRun(
        "memory_maintenance",
        fullPrompt,
        sessionLogger,
        { shellSessionId },
      );
      if (dryRunResult) {
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch { /* ignore NotFound */ }
        }
        result = dryRunResult;
        return result;
      }
      // === END DRY RUN CHECK ===

      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform,
        userId,
        channelId: "internal",
        isDM: true,
        yolo: this.yolo,
        autoApproveSkills: this.config.agent.autoApproveSkills,
      };

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
        idleTimeoutConfig: this.config.agent.idleTimeout,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");
        await auditWriter?.write("agent_connect", { agentType: getDefaultAgentType(this.config) });

        // Inject audit writer for permission decision auditing
        if (auditWriter) {
          connector.getClient()?.setAuditWriter(auditWriter);
        }

        const sessionId = await connector.createSession(this.getMCPServers());
        sessionLogger = sessionLogger.withContext({ sessionId });
        // Set the model for the session (using pre-resolved model)
        await connector.setSessionModel(sessionId, resolvedModel);

        await auditWriter?.write("prompt_sent", {
          promptLength: fullPrompt.length,
          modelId: resolvedModel,
        });
        const response = await this.promptWithIdleTimeoutHandling(
          connector,
          sessionId,
          fullPrompt,
        );

        if (response === null) {
          sessionLogger.warn("Memory maintenance session ended without response after reconnect");
          return { success: false, replySent: false, error: "Session lost due to idle timeout" };
        }

        sessionLogger.info("Memory maintenance session completed with stopReason {stopReason}", {
          stopReason: response.stopReason,
        });
        await auditWriter?.write("agent_response", {
          stopReason: response.stopReason,
          isRetry: false,
        });

        const success = response.stopReason === "end_turn";
        await auditWriter?.write("session_end", {
          success,
          replySent: false,
          durationMs: Date.now() - sessionStartTime,
          error: success ? undefined : `Unexpected stop reason: ${response.stopReason}`,
        });
        result = {
          success,
          replySent: false,
          error: success ? undefined : `Unexpected stop reason: ${response.stopReason}`,
        };
        return result;
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
      sessionLogger.error("Memory maintenance session failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await auditWriter?.write("session_end", {
        success: false,
        durationMs: Date.now() - sessionStartTime,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return result;
    } finally {
      activeSessionsGauge.dec();
      const durationSec = (Date.now() - sessionStartTime) / 1000;
      const status = result!.success ? "success" : "failure";
      sessionsTotal.labels(platform, "memory_maintenance", status).inc();
      sessionDurationSeconds.labels(platform, "memory_maintenance", status).observe(durationSec);
    }
  }

  /**
   * Process a due reminder — creates a new ACP session to deliver the reminder via DM.
   * Pattern follows processSpontaneousPost() but with reminder-specific context.
   */
  async processReminder(
    reminder: ResolvedReminder,
    platformAdapter: PlatformAdapter,
    reminderStore: ReminderStore,
  ): Promise<SessionResponse> {
    const platform = reminder.platform as Platform;
    const sessionLoggerName = `reminder:${platform}:${reminder.userId}:${reminder.id}`;
    let sessionLogger = logger.child(sessionLoggerName);

    sessionLogger.info("Processing due reminder {reminderId}", {
      reminderId: reminder.id,
      userId: reminder.userId,
      scheduledAt: reminder.scheduledAt,
    });

    const sessionStartTime = Date.now();
    activeSessionsGauge.inc();
    let result: SessionResponse;
    let auditWriter: SessionAuditWriter | null = null;

    try {
      // 1. Resolve DM channel
      const dmChannelId = await platformAdapter.getDmChannelId(reminder.userId);
      if (!dmChannelId) {
        sessionLogger.warn(
          "Cannot resolve DM channel for user {userId}, disabling reminder {reminderId}",
          { userId: reminder.userId, reminderId: reminder.id },
        );
        // Create workspace to access reminder store
        const syntheticEvent: NormalizedEvent = {
          platform,
          channelId: "internal",
          userId: reminder.userId,
          messageId: `reminder_cancel_${Date.now()}`,
          isDm: true,
          guildId: "",
          content: "",
          timestamp: new Date(),
        };
        const ws = await this.workspaceManager.getOrCreateWorkspace(syntheticEvent);
        await reminderStore.cancelReminder(ws, reminder.id);
        result = {
          success: false,
          replySent: false,
          error: "Cannot resolve DM channel — reminder disabled",
        };
        return result;
      }

      // 2. Create synthetic DM event
      const syntheticEvent: NormalizedEvent = {
        platform,
        channelId: dmChannelId,
        userId: reminder.userId,
        messageId: `reminder_${reminder.id}_${Date.now()}`,
        isDm: true,
        guildId: "",
        content: "",
        timestamp: new Date(),
      };
      const workspace = await this.workspaceManager.getOrCreateWorkspace(syntheticEvent);
      const agentWorkspacePath = await this.workspaceManager.getOrCreateAgentWorkspace();

      // 3. Register shell session
      let shellSessionId: string | null = null;
      if (this.config.skillApi?.enabled) {
        shellSessionId = this.sessionRegistry.register({
          platform,
          channelId: dmChannelId,
          userId: reminder.userId,
          isDm: true,
          workspace,
          platformAdapter,
          timeoutMs: this.config.skillApi.sessionTimeoutMs,
          agentWorkspacePath,
        });

        const sessionIdFile = join(workspace.path, "SESSION_ID");
        await Deno.writeTextFile(sessionIdFile, shellSessionId);
        sessionLogger.info("Shell session {shellSessionId} registered", { shellSessionId });

        sessionLogger = sessionLogger.withContext({ shellSessionId });
      }

      // Create audit writer
      auditWriter = shellSessionId
        ? this.createAuditWriter(platform, reminder.userId, shellSessionId)
        : null;
      if (auditWriter && shellSessionId) {
        this.sessionRegistry.setAuditWriter(shellSessionId, auditWriter);
      }

      // Pre-resolve model for template variables and later session model assignment
      const routingContext: ModelRoutingContext = {
        sessionType: "reminder",
        platform,
        userId: reminder.userId,
        channelId: dmChannelId,
      };
      const resolvedModel = resolveModel(
        this.config.agent.modelRouting,
        routingContext,
        this.config.agent.model,
      );

      // Compute YOLO decision early so it's available for prompt rendering
      const yoloDecision = this.getEffectiveYolo(platform, reminder.userId, dmChannelId);

      // Audit: yolo_resolution
      await auditWriter?.write("yolo_resolution", {
        yoloEnabled: yoloDecision.enabled,
        yoloSource: yoloDecision.source,
        matchedConfigId: yoloDecision.matchedConfigId,
        platform,
        userId: reminder.userId,
        channelId: dmChannelId,
      });

      // 4. Build reminder prompt
      const fullPrompt = await this.buildReminderPrompt(
        reminder,
        shellSessionId,
        resolvedModel,
        yoloDecision.enabled,
      );

      // === DRY RUN CHECK ===
      const dryRunResult = await this.handleDryRun(
        "reminder",
        fullPrompt,
        sessionLogger,
        { shellSessionId },
      );
      if (dryRunResult) {
        if (shellSessionId) {
          this.sessionRegistry.remove(shellSessionId);
          const sessionIdFile = join(workspace.path, "SESSION_ID");
          try {
            await Deno.remove(sessionIdFile);
          } catch { /* ignore NotFound */ }
        }
        result = dryRunResult;
        return result;
      }
      // === END DRY RUN CHECK ===

      // 5. Create client config

      const clientConfig: ClientConfig = {
        workingDir: workspace.path,
        agentWorkspacePath,
        platform,
        userId: reminder.userId,
        channelId: dmChannelId,
        isDM: true,
        yolo: yoloDecision.enabled,
        autoApproveSkills: this.config.agent.autoApproveSkills,
      };

      // 6. Build and execute ACP connector
      const agentType = getDefaultAgentType(this.config);
      const connector = this.createConnector({
        agentConfig: createAgentConfig(
          agentType,
          workspace.path,
          this.config,
          yoloDecision.enabled,
          agentWorkspacePath,
        ),
        clientConfig,
        skillRegistry: this.skillRegistry,
        logger: sessionLogger,
        idleTimeoutConfig: this.config.agent.idleTimeout,
      });

      try {
        await connector.connect();
        sessionLogger.info("Agent connected");
        await auditWriter?.write("agent_connect", { agentType: getDefaultAgentType(this.config) });

        // Inject audit writer for permission decision auditing
        if (auditWriter) {
          connector.getClient()?.setAuditWriter(auditWriter);
        }

        const sessionId = await connector.createSession(this.getMCPServers());
        sessionLogger = sessionLogger.withContext({ sessionId });
        // Set the model for the session (using pre-resolved model)
        await connector.setSessionModel(sessionId, resolvedModel);

        // Clear reply state
        const replyHandler = this.skillRegistry.getReplyHandler();
        replyHandler.clearReplyState(workspace.key, dmChannelId);

        // Audit: prompt_sent
        await auditWriter?.write("prompt_sent", {
          promptLength: fullPrompt.length,
          modelId: resolvedModel,
        });

        // Send prompt
        const response = await this.promptWithIdleTimeoutHandling(
          connector,
          sessionId,
          fullPrompt,
        );

        if (response === null) {
          sessionLogger.warn("Reminder session ended without response after reconnect");
          return { success: false, replySent: false, error: "Session lost due to idle timeout" };
        }

        sessionLogger.info("Agent session completed with stopReason {stopReason}", {
          stopReason: response.stopReason,
        });
        await auditWriter?.write("agent_response", {
          stopReason: response.stopReason,
          isRetry: false,
        });

        let replySent = replyHandler.hasReplySent(workspace.key, dmChannelId);

        // Retry if no reply sent
        if (!replySent && response.stopReason === "end_turn") {
          sessionLogger.warn("Agent completed without reply, retrying");

          const retryStrategy = getRetryPromptStrategy(agentType);
          for (let attempt = 0; attempt < retryStrategy.maxRetries; attempt++) {
            replyHandler.clearReplyState(workspace.key, dmChannelId);

            const retryResponse = await connector.prompt(
              sessionId,
              retryStrategy.retryPromptMessage,
            );

            replySent = replyHandler.hasReplySent(workspace.key, dmChannelId);
            if (replySent || retryResponse.stopReason !== "end_turn") break;
          }

          replySent = replyHandler.hasReplySent(workspace.key, dmChannelId);
        }

        // 7. Disable reminder on success
        if (replySent) {
          await reminderStore.cancelReminder(workspace, reminder.id);
          remindersDeliveredTotal.labels(platform, "success").inc();
          sessionLogger.info("Reminder {reminderId} delivered and disabled", {
            reminderId: reminder.id,
          });
        } else {
          remindersDeliveredTotal.labels(platform, "failure").inc();
        }

        // Audit: session_end (reminder)
        await auditWriter?.write("session_end", {
          success: replySent,
          replySent,
          durationMs: Date.now() - sessionStartTime,
          error: replySent ? undefined : "Agent did not send a reply",
        });

        result = {
          success: replySent,
          replySent,
          error: replySent ? undefined : "Agent did not send a reply",
        };
        return result;
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
      sessionLogger.error("Reminder session failed", {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await auditWriter?.write("session_end", {
        success: false,
        durationMs: Date.now() - sessionStartTime,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        replySent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return result;
    } finally {
      activeSessionsGauge.dec();
      const durationSec = (Date.now() - sessionStartTime) / 1000;
      const status = result!.success ? "success" : "failure";
      sessionsTotal.labels(platform, "reminder", status).inc();
      sessionDurationSeconds.labels(platform, "reminder", status).observe(durationSec);
    }
  }

  /**
   * Execute a prompt with idle timeout handling and session resumption.
   *
   * On idle timeout:
   * 1. Attempts to reconnect and resume the SAME session (not a new one)
   * 2. If session resumed and agent is still working → wait for completion
   * 3. If session cannot be resumed (loadSession unsupported) → throw error
   */
  private async promptWithIdleTimeoutHandling(
    connector: AgentConnector,
    sessionId: string,
    content: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse | null> {
    try {
      return await connector.prompt(sessionId, content);
    } catch (error) {
      const isIdleTimeout = error instanceof Error &&
        (error.message.includes("ACP connection dead") ||
          error.message.includes("ACP agent process exited unexpectedly"));

      if (!isIdleTimeout) {
        throw error;
      }

      logger.warn(
        "Idle timeout detected for session {sessionId}, attempting reconnect and resume...",
        { sessionId },
      );

      const resumed = await connector.reconnectAndResumeSession(sessionId);

      if (!resumed) {
        logger.error(
          "Cannot resume session {sessionId}: loadSession not supported by agent. Session lost.",
          { sessionId },
        );
        throw new Error(
          `ACP session ${sessionId} lost: connection died and agent does not support session resumption`,
        );
      }

      // Session resumed — wait for agent to complete or confirm idle
      logger.info(
        "Session {sessionId} resumed. Waiting for agent to complete or confirm idle...",
        { sessionId },
      );

      try {
        return await connector.prompt(sessionId, []);
      } catch (_resumeError) {
        logger.error(
          "Resumed session {sessionId} also timed out. Giving up.",
          { sessionId },
        );
        await connector.disconnect();
        return null;
      }
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
   * Create a SessionAuditWriter if audit is enabled.
   */
  private createAuditWriter(
    platform: string,
    userId: string,
    sessionId: string,
  ): SessionAuditWriter | null {
    if (!this.config.audit?.enabled) return null;
    return new SessionAuditWriter(
      join(this.config.workspace.repoPath, "audit"),
      platform,
      userId,
      sessionId,
      this.config.audit,
    );
  }

  /**
   * Build prompt content with optional image ContentBlocks.
   * Only downloads images from the trigger message when Agent supports image capability.
   */
  private async buildPromptContent(
    fullPrompt: string,
    supportsImage: boolean,
    event: NormalizedEvent,
    sessionLogger: ReturnType<typeof logger.child>,
  ): Promise<string | acp.ContentBlock[]> {
    if (!supportsImage || !event.attachments) {
      return fullPrompt;
    }

    const imageAttachments = event.attachments.filter(
      (att) => att.isImage && (!att.size || att.size <= MAX_IMAGE_SIZE_BYTES),
    );

    if (imageAttachments.length === 0) {
      return fullPrompt;
    }

    const contentBlocks: acp.ContentBlock[] = [{ type: "text" as const, text: fullPrompt }];

    for (const att of imageAttachments) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

        const response = await fetch(att.url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
          }
          const base64 = btoa(binary);
          contentBlocks.push({
            type: "image" as const,
            data: base64,
            mimeType: att.mimeType,
          });
          sessionLogger.debug("Image attachment added to prompt", {
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
          });
        }
      } catch (error) {
        sessionLogger.warn("Failed to fetch image attachment", {
          url: att.url,
          error: String(error),
        });
        // Failure is non-fatal — text description with URL is already in context
      }
    }

    return contentBlocks.length > 1 ? contentBlocks : fullPrompt;
  }

  /**
   * Build the full prompt for spontaneous posts using Vento template
   */
  private async buildSpontaneousPromptFromTemplate(
    context: import("../types/context.ts").AssembledSpontaneousContext,
    sessionId: string | null,
    model?: string,
    yolo?: boolean,
  ): Promise<string> {
    const promptDir = dirname(this.config.agent.systemPromptPath);
    const instructionsPath = join(promptDir, "system_spontaneous.md");
    const env = createTemplateEngine(promptDir);

    const importantMemoriesText = context.importantMemories.length > 0
      ? context.importantMemories.map((m, i) => `${i + 1}. ${m.content}`).join("\n")
      : "";

    const recentMessagesText = context.recentMessages.length > 0
      ? context.recentMessages.map((m) => {
        const prefix = m.isBot ? "[Bot]" : "[User]";
        return `${prefix} ${m.username}: ${m.content}`;
      }).join("\n")
      : "";

    const availableEmojisText = context.availableEmojis && context.availableEmojis.length > 0
      ? this.contextAssembler.formatEmojiSection(context.availableEmojis)
      : "";

    const variables: TemplateVariables = {
      isDm: false,
      platform: "internal",
      userId: "",
      channelId: "",
      guildId: "",
      sessionId: sessionId ?? "",
      agentType: getDefaultAgentType(this.config),
      model,
      yolo,
      recentMessagesFetched: context.recentMessagesFetched,
      importantMemories: importantMemoriesText,
      recentMessages: recentMessagesText,
      availableEmojis: availableEmojisText,
    };

    return await renderTemplate(
      env,
      instructionsPath,
      variables as unknown as Record<string, unknown>,
    );
  }

  /**
   * Build the full prompt for a self-research session
   */
  private async buildSelfResearchPrompt(
    rssItems: RssItem[],
    sessionId: string | null,
    model?: string,
    yolo?: boolean,
  ): Promise<string> {
    const promptDir = dirname(this.config.agent.systemPromptPath);
    const instructionsPath = join(promptDir, "system_self_research.md");
    const env = createTemplateEngine(promptDir);

    // Format RSS items
    const rssBlock = rssItems.map((item, i) =>
      `${
        i + 1
      }. **${item.title}**\n   Source: ${item.sourceName}\n   URL: ${item.url}\n   ${item.description}`
    ).join("\n\n");

    const variables: TemplateVariables = {
      isDm: false,
      platform: "internal",
      userId: "",
      channelId: "",
      guildId: "",
      sessionId: sessionId ?? "",
      agentType: getDefaultAgentType(this.config),
      model,
      yolo,
      rssItems: rssBlock,
    };

    return await renderTemplate(
      env,
      instructionsPath,
      variables as unknown as Record<string, unknown>,
    );
  }

  /**
   * Build the full prompt for a memory maintenance session
   */
  private async buildMemoryMaintenancePrompt(
    workspaceKey: string,
    sessionId: string | null,
    workspace: WorkspaceInfo,
    model?: string,
    yolo?: boolean,
  ): Promise<string> {
    const promptDir = dirname(this.config.agent.systemPromptPath);
    const instructionsPath = join(promptDir, "system_memory_maintenance.md");
    const env = createTemplateEngine(promptDir);

    // Load all enabled memories and embed them in the prompt
    const memoriesDump = await this.serializeAllMemories(workspace);

    const variables: TemplateVariables = {
      isDm: workspace.isDm,
      platform: workspace.components.platform,
      userId: workspace.components.userId ?? "",
      channelId: "",
      guildId: "",
      sessionId: sessionId ?? "",
      agentType: getDefaultAgentType(this.config),
      model,
      yolo,
      workspaceKey,
      memoriesDump,
    };

    return await renderTemplate(
      env,
      instructionsPath,
      variables as unknown as Record<string, unknown>,
    );
  }

  /**
   * Load all enabled memories from a workspace and serialize as JSON for prompt injection
   */
  private async serializeAllMemories(workspace: WorkspaceInfo): Promise<string> {
    const visibilities: import("../types/memory.ts").MemoryVisibility[] = workspace.isDm
      ? ["public", "private"]
      : ["public"];

    const allMemories: {
      id: string;
      visibility: string;
      importance: string;
      content: string;
      createdAt: string;
    }[] = [];

    for (const visibility of visibilities) {
      const memories = await this.memoryStore.loadAllMemories(workspace, visibility);
      for (const m of memories) {
        if (!m.enabled) continue;
        allMemories.push({
          id: m.id,
          visibility: m.visibility,
          importance: m.importance,
          content: m.content,
          createdAt: m.createdAt,
        });
      }
    }

    // Sort by creation date ascending
    allMemories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (allMemories.length === 0) {
      return "(No enabled memories found)";
    }

    return JSON.stringify(allMemories, null, 2);
  }

  /**
   * Build the full prompt for a reminder delivery session
   */
  private async buildReminderPrompt(
    reminder: ResolvedReminder,
    sessionId: string | null,
    model?: string,
    yolo?: boolean,
  ): Promise<string> {
    const promptDir = dirname(this.config.agent.systemPromptPath);
    const instructionsPath = join(promptDir, "system_reminder.md");
    const env = createTemplateEngine(promptDir);

    const variables: TemplateVariables = {
      isDm: true,
      platform: reminder.platform as Platform,
      userId: reminder.userId,
      channelId: "",
      guildId: "",
      sessionId: sessionId ?? "",
      agentType: getDefaultAgentType(this.config),
      model,
      yolo,
      reminderMessage: reminder.message,
      reminderCreatedAt: reminder.createdAt,
      reminderScheduledAt: reminder.scheduledAt,
    };

    return await renderTemplate(
      env,
      instructionsPath,
      variables as unknown as Record<string, unknown>,
    );
  }
}
