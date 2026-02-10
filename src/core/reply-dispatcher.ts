// src/core/reply-dispatcher.ts

import { createLogger } from "@utils/logger.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { SessionResponse } from "./session-orchestrator.ts";

const logger = createLogger("ReplyDispatcher");

/**
 * ReplyDispatcher handles sending error messages back to platforms
 * Note: Successful replies are sent directly by the send-reply skill handler
 */
export class ReplyDispatcher {
  /**
   * Dispatch error message if session failed
   * Returns true if error message was sent
   */
  async dispatchErrorIfNeeded(
    platformAdapter: PlatformAdapter,
    channelId: string,
    response: SessionResponse,
    replyToMessageId?: string,
  ): Promise<boolean> {
    // If successful or reply/reaction was already sent, nothing to do
    if (response.success || response.replySent || response.reactionSent) {
      return false;
    }

    // Don't send error messages for certain types of errors
    const skipErrorMessage = response.error?.includes("already being processed") ||
      response.error?.includes("cancelled");

    if (skipErrorMessage) {
      logger.debug("Skipping error message dispatch", {
        platform: platformAdapter.platform,
        channelId,
        error: response.error,
      });
      return false;
    }

    // Send generic error message to user
    const errorMessage = "I encountered an issue processing your message. Please try again.";

    try {
      const result = await platformAdapter.sendReply(
        channelId,
        errorMessage,
        { replyToMessageId },
      );

      if (result.success) {
        logger.info("Error message dispatched", {
          platform: platformAdapter.platform,
          channelId,
          messageId: result.messageId,
        });
        return true;
      } else {
        logger.error("Failed to dispatch error message", {
          platform: platformAdapter.platform,
          channelId,
          error: result.error,
        });
        return false;
      }
    } catch (error) {
      logger.error("Exception while dispatching error message", {
        platform: platformAdapter.platform,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
