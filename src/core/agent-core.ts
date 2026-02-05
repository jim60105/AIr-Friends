// src/core/agent-core.ts

import { createLogger } from "@utils/logger.ts";
import { SessionOrchestrator } from "./session-orchestrator.ts";
import { MessageHandler } from "./message-handler.ts";
import { ReplyDispatcher } from "./reply-dispatcher.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { ContextAssembler } from "./context-assembler.ts";
import { MemoryStore } from "./memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../skill-api/session-registry.ts";
import { SkillAPIServer } from "../skill-api/server.ts";
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
  private yolo: boolean;

  constructor(config: Config, yolo = false) {
    this.config = config;
    this.yolo = yolo;

    logger.info("Initializing Agent Core", { yolo });

    // Initialize workspace manager
    const workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });

    // Initialize memory store
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
    });

    // Initialize skill registry
    const skillRegistry = new SkillRegistry(memoryStore);

    // Initialize session registry
    this.sessionRegistry = new SessionRegistry();

    // Initialize skill API server if enabled
    if (config.skillApi?.enabled) {
      this.skillApiServer = new SkillAPIServer(
        this.sessionRegistry,
        skillRegistry,
        {
          port: config.skillApi.port,
          host: config.skillApi.host,
        },
      );
      this.skillApiServer.start();
      logger.info("Skill API server enabled", {
        port: config.skillApi.port,
        host: config.skillApi.host,
      });
    }

    // Initialize context assembler
    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: config.agent.systemPromptPath,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    // Initialize orchestrator
    this.orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      this.sessionRegistry,
      this.yolo,
    );

    // Initialize message handler and reply dispatcher
    this.messageHandler = new MessageHandler(this.orchestrator);
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
    logger.info("Platform adapter registered", {
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
      logger.error("No adapter registered for platform", {
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

    // Process the event
    const response = await this.messageHandler.handleEvent(event, platform);

    // If processing failed and no reply was sent, dispatch error message
    if (!response.success && !response.replySent) {
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
   * Shutdown the core (cleanup resources)
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down Agent Core");

    // Stop skill API server
    if (this.skillApiServer) {
      await this.skillApiServer.stop();
    }

    // Stop session registry
    this.sessionRegistry.stop();

    logger.info("Agent Core shutdown complete");
  }
}
