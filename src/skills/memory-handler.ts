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
import type {
  MemoryCategory,
  MemoryImportance,
  MemoryScope,
  MemoryTier,
  MemoryVisibility,
  ResolvedMemory,
} from "../types/memory.ts";

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

      // Validate tier
      const tier = (params.tier ?? "archive") as MemoryTier;
      if (tier !== "core" && tier !== "working" && tier !== "archive") {
        return {
          success: false,
          error: "Invalid 'tier' parameter. Must be 'core', 'working', or 'archive'",
        };
      }

      // Validate category
      const category = (params.category ?? "fact") as MemoryCategory;
      const validCategories: MemoryCategory[] = [
        "fact",
        "preference",
        "episode",
        "summary",
        "relationship",
      ];
      if (!validCategories.includes(category)) {
        return {
          success: false,
          error:
            "Invalid 'category' parameter. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
        };
      }

      // Validate scope
      const scope = (params.scope ?? "user") as MemoryScope;
      if (scope !== "user" && scope !== "channel") {
        return {
          success: false,
          error: "Invalid 'scope' parameter. Must be 'user' or 'channel'",
        };
      }

      // Validate and clamp decay to [0.0, 1.0]
      let decay = params.decay;
      if (decay !== undefined) {
        if (typeof decay !== "number") {
          return {
            success: false,
            error: "Invalid 'decay' parameter. Must be a number between 0.0 and 1.0",
          };
        }
        decay = Math.max(0.0, Math.min(1.0, decay));
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

      // Channel-scoped memory
      if (scope === "channel") {
        if (!context.channelId) {
          return {
            success: false,
            error: "Cannot save channel memory: no channelId in context",
          };
        }
        if (!context.workspaceManager) {
          return {
            success: false,
            error: "Cannot save channel memory: workspaceManager not available",
          };
        }

        const channelWorkspace = await context.workspaceManager.getOrCreateChannelWorkspace(
          context.workspace.components.platform,
          context.channelId,
        );

        const entry = await this.memoryStore.addChannelMemory(
          channelWorkspace,
          params.content,
          {
            importance,
            tier,
            category,
            ...(decay !== undefined && { decay }),
            ...(relatedTo && { relatedTo }),
            ...(supersedes && { supersedes }),
          },
        );

        logger.info(
          "Channel memory {memoryId} saved via skill (tier={tier}, category={category})",
          {
            channelKey: channelWorkspace.key,
            memoryId: entry.id,
            tier,
            category,
          },
        );
        memoryOperationsTotal.labels("save", "public").inc();

        return {
          success: true,
          data: {
            id: entry.id,
            content: entry.content,
            visibility: entry.visibility,
            importance: entry.importance,
            tier: entry.tier,
            category: entry.category,
            scope: entry.scope,
            decay: entry.decay,
            timestamp: entry.ts,
            ...(entry.relatedTo && { relatedTo: entry.relatedTo }),
            ...(entry.supersedes && { supersedes: entry.supersedes }),
          },
        };
      }

      // User-scoped memory (default)
      const entry = await this.memoryStore.addMemory(
        context.workspace,
        params.content,
        {
          visibility,
          importance,
          tier,
          category,
          scope,
          ...(decay !== undefined && { decay }),
          ...(relatedTo && { relatedTo }),
          ...(supersedes && { supersedes }),
        },
      );

      logger.info(
        "Memory {memoryId} saved via skill ({visibility}, {importance}, tier={tier})",
        {
          workspaceKey: context.workspace.key,
          memoryId: entry.id,
          visibility,
          importance,
          tier,
        },
      );
      memoryOperationsTotal.labels("save", visibility).inc();

      return {
        success: true,
        data: {
          id: entry.id,
          content: entry.content,
          visibility: entry.visibility,
          importance: entry.importance,
          tier: entry.tier,
          category: entry.category,
          scope: entry.scope,
          decay: entry.decay,
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

      // Validate optional category filter
      const category = params.category as MemoryCategory | undefined;
      if (category !== undefined) {
        const validCategories: MemoryCategory[] = [
          "fact",
          "preference",
          "episode",
          "summary",
          "relationship",
        ];
        if (!validCategories.includes(category)) {
          return {
            success: false,
            error:
              "Invalid 'category' parameter. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
          };
        }
      }

      // Validate optional scope filter
      const scope = params.scope as MemoryScope | undefined;
      if (scope !== undefined && scope !== "user" && scope !== "channel") {
        return {
          success: false,
          error: "Invalid 'scope' parameter. Must be 'user' or 'channel'",
        };
      }

      // Split query into keywords
      const keywords = params.query.trim().split(/\s+/);

      // Search user memories (unless scope is explicitly "channel")
      let memories: ResolvedMemory[] = [];
      if (scope !== "channel") {
        memories = await this.memoryStore.searchMemories(
          context.workspace,
          keywords,
          { maxResults: limit },
          category,
        );
      }

      // Search channel memories if scope is "channel" or not specified and channelId available
      let channelMemories: ResolvedMemory[] = [];
      if (
        (scope === "channel" || scope === undefined) &&
        context.channelId &&
        context.workspaceManager
      ) {
        try {
          const channelWorkspace = await context.workspaceManager.getOrCreateChannelWorkspace(
            context.workspace.components.platform,
            context.channelId,
          );
          channelMemories = await this.memoryStore.searchChannelMemories(
            channelWorkspace,
            keywords,
            { maxResults: limit },
            category,
          );
        } catch (error) {
          logger.warn("Failed to search channel memories", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Merge and deduplicate results
      const seenIds = new Set<string>();
      const mergedMemories: ResolvedMemory[] = [];
      for (const m of [...memories, ...channelMemories]) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          mergedMemories.push(m);
        }
      }
      // Limit total results
      const finalMemories = mergedMemories.slice(0, limit);

      logger.info("Memory search via skill: query returned {resultsCount} results", {
        workspaceKey: context.workspace.key,
        query: params.query,
        resultsCount: finalMemories.length,
      });
      memoryOperationsTotal.labels("search", "public").inc();

      const result: MemorySearchResult = {
        memories: finalMemories.map((m) => ({
          id: m.id,
          enabled: m.enabled,
          visibility: m.visibility,
          importance: m.importance,
          content: m.content,
          createdAt: m.createdAt,
          lastModifiedAt: m.lastModifiedAt,
          tier: m.tier,
          category: m.category,
          scope: m.scope,
          decay: m.decay,
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

      // Include channel memory stats if channelId is available
      if (context.channelId && context.workspaceManager) {
        try {
          const channelWorkspace = await context.workspaceManager.getOrCreateChannelWorkspace(
            context.workspace.components.platform,
            context.channelId,
          );
          const channelStats = await this.memoryStore.getChannelMemoryStats(channelWorkspace);
          stats.channel = channelStats.channel ?? channelStats.public;
        } catch (error) {
          logger.warn("Failed to get channel memory stats", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

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
        tier?: MemoryTier;
        category?: MemoryCategory;
        decay?: number;
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

      if (params.tier !== undefined) {
        if (params.tier !== "core" && params.tier !== "working" && params.tier !== "archive") {
          return {
            success: false,
            error: "Invalid 'tier' parameter. Must be 'core', 'working', or 'archive'",
          };
        }
        patch.tier = params.tier as MemoryTier;
      }

      if (params.category !== undefined) {
        const validCategories: MemoryCategory[] = [
          "fact",
          "preference",
          "episode",
          "summary",
          "relationship",
        ];
        if (!validCategories.includes(params.category as MemoryCategory)) {
          return {
            success: false,
            error:
              "Invalid 'category' parameter. Must be 'fact', 'preference', 'episode', 'summary', or 'relationship'",
          };
        }
        patch.category = params.category as MemoryCategory;
      }

      if (params.decay !== undefined) {
        if (typeof params.decay !== "number") {
          return {
            success: false,
            error: "Invalid 'decay' parameter. Must be a number between 0.0 and 1.0",
          };
        }
        patch.decay = Math.max(0.0, Math.min(1.0, params.decay));
      }

      // At least one field must be provided
      if (Object.keys(patch).length === 0) {
        return {
          success: false,
          error:
            "At least one of 'enabled', 'visibility', 'importance', 'tier', 'category', 'decay', 'relatedTo', or 'supersedes' must be provided",
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
