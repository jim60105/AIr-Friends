// src/core/memory-recall/snapshot-cache.ts

import { join, relative, resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { validatePathWithinBoundary } from "@utils/path-validator.ts";
import { estimateTokens } from "@utils/token-counter.ts";
import { indexMemory, lexicalIndex } from "./indexed-memory.ts";
import { parseNote } from "./note-chunker.ts";
import type { MemoryTokenizer } from "./tokenizer.ts";
import type { IndexedMemory, IndexedNoteFile } from "./types.ts";
import type { ResolvedMemory } from "../../types/memory.ts";

const logger = createLogger("MemorySnapshotCache");

/** Identity of a file: its size and modification time. */
interface Stamp {
  size: number;
  mtimeMs: number;
}

/** One cached memory file: the stamp its documents were built for and the documents. */
interface SnapshotEntry {
  /** `null` when the file did not exist. */
  stamp: Stamp | null;
  docs: IndexedMemory[];
}

/** One cached note file: the stamp its chunks were built for and the note. */
interface NoteSnapshotEntry {
  /** `null` when the file did not exist or was rejected. */
  stamp: Stamp | null;
  note: IndexedNoteFile | null;
}

/** A slot holds one file's rebuild, whether it is still running or done. */
interface CacheSlot {
  /** Stamp the rebuild was requested for; the freshness check compares to it. */
  stamp: Stamp | null;
  entry: Promise<SnapshotEntry>;
}

/** A slot holds one note file's rebuild, whether it is still running or done. */
interface NoteCacheSlot {
  stamp: Stamp | null;
  entry: Promise<NoteSnapshotEntry>;
}

/** Reads and resolves the memories of one file; called only on a rebuild. */
export type DocumentLoader = () => Promise<ResolvedMemory[]>;

/**
 * In-process snapshot of indexed memories per JSONL file and of indexed note
 * files (Memory Recall v2 design, D4 and §3, §6).
 *
 * Every search stats the relevant files and reuses a snapshot only while the
 * file's size and modification time are unchanged, so any write path (skill,
 * dashboard, maintenance, the agent itself) is visible to the next search
 * without write hooks. JSONL is append-only, so a save or a patch always
 * changes the size; a note edit changes size or modification time.
 *
 * Concurrent searches for the same stale file share one rebuild. A search that
 * starts after a write always stats the new stamp and therefore never joins a
 * rebuild that began before the write.
 */
export class MemorySnapshotCache {
  private readonly slots = new Map<string, CacheSlot>();
  private readonly noteSlots = new Map<string, NoteCacheSlot>();

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
   * Indexed notes of an agent workspace, walking the tree on every call and
   * re-chunking only files whose size or modification time changed (Memory
   * Recall v2 design, §6). The walk skips the root `README.md` and
   * `notes/_index.md`, never follows a symbolic link, and never reads an entry
   * whose real path leaves the workspace.
   *
   * Both slot maps never evict: they are bounded by the number of files of the
   * workspaces this process has searched, and the process restarts on deploy.
   */
  async getNotes(agentWorkspacePath: string): Promise<IndexedNoteFile[]> {
    const root = resolve(agentWorkspacePath);
    let boundary: string;
    try {
      boundary = await Deno.realPath(root);
    } catch (error) {
      logger.debug("Agent workspace is not readable", {
        path: root,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const paths: string[] = [];
    await this.collectNotePaths(root, root, boundary, paths);

    const notes: IndexedNoteFile[] = [];
    for (const path of paths) {
      const note = await this.getNote(path, boundary);
      if (note !== null) notes.push(note);
    }
    return notes;
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

  private async awaitNoteSlot(path: string, slot: NoteCacheSlot): Promise<NoteSnapshotEntry> {
    try {
      return await slot.entry;
    } catch (error) {
      if (this.noteSlots.get(path) === slot) this.noteSlots.delete(path);
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

  /** Collects the note paths of one directory, recursively and in name order. */
  private async collectNotePaths(
    dir: string,
    root: string,
    boundary: string,
    out: string[],
  ): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) entries.push(entry);
    } catch (error) {
      logger.warn("Failed to read an agent workspace directory", {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    for (const entry of entries) {
      // A link is never followed: the workspace is agent-writable and there is
      // no legitimate need for one (Memory Recall v2 design, D12).
      if (entry.isSymlink) continue;
      const path = join(dir, entry.name);
      if (!await this.resolvesInside(path, boundary)) continue;
      if (entry.isDirectory) {
        await this.collectNotePaths(path, root, boundary, out);
        continue;
      }
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const relativePath = relative(root, path);
      if (relativePath === "README.md" || relativePath === "notes/_index.md") continue;
      out.push(path);
    }
  }

  /** Indexed note of one file, rebuilding it when the file changed. */
  private async getNote(path: string, boundary: string): Promise<IndexedNoteFile | null> {
    let stamp: Stamp | null;
    try {
      stamp = await statStamp(path);
    } catch (error) {
      // A note failure never fails the search; an unreadable file is skipped.
      logger.warn("Failed to stat an agent workspace note", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    const slot = this.noteSlots.get(path);
    if (slot !== undefined && sameStamp(slot.stamp, stamp)) {
      return (await this.awaitNoteSlot(path, slot)).note;
    }

    const fresh: NoteCacheSlot = { stamp, entry: this.rebuildNote(path, stamp, boundary) };
    this.noteSlots.set(path, fresh);
    return (await this.awaitNoteSlot(path, fresh)).note;
  }

  /**
   * Containment is re-checked immediately before the read, because the path
   * could have been swapped for a link escaping the workspace since the walk.
   * A link planted after the read can only serve the content that was already
   * validated, and any stamp change forces a fresh check.
   */
  private async rebuildNote(
    path: string,
    stamp: Stamp | null,
    boundary: string,
  ): Promise<NoteSnapshotEntry> {
    if (stamp === null) return { stamp, note: null };
    try {
      if (!await this.resolvesInside(path, boundary)) return { stamp, note: null };
      const content = await Deno.readTextFile(path);
      const parsed = parseNote(content, path);
      return {
        stamp,
        note: {
          path,
          title: parsed.title,
          fileTokens: estimateTokens(content),
          modifiedAt: new Date(stamp.mtimeMs).toISOString(),
          chunks: parsed.chunks.map((chunk) => {
            const index = lexicalIndex(chunk.text, this.tokenizer);
            return {
              headingPath: chunk.headingPath,
              lineStart: chunk.lineStart,
              lineEnd: chunk.lineEnd,
              text: chunk.text,
              ...index,
            };
          }),
        },
      };
    } catch (error) {
      logger.warn("Failed to index an agent workspace note", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return { stamp, note: null };
    }
  }

  /** Whether `path` resolves, by real path, inside the workspace boundary. */
  private async resolvesInside(path: string, boundary: string): Promise<boolean> {
    try {
      validatePathWithinBoundary(await Deno.realPath(path), boundary);
      return true;
    } catch (error) {
      logger.debug("Skipping an agent workspace entry outside the workspace", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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
