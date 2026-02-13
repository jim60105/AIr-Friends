// src/types/memory.ts

/**
 * Memory visibility levels
 */
export type MemoryVisibility = "public" | "private";

/**
 * Memory importance levels
 */
export type MemoryImportance = "high" | "normal";

/**
 * Event type in memory log
 */
export type MemoryEventType = "memory" | "patch";

/**
 * Base memory event (common fields)
 */
interface BaseMemoryEvent {
  /** Unique identifier for the memory */
  id: string;

  /** Timestamp when the event was created */
  ts: string;

  /** Event type */
  type: MemoryEventType;
}

/**
 * Memory creation event
 */
export interface MemoryEntry extends BaseMemoryEvent {
  type: "memory";

  /** Whether this memory is active */
  enabled: boolean;

  /** Visibility scope */
  visibility: MemoryVisibility;

  /** Importance level */
  importance: MemoryImportance;

  /** Memory content (plain text) */
  content: string;
}

/**
 * Memory patch event (for disabling or changing properties)
 * Content cannot be modified, only enabled/visibility/importance
 */
export interface MemoryPatch extends BaseMemoryEvent {
  type: "patch";

  /** Target memory ID */
  targetId: string;

  /** New enabled state (optional) */
  enabled?: boolean;

  /** New visibility (optional) */
  visibility?: MemoryVisibility;

  /** New importance (optional) */
  importance?: MemoryImportance;
}

/**
 * Union type for all memory log events
 */
export type MemoryLogEvent = MemoryEntry | MemoryPatch;

/**
 * Computed memory state after applying all patches
 */
export interface ResolvedMemory {
  id: string;
  enabled: boolean;
  visibility: MemoryVisibility;
  importance: MemoryImportance;
  content: string;
  createdAt: string;
  lastModifiedAt: string;
}

/**
 * Agent workspace note search result
 */
/** Statistics for a single memory category (public or private) */
export interface MemoryStatCategory {
  total: number;
  enabled: number;
  disabled: number;
  highImportance: number;
  normalImportance: number;
}

/** Complete memory statistics for a workspace */
export interface MemoryStats {
  public: MemoryStatCategory;
  private: MemoryStatCategory | null;
  summary: {
    totalMemories: number;
    totalEnabled: number;
    totalDisabled: number;
    totalHighImportance: number;
    totalNormalImportance: number;
  };
}

export interface AgentNoteSearchResult {
  filePath: string;
  matchedLines: Array<{
    lineNumber: number;
    content: string;
  }>;
}
