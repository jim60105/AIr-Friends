import { createLogger } from "@utils/logger.ts";
import type { AccessControlConfig, ReplyPolicy } from "../types/config.ts";
import type { NormalizedEvent, Platform } from "../types/events.ts";

const logger = createLogger("ReplyPolicy");

interface WhitelistEntry {
  platform: Platform;
  type: "account" | "channel";
  id: string;
}

/**
 * Evaluates whether to reply to a given event based on access control config.
 */
export class ReplyPolicyEvaluator {
  private readonly policy: ReplyPolicy;
  private readonly entries: WhitelistEntry[];

  constructor(config: AccessControlConfig) {
    this.policy = config.replyTo;
    this.entries = this.parseWhitelist(config.whitelist);

    logger.info("Reply policy initialized", {
      policy: this.policy,
      whitelistEntries: this.entries.length,
    });
  }

  /**
   * Determine if the bot should reply to this event.
   */
  shouldReply(event: NormalizedEvent): boolean {
    const whitelisted = this.isWhitelisted(event);

    switch (this.policy) {
      case "all":
        return true;
      case "public":
        if (!event.isDm) {
          return true;
        }
        return whitelisted;
      case "whitelist":
        return whitelisted;
      default:
        logger.warn("Unknown reply policy, defaulting to deny", { policy: this.policy });
        return false;
    }
  }

  /**
   * Check whether an event matches any whitelist entry.
   */
  private isWhitelisted(event: NormalizedEvent): boolean {
    return this.entries.some((entry) => {
      if (entry.platform !== event.platform) {
        return false;
      }

      switch (entry.type) {
        case "account":
          return entry.id === event.userId;
        case "channel":
          return entry.id === event.channelId;
      }
    });
  }

  /**
   * Parse whitelist string entries into structured format.
   */
  private parseWhitelist(whitelist: string[]): WhitelistEntry[] {
    const pattern = /^(discord|misskey)\/(account|channel)\/(\S+)$/;
    const entries: WhitelistEntry[] = [];

    for (const raw of whitelist) {
      const match = raw.match(pattern);
      if (!match) {
        logger.warn("Invalid whitelist entry, skipping", { entry: raw });
        continue;
      }

      entries.push({
        platform: match[1] as Platform,
        type: match[2] as "account" | "channel",
        id: match[3],
      });
    }

    return entries;
  }
}
