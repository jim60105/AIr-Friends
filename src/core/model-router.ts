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
  // channel condition
  if (match.channel !== undefined) {
    const entry = match.channel;
    let channelMatched = false;
    if (context.platform && context.userId) {
      if (entry === `${context.platform}/account/${context.userId}`) {
        channelMatched = true;
      }
    }
    if (!channelMatched && context.platform && context.channelId) {
      if (entry === `${context.platform}/channel/${context.channelId}`) {
        channelMatched = true;
      }
    }
    if (!channelMatched) return false;
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
  const hasAnyCondition = match.channel !== undefined ||
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

/**
 * Resolve the reasoning effort to use for a given context.
 *
 * Mirrors {@link resolveModel}: it evaluates rules in declaration order and stops at the
 * **first matching rule** (NOT the first rule that happens to have a `reasoningEffort`).
 * If that first matching rule sets `reasoningEffort`, it wins; otherwise the resolver
 * returns `fallbackEffort` and does NOT continue to later rules. This keeps a session's
 * model and effort tied to the same matched rule while letting operators set one without
 * the other.
 *
 * Evaluation order:
 * 1. If modelRouting is disabled or undefined, return `fallbackEffort`
 * 2. Find the first matching rule; if it sets `reasoningEffort`, return it
 * 3. Otherwise (matched rule without effort, or no rule matched) return `fallbackEffort`
 *
 * @param routingConfig - Model routing configuration (may be undefined)
 * @param context - Current session context
 * @param fallbackEffort - Effort to use when no rule provides one (section -> global chain)
 * @returns The resolved reasoning effort (always a concrete string when the caller passes
 *          a concrete fallback)
 */
export function resolveReasoningEffort(
  routingConfig: ModelRoutingConfig | undefined,
  context: ModelRoutingContext,
  fallbackEffort: string,
): string {
  if (!routingConfig?.enabled || !routingConfig.rules?.length) {
    return fallbackEffort;
  }

  for (const rule of routingConfig.rules) {
    if (matchesRule(rule.match, context)) {
      // First matching rule wins. If it sets reasoningEffort, use it; otherwise fall back.
      if (rule.reasoningEffort !== undefined && rule.reasoningEffort !== "") {
        logger.info("Reasoning effort routing rule matched, resolved to {resolvedEffort}", {
          matchedRule: rule.match,
          resolvedEffort: rule.reasoningEffort,
          sessionType: context.sessionType,
        });
        return rule.reasoningEffort;
      }
      // Matched rule without effort: stop here and use fallback (do not scan later rules).
      return fallbackEffort;
    }
  }

  return fallbackEffort;
}
