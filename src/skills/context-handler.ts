// src/skills/context-handler.ts

import { createLogger } from "@utils/logger.ts";
import type {
  FetchContextParams,
  FetchContextResult,
  SkillContext,
  SkillHandler,
  SkillResult,
} from "./types.ts";

const logger = createLogger("ContextHandler");

export class ContextHandler {
  /**
   * Handle fetch-context skill
   */
  handleFetchContext: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as FetchContextParams;

      if (!params.type || typeof params.type !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'type' parameter",
        };
      }

      const validTypes = ["recent_messages", "search_messages", "user_info"];
      if (!validTypes.includes(params.type)) {
        return {
          success: false,
          error: `Invalid 'type' parameter. Must be one of: ${validTypes.join(", ")}`,
        };
      }

      const limit = params.limit ?? 20;
      if (typeof limit !== "number" || limit < 1) {
        return {
          success: false,
          error: "Invalid 'limit' parameter. Must be a positive number",
        };
      }

      let result: FetchContextResult;

      switch (params.type) {
        case "recent_messages": {
          const messages = await context.platformAdapter.fetchRecentMessages(
            context.channelId,
            limit,
          );

          logger.info("Fetched {count} recent messages via skill for channel {channelId}", {
            workspaceKey: context.workspace.key,
            channelId: context.channelId,
            count: messages.length,
          });

          result = {
            type: "recent_messages",
            data: messages,
          };
          break;
        }

        case "search_messages": {
          if (!params.query || typeof params.query !== "string") {
            return {
              success: false,
              error: "Missing or invalid 'query' parameter for search_messages type",
            };
          }

          // Check if platform supports message search
          if (!context.platformAdapter.searchRelatedMessages) {
            return {
              success: false,
              error: "Platform does not support message search",
            };
          }

          const guildId = context.workspace.components.platform === "discord"
            ? (context.workspace.isDm ? "" : context.channelId)
            : "";

          const messages = await context.platformAdapter.searchRelatedMessages(
            guildId,
            context.channelId,
            params.query,
            limit,
          );

          logger.info("Searched messages via skill: query returned {count} results", {
            workspaceKey: context.workspace.key,
            channelId: context.channelId,
            query: params.query,
            count: messages.length,
          });

          result = {
            type: "search_messages",
            data: messages,
          };
          break;
        }

        case "user_info": {
          const username = await context.platformAdapter.getUsername(context.userId);

          logger.info("Fetched user info via skill for user {userId}", {
            workspaceKey: context.workspace.key,
            userId: context.userId,
          });

          result = {
            type: "user_info",
            data: {
              userId: context.userId,
              username,
              platform: context.workspace.components.platform,
              isDm: context.workspace.isDm,
            },
          };
          break;
        }

        default:
          return {
            success: false,
            error: `Unsupported context type: ${params.type}`,
          };
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error("Failed to fetch context", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
        type: (parameters as unknown as FetchContextParams).type,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };
}
