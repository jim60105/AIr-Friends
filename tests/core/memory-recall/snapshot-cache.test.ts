// tests/core/memory-recall/snapshot-cache.test.ts

import { assertEquals, assertRejects } from "@std/assert";
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
    const store = new MemoryStore(manager, { searchLimit: 10, maxChars: 2000 });
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
