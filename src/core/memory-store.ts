// src/core/memory-store.ts

import { createLogger } from "@utils/logger.ts";
import { searchMultipleKeywords, SearchOptions } from "@utils/text-search.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import {
  AgentNoteSearchResult,
  MemoryCategory,
  MemoryCategoryStats,
  MemoryEntry,
  MemoryImportance,
  MemoryLogEvent,
  MemoryPatch,
  MemoryScope,
  MemoryStatCategory,
  MemoryStats,
  MemoryTier,
  MemoryTierStats,
  MemoryVisibility,
  ResolvedMemory,
} from "../types/memory.ts";
import { MemoryFileType, WorkspaceInfo } from "../types/workspace.ts";
import type { ChannelWorkspaceInfo } from "../types/workspace.ts";
import { ErrorCode, MemoryError } from "../types/errors.ts";

const logger = createLogger("MemoryStore");

export interface MemoryStoreConfig {
  searchLimit: number;
  maxChars: number;
  workingTierLimit?: number;
}

/** Default decay values per tier */
const DEFAULT_TIER_DECAY: Record<MemoryTier, number> = {
  core: 1.0,
  working: 0.8,
  archive: 0.5,
};

/**
 * Maximum number of durable (core-tier) channel memory entries per channel (F15).
 * Bounds the durable/curated channel-knowledge store so it cannot grow without
 * limit. Ordinary user-driven channel writes never reach core tier (they decay);
 * this cap applies to the authorized/curated durable flow.
 */
export const MAX_CHANNEL_CORE_ENTRIES = 32;

export class MemoryStore {
  private readonly workspaceManager: WorkspaceManager;
  private readonly config: MemoryStoreConfig;

  constructor(workspaceManager: WorkspaceManager, config: MemoryStoreConfig) {
    this.workspaceManager = workspaceManager;
    this.config = config;
  }

  /**
   * Generate a unique memory ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `mem_${timestamp}_${random}`;
  }

  /**
   * Get the appropriate memory file path
   */
  private getMemoryPath(
    workspace: WorkspaceInfo,
    visibility: MemoryVisibility,
  ): string {
    const fileType = visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC;
    return this.workspaceManager.getMemoryFilePath(workspace, fileType);
  }

  /**
   * Add a new memory entry
   */
  async addMemory(
    workspace: WorkspaceInfo,
    content: string,
    options: {
      visibility?: MemoryVisibility;
      importance?: MemoryImportance;
      relatedTo?: string[];
      supersedes?: string[];
      tier?: MemoryTier;
      category?: MemoryCategory;
      scope?: MemoryScope;
      decay?: number;
    } = {},
  ): Promise<MemoryEntry> {
    const visibility = options.visibility ?? "public";
    const importance = options.importance ?? "normal";
    const tier = options.tier ?? (importance === "high" ? "core" : "archive");
    const category = options.category ?? "fact";
    const scope = options.scope ?? "user";
    const decay = tier === "core" ? 1.0 : (options.decay ?? DEFAULT_TIER_DECAY[tier]);

    const entry: MemoryEntry = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "memory",
      enabled: true,
      visibility,
      importance,
      content,
      tier,
      category,
      scope,
      decay,
      ...(options.relatedTo && { relatedTo: options.relatedTo }),
      ...(options.supersedes && { supersedes: options.supersedes }),
    };

    const line = JSON.stringify(entry) + "\n";
    await this.workspaceManager.appendWorkspaceFile(
      workspace,
      visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC,
      line,
    );

    logger.info("Memory {memoryId} added ({visibility}, {importance}, tier={tier})", {
      workspaceKey: workspace.key,
      memoryId: entry.id,
      importance,
      visibility,
      tier,
    });

    return entry;
  }

  /**
   * Patch an existing memory (can only change enabled/visibility/importance)
   */
  async patchMemory(
    workspace: WorkspaceInfo,
    targetId: string,
    patch: {
      enabled?: boolean;
      visibility?: MemoryVisibility;
      importance?: MemoryImportance;
      relatedTo?: string[];
      supersedes?: string[];
      tier?: MemoryTier;
      category?: MemoryCategory;
      decay?: number;
    },
  ): Promise<MemoryPatch> {
    // First, find the original memory to determine which file it's in
    const originalMemory = await this.findMemoryById(workspace, targetId);
    if (!originalMemory) {
      throw new MemoryError(
        ErrorCode.MEMORY_READ_FAILED,
        `Memory not found: ${targetId}`,
        { workspaceKey: workspace.key, targetId },
      );
    }

    // If target or patch tier is "core", pin decay at 1.0
    const resultingTier = patch.tier ?? originalMemory.tier;
    const effectiveDecay = resultingTier === "core" ? undefined : patch.decay;

    const patchEntry: MemoryPatch = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "patch",
      targetId,
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.visibility !== undefined && { visibility: patch.visibility }),
      ...(patch.importance !== undefined && { importance: patch.importance }),
      ...(patch.tier !== undefined && { tier: patch.tier }),
      ...(patch.category !== undefined && { category: patch.category }),
      ...(effectiveDecay !== undefined && { decay: effectiveDecay }),
      ...(resultingTier === "core" && { decay: 1.0 }),
      ...(patch.relatedTo !== undefined && { relatedTo: patch.relatedTo }),
      ...(patch.supersedes !== undefined && { supersedes: patch.supersedes }),
    };

    // Write patch to the same file as the original memory
    const line = JSON.stringify(patchEntry) + "\n";
    await this.workspaceManager.appendWorkspaceFile(
      workspace,
      originalMemory.visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC,
      line,
    );

    logger.info("Memory {targetId} patched", {
      workspaceKey: workspace.key,
      targetId,
      patch,
    });

    return patchEntry;
  }

  /**
   * Find a memory by ID (searches both public and private if applicable)
   */
  private async findMemoryById(
    workspace: WorkspaceInfo,
    memoryId: string,
  ): Promise<ResolvedMemory | null> {
    // Search public memories
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const publicMatch = publicMemories.find((m) => m.id === memoryId);
    if (publicMatch) return publicMatch;

    // Search private memories if DM
    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      const privateMatch = privateMemories.find((m) => m.id === memoryId);
      if (privateMatch) return privateMatch;
    }

    return null;
  }

  /**
   * Load all memories from a file and resolve patches
   */
  async loadAllMemories(
    workspace: WorkspaceInfo,
    visibility: MemoryVisibility,
  ): Promise<ResolvedMemory[]> {
    try {
      const content = await this.workspaceManager.readWorkspaceFile(
        workspace,
        visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC,
      );

      const events = this.parseMemoryLog(content);
      return this.resolveMemories(events);
    } catch (error) {
      if (
        error instanceof MemoryError ||
        (error instanceof Error && error.message.includes("not found"))
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Parse memory log file content into events
   */
  private parseMemoryLog(content: string): MemoryLogEvent[] {
    const events: MemoryLogEvent[] = [];
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as MemoryLogEvent;
        events.push(event);
      } catch (error) {
        logger.warn("Failed to parse memory log line", {
          line: line.substring(0, 100),
          error: String(error),
        });
      }
    }

    return events;
  }

  /**
   * Resolve memories by applying patches
   */
  private resolveMemories(events: MemoryLogEvent[]): ResolvedMemory[] {
    const memoriesMap = new Map<string, ResolvedMemory>();
    const patchesMap = new Map<string, MemoryPatch[]>();

    // First pass: collect all memories and patches
    for (const event of events) {
      if (event.type === "memory") {
        // Backward compat: derive tier from importance if not present
        const tier = event.tier ?? (event.importance === "high" ? "core" : "archive");
        const category = event.category ?? "fact";
        const scope = event.scope ?? "user";
        const decay = event.decay ?? DEFAULT_TIER_DECAY[tier];

        memoriesMap.set(event.id, {
          id: event.id,
          enabled: event.enabled,
          visibility: event.visibility,
          importance: event.importance,
          content: event.content,
          createdAt: event.ts,
          lastModifiedAt: event.ts,
          tier,
          category,
          scope,
          decay,
          relatedTo: event.relatedTo ?? [],
          supersedes: event.supersedes ?? [],
          ...(event.author !== undefined && { author: event.author }),
        });
      } else if (event.type === "patch") {
        const patches = patchesMap.get(event.targetId) ?? [];
        patches.push(event);
        patchesMap.set(event.targetId, patches);
      }
    }

    // Second pass: apply patches
    for (const [targetId, patches] of patchesMap) {
      const memory = memoriesMap.get(targetId);
      if (!memory) continue;

      // Sort patches by timestamp and apply in order
      patches.sort((a, b) => a.ts.localeCompare(b.ts));

      for (const patch of patches) {
        if (patch.enabled !== undefined) memory.enabled = patch.enabled;
        if (patch.visibility !== undefined) memory.visibility = patch.visibility;
        if (patch.importance !== undefined) memory.importance = patch.importance;
        if (patch.tier !== undefined) memory.tier = patch.tier;
        if (patch.category !== undefined) memory.category = patch.category;
        if (patch.decay !== undefined) memory.decay = patch.decay;
        if (patch.relatedTo) {
          memory.relatedTo = [...new Set([...memory.relatedTo, ...patch.relatedTo])];
        }
        if (patch.supersedes) {
          memory.supersedes = [...new Set([...memory.supersedes, ...patch.supersedes])];
        }
        memory.lastModifiedAt = patch.ts;
      }
    }

    return Array.from(memoriesMap.values());
  }

  /**
   * Get all core-tier memories (for initial context)
   * Filters by tier === "core"
   * DM context → both private and public memories
   * Non-DM context → public memories only
   */
  async getCoreTierMemories(workspace: WorkspaceInfo): Promise<ResolvedMemory[]> {
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const corePublic = publicMemories.filter(
      (m) => m.enabled && m.tier === "core",
    );

    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      const corePrivate = privateMemories.filter(
        (m) => m.enabled && m.tier === "core",
      );
      return [...corePublic, ...corePrivate].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt),
      );
    }

    return corePublic.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get all important memories (for initial context)
   * Uses both tier === "core" and importance === "high" for backward compatibility
   * DM context → both private and public memories
   * Non-DM context → public memories only
   */
  async getImportantMemories(workspace: WorkspaceInfo): Promise<ResolvedMemory[]> {
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const importantPublic = publicMemories.filter(
      (m) => m.enabled && (m.tier === "core" || m.importance === "high"),
    );

    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      const importantPrivate = privateMemories.filter(
        (m) => m.enabled && (m.tier === "core" || m.importance === "high"),
      );
      return [...importantPublic, ...importantPrivate].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt),
      );
    }

    return importantPublic.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get recent working-tier memories sorted by creation time (newest first)
   */
  async getRecentWorkingMemories(
    workspace: WorkspaceInfo,
    limit?: number,
  ): Promise<ResolvedMemory[]> {
    const effectiveLimit = limit ?? this.config.workingTierLimit ?? 20;
    const results: ResolvedMemory[] = [];

    const publicMemories = await this.loadAllMemories(workspace, "public");
    results.push(...publicMemories.filter((m) => m.enabled && m.tier === "working"));

    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      results.push(...privateMemories.filter((m) => m.enabled && m.tier === "working"));
    }

    return results
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, effectiveLimit);
  }

  /**
   * Count enabled memories in a workspace (both public and private for DM).
   * Used by memory maintenance scheduler to check if compaction threshold is met.
   */
  async countEnabledMemories(workspace: WorkspaceInfo): Promise<number> {
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const enabledPublic = publicMemories.filter((m) => m.enabled).length;

    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      const enabledPrivate = privateMemories.filter((m) => m.enabled).length;
      return enabledPublic + enabledPrivate;
    }

    return enabledPublic;
  }

  /**
   * Search memories by keywords
   * DM context → both private and public memory
   * Non-DM context → public memory only
   */
  async searchMemories(
    workspace: WorkspaceInfo,
    keywords: string[],
    options: SearchOptions = {},
    category?: MemoryCategory,
  ): Promise<ResolvedMemory[]> {
    const searchOpts: SearchOptions = {
      maxResults: options.maxResults ?? this.config.searchLimit,
      maxChars: options.maxChars ?? this.config.maxChars,
      caseInsensitive: true,
    };

    const results: ResolvedMemory[] = [];
    const seenIds = new Set<string>();

    // Determine which files to search based on context
    const visibilities: MemoryVisibility[] = workspace.isDm ? ["public", "private"] : ["public"];

    for (const visibility of visibilities) {
      const memoryPath = this.getMemoryPath(workspace, visibility);
      const searchResults = await searchMultipleKeywords(
        memoryPath,
        keywords,
        searchOpts,
      );

      for (const result of searchResults) {
        try {
          const event = JSON.parse(result.content) as MemoryLogEvent;
          if (event.type === "memory" && !seenIds.has(event.id)) {
            seenIds.add(event.id);
            // Load full resolved memory
            const memory = await this.findMemoryById(workspace, event.id);
            if (memory && memory.enabled) {
              if (!category || memory.category === category) {
                results.push(memory);
              }
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Sort results by decay-weighted relevance score
    const scoredResults = results.map((m) => ({
      memory: m,
      score: m.decay * this.computeRecencyBonus(m.createdAt),
    }));
    scoredResults.sort((a, b) => b.score - a.score);

    return scoredResults.map((r) => r.memory).slice(0, searchOpts.maxResults);
  }

  /**
   * Compute recency bonus: 1.0 + (0.5 * (1.0 - ageDays / 365)) clamped to [1.0, 1.5]
   */
  private computeRecencyBonus(createdAt: string): number {
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(1.0, Math.min(1.5, 1.0 + 0.5 * (1.0 - ageDays / 365)));
  }

  /**
   * Disable a memory (convenience method)
   */
  disableMemory(
    workspace: WorkspaceInfo,
    memoryId: string,
  ): Promise<MemoryPatch> {
    return this.patchMemory(workspace, memoryId, { enabled: false });
  }

  /**
   * Get memory statistics for a workspace
   */
  async getMemoryStats(
    workspace: WorkspaceInfo,
    includePrivate: boolean,
  ): Promise<MemoryStats> {
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const publicStats = this.computeStats(publicMemories);

    let privateStats: MemoryStatCategory | null = null;
    let allMemories = [...publicMemories];
    if (includePrivate) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      privateStats = this.computeStats(privateMemories);
      allMemories = [...allMemories, ...privateMemories];
    }

    const enabled = allMemories.filter((m) => m.enabled);
    const byTier: MemoryTierStats = {
      core: enabled.filter((m) => m.tier === "core").length,
      working: enabled.filter((m) => m.tier === "working").length,
      archive: enabled.filter((m) => m.tier === "archive").length,
    };
    const byCategory: MemoryCategoryStats = {
      fact: enabled.filter((m) => m.category === "fact").length,
      preference: enabled.filter((m) => m.category === "preference").length,
      episode: enabled.filter((m) => m.category === "episode").length,
      summary: enabled.filter((m) => m.category === "summary").length,
      relationship: enabled.filter((m) => m.category === "relationship").length,
    };

    const summary = {
      totalMemories: publicStats.total + (privateStats?.total ?? 0),
      totalEnabled: publicStats.enabled + (privateStats?.enabled ?? 0),
      totalDisabled: publicStats.disabled + (privateStats?.disabled ?? 0),
      totalHighImportance: publicStats.highImportance + (privateStats?.highImportance ?? 0),
      totalNormalImportance: publicStats.normalImportance + (privateStats?.normalImportance ?? 0),
    };

    return { public: publicStats, private: privateStats, byTier, byCategory, summary };
  }

  private computeStats(memories: ResolvedMemory[]): MemoryStatCategory {
    const enabled = memories.filter((m) => m.enabled);
    const disabled = memories.filter((m) => !m.enabled);
    return {
      total: memories.length,
      enabled: enabled.length,
      disabled: disabled.length,
      highImportance: enabled.filter((m) => m.importance === "high").length,
      normalImportance: enabled.filter((m) => m.importance === "normal").length,
    };
  }

  /**
   * Search agent workspace .md files for matching keywords
   */
  async searchAgentWorkspace(
    agentWorkspacePath: string,
    keywords: string[],
    maxResults: number,
  ): Promise<AgentNoteSearchResult[]> {
    const results: AgentNoteSearchResult[] = [];
    const mdFiles = await this.collectMdFiles(agentWorkspacePath);

    for (const filePath of mdFiles) {
      if (filePath.endsWith("/README.md")) continue;

      const searchResults = await searchMultipleKeywords(
        filePath,
        keywords,
        { maxResults },
      );

      if (searchResults.length > 0) {
        const relativePath = filePath.slice(agentWorkspacePath.length + 1);
        results.push({
          filePath: relativePath,
          matchedLines: searchResults.map((r) => ({
            lineNumber: r.lineNumber,
            content: r.content,
          })),
        });
      }

      if (results.length >= maxResults) break;
    }

    return results;
  }

  /**
   * Recursively collect .md files from a directory
   */
  private async collectMdFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) {
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isFile && entry.name.endsWith(".md")) {
          files.push(fullPath);
        } else if (entry.isDirectory) {
          files.push(...await this.collectMdFiles(fullPath));
        }
      }
    } catch (error) {
      logger.warn("Failed to read directory for agent workspace search", {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return files;
  }

  // ── Channel memory methods ──

  /**
   * Read a channel memory file's content
   */
  private async readChannelMemoryFile(channelWorkspace: ChannelWorkspaceInfo): Promise<string> {
    const filePath = this.workspaceManager.getChannelMemoryFilePath(channelWorkspace);
    try {
      return await Deno.readTextFile(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return "";
      throw error;
    }
  }

  /**
   * Load all channel memories and resolve patches
   */
  async loadChannelMemories(
    channelWorkspace: ChannelWorkspaceInfo,
  ): Promise<ResolvedMemory[]> {
    const content = await this.readChannelMemoryFile(channelWorkspace);
    if (!content.trim()) return [];
    const events = this.parseMemoryLog(content);
    return this.resolveMemories(events);
  }

  /**
   * Add a channel memory (always public, scope=channel)
   */
  async addChannelMemory(
    channelWorkspace: ChannelWorkspaceInfo,
    content: string,
    options: {
      importance?: MemoryImportance;
      relatedTo?: string[];
      supersedes?: string[];
      tier?: MemoryTier;
      category?: MemoryCategory;
      decay?: number;
      /** User ID of the contributing author (F15), for attribution on read. */
      author?: string;
      /**
       * Whether this write comes from an authorized/curated durable flow (F15).
       * Only durable writes may create a permanent, non-decaying `core` entry.
       * Ordinary user-driven writes (the default) are never pinned to core: a
       * requested `core` tier is downgraded to a decaying `working` tier so an
       * untrusted contribution cannot become a permanent implant.
       */
      durable?: boolean;
    } = {},
  ): Promise<MemoryEntry> {
    let tier = options.tier ?? (options.importance === "high" ? "core" : "archive");

    // F15: untrusted (non-durable) channel writes may not be pinned to permanent
    // core. Downgrade a requested core tier to a decaying working tier.
    if (tier === "core" && !options.durable) {
      tier = "working";
    }

    // F15: bound the number of durable core-tier channel entries per channel.
    if (tier === "core" && options.durable) {
      const existingCore = await this.getChannelCoreTierMemories(channelWorkspace);
      if (existingCore.length >= MAX_CHANNEL_CORE_ENTRIES) {
        throw new MemoryError(
          ErrorCode.MEMORY_WRITE_FAILED,
          `Channel core-tier memory cap reached (${MAX_CHANNEL_CORE_ENTRIES})`,
          { channelKey: channelWorkspace.key },
        );
      }
    }

    const category = options.category ?? "fact";
    const decay = tier === "core" ? 1.0 : (options.decay ?? DEFAULT_TIER_DECAY[tier]);

    const entry: MemoryEntry = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "memory",
      enabled: true,
      visibility: "public",
      importance: options.importance ?? "normal",
      content,
      tier,
      category,
      scope: "channel",
      decay,
      ...(options.relatedTo && { relatedTo: options.relatedTo }),
      ...(options.supersedes && { supersedes: options.supersedes }),
      ...(options.author !== undefined && { author: options.author }),
    };

    const filePath = this.workspaceManager.getChannelMemoryFilePath(channelWorkspace);
    await Deno.writeTextFile(filePath, JSON.stringify(entry) + "\n", { append: true });

    logger.info("Channel memory {memoryId} added (tier={tier})", {
      channelKey: channelWorkspace.key,
      memoryId: entry.id,
      tier,
    });

    return entry;
  }

  /**
   * Search channel memories by keywords
   */
  async searchChannelMemories(
    channelWorkspace: ChannelWorkspaceInfo,
    keywords: string[],
    options: SearchOptions = {},
    category?: MemoryCategory,
  ): Promise<ResolvedMemory[]> {
    const searchOpts: SearchOptions = {
      maxResults: options.maxResults ?? this.config.searchLimit,
      maxChars: options.maxChars ?? this.config.maxChars,
      caseInsensitive: true,
    };

    const filePath = this.workspaceManager.getChannelMemoryFilePath(channelWorkspace);
    const searchResults = await searchMultipleKeywords(filePath, keywords, searchOpts);

    const results: ResolvedMemory[] = [];
    const seenIds = new Set<string>();
    const allMemories = await this.loadChannelMemories(channelWorkspace);
    const memoryMap = new Map(allMemories.map((m) => [m.id, m]));

    for (const result of searchResults) {
      try {
        const event = JSON.parse(result.content) as MemoryLogEvent;
        if (event.type === "memory" && !seenIds.has(event.id)) {
          seenIds.add(event.id);
          const memory = memoryMap.get(event.id);
          if (memory && memory.enabled) {
            if (!category || memory.category === category) {
              results.push(memory);
            }
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    const scoredResults = results.map((m) => ({
      memory: m,
      score: m.decay * this.computeRecencyBonus(m.createdAt),
    }));
    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults.map((r) => r.memory).slice(0, searchOpts.maxResults);
  }

  /**
   * Get core-tier channel memories
   */
  async getChannelCoreTierMemories(
    channelWorkspace: ChannelWorkspaceInfo,
  ): Promise<ResolvedMemory[]> {
    const memories = await this.loadChannelMemories(channelWorkspace);
    return memories
      .filter((m) => m.enabled && m.tier === "core")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get recent working-tier channel memories
   */
  async getChannelRecentWorkingMemories(
    channelWorkspace: ChannelWorkspaceInfo,
    limit?: number,
  ): Promise<ResolvedMemory[]> {
    const effectiveLimit = limit ?? this.config.workingTierLimit ?? 20;
    const memories = await this.loadChannelMemories(channelWorkspace);
    return memories
      .filter((m) => m.enabled && m.tier === "working")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, effectiveLimit);
  }

  /**
   * Patch a channel memory
   */
  async patchChannelMemory(
    channelWorkspace: ChannelWorkspaceInfo,
    targetId: string,
    patch: {
      enabled?: boolean;
      importance?: MemoryImportance;
      relatedTo?: string[];
      supersedes?: string[];
      tier?: MemoryTier;
      category?: MemoryCategory;
      decay?: number;
    },
  ): Promise<MemoryPatch> {
    const allMemories = await this.loadChannelMemories(channelWorkspace);
    const original = allMemories.find((m) => m.id === targetId);
    if (!original) {
      throw new MemoryError(
        ErrorCode.MEMORY_READ_FAILED,
        `Channel memory not found: ${targetId}`,
        { channelKey: channelWorkspace.key, targetId },
      );
    }

    const resultingTier = patch.tier ?? original.tier;
    const effectiveDecay = resultingTier === "core" ? undefined : patch.decay;
    const patchEntry: MemoryPatch = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "patch",
      targetId,
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.importance !== undefined && { importance: patch.importance }),
      ...(patch.tier !== undefined && { tier: patch.tier }),
      ...(patch.category !== undefined && { category: patch.category }),
      ...(effectiveDecay !== undefined && { decay: effectiveDecay }),
      ...(resultingTier === "core" && { decay: 1.0 }),
      ...(patch.relatedTo !== undefined && { relatedTo: patch.relatedTo }),
      ...(patch.supersedes !== undefined && { supersedes: patch.supersedes }),
    };

    const filePath = this.workspaceManager.getChannelMemoryFilePath(channelWorkspace);
    await Deno.writeTextFile(filePath, JSON.stringify(patchEntry) + "\n", { append: true });

    logger.info("Channel memory {targetId} patched", {
      channelKey: channelWorkspace.key,
      targetId,
      patch,
    });

    return patchEntry;
  }

  /**
   * Get channel memory statistics
   */
  async getChannelMemoryStats(
    channelWorkspace: ChannelWorkspaceInfo,
  ): Promise<MemoryStats> {
    const memories = await this.loadChannelMemories(channelWorkspace);
    const channelStats = this.computeStats(memories);
    const enabled = memories.filter((m) => m.enabled);

    const byTier: MemoryTierStats = {
      core: enabled.filter((m) => m.tier === "core").length,
      working: enabled.filter((m) => m.tier === "working").length,
      archive: enabled.filter((m) => m.tier === "archive").length,
    };
    const byCategory: MemoryCategoryStats = {
      fact: enabled.filter((m) => m.category === "fact").length,
      preference: enabled.filter((m) => m.category === "preference").length,
      episode: enabled.filter((m) => m.category === "episode").length,
      summary: enabled.filter((m) => m.category === "summary").length,
      relationship: enabled.filter((m) => m.category === "relationship").length,
    };

    return {
      public: channelStats,
      private: null,
      channel: channelStats,
      byTier,
      byCategory,
      summary: {
        totalMemories: channelStats.total,
        totalEnabled: channelStats.enabled,
        totalDisabled: channelStats.disabled,
        totalHighImportance: channelStats.highImportance,
        totalNormalImportance: channelStats.normalImportance,
      },
    };
  }
}
