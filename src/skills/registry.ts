// src/skills/registry.ts

import { createLogger } from "@utils/logger.ts";
import { MemoryHandler } from "./memory-handler.ts";
import { ReplyHandler } from "./reply-handler.ts";
import { ReactionHandler } from "./reaction-handler.ts";
import { ContextHandler } from "./context-handler.ts";
import { ReminderHandler } from "./reminder-handler.ts";
import { FileHandler } from "./file-handler.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { SkillContext, SkillHandler, SkillResult } from "./types.ts";
import type { MemoryStore } from "@core/memory-store.ts";
import type { RemindersConfig, SendFileSkillConfig } from "../types/config.ts";

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

  constructor(
    memoryStore: MemoryStore,
    remindersConfig?: RemindersConfig,
    reminderStore?: ReminderStore,
    sendFileConfig?: SendFileSkillConfig,
  ) {
    this.memoryHandler = new MemoryHandler(memoryStore);
    this.replyHandler = new ReplyHandler();
    this.reactionHandler = new ReactionHandler();
    this.contextHandler = new ContextHandler();

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
}
