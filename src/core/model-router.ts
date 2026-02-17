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
}

/**
 * Check if a routing rule matches the given context.
 */
function matchesRule(
  match: ModelRoutingMatch,
  context: ModelRoutingContext,
): boolean {
  if (match.whitelist) {
    const entry = match.whitelist;
    if (context.platform && context.userId) {
      if (entry === `${context.platform}/account/${context.userId}`) {
        return true;
      }
    }
    if (context.platform && context.channelId) {
      if (entry === `${context.platform}/channel/${context.channelId}`) {
        return true;
      }
    }
    return false;
  }

  if (match.sessionType) {
    return match.sessionType === context.sessionType;
  }

  return false;
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
