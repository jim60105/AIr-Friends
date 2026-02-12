// src/skills/memory-handler.ts

import { createLogger } from "@utils/logger.ts";
import { MemoryStore } from "@core/memory-store.ts";
import type {
  MemoryPatchParams,
  MemorySaveParams,
  MemorySearchParams,
  MemorySearchResult,
  SkillContext,
  SkillHandler,
  SkillResult,
} from "./types.ts";
import type { MemoryImportance, MemoryVisibility } from "../types/memory.ts";

const logger = createLogger("MemoryHandler");

export class MemoryHandler {
  constructor(private readonly memoryStore: MemoryStore) {}

  /**
   * Handle memory-save skill
   * Visibility is auto-determined by context:
   *   DM → private, non-DM (guild/public thread) → public
   */
  handleMemorySave: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as MemorySaveParams;

      if (!params.content || typeof params.content !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'content' parameter",
        };
      }

      // Auto-determine visibility from context: DM → private, non-DM → public
      const visibility: MemoryVisibility = context.workspace.isDm ? "private" : "public";

      // Validate importance
      const importance = (params.importance ?? "normal") as MemoryImportance;
      if (importance !== "high" && importance !== "normal") {
        return {
          success: false,
          error: "Invalid 'importance' parameter. Must be 'high' or 'normal'",
        };
      }

      const entry = await this.memoryStore.addMemory(
        context.workspace,
        params.content,
        {
          visibility,
          importance,
        },
      );

      logger.info("Memory saved via skill", {
        workspaceKey: context.workspace.key,
        memoryId: entry.id,
        visibility,
        importance,
      });

      return {
        success: true,
        data: {
          id: entry.id,
          content: entry.content,
          visibility: entry.visibility,
          importance: entry.importance,
          timestamp: entry.ts,
        },
      };
    } catch (error) {
      logger.error("Failed to save memory", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };

  /**
   * Handle memory-search skill
   */
  handleMemorySearch: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as MemorySearchParams;

      if (!params.query || typeof params.query !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'query' parameter",
        };
      }

      const limit = params.limit ?? 10;
      if (typeof limit !== "number" || limit < 1) {
        return {
          success: false,
          error: "Invalid 'limit' parameter. Must be a positive number",
        };
      }

      // Split query into keywords
      const keywords = params.query.trim().split(/\s+/);

      const memories = await this.memoryStore.searchMemories(
        context.workspace,
        keywords,
        { maxResults: limit },
      );

      logger.info("Memory search via skill", {
        workspaceKey: context.workspace.key,
        query: params.query,
        resultsCount: memories.length,
      });

      const result: MemorySearchResult = {
        memories: memories.map((m) => ({
          id: m.id,
          enabled: m.enabled,
          visibility: m.visibility,
          importance: m.importance,
          content: m.content,
          createdAt: m.createdAt,
          lastModifiedAt: m.lastModifiedAt,
        })),
      };

      // Search agent workspace notes if available
      if (context.agentWorkspacePath) {
        try {
          result.agentNotes = await this.memoryStore.searchAgentWorkspace(
            context.agentWorkspacePath,
            keywords,
            limit,
          );
        } catch (error) {
          logger.warn("Failed to search agent workspace", {
            error: error instanceof Error ? error.message : String(error),
          });
          result.agentNotes = [];
        }
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error("Failed to search memories", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };

  /**
   * Handle memory-patch skill
   */
  handleMemoryPatch: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as MemoryPatchParams;

      if (!params.memory_id || typeof params.memory_id !== "string") {
        return {
          success: false,
          error: "Missing or invalid 'memory_id' parameter",
        };
      }

      // Build patch object
      const patch: {
        enabled?: boolean;
        visibility?: MemoryVisibility;
        importance?: MemoryImportance;
      } = {};

      if (params.enabled !== undefined) {
        if (typeof params.enabled !== "boolean") {
          return {
            success: false,
            error: "Invalid 'enabled' parameter. Must be a boolean",
          };
        }
        patch.enabled = params.enabled;
      }

      if (params.visibility !== undefined) {
        if (params.visibility !== "public" && params.visibility !== "private") {
          return {
            success: false,
            error: "Invalid 'visibility' parameter. Must be 'public' or 'private'",
          };
        }
        patch.visibility = params.visibility;
      }

      if (params.importance !== undefined) {
        if (params.importance !== "high" && params.importance !== "normal") {
          return {
            success: false,
            error: "Invalid 'importance' parameter. Must be 'high' or 'normal'",
          };
        }
        patch.importance = params.importance;
      }

      // At least one field must be provided
      if (Object.keys(patch).length === 0) {
        return {
          success: false,
          error: "At least one of 'enabled', 'visibility', or 'importance' must be provided",
        };
      }

      const patchEntry = await this.memoryStore.patchMemory(
        context.workspace,
        params.memory_id,
        patch,
      );

      logger.info("Memory patched via skill", {
        workspaceKey: context.workspace.key,
        memoryId: params.memory_id,
        patch,
      });

      return {
        success: true,
        data: {
          patchId: patchEntry.id,
          targetId: patchEntry.targetId,
          timestamp: patchEntry.ts,
          changes: patch,
        },
      };
    } catch (error) {
      logger.error("Failed to patch memory", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: context.workspace.key,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };
}
