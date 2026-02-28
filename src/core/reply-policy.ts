import { createLogger } from "@utils/logger.ts";
import type { ChannelConfig, ReplyPolicy } from "../types/config.ts";
import { parseChannelId } from "../types/config.ts";
import type { NormalizedEvent } from "../types/events.ts";

const logger = createLogger("ReplyPolicy");

/**
 * Evaluates whether to reply to a given event based on channel configuration.
 */
export class ReplyPolicyEvaluator {
  private readonly policy: ReplyPolicy;
  private readonly channels: ChannelConfig[];

  constructor(policy: ReplyPolicy, channels: ChannelConfig[]) {
    this.policy = policy;
    this.channels = channels;

    logger.info("Reply policy initialized", {
      policy: this.policy,
      channelEntries: this.channels.length,
    });
  }

  /**
   * Determine if the bot should reply to this event.
   */
  shouldReply(event: NormalizedEvent): boolean {
    switch (this.policy) {
      case "all":
        return true;
      case "public":
        if (!event.isDm) {
          return true;
        }
        return this.isChannelEnabled(event);
      case "channels":
        return this.isChannelEnabled(event);
      default:
        logger.warn("Unknown reply policy, defaulting to deny", { policy: this.policy });
        return false;
    }
  }

  /**
   * Check if rate limiting should be bypassed for a given event.
   * Works for both account type (match by userId) and channel type (match by channelId).
   */
  isRateLimitBypassed(platform: string, userId: string, channelId: string): boolean {
    return this.channels.some((ch) => {
      if (ch.enabled === false || !ch.rateLimitBypass) return false;
      const parsed = parseChannelId(ch.id);
      if (!parsed || parsed.platform !== platform) return false;

      if (parsed.type === "account") {
        return parsed.value === userId;
      }
      if (parsed.type === "channel") {
        return parsed.value === channelId;
      }
      return false;
    });
  }

  /**
   * Check if YOLO mode should be active for the given event.
   * Returns true if the matching channel config has yolo: true.
   */
  isYoloEnabled(platform: string, userId: string, channelId: string): boolean {
    return this.channels.some((ch) => {
      if (ch.enabled === false || !ch.yolo) return false;
      const parsed = parseChannelId(ch.id);
      if (!parsed || parsed.platform !== platform) return false;
      if (parsed.type === "account") return parsed.value === userId;
      if (parsed.type === "channel") return parsed.value === channelId;
      return false;
    });
  }

  /**
   * Get the channel configuration for a specific channel ID string.
   */
  getChannelConfig(channelId: string): ChannelConfig | undefined {
    return this.channels.find((ch) => ch.id === channelId);
  }

  /**
   * Check whether an event matches any enabled channel entry.
   */
  private isChannelEnabled(event: NormalizedEvent): boolean {
    return this.channels.some((ch) => {
      if (ch.enabled === false) return false;
      const parsed = parseChannelId(ch.id);
      if (!parsed || parsed.platform !== event.platform) return false;

      if (parsed.type === "account") {
        return parsed.value === event.userId;
      }
      if (parsed.type === "channel") {
        return parsed.value === event.channelId;
      }
      return false;
    });
  }
}
