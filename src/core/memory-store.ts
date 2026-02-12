// src/core/memory-store.ts

import { createLogger } from "@utils/logger.ts";
import { searchMultipleKeywords, SearchOptions } from "@utils/text-search.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import {
  AgentNoteSearchResult,
  MemoryEntry,
  MemoryImportance,
  MemoryLogEvent,
  MemoryPatch,
  MemoryVisibility,
  ResolvedMemory,
} from "../types/memory.ts";
import { MemoryFileType, WorkspaceInfo } from "../types/workspace.ts";
import { ErrorCode, MemoryError } from "../types/errors.ts";

const logger = createLogger("MemoryStore");

export interface MemoryStoreConfig {
  searchLimit: number;
  maxChars: number;
}

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
    } = {},
  ): Promise<MemoryEntry> {
    const visibility = options.visibility ?? "public";
    const importance = options.importance ?? "normal";

    const entry: MemoryEntry = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "memory",
      enabled: true,
      visibility,
      importance,
      content,
    };

    const line = JSON.stringify(entry) + "\n";
    await this.workspaceManager.appendWorkspaceFile(
      workspace,
      visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC,
      line,
    );

    logger.info("Memory added", {
      workspaceKey: workspace.key,
      memoryId: entry.id,
      importance,
      visibility,
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

    const patchEntry: MemoryPatch = {
      id: this.generateId(),
      ts: new Date().toISOString(),
      type: "patch",
      targetId,
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.visibility !== undefined && { visibility: patch.visibility }),
      ...(patch.importance !== undefined && { importance: patch.importance }),
    };

    // Write patch to the same file as the original memory
    const line = JSON.stringify(patchEntry) + "\n";
    await this.workspaceManager.appendWorkspaceFile(
      workspace,
      originalMemory.visibility === "private" ? MemoryFileType.PRIVATE : MemoryFileType.PUBLIC,
      line,
    );

    logger.info("Memory patched", {
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
  private async loadAllMemories(
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
        memoriesMap.set(event.id, {
          id: event.id,
          enabled: event.enabled,
          visibility: event.visibility,
          importance: event.importance,
          content: event.content,
          createdAt: event.ts,
          lastModifiedAt: event.ts,
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
        memory.lastModifiedAt = patch.ts;
      }
    }

    return Array.from(memoriesMap.values());
  }

  /**
   * Get all important memories (for initial context)
   * DM context → both private and public memories
   * Non-DM context → public memories only
   */
  async getImportantMemories(workspace: WorkspaceInfo): Promise<ResolvedMemory[]> {
    const publicMemories = await this.loadAllMemories(workspace, "public");
    const importantPublic = publicMemories.filter(
      (m) => m.enabled && m.importance === "high",
    );

    if (workspace.isDm) {
      const privateMemories = await this.loadAllMemories(workspace, "private");
      const importantPrivate = privateMemories.filter(
        (m) => m.enabled && m.importance === "high",
      );
      return [...importantPublic, ...importantPrivate].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt),
      );
    }

    return importantPublic.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
              results.push(memory);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return results.slice(0, searchOpts.maxResults);
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
    } catch {
      // Directory doesn't exist or not accessible
    }
    return files;
  }
}
