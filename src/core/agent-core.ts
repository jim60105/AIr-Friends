// src/core/agent-core.ts

import { createLogger } from "@utils/logger.ts";
import { SessionOrchestrator } from "./session-orchestrator.ts";
import type { SessionResponse } from "./session-orchestrator.ts";
import { MessageHandler } from "./message-handler.ts";
import { ReplyDispatcher } from "./reply-dispatcher.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { ContextAssembler } from "./context-assembler.ts";
import { resolveTrustedSkillsRoot } from "./skills-root.ts";
import { MemoryStore } from "./memory-store.ts";
import { ReminderStore } from "./reminder-store.ts";
import { ReplyPolicyEvaluator } from "./reply-policy.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../skill-api/session-registry.ts";
import { SkillAPIServer } from "../skill-api/server.ts";
import { AgentProcessPool } from "./agent-process-pool.ts";
import type { Config } from "../types/config.ts";
import { emailWorkReceiptOf } from "../types/events.ts";
import type { EmailWorkReceipt, NormalizedEvent } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { EmailSessionReceipts } from "../platforms/email/session-receipts.ts";
import type { EmailSubmissionEvidenceSource } from "./email-response-accounting.ts";
import type { EmailPlatformServices } from "../platforms/email/activation.ts";

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
  /**
   * Durable email work receipt sink (row 14). Null until email ingress wires it;
   * while null no email admission decision is recorded.
   */
  private emailSessionReceipts: EmailSessionReceipts | null = null;

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
      config.memory.recall,
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
    // The workspace manager is required for the channel memory sections: without
    // it the assembler cannot resolve the channel workspace, so channel memories
    // would never reach a channel session's context.
    const contextAssembler = new ContextAssembler(
      this.memoryStore,
      {
        systemPromptPath: config.agent.systemPromptPath,
        recentMessageLimit: config.memory.recentMessageLimit,
        tokenLimit: config.agent.tokenLimit,
        agentType: config.agent.defaultAgentType,
        // Trusted skill-script root (repair-omp-owned-skill-handoff D1):
        // resolved once at assembly construction — an unresolvable root fails
        // startup explicitly, never a child-HOME/token fallback.
        skillsDir: resolveTrustedSkillsRoot(
          config.agent.defaultAgentType ?? "opencode",
          config.agent.skillsDir,
        ),
        recall: config.memory.recall,
      },
      this.workspaceManager,
      skillRegistry.getMemoryRetriever(),
    );

    // Initialize reply policy (needed by orchestrator and message handler)
    this.replyPolicy = new ReplyPolicyEvaluator(config.replyPolicy, config.channels);

    // Initialize shared ACP process pool when shared-process mode is enabled.
    if (config.agent.sharedProcess?.enabled) {
      this.processPool = new AgentProcessPool(
        config,
        this.sessionRegistry,
        this.skillApiSecret ?? "",
        null, // connectorFactory: the real AgentConnector
        undefined, // sweepIntervalMs: default
        undefined, // jwtRenewalIntervalMs: default
        // The workspace manager owns temporary-use protection: the pool marks a
        // workspace unreclaimable when pooled producer quiescence is uncertain.
        this.workspaceManager,
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
   * Install (or clear) the durable email work receipt sink and forward it to
   * the orchestrator. Email ingress wires this before its first poll; receipts
   * are recorded only for email-typed work carrying a typed receipt.
   */
  setEmailSessionReceipts(receipts: EmailSessionReceipts | null): void {
    this.emailSessionReceipts = receipts;
    this.orchestrator.setEmailSessionReceipts(receipts);
  }

  /**
   * Install (or clear) the durable email submission evidence source (row 22).
   *
   * Email ingress wires this once, before its first poll; it reaches both the
   * orchestrator (retry/recovery decisions) and the Skill API server (the
   * durable second opinion before an email quota rollback).
   */
  setEmailSubmissionEvidence(source: EmailSubmissionEvidenceSource | null): void {
    this.orchestrator.setEmailSubmissionEvidence(source);
    this.skillApiServer?.setEmailSubmissionEvidence(source);
  }

  /**
   * Install (or clear) the composed production email platform.
   *
   * Email activation composes the durable stack after this core exists, so every email seam is
   * installed here as ONE unit: durable work receipts, recovered submission evidence, the
   * destination-grant preflight and the `send-email` skill. Passing `null` removes all of them,
   * leaving email blocked rather than partially enabled.
   */
  setEmailPlatform(services: EmailPlatformServices | null): void {
    this.setEmailSessionReceipts(services?.receipts ?? null);
    this.setEmailSubmissionEvidence(services?.submissionEvidence ?? null);
    this.orchestrator.setEmailDestinationGrantPreflight(services?.preflight ?? null);
    this.skillRegistry.setEmailCompose(
      services === null ? null : {
        mailService: services.mailService,
        ...(services.forwardSourceStore === undefined
          ? {}
          : { forwardSourceStore: services.forwardSourceStore }),
      },
    );
  }

  /**
   * Handle an incoming event from any platform
   */
  async handleEvent(event: NormalizedEvent): Promise<void> {
    const platform = this.platformAdapters.get(event.platform);
    const emailReceipt = emailWorkReceiptOf(event);
    if (!platform) {
      logger.error("No adapter registered for platform: {platform}", {
        platform: event.platform,
        messageId: event.messageId,
      });
      // Accepted email work that nothing can execute is terminally ignored:
      // leaving it accepted would re-emit the same unprocessable work forever.
      await this.denyEmailAdmission(emailReceipt, "no-platform-adapter");
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
      // A rejected admission is a terminal decision, recorded as ignored.
      await this.denyEmailAdmission(emailReceipt, "access-policy-denied");
      return;
    }

    // Process the event
    const response = await this.messageHandler.handleEvent(event, platform);

    // If processing failed and no reply was sent, dispatch error message
    // (also skipped when a file was delivered — the user already received output
    // — and for email whenever a submission was recorded or is unresolved, since
    // a fallback mail could duplicate an accepted message; row 22).
    if (
      !response.success && !response.replySent && !response.fileSent &&
      !response.emailSubmitted && !response.emailUnknown
    ) {
      await this.dispatchErrorNotice(platform, event, response, emailReceipt);
    }
  }

  /**
   * Dispatches the generic error notice for a failed session, keeping email work
   * inside its durable receipt lifecycle.
   *
   * The notice is an external delivery on behalf of the work item. When the
   * session failed BEFORE the agent could act (context assembly or agent
   * connect), the entry is still unstarted, so the durable fence is taken here
   * first and the notice's own outcome is recorded terminally — an unrecorded
   * notice would otherwise be replayed by the next poll. Once the orchestrator
   * has fenced and decided the outcome, the recorded receipt is never rewritten
   * by a notification. Other platforms keep the existing dispatcher behavior.
   */
  private async dispatchErrorNotice(
    platform: PlatformAdapter,
    event: NormalizedEvent,
    response: SessionResponse,
    receipt: EmailWorkReceipt | undefined,
  ): Promise<void> {
    const receipts = this.emailSessionReceipts;
    if (receipt && receipts) {
      let fenced = false;
      try {
        fenced = receipts.isUnstarted(receipt);
        if (fenced) await receipts.beginEmailWork(receipt);
      } catch (error) {
        // Fail open to the plain notice: the entry stays accepted and the next
        // poll re-emits it instead of losing the delivery silently.
        fenced = false;
        logger.error("Failed to fence email work before its error notice", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (fenced) {
        const delivered = await this.replyDispatcher.dispatchErrorIfNeeded(
          platform,
          event.channelId,
          response,
          event.messageId,
        );
        try {
          if (delivered) {
            await receipts.finishEmailWork(receipt, {
              outcome: "completed",
              detail: "error-notice-delivered",
              settle: () => Promise.resolve(true),
            });
          } else {
            await receipts.requireReview(receipt, "error-notice-undelivered");
          }
        } catch (error) {
          // The entry stays `started`: startup recovery quarantines it.
          logger.error("Failed to record the error-notice receipt", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    await this.replyDispatcher.dispatchErrorIfNeeded(
      platform,
      event.channelId,
      response,
      event.messageId,
    );
  }

  /**
   * Records a terminally ignored receipt for rejected email work.
   *
   * A receipt failure is logged and swallowed: the adapter already swallows
   * event-handler errors, and the entry stays `accepted` on failure, so the
   * next poll re-emits it rather than losing the admission decision silently.
   */
  private async denyEmailAdmission(
    receipt: EmailWorkReceipt | undefined,
    reason: string,
  ): Promise<void> {
    if (!receipt || !this.emailSessionReceipts) return;
    try {
      await this.emailSessionReceipts.denyAdmission(receipt, reason);
    } catch (error) {
      logger.error("Failed to record denied email admission: {reason}", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
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
