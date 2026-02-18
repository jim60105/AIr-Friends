// src/skills/memory-handler.ts

import { createLogger } from "@utils/logger.ts";
import { MemoryStore } from "@core/memory-store.ts";
import type {
  MemoryExportParams,
  MemoryPatchParams,
  MemorySaveParams,
  MemorySearchParams,
  MemorySearchResult,
  SkillContext,
  SkillHandler,
  SkillResult,
} from "./types.ts";
import type { MemoryImportance, MemoryVisibility, ResolvedMemory } from "../types/memory.ts";

import { memoryOperationsTotal } from "@utils/metrics.ts";

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

      // Validate relatedTo
      const relatedTo = (params as unknown as Record<string, unknown>).relatedTo as
        | string[]
        | undefined;
      if (relatedTo !== undefined) {
        if (
          !Array.isArray(relatedTo) ||
          !relatedTo.every((id: unknown) => typeof id === "string")
        ) {
          return {
            success: false,
            error: "Invalid 'relatedTo' parameter. Must be an array of strings",
          };
        }
      }

      // Validate supersedes
      const supersedes = (params as unknown as Record<string, unknown>).supersedes as
        | string[]
        | undefined;
      if (supersedes !== undefined) {
        if (
          !Array.isArray(supersedes) ||
          !supersedes.every((id: unknown) => typeof id === "string")
        ) {
          return {
            success: false,
            error: "Invalid 'supersedes' parameter. Must be an array of strings",
          };
        }
      }

      const entry = await this.memoryStore.addMemory(
        context.workspace,
        params.content,
        {
          visibility,
          importance,
          ...(relatedTo && { relatedTo }),
          ...(supersedes && { supersedes }),
        },
      );

      logger.info("Memory {memoryId} saved via skill ({visibility}, {importance})", {
        workspaceKey: context.workspace.key,
        memoryId: entry.id,
        visibility,
        importance,
      });
      memoryOperationsTotal.labels("save", visibility).inc();

      return {
        success: true,
        data: {
          id: entry.id,
          content: entry.content,
          visibility: entry.visibility,
          importance: entry.importance,
          timestamp: entry.ts,
          ...(entry.relatedTo && { relatedTo: entry.relatedTo }),
          ...(entry.supersedes && { supersedes: entry.supersedes }),
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

      logger.info("Memory search via skill: query returned {resultsCount} results", {
        workspaceKey: context.workspace.key,
        query: params.query,
        resultsCount: memories.length,
      });
      memoryOperationsTotal.labels("search", "public").inc();

      const result: MemorySearchResult = {
        memories: memories.map((m) => ({
          id: m.id,
          enabled: m.enabled,
          visibility: m.visibility,
          importance: m.importance,
          content: m.content,
          createdAt: m.createdAt,
          lastModifiedAt: m.lastModifiedAt,
          relatedTo: m.relatedTo,
          supersedes: m.supersedes,
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
   * Handle memory-stats skill
   */
  handleMemoryStats: SkillHandler = async (
    _parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const includePrivate = context.workspace.isDm;
      const stats = await this.memoryStore.getMemoryStats(context.workspace, includePrivate);

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      logger.error("Failed to get memory stats", {
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
        relatedTo?: string[];
        supersedes?: string[];
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

      if (params.relatedTo !== undefined) {
        if (
          !Array.isArray(params.relatedTo) ||
          !params.relatedTo.every((id: unknown) => typeof id === "string")
        ) {
          return {
            success: false,
            error: "Invalid 'relatedTo' parameter. Must be an array of strings",
          };
        }
        patch.relatedTo = params.relatedTo;
      }

      if (params.supersedes !== undefined) {
        if (
          !Array.isArray(params.supersedes) ||
          !params.supersedes.every((id: unknown) => typeof id === "string")
        ) {
          return {
            success: false,
            error: "Invalid 'supersedes' parameter. Must be an array of strings",
          };
        }
        patch.supersedes = params.supersedes;
      }

      // At least one field must be provided
      if (Object.keys(patch).length === 0) {
        return {
          success: false,
          error:
            "At least one of 'enabled', 'visibility', 'importance', 'relatedTo', or 'supersedes' must be provided",
        };
      }

      const patchEntry = await this.memoryStore.patchMemory(
        context.workspace,
        params.memory_id,
        patch,
      );

      logger.info("Memory {memoryId} patched via skill", {
        workspaceKey: context.workspace.key,
        memoryId: params.memory_id,
        patch,
      });
      memoryOperationsTotal.labels("patch", "public").inc();

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

  /**
   * Handle memory-export skill
   * Exports memories as a file and sends it directly via DM.
   * Always includes both public and private memories (DM delivery ensures privacy).
   * Agent workspace notes are NOT included (privacy boundary).
   */
  handleMemoryExport: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    try {
      const params = parameters as unknown as MemoryExportParams;

      // Validate format
      const format = params.format ?? "markdown";
      if (format !== "markdown" && format !== "json") {
        return {
          success: false,
          error: "Invalid 'format' parameter. Must be 'markdown' or 'json'",
        };
      }

      // Validate importance filter
      const importanceFilter = params.importance ?? "all";
      if (
        importanceFilter !== "high" && importanceFilter !== "normal" && importanceFilter !== "all"
      ) {
        return {
          success: false,
          error: "Invalid 'importance' parameter. Must be 'high', 'normal', or 'all'",
        };
      }

      const enabledOnly = params.enabled_only !== false; // Default true

      // Always load both public and private memories
      // Privacy is enforced by DM delivery, not by visibility filtering
      const allMemories: ResolvedMemory[] = [];
      for (const visibility of ["public", "private"] as MemoryVisibility[]) {
        const memories = await this.memoryStore.loadAllMemories(context.workspace, visibility);
        allMemories.push(...memories);
      }

      // Apply filters
      let filtered = allMemories;
      if (enabledOnly) {
        filtered = filtered.filter((m) => m.enabled);
      }
      if (importanceFilter !== "all") {
        filtered = filtered.filter((m) => m.importance === importanceFilter);
      }

      // Sort by creation time (oldest first)
      filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      // Format output
      const output = format === "markdown"
        ? this.formatMemoriesAsMarkdown(filtered)
        : this.formatMemoriesAsJson(filtered);

      // Determine file name
      const ext = format === "markdown" ? "md" : "json";
      const fileName = `memory-export.${ext}`;

      // Get DM channel for the user (always send via DM for privacy)
      const dmChannelId = await context.platformAdapter.getDmChannelId(context.userId);
      if (!dmChannelId) {
        return {
          success: false,
          error: "Failed to create DM channel. Cannot send export file.",
        };
      }

      // Send file via DM
      const fileContent = new TextEncoder().encode(output);
      const sendResult = await context.platformAdapter.sendFile(
        dmChannelId,
        fileContent,
        fileName,
      );

      if (!sendResult.success) {
        logger.error("Failed to send memory export file via DM", {
          workspaceKey: context.workspace.key,
          userId: context.userId,
          error: sendResult.error,
        });

        return {
          success: false,
          error: sendResult.error ?? "Failed to send export file",
        };
      }

      logger.info("Memory export sent via DM: {count} memories ({format})", {
        workspaceKey: context.workspace.key,
        count: filtered.length,
        format,
        fileName,
        messageId: sendResult.messageId,
      });
      memoryOperationsTotal.labels("export", "public").inc();

      return {
        success: true,
        data: {
          count: filtered.length,
          format,
          fileName,
          messageId: sendResult.messageId,
        },
      };
    } catch (error) {
      logger.error("Failed to export memories", {
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
   * Format memories as Markdown
   */
  private formatMemoriesAsMarkdown(memories: ResolvedMemory[]): string {
    if (memories.length === 0) {
      return "# Memory Export\n\nNo memories found matching the specified criteria.\n";
    }

    const lines: string[] = [];
    lines.push("# Memory Export");
    lines.push(`Total: ${memories.length} memories`);
    lines.push("");

    for (const m of memories) {
      lines.push(`## [${m.importance.toUpperCase()}] ${m.id}`);
      lines.push(`- **Visibility**: ${m.visibility}`);
      lines.push(`- **Importance**: ${m.importance}`);
      lines.push(`- **Enabled**: ${m.enabled}`);
      lines.push(`- **Created**: ${m.createdAt}`);
      if (m.lastModifiedAt !== m.createdAt) {
        lines.push(`- **Last Modified**: ${m.lastModifiedAt}`);
      }
      lines.push("");
      lines.push(m.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Format memories as JSON
   */
  private formatMemoriesAsJson(memories: ResolvedMemory[]): string {
    return JSON.stringify(
      memories.map((m) => ({
        id: m.id,
        enabled: m.enabled,
        visibility: m.visibility,
        importance: m.importance,
        content: m.content,
        createdAt: m.createdAt,
        lastModifiedAt: m.lastModifiedAt,
      })),
      null,
      2,
    );
  }
}
