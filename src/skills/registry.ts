// src/skills/registry.ts

import { createLogger } from "@utils/logger.ts";
import { DEFAULT_RECALL_CONFIG } from "@core/memory-recall/recall-config.ts";
import { MemoryRetriever } from "@core/memory-recall/retriever.ts";
import { MemoryHandler } from "./memory-handler.ts";
import { ReplyHandler } from "./reply-handler.ts";
import { ReactionHandler } from "./reaction-handler.ts";
import { ContextHandler } from "./context-handler.ts";
import { ReminderHandler } from "./reminder-handler.ts";
import { FileHandler } from "./file-handler.ts";
import {
  EmailComposeHandler,
  type EmailComposeMailService,
  type EmailForwardSourceStore,
} from "./email-handler.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { SkillContext, SkillHandler, SkillResult } from "./types.ts";
import type { MemoryStore } from "@core/memory-store.ts";
import type { MemoryRecallConfig, RemindersConfig, SendFileSkillConfig } from "../types/config.ts";

const logger = createLogger("SkillRegistry");

/**
 * Registry for all available skills
 */
export class SkillRegistry {
  private handlers: Map<string, SkillHandler> = new Map();
  private memoryHandler: MemoryHandler;
  private replyHandler: ReplyHandler;
  private reactionHandler: ReactionHandler;
  private contextHandler: ContextHandler;
  private reminderHandler: ReminderHandler | null = null;
  private fileHandler: FileHandler | null = null;
  private readonly memoryRetriever: MemoryRetriever;
  /**
   * The existing send-file skill limits, reused for `send-email` attachments.
   * Stored even when send-file itself is disabled: composing with an attachment
   * must not depend on the send-file skill's own `enabled` flag.
   */
  private readonly sendFileConfig?: SendFileSkillConfig;
  /** Durable email submission service; absent until email activation wires it. */
  private readonly emailComposeMailService?: EmailComposeMailService;
  /**
   * Owner-scoped message store a forward reads its designated source from (row 21). Absent
   * leaves composing available and forwarding failing closed, because no source may be read
   * through any other seam.
   */
  private readonly emailForwardSourceStore?: EmailForwardSourceStore;

  constructor(
    memoryStore: MemoryStore,
    remindersConfig?: RemindersConfig,
    reminderStore?: ReminderStore,
    sendFileConfig?: SendFileSkillConfig,
    recallConfig?: MemoryRecallConfig,
    emailCompose?: {
      mailService: EmailComposeMailService;
      forwardSourceStore?: EmailForwardSourceStore;
    },
  ) {
    // One retriever per process: every session shares its snapshot cache.
    this.memoryRetriever = new MemoryRetriever(memoryStore, recallConfig ?? DEFAULT_RECALL_CONFIG);
    this.memoryHandler = new MemoryHandler(memoryStore, this.memoryRetriever);
    this.replyHandler = new ReplyHandler();
    this.reactionHandler = new ReactionHandler();
    this.contextHandler = new ContextHandler();
    this.sendFileConfig = sendFileConfig;
    this.emailComposeMailService = emailCompose?.mailService;
    this.emailForwardSourceStore = emailCompose?.forwardSourceStore;

    if (remindersConfig?.enabled && reminderStore) {
      this.reminderHandler = new ReminderHandler(reminderStore, remindersConfig);
    }

    if (sendFileConfig?.enabled) {
      this.fileHandler = new FileHandler(sendFileConfig);
    }

    this.registerSkills();
  }

  /**
   * Register all available skills
   */
  private registerSkills(): void {
    // Memory skills
    this.handlers.set("memory-save", this.memoryHandler.handleMemorySave);
    this.handlers.set("memory-search", this.memoryHandler.handleMemorySearch);
    this.handlers.set("memory-patch", this.memoryHandler.handleMemoryPatch);
    this.handlers.set("memory-stats", this.memoryHandler.handleMemoryStats);
    this.handlers.set("memory-export", this.memoryHandler.handleMemoryExport);

    // Reply skills
    this.handlers.set("send-reply", this.replyHandler.handleSendReply);
    this.handlers.set("edit-reply", this.replyHandler.handleEditReply);
    this.handlers.set("get-message", this.replyHandler.handleGetMessage);

    // Context skill
    this.handlers.set("fetch-context", this.contextHandler.handleFetchContext);

    // Reaction skill
    this.handlers.set("react-message", this.reactionHandler.handleReactMessage);

    // Reminder skills (conditional)
    if (this.reminderHandler) {
      this.handlers.set("set-reminder", this.reminderHandler.handleSetReminder);
      this.handlers.set("cancel-reminder", this.reminderHandler.handleCancelReminder);
      this.handlers.set("list-reminders", this.reminderHandler.handleListReminders);
    }

    // File skill (conditional)
    if (this.fileHandler) {
      this.handlers.set("send-file", this.fileHandler.handleSendFile);
    }

    // Email compose skill (conditional): registered ONLY once the durable submission
    // service is wired (email activation). Until then the skill does not exist, so no
    // session can reach an email send path.
    if (this.emailComposeMailService) {
      const handler = new EmailComposeHandler({
        mailService: this.emailComposeMailService,
        ...(this.emailForwardSourceStore === undefined
          ? {}
          : { forwardSourceStore: this.emailForwardSourceStore }),
        limits: this.sendFileConfig,
      });
      this.handlers.set("send-email", handler.handleSendEmail);
    }

    logger.info("Skills registered: {count} skills ({skillNames})", {
      count: this.handlers.size,
      skillNames: Array.from(this.handlers.keys()).join(", "),
      skills: Array.from(this.handlers.keys()),
    });
  }

  /**
   * Execute a skill by name
   */
  async executeSkill(
    skillName: string,
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> {
    const handler = this.handlers.get(skillName);

    if (!handler) {
      logger.warn("Unknown skill requested: {skillName}", {
        skillName,
        availableSkills: Array.from(this.handlers.keys()),
      });

      return {
        success: false,
        error: `Unknown skill: ${skillName}`,
      };
    }

    logger.debug("Executing skill: {skillName}", {
      skillName,
      workspaceKey: context.workspace.key,
    });

    try {
      return await handler(parameters, context);
    } catch (error) {
      logger.error("Skill {skillName} execution error", {
        skillName,
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Skill execution failed",
      };
    }
  }

  /**
   * Get list of available skill names
   */
  getAvailableSkills(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a skill exists
   */
  hasSkill(skillName: string): boolean {
    return this.handlers.has(skillName);
  }

  /**
   * Get reply handler for clearing state
   */
  getReplyHandler(): ReplyHandler {
    return this.replyHandler;
  }

  /**
   * Get reaction handler for state management
   */
  getReactionHandler(): ReactionHandler {
    return this.reactionHandler;
  }

  /**
   * Get reminder handler for session state management
   */
  getReminderHandler(): ReminderHandler | null {
    return this.reminderHandler;
  }

  /**
   * Get the process-wide recall engine, so a second component (the context
   * assembler's Fast Recall) ranks over the same snapshot cache as
   * `memory-search` instead of paying for its own.
   */
  getMemoryRetriever(): MemoryRetriever {
    return this.memoryRetriever;
  }
}
