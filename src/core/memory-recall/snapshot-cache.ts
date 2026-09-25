// src/core/memory-recall/snapshot-cache.ts

import { indexMemory } from "./indexed-memory.ts";
import type { MemoryTokenizer } from "./tokenizer.ts";
import type { IndexedMemory } from "./types.ts";
import type { ResolvedMemory } from "../../types/memory.ts";

/** Identity of a memory file: its size and modification time. */
interface Stamp {
  size: number;
  mtimeMs: number;
}

/** One cached file: the stamp its documents were built for and the documents. */
interface SnapshotEntry {
  /** `null` when the file did not exist. */
  stamp: Stamp | null;
  docs: IndexedMemory[];
}

/** A slot holds one file's rebuild, whether it is still running or done. */
interface CacheSlot {
  /** Stamp the rebuild was requested for; the freshness check compares to it. */
  stamp: Stamp | null;
  entry: Promise<SnapshotEntry>;
}

/** Reads and resolves the memories of one file; called only on a rebuild. */
export type DocumentLoader = () => Promise<ResolvedMemory[]>;

/**
 * In-process snapshot of indexed memories per JSONL file (Memory Recall v2
 * design, D4 and §3).
 *
 * Every search stats the relevant files and reuses a snapshot only while the
 * file's size and modification time are unchanged, so any write path (skill,
 * dashboard, maintenance) is visible to the next search without write hooks.
 * JSONL is append-only, so a save or a patch always changes the size.
 *
 * Concurrent searches for the same stale file share one rebuild. A search that
 * starts after a write always stats the new stamp and therefore never joins a
 * rebuild that began before the write.
 */
export class MemorySnapshotCache {
  private readonly slots = new Map<string, CacheSlot>();

  constructor(private readonly tokenizer: MemoryTokenizer) {}

  /**
   * Indexed documents of `path`, rebuilding them when the file changed,
   * appeared or disappeared since its snapshot was taken. A file that does not
   * exist yields no documents.
   */
  async getDocuments(path: string, load: DocumentLoader): Promise<readonly IndexedMemory[]> {
    const stamp = await statStamp(path);
    const slot = this.slots.get(path);
    if (slot !== undefined && sameStamp(slot.stamp, stamp)) {
      return (await this.awaitSlot(path, slot)).docs;
    }

    const fresh: CacheSlot = { stamp, entry: this.rebuild(load, stamp) };
    this.slots.set(path, fresh);
    return (await this.awaitSlot(path, fresh)).docs;
  }

  /**
   * Awaits a rebuild and drops its slot when it failed, so the next search
   * retries the load instead of replaying the error forever.
   */
  private async awaitSlot(path: string, slot: CacheSlot): Promise<SnapshotEntry> {
    try {
      return await slot.entry;
    } catch (error) {
      if (this.slots.get(path) === slot) this.slots.delete(path);
      throw error;
    }
  }

  /**
   * The stamp is read before the load on purpose: when a write lands while the
   * load runs, the stored stamp stays behind the file, so the next search
   * rebuilds instead of treating documents read before the write as fresh.
   *
   * Reuse therefore rests on size and mtime changing on every write. Every
   * `MemoryStore` writer appends to the JSONL file (`addMemory`, `patchMemory`,
   * `addChannelMemory`, `patchChannelMemory`), and memory maintenance acts
   * through patches, so a size-preserving rewrite does not exist today. Any
   * future compaction must invalidate this cache.
   */
  private async rebuild(load: DocumentLoader, stamp: Stamp | null): Promise<SnapshotEntry> {
    const memories = await load();
    return { stamp, docs: memories.map((memory) => indexMemory(memory, this.tokenizer)) };
  }
}

/** Size and modification time of `path`, or `null` when it does not exist. */
async function statStamp(path: string): Promise<Stamp | null> {
  try {
    const stat = await Deno.stat(path);
    return { size: stat.size, mtimeMs: stat.mtime?.getTime() ?? 0 };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function sameStamp(a: Stamp | null, b: Stamp | null): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}
