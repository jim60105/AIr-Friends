// src/skills/reply-handler.ts

import { createLogger } from "@utils/logger.ts";
import type { SendReplyParams, SkillContext, SkillHandler, SkillResult } from "./types.ts";

const logger = createLogger("ReplyHandler");

export class ReplyHandler {
  private replySentMap: Map<string, boolean> = new Map();

  /**
   * Generate session key for tracking if reply was sent
   */
  private getSessionKey(context: SkillContext): string {
    return `${context.workspace.key}:${context.channelId}`;
  }

  /**
   * Check if reply was already sent for this session
   */
  private hasReplySent(context: SkillContext): boolean {
    const key = this.getSessionKey(context);
    return this.replySentMap.get(key) ?? false;
  }

  /**
   * Mark that reply was sent for this session
   */
  private markReplySent(context: SkillContext): void {
    const key = this.getSessionKey(context);
    this.replySentMap.set(key, true);
  }

  /**
   * Clear reply state for a session (call this when starting new interaction)
   */
  clearReplyState(workspaceKey: string, channelId: string): void {
    const key = `${workspaceKey}:${channelId}`;
    this.replySentMap.delete(key);
  }

  /**
   * Handle send-reply skill
   */
  handleSendReply: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      // Check if reply was already sent
      if (this.hasReplySent(context)) {
        logger.warn("Attempted to send reply multiple times", {
          workspaceKey: context.workspace.key,
          channelId: context.channelId,
        });

        return {
          success: false,
          error: "Reply can only be sent once per interaction",
        };
      }

      const params = parameters as unknown as SendReplyParams;

      if (!params.message || typeof params.message !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'message' parameter",
        };
      }

      if (params.message.trim().length === 0) {
        return {
          success: false,
          error: "Message cannot be empty",
        };
      }

      // Validate attachments if provided
      if (params.attachments) {
        if (!Array.isArray(params.attachments)) {
          return {
            success: false,
            error: "Invalid 'attachments' parameter. Must be an array",
          };
        }

        // For now, we'll note attachments but not implement full support
        if (params.attachments.length > 0) {
          logger.warn("Attachments provided but not yet fully supported", {
            workspaceKey: context.workspace.key,
            attachmentCount: params.attachments.length,
          });
        }
      }

      // Send reply via platform adapter
      const result = await context.platformAdapter.sendReply(
        context.channelId,
        params.message,
      );

      if (!result.success) {
        logger.error("Failed to send reply via platform", {
          workspaceKey: context.workspace.key,
          channelId: context.channelId,
          error: result.error,
        });

        return {
          success: false,
          error: result.error ?? "Failed to send reply",
        };
      }

      // Mark reply as sent
      this.markReplySent(context);

      logger.info("Reply sent via skill", {
        workspaceKey: context.workspace.key,
        channelId: context.channelId,
        messageId: result.messageId,
      });

      return {
        success: true,
        data: {
          messageId: result.messageId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error("Failed to send reply", {
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
