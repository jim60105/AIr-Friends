// src/core/event-router.ts

import { createLogger } from "@utils/logger.ts";
import type { PlatformRegistry } from "@platforms/platform-registry.ts";
import type { NormalizedEvent } from "../types/events.ts";

const logger = createLogger("EventRouter");

/**
 * Route handler function type
 */
export type RouteHandler = (event: NormalizedEvent) => Promise<void>;

/**
 * Route condition function type
 */
export type RouteCondition = (event: NormalizedEvent) => boolean;

/**
 * Route definition
 */
interface Route {
  name: string;
  condition: RouteCondition;
  handler: RouteHandler;
}

/**
 * Routes platform events to appropriate handlers
 */
export class EventRouter {
  private readonly routes: Route[] = [];
  private defaultHandler: RouteHandler | null = null;

  /**
   * Add a route with a condition
   */
  addRoute(
    name: string,
    condition: RouteCondition,
    handler: RouteHandler,
  ): void {
    this.routes.push({ name, condition, handler });
    logger.debug("Route added", { name });
  }

  /**
   * Set the default handler for events that don't match any route
   */
  setDefaultHandler(handler: RouteHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * Route an event to the appropriate handler
   */
  async route(event: NormalizedEvent): Promise<void> {
    logger.debug("Routing event", {
      platform: event.platform,
      channelId: event.channelId,
      userId: event.userId,
    });

    // Find matching route
    for (const route of this.routes) {
      if (route.condition(event)) {
        logger.debug("Route matched", {
          routeName: route.name,
          messageId: event.messageId,
        });

        try {
          await route.handler(event);
        } catch (error) {
          logger.error("Route handler error", {
            routeName: route.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    // No matching route, use default handler
    if (this.defaultHandler) {
      logger.debug("Using default handler", {
        messageId: event.messageId,
      });
      await this.defaultHandler(event);
    } else {
      logger.warn("No handler for event", {
        platform: event.platform,
        channelId: event.channelId,
      });
    }
  }

  /**
   * Connect router to platform registry
   */
  connectToRegistry(registry: PlatformRegistry): void {
    registry.onEvent(async (event) => {
      await this.route(event);
    });
    logger.info("Event router connected to registry");
  }
}

// ============ Predefined route conditions ============

/**
 * Match DM events only
 */
export const isDmEvent: RouteCondition = (event) => event.isDm;

/**
 * Match guild/server events only
 */
export const isGuildEvent: RouteCondition = (event) => !event.isDm && !!event.guildId;

/**
 * Create a condition that matches specific platforms
 */
export function isPlatform(...platforms: string[]): RouteCondition {
  return (event) => platforms.includes(event.platform);
}

/**
 * Create a condition that matches messages containing keywords
 */
export function containsKeyword(...keywords: string[]): RouteCondition {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return (event) => {
    const content = event.content.toLowerCase();
    return lowerKeywords.some((k) => content.includes(k));
  };
}

/**
 * Combine multiple conditions with AND logic
 */
export function allOf(...conditions: RouteCondition[]): RouteCondition {
  return (event) => conditions.every((c) => c(event));
}

/**
 * Combine multiple conditions with OR logic
 */
export function anyOf(...conditions: RouteCondition[]): RouteCondition {
  return (event) => conditions.some((c) => c(event));
}
