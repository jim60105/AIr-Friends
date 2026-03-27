// src/core/memory-index.ts

import { createLogger } from "@utils/logger.ts";
import { MemoryCategory, MemoryIndexEntry, MemoryLogEvent, MemoryTier } from "../types/memory.ts";
import { ErrorCode, MemoryError } from "../types/errors.ts";

const logger = createLogger("MemoryIndex");

const INDEX_FILE_NAME = "memory.index.jsonl";

/**
 * Provides O(1) memory lookup by ID using an in-memory map backed by a JSONL index file.
 */
export class MemoryIndex {
  private readonly dirPath: string;
  private entries: Map<string, MemoryIndexEntry> = new Map();

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }

  /** Path to the index file */
  get indexFilePath(): string {
    return `${this.dirPath}/${INDEX_FILE_NAME}`;
  }

  /** Number of indexed entries */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Rebuild index from source JSONL memory files.
   * Creates a clean index file with one entry per memory ID.
   */
  async rebuild(
    memoryFiles: Array<{ path: string; file: "public" | "private" | "channel" }>,
  ): Promise<number> {
    const indexMap = new Map<string, MemoryIndexEntry>();

    for (const { path, file } of memoryFiles) {
      let content: string;
      try {
        content = await Deno.readTextFile(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) continue;
        throw new MemoryError(
          ErrorCode.MEMORY_READ_FAILED,
          `Failed to read memory file: ${path}`,
          { path, error: error instanceof Error ? error.message : String(error) },
        );
      }

      const lines = content.split("\n").filter((line) => line.trim());
      for (let i = 0; i < lines.length; i++) {
        let event: MemoryLogEvent;
        try {
          event = JSON.parse(lines[i]) as MemoryLogEvent;
        } catch {
          logger.warn("Skipping invalid JSON line in {file}", {
            file: path,
            lineNumber: i + 1,
          });
          continue;
        }

        if (event.type === "memory") {
          const tier = event.tier ?? (event.importance === "high" ? "core" : "archive");
          const category = event.category ?? "fact";
          const scope = event.scope ?? "user";

          indexMap.set(event.id, {
            id: event.id,
            tier,
            category,
            scope,
            visibility: event.visibility,
            enabled: event.enabled,
            file,
            lineNumber: i + 1,
          });
        } else if (event.type === "patch") {
          const existing = indexMap.get(event.targetId);
          if (existing) {
            if (event.enabled !== undefined) existing.enabled = event.enabled;
            if (event.tier !== undefined) existing.tier = event.tier;
            if (event.category !== undefined) existing.category = event.category;
          }
        }
      }
    }

    // Write clean index file
    try {
      const lines = Array.from(indexMap.values())
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      await Deno.writeTextFile(this.indexFilePath, lines ? lines + "\n" : "");
    } catch (error) {
      throw new MemoryError(
        ErrorCode.MEMORY_WRITE_FAILED,
        `Failed to write index file: ${this.indexFilePath}`,
        { path: this.indexFilePath, error: error instanceof Error ? error.message : String(error) },
      );
    }

    this.entries = indexMap;
    logger.info("Index {action} for {dirPath}, {count} entries", {
      action: "rebuilt",
      dirPath: this.dirPath,
      count: indexMap.size,
    });

    return indexMap.size;
  }

  /**
   * Load existing index file into in-memory map.
   * Returns empty map if file does not exist.
   */
  async load(): Promise<Map<string, MemoryIndexEntry>> {
    this.entries = new Map();

    let content: string;
    try {
      content = await Deno.readTextFile(this.indexFilePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug("Index file not found, starting empty for {dirPath}", {
          dirPath: this.dirPath,
        });
        return this.entries;
      }
      throw new MemoryError(
        ErrorCode.MEMORY_READ_FAILED,
        `Failed to read index file: ${this.indexFilePath}`,
        { path: this.indexFilePath, error: error instanceof Error ? error.message : String(error) },
      );
    }

    const lines = content.split("\n").filter((line) => line.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MemoryIndexEntry;
        // Last-write-wins: later entries for the same ID override earlier ones
        this.entries.set(entry.id, entry);
      } catch {
        logger.warn("Skipping invalid JSON line in index file");
      }
    }

    logger.info("Index {action} for {dirPath}, {count} entries", {
      action: "loaded",
      dirPath: this.dirPath,
      count: this.entries.size,
    });

    return this.entries;
  }

  /**
   * Add a new entry to the in-memory map and append to the index file.
   */
  async appendEntry(entry: MemoryIndexEntry): Promise<void> {
    this.entries.set(entry.id, entry);

    try {
      await Deno.writeTextFile(this.indexFilePath, JSON.stringify(entry) + "\n", { append: true });
    } catch (error) {
      throw new MemoryError(
        ErrorCode.MEMORY_WRITE_FAILED,
        `Failed to append to index file: ${this.indexFilePath}`,
        { path: this.indexFilePath, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Update an existing entry in the in-memory map and append updated entry to the index file.
   * Uses last-write-wins semantics: load() will pick up the latest entry per ID.
   */
  async updateEntry(
    id: string,
    changes: Partial<Pick<MemoryIndexEntry, "enabled" | "tier" | "category">>,
  ): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new MemoryError(
        ErrorCode.MEMORY_READ_FAILED,
        `Memory index entry not found: ${id}`,
        { id },
      );
    }

    const updated: MemoryIndexEntry = {
      ...existing,
      ...changes,
    };
    this.entries.set(id, updated);

    try {
      await Deno.writeTextFile(this.indexFilePath, JSON.stringify(updated) + "\n", {
        append: true,
      });
    } catch (error) {
      throw new MemoryError(
        ErrorCode.MEMORY_WRITE_FAILED,
        `Failed to append to index file: ${this.indexFilePath}`,
        { path: this.indexFilePath, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** O(1) lookup by memory ID */
  lookupById(id: string): MemoryIndexEntry | undefined {
    return this.entries.get(id);
  }

  /** Return all entries matching the given tier */
  getByTier(tier: MemoryTier): MemoryIndexEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.tier === tier);
  }

  /** Return all entries matching the given category */
  getByCategory(category: MemoryCategory): MemoryIndexEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  /** Return all enabled entries */
  getEnabled(): MemoryIndexEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.enabled);
  }
}
