// src/skills/reaction-handler.ts

import { createLogger } from "@utils/logger.ts";
import type { ReactMessageParams, SkillContext, SkillHandler, SkillResult } from "./types.ts";

const logger = createLogger("ReactionHandler");

export class ReactionHandler {
  private reactionSentMap: Map<string, boolean> = new Map();

  /**
   * Generate session key for tracking if reaction was sent
   */
  private getSessionKey(context: SkillContext): string {
    return `${context.workspace.key}:${context.channelId}`;
  }

  /**
   * Check if reaction was sent for a workspace/channel (public API)
   */
  hasReactionSent(workspaceKey: string, channelId: string): boolean {
    const key = `${workspaceKey}:${channelId}`;
    return this.reactionSentMap.get(key) ?? false;
  }

  /**
   * Mark that reaction was sent for this session
   */
  private markReactionSent(context: SkillContext): void {
    const key = this.getSessionKey(context);
    this.reactionSentMap.set(key, true);
  }

  /**
   * Clear reaction state for a session
   */
  clearReactionState(workspaceKey: string, channelId: string): void {
    const key = `${workspaceKey}:${channelId}`;
    this.reactionSentMap.delete(key);
  }

  /**
   * Handle react-message skill
   */
  handleReactMessage: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as ReactMessageParams;

      if (!params.emoji || typeof params.emoji !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'emoji' parameter",
        };
      }

      if (params.emoji.trim().length === 0) {
        return {
          success: false,
          error: "Emoji cannot be empty",
        };
      }

      // Need a message to react to
      if (!context.replyToMessageId) {
        return {
          success: false,
          error: "No trigger message to react to",
        };
      }

      // Add reaction via platform adapter
      const result = await context.platformAdapter.addReaction(
        context.channelId,
        context.replyToMessageId,
        params.emoji,
      );

      if (!result.success) {
        logger.error("Failed to add reaction via platform", {
          workspaceKey: context.workspace.key,
          channelId: context.channelId,
          error: result.error,
        });

        return {
          success: false,
          error: result.error ?? "Failed to add reaction",
        };
      }

      // Mark reaction as sent
      this.markReactionSent(context);

      logger.info("Reaction {emoji} added via skill to message {messageId}", {
        workspaceKey: context.workspace.key,
        channelId: context.channelId,
        emoji: params.emoji,
        messageId: context.replyToMessageId,
      });

      return {
        success: true,
        data: {
          emoji: params.emoji,
          messageId: context.replyToMessageId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error("Failed to add reaction", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
        channelId: context.channelId,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };
}
