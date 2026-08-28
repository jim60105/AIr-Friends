// src/core/agent-core.ts

import { createLogger } from "@utils/logger.ts";
import { SessionOrchestrator } from "./session-orchestrator.ts";
import { MessageHandler } from "./message-handler.ts";
import { ReplyDispatcher } from "./reply-dispatcher.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { ContextAssembler } from "./context-assembler.ts";
import { MemoryStore } from "./memory-store.ts";
import { ReminderStore } from "./reminder-store.ts";
import { ReplyPolicyEvaluator } from "./reply-policy.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../skill-api/session-registry.ts";
import { SkillAPIServer } from "../skill-api/server.ts";
import { AgentProcessPool } from "./agent-process-pool.ts";
import type { Config } from "../types/config.ts";
import type { NormalizedEvent } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const logger = createLogger("AgentCore");

/**
 * AgentCore is the main integration point that coordinates all components
 * It manages the lifecycle of handling messages from platforms to generating replies
 */
export class AgentCore {
  private messageHandler: MessageHandler;
  private replyDispatcher: ReplyDispatcher;
  private platformAdapters: Map<string, PlatformAdapter> = new Map();
  private config: Config;
  private sessionRegistry: SessionRegistry;
  private skillApiServer: SkillAPIServer | null = null;
  private orchestrator: SessionOrchestrator;
  private replyPolicy: ReplyPolicyEvaluator;
  private yolo: boolean;
  private workspaceManager: WorkspaceManager;
  private memoryStore: MemoryStore;
  private reminderStore: ReminderStore | null = null;
  private skillRegistry: SkillRegistry;
  /**
   * Deployment-level HMAC secret for per-session Skill API JWTs.
   * Held ONLY by the bot process (JWT issuer + Skill API verifier).
   */
  private skillApiSecret: string | undefined;
  /**
   * Shared ACP process pool (shared-process mode). Null in per-spawn mode.
   */
  private processPool: AgentProcessPool | null = null;

  constructor(config: Config, yolo = false, skillApiSecret?: string) {
    this.config = config;
    this.yolo = yolo;
    this.skillApiSecret = skillApiSecret;

    logger.info("Initializing Agent Core", { yolo });

    // Initialize workspace manager
    this.workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });

    // Initialize memory store
    this.memoryStore = new MemoryStore(this.workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
      workingTierLimit: config.memory.workingTierLimit ?? 20,
    });

    // Initialize skill registry
    let reminderStore: ReminderStore | undefined;
    if (config.reminders?.enabled) {
      reminderStore = new ReminderStore(config.reminders.persistPath);
      this.reminderStore = reminderStore;
    }
    this.skillRegistry = new SkillRegistry(
      this.memoryStore,
      config.reminders,
      reminderStore,
      config.skills?.sendFile,
    );
    const skillRegistry = this.skillRegistry;

    // Initialize session registry
    this.sessionRegistry = new SessionRegistry(config.skillApi?.sessionTimeoutMs);

    // Initialize skill API server if enabled
    if (config.skillApi?.enabled) {
      this.sessionRegistry.startCleanupTimer();
      this.skillApiServer = new SkillAPIServer(
        this.sessionRegistry,
        skillRegistry,
        {
          port: config.skillApi.port,
          host: config.skillApi.host,
        },
        this.skillApiSecret ?? "",
      );
      this.skillApiServer.start();
      logger.info("Skill API server enabled on port {port}", {
        port: config.skillApi.port,
        host: config.skillApi.host,
      });
    }

    // Initialize context assembler
    const contextAssembler = new ContextAssembler(this.memoryStore, {
      systemPromptPath: config.agent.systemPromptPath,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
      agentType: config.agent.defaultAgentType,
    });

    // Initialize reply policy (needed by orchestrator and message handler)
    this.replyPolicy = new ReplyPolicyEvaluator(config.replyPolicy, config.channels);

    // Initialize shared ACP process pool when shared-process mode is enabled.
    if (config.agent.sharedProcess?.enabled) {
      this.processPool = new AgentProcessPool(
        config,
        this.sessionRegistry,
        this.skillApiSecret ?? "",
      );
    }

    // Initialize orchestrator
    this.orchestrator = new SessionOrchestrator(
      this.workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      this.sessionRegistry,
      this.memoryStore,
      this.yolo,
      this.replyPolicy,
      this.skillApiSecret,
      this.processPool,
    );

    // Initialize message handler and reply dispatcher
    const rateLimitConfig = config.rateLimit ?? {
      enabled: false,
      maxRequestsPerWindow: 10,
      windowMs: 600000,
      cooldownMs: 600000,
    };
    this.messageHandler = new MessageHandler(this.orchestrator, rateLimitConfig, this.replyPolicy);
    this.replyDispatcher = new ReplyDispatcher();

    logger.info("Agent Core initialized", {
      workspaceRoot: config.workspace.repoPath,
      tokenLimit: config.agent.tokenLimit,
      memorySearchLimit: config.memory.searchLimit,
      skillApiEnabled: config.skillApi?.enabled ?? false,
    });
  }

  /**
   * Register a platform adapter
   */
  registerPlatform(adapter: PlatformAdapter): void {
    this.platformAdapters.set(adapter.platform, adapter);
    logger.info("Platform adapter registered: {platform}", {
      platform: adapter.platform,
      capabilities: adapter.capabilities,
    });

    // Set up event handler
    adapter.onEvent((event) => this.handleEvent(event));
  }

  /**
   * Handle an incoming event from any platform
   */
  async handleEvent(event: NormalizedEvent): Promise<void> {
    const platform = this.platformAdapters.get(event.platform);
    if (!platform) {
      logger.error("No adapter registered for platform: {platform}", {
        platform: event.platform,
        messageId: event.messageId,
      });
      return;
    }

    logger.debug("Received event", {
      platform: event.platform,
      channelId: event.channelId,
      userId: event.userId,
      messageId: event.messageId,
    });

    if (!this.replyPolicy.shouldReply(event)) {
      logger.info("Event filtered by access control policy for user {userId} on {platform}", {
        platform: event.platform,
        channelId: event.channelId,
        userId: event.userId,
        messageId: event.messageId,
        policy: this.config.replyPolicy,
      });
      return;
    }

    // Process the event
    const response = await this.messageHandler.handleEvent(event, platform);

    // If processing failed and no reply was sent, dispatch error message
    // (also skipped when a file was delivered — the user already received output)
    if (!response.success && !response.replySent && !response.fileSent) {
      await this.replyDispatcher.dispatchErrorIfNeeded(
        platform,
        event.channelId,
        response,
        event.messageId,
      );
    }
  }

  /**
   * Get the list of registered platform names
   */
  getRegisteredPlatforms(): string[] {
    return Array.from(this.platformAdapters.keys());
  }

  /**
   * Get a platform adapter by name
   */
  getPlatformAdapter(platform: string): PlatformAdapter | undefined {
    return this.platformAdapters.get(platform);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Get the Skill API server instance (if enabled)
   */
  getSkillAPIServer(): SkillAPIServer | null {
    return this.skillApiServer;
  }

  /**
   * Get the session orchestrator.
   * Used by SpontaneousScheduler to trigger spontaneous posts.
   */
  getOrchestrator(): SessionOrchestrator {
    return this.orchestrator;
  }

  /**
   * Get the workspace manager.
   */
  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }

  /**
   * Get the memory store.
   */
  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  /**
   * Get the ReminderStore instance (null if reminders disabled)
   */
  getReminderStore(): ReminderStore | null {
    return this.reminderStore;
  }

  /**
   * Get the skill registry
   */
  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  /**
   * Get the session registry.
   */
  getSessionRegistry(): SessionRegistry {
    return this.sessionRegistry;
  }

  /**
   * Get the shared ACP process pool (null in per-spawn mode).
   */
  getProcessPool(): AgentProcessPool | null {
    return this.processPool;
  }

  /**
   * Shutdown the core (cleanup resources)
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Agent Core");

    // Stop the shared process pool (reclaims idle agent processes).
    this.processPool?.stop();

    // Stop skill API server
    if (this.skillApiServer) {
      await this.skillApiServer.stop();
    }

    // Stop session registry
    this.sessionRegistry.stop();

    // Dispose message handler
    this.messageHandler.dispose();

    logger.info("Agent Core shutdown complete");
  }
}
