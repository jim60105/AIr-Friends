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
    // If successful, or a reply/reaction/file was already sent, or email was
    // submitted OR left unresolved, nothing to do. Row 22: a submitted
    // third-party mail satisfies the response, and an unresolved submission must
    // never be followed by a fallback mail that could duplicate it — the status
    // is carried ON the response, so it still suppresses here after the
    // session's registry entry is gone.
    if (
      response.success || response.replySent || response.reactionSent || response.fileSent ||
      response.emailSubmitted || response.emailUnknown
    ) {
      return false;
    }

    // Don't send error messages for certain types of errors
    const skipErrorMessage = response.error?.includes("already being processed") ||
      response.error?.includes("cancelled") ||
      response.error?.includes("Rate limited");

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
      // Row 22: the notice is an outgoing mail on the work item's behalf, so an
      // email session delivers it with the host-assigned operation context — the
      // adapter refuses an email send without it, and the ordinary `reply` slot
      // is reused (never a second error-message operation).
      const result = await platformAdapter.sendReply(
        channelId,
        errorMessage,
        {
          replyToMessageId,
          ...(response.emailSend === undefined ? {} : { emailSend: response.emailSend }),
        },
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
