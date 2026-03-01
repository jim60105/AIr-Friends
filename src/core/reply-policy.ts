import { createLogger } from "@utils/logger.ts";
import type { ChannelConfig, ReplyPolicy } from "../types/config.ts";
import { parseChannelId } from "../types/config.ts";
import type { NormalizedEvent } from "../types/events.ts";

/**
 * Structured result describing how a YOLO decision was made.
 */
export interface YoloDecision {
  /** Whether YOLO mode is enabled for this context. */
  enabled: boolean;
  /**
   * Which mechanism activated YOLO:
   *  - "global_flag"   : the global --yolo CLI flag is active (resolved externally)
   *  - "account_config": matched an account-level channel config entry
   *  - "channel_config": matched a channel-level channel config entry
   *  - "none"          : no config entry grants YOLO
   */
  source: "global_flag" | "account_config" | "channel_config" | "none";
  /** The id field of the matched ChannelConfig entry, if any. */
  matchedConfigId?: string;
}

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
    return this.resolveYoloDecision(platform, userId, channelId).enabled;
  }

  /**
   * Resolve how YOLO mode was determined for the given context.
   * Returns a structured decision that includes the boolean result, the source
   * of the decision, and the matched config entry id (if any).
   *
   * NOTE: This only evaluates per-channel config. The global --yolo flag is
   * handled externally by SessionOrchestrator.getEffectiveYolo().
   */
  resolveYoloDecision(platform: string, userId: string, channelId: string): YoloDecision {
    for (const ch of this.channels) {
      // Skip entries that are disabled or haven't opted into YOLO.
      if (ch.enabled === false || !ch.yolo) continue;

      // Parse "{platform}/account/{id}" or "{platform}/channel/{id}" into components.
      const parsed = parseChannelId(ch.id);
      if (!parsed || parsed.platform !== platform) continue;

      if (parsed.type === "account" && parsed.value === userId) {
        // Account-level grant: YOLO follows the user across every channel they post in.
        logger.info(
          "YOLO enabled via account config {matchedConfigId} for user {userId} on {platform}",
          { matchedConfigId: ch.id, userId, platform, channelId },
        );
        return { enabled: true, source: "account_config", matchedConfigId: ch.id };
      }

      if (parsed.type === "channel" && parsed.value === channelId) {
        // Channel-level grant: YOLO applies to everyone inside this specific channel.
        logger.info(
          "YOLO enabled via channel config {matchedConfigId} for channel {channelId} on {platform}",
          { matchedConfigId: ch.id, channelId, platform, userId },
        );
        return { enabled: true, source: "channel_config", matchedConfigId: ch.id };
      }

      // Other entry types (e.g. "timeline") do not carry YOLO semantics.
    }

    // No config entry grants YOLO for this context.
    logger.debug(
      "YOLO not enabled by channel config for {platform} user {userId} channel {channelId}",
      { platform, userId, channelId },
    );
    return { enabled: false, source: "none" };
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
