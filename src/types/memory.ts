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
 * Memory storage tier (determines context loading behavior)
 */
export type MemoryTier = "core" | "working" | "archive";

/**
 * Memory content category (enables structured retrieval)
 */
export type MemoryCategory = "fact" | "preference" | "episode" | "summary" | "relationship";

/**
 * Memory scope (user-private or channel-shared)
 */
export type MemoryScope = "user" | "channel";

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

  /** Importance level (legacy, retained for backward compatibility) */
  importance: MemoryImportance;

  /** Memory content (plain text) */
  content: string;

  /** Storage tier: core (always loaded), working (recent N), archive (search only) */
  tier?: MemoryTier;

  /** Content category for structured retrieval */
  category?: MemoryCategory;

  /** Memory scope: user (per-user) or channel (per-channel, shared) */
  scope?: MemoryScope;

  /** Importance-weighted temporal relevance (0.0–1.0). Core=1.0, working=0.8, archive=0.5 */
  decay?: number;

  /** IDs of semantically related memories (set at creation time) */
  relatedTo?: string[];

  /** IDs of memories this entry supersedes (e.g., maintenance summary replacing old memories) */
  supersedes?: string[];
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

  /** New storage tier (optional) */
  tier?: MemoryTier;

  /** New content category (optional) */
  category?: MemoryCategory;

  /** New decay value (optional, ignored for core tier) */
  decay?: number;

  /** IDs of semantically related memories */
  relatedTo?: string[];

  /** IDs of memories this patch's target supersedes (maintenance lineage) */
  supersedes?: string[];
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

  /** Storage tier (defaults to "archive" for legacy entries without tier) */
  tier: MemoryTier;

  /** Content category (defaults to "fact" for legacy entries without category) */
  category: MemoryCategory;

  /** Memory scope (defaults to "user" for legacy entries without scope) */
  scope: MemoryScope;

  /** Temporal relevance decay (defaults based on tier) */
  decay: number;

  /** IDs of semantically related memories (aggregated from entry + patches) */
  relatedTo: string[];

  /** IDs of memories this memory supersedes (aggregated from entry + patches) */
  supersedes: string[];
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

/** Per-tier memory statistics */
export interface MemoryTierStats {
  core: number;
  working: number;
  archive: number;
}

/** Per-category memory statistics */
export interface MemoryCategoryStats {
  fact: number;
  preference: number;
  episode: number;
  summary: number;
  relationship: number;
}

/** Complete memory statistics for a workspace */
export interface MemoryStats {
  public: MemoryStatCategory;
  private: MemoryStatCategory | null;
  channel?: MemoryStatCategory;
  byTier: MemoryTierStats;
  byCategory: MemoryCategoryStats;
  summary: {
    totalMemories: number;
    totalEnabled: number;
    totalDisabled: number;
    totalHighImportance: number;
    totalNormalImportance: number;
  };
}

/**
 * Memory index entry for O(1) ID lookup
 */
export interface MemoryIndexEntry {
  /** Memory ID */
  id: string;
  /** Storage tier */
  tier: MemoryTier;
  /** Content category */
  category: MemoryCategory;
  /** Whether memory is enabled */
  enabled: boolean;
  /** Memory scope */
  scope: MemoryScope;
  /** Visibility level */
  visibility: MemoryVisibility;
  /** Source file: "public", "private", or "channel" */
  file: "public" | "private" | "channel";
  /** Line number in the source JSONL file (1-based) */
  lineNumber: number;
}

export interface AgentNoteSearchResult {
  filePath: string;
  matchedLines: Array<{
    lineNumber: number;
    content: string;
  }>;
}
