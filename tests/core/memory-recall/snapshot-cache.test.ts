// tests/core/memory-recall/snapshot-cache.test.ts

import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { MemorySnapshotCache } from "@core/memory-recall/snapshot-cache.ts";
import type { DocumentLoader } from "@core/memory-recall/snapshot-cache.ts";
import { MemoryTokenizer } from "@core/memory-recall/tokenizer.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { Platform } from "../../../src/types/events.ts";
import type { MemoryEntry, MemoryLogEvent, MemoryPatch } from "../../../src/types/memory.ts";
import type { WorkspaceInfo } from "../../../src/types/workspace.ts";

const TS = "2026-09-25T00:00:00.000Z";

let sequence = 0;

function memoryEvent(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  sequence++;
  return {
    type: "memory",
    id: `mem-${sequence}`,
    ts: TS,
    enabled: true,
    visibility: "public",
    importance: "normal",
    content: "keyboard",
    tier: "archive",
    category: "fact",
    scope: "user",
    decay: 0,
    relatedTo: [],
    supersedes: [],
    ...overrides,
  };
}

function patchEvent(targetId: string, patch: Partial<MemoryPatch> = {}): MemoryPatch {
  return { type: "patch", id: `patch-${targetId}`, ts: TS, targetId, ...patch };
}

/** Writes JSONL memory events, replacing the file unless `append` is set. */
async function writeMemoryLog(
  path: string,
  events: MemoryLogEvent[],
  append = false,
): Promise<void> {
  const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await Deno.writeTextFile(path, body, { append });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface CacheContext {
  cache: MemorySnapshotCache;
  /** Absolute path of the user's public memory file. */
  path: string;
  /** Loader over the real store, counting how often the file is read. */
  load: DocumentLoader;
  reads: () => number;
}

async function withCache(fn: (context: CacheContext) => Promise<void>): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const store = new MemoryStore(manager, {});
    const workspace: WorkspaceInfo = await manager.getOrCreateWorkspace({
      platform: "discord" as Platform,
      channelId: "channel123",
      userId: "user456",
      messageId: "msg789",
      isDm: true,
      guildId: "guild001",
      content: "test message",
      timestamp: new Date(TS),
    });
    const path = store.getMemoryFilePathFor(workspace, "public");
    let reads = 0;
    const load: DocumentLoader = () => {
      reads++;
      return store.loadAllMemories(workspace, "public");
    };
    await fn({
      cache: new MemorySnapshotCache(new MemoryTokenizer()),
      path,
      load,
      reads: () => reads,
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("MemorySnapshotCache - indexes the memories of an existing file", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a", content: "keyboard" })]);

    const docs = await cache.getDocuments(path, load);

    assertEquals(docs.length, 1);
    assertEquals(docs[0].memory.id, "a");
  });
});

Deno.test("MemorySnapshotCache - a file that does not exist yields no documents", async () => {
  await withCache(async ({ cache, path, load }) => {
    assertEquals(await cache.getDocuments(path, load), []);
  });
});

Deno.test("MemorySnapshotCache - an appended memory is visible to the next read", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);
    assertEquals((await cache.getDocuments(path, load)).length, 1);

    await writeMemoryLog(path, [memoryEvent({ id: "b" })], true);

    const docs = await cache.getDocuments(path, load);
    assertEquals(docs.length, 2);
    assertEquals(docs.map((doc) => doc.memory.id), ["a", "b"]);
  });
});

Deno.test("MemorySnapshotCache - a disabling patch is resolved on the next read", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);
    assertEquals((await cache.getDocuments(path, load))[0].memory.enabled, true);

    await writeMemoryLog(path, [patchEvent("a", { enabled: false })], true);

    const docs = await cache.getDocuments(path, load);
    assertEquals(docs.length, 1);
    assertEquals(docs[0].memory.enabled, false);
  });
});

Deno.test("MemorySnapshotCache - an unchanged file is not read again", async () => {
  await withCache(async ({ cache, path, load, reads }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);

    await cache.getDocuments(path, load);
    await cache.getDocuments(path, load);
    await cache.getDocuments(path, load);

    assertEquals(reads(), 1);
  });
});

Deno.test("MemorySnapshotCache - a file that appears is indexed", async () => {
  await withCache(async ({ cache, path, load }) => {
    assertEquals(await cache.getDocuments(path, load), []);

    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);

    const docs = await cache.getDocuments(path, load);
    assertEquals(docs.length, 1);
    assertEquals(docs[0].memory.id, "a");
  });
});

Deno.test("MemorySnapshotCache - a file that disappears yields no documents again", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);
    assertEquals((await cache.getDocuments(path, load)).length, 1);

    await Deno.remove(path);

    assertEquals(await cache.getDocuments(path, load), []);
  });
});

Deno.test("MemorySnapshotCache - concurrent reads share one rebuild", async () => {
  await withCache(async ({ cache, path, load, reads }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);

    const [first, second] = await Promise.all([
      cache.getDocuments(path, load),
      cache.getDocuments(path, load),
    ]);

    assertEquals(reads(), 1);
    assertEquals(first, second);
    assertEquals(first.length, 1);
  });
});

Deno.test("MemorySnapshotCache - a read that starts after a write never joins an earlier rebuild", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);
    const gate = deferred();
    const read = deferred();
    let parked = true;
    const slowLoad: DocumentLoader = async () => {
      const docs = await load();
      if (parked) {
        parked = false;
        read.resolve();
        await gate.promise;
      }
      return docs;
    };

    // The first read captures the file, then holds its documents.
    const stale = cache.getDocuments(path, slowLoad);
    await read.promise;
    await writeMemoryLog(path, [memoryEvent({ id: "b" })], true);

    // A read that starts after the write must not be served the parked snapshot.
    const fresh = await cache.getDocuments(path, slowLoad);
    gate.resolve();
    const staleDocs = await stale;

    assertEquals(fresh.length, 2);
    assertEquals(staleDocs.length, 1);
  });
});

Deno.test("MemorySnapshotCache - a failed rebuild is not cached", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);
    let attempts = 0;
    const flaky: DocumentLoader = () => {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error("unreadable"));
      return load();
    };

    await assertRejects(() => cache.getDocuments(path, flaky), Error, "unreadable");

    // The next search retries the load instead of replaying the error.
    const docs = await cache.getDocuments(path, flaky);
    assertEquals(docs.length, 1);
    assertEquals(attempts, 2);
  });
});

Deno.test("MemorySnapshotCache - a stat failure other than a missing file propagates", async () => {
  await withCache(async ({ cache, path, load }) => {
    await writeMemoryLog(path, [memoryEvent({ id: "a" })]);

    // The path of a file is used as a directory, which is not a missing file.
    await assertRejects(() => cache.getDocuments(`${path}/child`, load));
  });
});

/**
 * A temp agent workspace with its default files, plus a `notes/` and a
 * `journal/` directory for the test to fill.
 */
async function withNoteWorkspace(
  fn: (context: { root: string; tempDir: string; cache: MemorySnapshotCache }) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const root = `${tempDir}/agent-workspace`;
    await Deno.mkdir(`${root}/notes`, { recursive: true });
    await Deno.mkdir(`${root}/journal`, { recursive: true });
    await Deno.writeTextFile(`${root}/README.md`, "# Agent Workspace\n");
    await Deno.writeTextFile(`${root}/notes/_index.md`, "# Notes Index\n");
    await fn({ root, tempDir, cache: new MemorySnapshotCache(new MemoryTokenizer()) });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

function notePaths(notes: Array<{ path: string }>): string[] {
  return notes.map((note) => note.path);
}

Deno.test("MemorySnapshotCache - walks every .md file except the index and root README", async () => {
  await withNoteWorkspace(async ({ root, cache }) => {
    await Deno.writeTextFile(`${root}/notes/topic.md`, "# Topic\n\nkeyboard\n");
    await Deno.writeTextFile(`${root}/notes/README.md`, "# Nested Readme\n\nkeyboard\n");
    await Deno.writeTextFile(`${root}/journal/2026-09-20.md`, "# Journal\n\nkeyboard\n");
    await Deno.writeTextFile(`${root}/notes/ignored.txt`, "keyboard\n");

    const notes = await cache.getNotes(root);

    assertEquals(notePaths(notes), [
      `${root}/journal/2026-09-20.md`,
      `${root}/notes/README.md`,
      `${root}/notes/topic.md`,
    ]);
    assertEquals(notes[2].title, "Topic");
    assert(notes[2].fileTokens > 0);
    assertEquals(notes[2].modifiedAt.endsWith("Z"), true);
  });
});

Deno.test("MemorySnapshotCache - a symlinked file or directory is never read", async () => {
  await withNoteWorkspace(async ({ root, tempDir, cache }) => {
    await Deno.writeTextFile(`${tempDir}/memory.private.jsonl`, "leaked keyboard secret\n");
    await Deno.mkdir(`${tempDir}/outside`);
    await Deno.writeTextFile(`${tempDir}/outside/linked.md`, "leaked keyboard secret\n");
    await Deno.symlink(`${tempDir}/memory.private.jsonl`, `${root}/notes/leak.md`);
    await Deno.symlink(`${tempDir}/outside`, `${root}/notes/linked-dir`);
    await Deno.writeTextFile(`${root}/notes/real.md`, "# Real\n\nkeyboard\n");

    const notes = await cache.getNotes(root);

    assertEquals(notePaths(notes), [`${root}/notes/real.md`]);
    for (const note of notes) {
      for (const chunk of note.chunks) {
        assertEquals(chunk.text.includes("secret"), false);
      }
    }
  });
});

Deno.test("MemorySnapshotCache - an unchanged note is reused and an edited one is re-chunked", async () => {
  await withNoteWorkspace(async ({ root, cache }) => {
    const path = `${root}/notes/topic.md`;
    await Deno.writeTextFile(path, "# Topic\n\nfirst body\n");

    const first = await cache.getNotes(root);
    const second = await cache.getNotes(root);

    assertStrictEquals(first[0], second[0]);
    assertEquals(first[0].chunks[0].text, "# Topic\n\nfirst body");

    await Deno.writeTextFile(path, "# Topic\n\nsecond body\n");

    const third = await cache.getNotes(root);
    assertEquals(third[0].chunks[0].text, "# Topic\n\nsecond body");
  });
});

Deno.test("MemorySnapshotCache - a missing workspace yields no notes", async () => {
  await withNoteWorkspace(async ({ tempDir, cache }) => {
    assertEquals(await cache.getNotes(`${tempDir}/absent`), []);
  });
});

Deno.test("MemorySnapshotCache - an unreadable note is skipped, not thrown", async () => {
  await withNoteWorkspace(async ({ root, cache }) => {
    const path = `${root}/notes/topic.md`;
    await Deno.writeTextFile(path, "# Topic\n\nkeyboard\n");
    assertEquals((await cache.getNotes(root)).length, 1);

    // The path is now a directory, so its content can no longer be read.
    await Deno.remove(path);
    await Deno.mkdir(path);

    assertEquals(await cache.getNotes(root), []);
  });
});

Deno.test("MemorySnapshotCache - a hard-linked note is not read", async () => {
  await withNoteWorkspace(async ({ root, tempDir, cache }) => {
    // A hard link is not a symbolic link: `isSymlink` and `realPath` both accept
    // it, so the link count is what keeps another file's content out.
    const privatePath = `${tempDir}/memory.private.jsonl`;
    await Deno.writeTextFile(privatePath, "leaked keyboard secret\n");
    await Deno.link(privatePath, `${root}/notes/leak.md`);
    await Deno.writeTextFile(`${root}/notes/real.md`, "# Real\n\nkeyboard\n");

    const notes = await cache.getNotes(root);

    assertEquals(notePaths(notes), [`${root}/notes/real.md`]);
  });
});

Deno.test("MemorySnapshotCache - a symlinked workspace root is walked at its given path", async () => {
  await withNoteWorkspace(async ({ root, tempDir, cache }) => {
    await Deno.writeTextFile(`${root}/notes/topic.md`, "# Topic\n\nkeyboard\n");
    const link = `${tempDir}/linked-workspace`;
    await Deno.symlink(root, link);

    const notes = await cache.getNotes(link);

    assertEquals(notePaths(notes), [`${link}/notes/topic.md`]);
  });
});
