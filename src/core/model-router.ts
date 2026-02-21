// src/core/model-router.ts

import { createLogger } from "@utils/logger.ts";
import type { ModelRoutingConfig, ModelRoutingMatch, SessionType } from "../types/config.ts";

const logger = createLogger("ModelRouter");

/**
 * Context for model routing resolution
 */
export interface ModelRoutingContext {
  /** Current session type */
  sessionType: SessionType;
  /** Platform name ("discord" | "misskey") */
  platform?: string;
  /** User ID on the platform */
  userId?: string;
  /** Channel ID on the platform */
  channelId?: string;
  /** Trigger message content (only available for "message" session type) */
  messageContent?: string;
}

/**
 * Check if a routing rule matches the given context.
 * All specified conditions must match (AND logic).
 */
function matchesRule(
  match: ModelRoutingMatch,
  context: ModelRoutingContext,
): boolean {
  // whitelist condition
  if (match.whitelist !== undefined) {
    const entry = match.whitelist;
    let whitelistMatched = false;
    if (context.platform && context.userId) {
      if (entry === `${context.platform}/account/${context.userId}`) {
        whitelistMatched = true;
      }
    }
    if (!whitelistMatched && context.platform && context.channelId) {
      if (entry === `${context.platform}/channel/${context.channelId}`) {
        whitelistMatched = true;
      }
    }
    if (!whitelistMatched) return false;
  }

  // sessionType condition
  if (match.sessionType !== undefined) {
    if (match.sessionType !== context.sessionType) return false;
  }

  // contentKeywords condition (OR within keywords, only for "message" sessions)
  if (match.contentKeywords !== undefined && match.contentKeywords.length > 0) {
    if (context.sessionType !== "message" || !context.messageContent) {
      return false;
    }
    const lowerContent = context.messageContent.toLowerCase();
    const keywordMatched = match.contentKeywords.some(
      (kw) => lowerContent.includes(kw.toLowerCase()),
    );
    if (!keywordMatched) return false;
  }

  // All specified conditions passed
  // Empty match object should not match anything
  const hasAnyCondition = match.whitelist !== undefined ||
    match.sessionType !== undefined ||
    (match.contentKeywords !== undefined && match.contentKeywords.length > 0);
  return hasAnyCondition;
}

/**
 * Resolve the model to use for a given context.
 *
 * Evaluation order:
 * 1. If modelRouting is disabled or undefined, return fallbackModel
 * 2. Iterate rules in order (first-match wins)
 * 3. If no rule matches, return fallbackModel
 *
 * @param routingConfig - Model routing configuration (may be undefined)
 * @param context - Current session context
 * @param fallbackModel - Model to use if no rule matches
 * @returns The resolved model identifier
 */
export function resolveModel(
  routingConfig: ModelRoutingConfig | undefined,
  context: ModelRoutingContext,
  fallbackModel: string,
): string {
  if (!routingConfig?.enabled || !routingConfig.rules?.length) {
    return fallbackModel;
  }

  for (const rule of routingConfig.rules) {
    if (matchesRule(rule.match, context)) {
      logger.info("Model routing rule matched, resolved to {resolvedModel}", {
        matchedRule: rule.match,
        resolvedModel: rule.model,
        sessionType: context.sessionType,
      });
      return rule.model;
    }
  }

  logger.debug("No model routing rule matched, using fallback {fallbackModel}", {
    fallbackModel,
    sessionType: context.sessionType,
  });
  return fallbackModel;
}
