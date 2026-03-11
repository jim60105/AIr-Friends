// src/skills/reply-handler.ts

import { createLogger } from "@utils/logger.ts";
import type {
  EditReplyParams,
  GetMessageParams,
  SendReplyParams,
  SkillContext,
  SkillHandler,
  SkillResult,
} from "./types.ts";

import { repliesSentTotal } from "@utils/metrics.ts";

const logger = createLogger("ReplyHandler");

/**
 * Strip XML-like tags from message content, keeping only inner text.
 * e.g. `<e>😆</e>` → `😆`, `<scenario>text</scenario>` → `text`
 */
export function stripXmlTags(message: string): string {
  return message.replace(/<\/?[a-zA-Z][a-zA-Z0-9_]*>/g, "");
}

/**
 * Convert literal backslash-n sequences to actual newline characters.
 * Agent output may contain escaped "\\n" (two chars: backslash + n)
 * that should be rendered as real line breaks in platform messages.
 */
export function unescapeNewlines(text: string): string {
  return text.replaceAll("\\n", "\n");
}

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
  private hasReplySentInternal(context: SkillContext): boolean {
    const key = this.getSessionKey(context);
    return this.replySentMap.get(key) ?? false;
  }

  /**
   * Check if reply was sent for a workspace/channel (public API)
   */
  hasReplySent(workspaceKey: string, channelId: string): boolean {
    const key = `${workspaceKey}:${channelId}`;
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

      // Strip XML-like tags from message content
      const cleanedMessage = stripXmlTags(params.message);

      // Convert literal \n to actual newline characters
      const formattedMessage = unescapeNewlines(cleanedMessage);

      // Send reply via platform adapter
      const result = await context.platformAdapter.sendReply(
        context.channelId,
        formattedMessage,
        { replyToMessageId: context.replyToMessageId },
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
      repliesSentTotal.labels(context.workspace.components.platform).inc();

      logger.info("Reply sent via skill to channel {channelId} ({contentLength} chars)", {
        workspaceKey: context.workspace.key,
        channelId: context.channelId,
        messageId: result.messageId,
        contentLength: params.message.length,
      });

      return {
        success: true,
        data: {
          messageId: result.messageId,
          timestamp: new Date().toISOString(),
          nextAction: "You have done your job. EXIT IMMEDIATELY",
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

  /**
   * Handle edit-reply skill
   */
  handleEditReply: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      // Must have sent a reply first
      if (!this.hasReplySentInternal(context)) {
        return {
          success: false,
          error: "No reply has been sent yet. Use send-reply first.",
        };
      }

      const params = parameters as unknown as EditReplyParams;

      if (!params.messageId || typeof params.messageId !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'messageId' parameter",
        };
      }

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

      // Strip XML-like tags from message content
      const cleanedMessage = stripXmlTags(params.message);

      // Convert literal \n to actual newline characters
      const formattedMessage = unescapeNewlines(cleanedMessage);

      // Fetch current message content and compare before editing
      try {
        const currentMessage = await context.platformAdapter.fetchMessage(
          context.channelId,
          params.messageId,
        );

        if (currentMessage && currentMessage.content === formattedMessage) {
          logger.info(
            "Edit-reply skipped: content unchanged for message {messageId}",
            {
              workspaceKey: context.workspace.key,
              channelId: context.channelId,
              messageId: params.messageId,
            },
          );

          return {
            success: false,
            error:
              "The edit content is the same as the current message content. No changes were made.",
          };
        }
      } catch {
        // fetchMessage failure should not block editing — proceed with the edit
      }

      // Edit message via platform adapter
      const result = await context.platformAdapter.editMessage(
        context.channelId,
        params.messageId,
        formattedMessage,
        context.replyToMessageId,
      );

      if (!result.success) {
        logger.error("Failed to edit reply via platform", {
          workspaceKey: context.workspace.key,
          channelId: context.channelId,
          messageId: params.messageId,
          error: result.error,
        });

        return {
          success: false,
          error: result.error ?? "Failed to edit reply",
        };
      }

      logger.info("Reply edited via skill for message {messageId} ({contentLength} chars)", {
        workspaceKey: context.workspace.key,
        channelId: context.channelId,
        messageId: params.messageId,
        contentLength: params.message.length,
      });

      return {
        success: true,
        data: {
          messageId: result.messageId,
          timestamp: new Date().toISOString(),
          nextAction: "You have done your job. EXIT IMMEDIATELY or you will be terminated.",
        },
      };
    } catch (error) {
      logger.error("Failed to edit reply", {
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

  /**
   * Handle get-message skill
   */
  handleGetMessage: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as GetMessageParams;

      // Use provided messageId or fall back to last sent message
      const messageId = params.messageId || context.lastSentMessageId;

      if (!messageId) {
        return {
          success: false,
          error: "Missing 'messageId' parameter and no message has been sent yet in this session.",
        };
      }

      // Fetch message from platform
      const message = await context.platformAdapter.fetchMessage(
        context.channelId,
        messageId,
      );

      if (!message) {
        return {
          success: false,
          error: `Message not found: ${messageId}`,
        };
      }

      return {
        success: true,
        data: {
          messageId: message.messageId,
          content: message.content,
          userId: message.userId,
          username: message.username,
          timestamp: message.timestamp.toISOString(),
          isBot: message.isBot,
        },
      };
    } catch (error) {
      logger.error("Failed to get message", {
        error: error instanceof Error ? error.message : String(error),
        channelId: context.channelId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };
}
