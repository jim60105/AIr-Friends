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
   *
   * YOLO mode makes the Agent auto-approve ALL permission requests without asking the user.
   * It can be granted at two different scopes:
   *   - Account level: a specific user gets YOLO everywhere, regardless of which channel they post in.
   *   - Channel level: everyone posting in a specific channel gets YOLO.
   *
   * The check walks through every config entry and returns true as soon as one matches.
   */
  isYoloEnabled(platform: string, userId: string, channelId: string): boolean {
    return this.channels.some((ch) => {
      // Skip entries that are disabled or haven't opted into YOLO.
      if (ch.enabled === false || !ch.yolo) return false;

      // Parse "{platform}/account/{id}" or "{platform}/channel/{id}" into components.
      // Return false if the ID format is unrecognized or belongs to a different platform.
      const parsed = parseChannelId(ch.id);
      if (!parsed || parsed.platform !== platform) return false;

      if (parsed.type === "account") {
        // Account-level grant: YOLO follows the user across every channel they post in.
        return parsed.value === userId;
      }
      if (parsed.type === "channel") {
        // Channel-level grant: YOLO applies to everyone inside this specific channel.
        return parsed.value === channelId;
      }

      // Other entry types (e.g. "timeline") do not carry YOLO semantics.
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
