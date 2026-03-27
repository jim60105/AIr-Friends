// tests/core/memory-index.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { MemoryIndex } from "../../src/core/memory-index.ts";
import { MemoryError } from "../../src/types/errors.ts";
import { MemoryIndexEntry } from "../../src/types/memory.ts";

function makeEntry(overrides: Partial<MemoryIndexEntry> = {}): MemoryIndexEntry {
  return {
    id: "mem_001",
    tier: "core",
    category: "fact",
    scope: "user",
    visibility: "public",
    enabled: true,
    file: "public",
    lineNumber: 1,
    ...overrides,
  };
}

function makeMemoryLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "memory",
    id: "mem_001",
    ts: "2024-01-01T00:00:00Z",
    enabled: true,
    visibility: "public",
    importance: "normal",
    content: "test",
    ...overrides,
  });
}

function makePatchLine(targetId: string, changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "patch",
    id: "patch_001",
    targetId,
    ts: "2024-01-02T00:00:00Z",
    ...changes,
  });
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// --- rebuild() ---

Deno.test("MemoryIndex - rebuild creates index from JSONL files", async () => {
  await withTempDir(async (dir) => {
    const memFile = `${dir}/memory.public.jsonl`;
    await Deno.writeTextFile(
      memFile,
      [
        makeMemoryLine({ id: "mem_001", tier: "core", category: "fact" }),
        makeMemoryLine({ id: "mem_002", tier: "working", category: "preference" }),
      ].join("\n") + "\n",
    );

    const index = new MemoryIndex(dir);
    const count = await index.rebuild([{ path: memFile, file: "public" }]);

    assertEquals(count, 2);
    assertEquals(index.size, 2);
    assertEquals(index.lookupById("mem_001")?.tier, "core");
    assertEquals(index.lookupById("mem_002")?.category, "preference");
  });
});

Deno.test("MemoryIndex - rebuild handles backward compat (no tier → importance mapping)", async () => {
  await withTempDir(async (dir) => {
    const memFile = `${dir}/memory.public.jsonl`;
    // No tier/category fields — legacy format
    await Deno.writeTextFile(
      memFile,
      [
        makeMemoryLine({ id: "mem_high", importance: "high" }),
        makeMemoryLine({ id: "mem_normal", importance: "normal" }),
      ].join("\n") + "\n",
    );

    const index = new MemoryIndex(dir);
    await index.rebuild([{ path: memFile, file: "public" }]);

    assertEquals(index.lookupById("mem_high")?.tier, "core");
    assertEquals(index.lookupById("mem_normal")?.tier, "archive");
    assertEquals(index.lookupById("mem_high")?.category, "fact");
  });
});

Deno.test("MemoryIndex - rebuild skips missing files", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    const count = await index.rebuild([{ path: `${dir}/nonexistent.jsonl`, file: "public" }]);
    assertEquals(count, 0);
  });
});

Deno.test("MemoryIndex - rebuild applies patches", async () => {
  await withTempDir(async (dir) => {
    const memFile = `${dir}/memory.public.jsonl`;
    await Deno.writeTextFile(
      memFile,
      [
        makeMemoryLine({ id: "mem_001", tier: "core" }),
        makePatchLine("mem_001", { enabled: false, tier: "archive" }),
      ].join("\n") + "\n",
    );

    const index = new MemoryIndex(dir);
    await index.rebuild([{ path: memFile, file: "public" }]);

    const entry = index.lookupById("mem_001");
    assertEquals(entry?.enabled, false);
    assertEquals(entry?.tier, "archive");
  });
});

Deno.test("MemoryIndex - rebuild writes index file", async () => {
  await withTempDir(async (dir) => {
    const memFile = `${dir}/memory.public.jsonl`;
    await Deno.writeTextFile(memFile, makeMemoryLine({ id: "mem_001" }) + "\n");

    const index = new MemoryIndex(dir);
    await index.rebuild([{ path: memFile, file: "public" }]);

    const content = await Deno.readTextFile(index.indexFilePath);
    const parsed = JSON.parse(content.trim());
    assertEquals(parsed.id, "mem_001");
  });
});

// --- load() ---

Deno.test("MemoryIndex - load reads existing index file", async () => {
  await withTempDir(async (dir) => {
    const entry = makeEntry({ id: "mem_001" });
    await Deno.writeTextFile(`${dir}/memory.index.jsonl`, JSON.stringify(entry) + "\n");

    const index = new MemoryIndex(dir);
    const map = await index.load();

    assertEquals(map.size, 1);
    assertEquals(index.lookupById("mem_001")?.tier, "core");
  });
});

Deno.test("MemoryIndex - load returns empty map for missing file", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    const map = await index.load();
    assertEquals(map.size, 0);
    assertEquals(index.size, 0);
  });
});

Deno.test("MemoryIndex - load uses last-write-wins for duplicate IDs", async () => {
  await withTempDir(async (dir) => {
    const lines = [
      JSON.stringify(makeEntry({ id: "mem_001", tier: "core" })),
      JSON.stringify(makeEntry({ id: "mem_001", tier: "archive" })),
    ].join("\n") + "\n";
    await Deno.writeTextFile(`${dir}/memory.index.jsonl`, lines);

    const index = new MemoryIndex(dir);
    await index.load();

    assertEquals(index.lookupById("mem_001")?.tier, "archive");
    assertEquals(index.size, 1);
  });
});

// --- appendEntry() ---

Deno.test("MemoryIndex - appendEntry adds to map and file", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();

    const entry = makeEntry({ id: "mem_new" });
    await index.appendEntry(entry);

    assertEquals(index.lookupById("mem_new")?.id, "mem_new");
    assertEquals(index.size, 1);

    // Verify persisted to file
    const content = await Deno.readTextFile(index.indexFilePath);
    const parsed = JSON.parse(content.trim());
    assertEquals(parsed.id, "mem_new");
  });
});

// --- updateEntry() ---

Deno.test("MemoryIndex - updateEntry updates map and appends to file", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();
    await index.appendEntry(makeEntry({ id: "mem_001", enabled: true, tier: "core" }));

    await index.updateEntry("mem_001", { enabled: false, tier: "archive" });

    assertEquals(index.lookupById("mem_001")?.enabled, false);
    assertEquals(index.lookupById("mem_001")?.tier, "archive");

    // File should have 2 lines (append + update)
    const content = await Deno.readTextFile(index.indexFilePath);
    const lines = content.split("\n").filter((l) => l.trim());
    assertEquals(lines.length, 2);
  });
});

Deno.test("MemoryIndex - updateEntry throws for missing ID", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();

    await assertRejects(
      () => index.updateEntry("nonexistent", { enabled: false }),
      MemoryError,
    );
  });
});

// --- lookupById() ---

Deno.test("MemoryIndex - lookupById returns entry for existing ID", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();
    await index.appendEntry(makeEntry({ id: "mem_001" }));

    const result = index.lookupById("mem_001");
    assertEquals(result?.id, "mem_001");
  });
});

Deno.test("MemoryIndex - lookupById returns undefined for missing ID", () => {
  const index = new MemoryIndex("/tmp/nonexistent");
  assertEquals(index.lookupById("missing"), undefined);
});

// --- getByTier() ---

Deno.test("MemoryIndex - getByTier filters correctly", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();
    await index.appendEntry(makeEntry({ id: "m1", tier: "core" }));
    await index.appendEntry(makeEntry({ id: "m2", tier: "archive" }));
    await index.appendEntry(makeEntry({ id: "m3", tier: "core" }));

    assertEquals(index.getByTier("core").length, 2);
    assertEquals(index.getByTier("archive").length, 1);
    assertEquals(index.getByTier("working").length, 0);
  });
});

// --- getByCategory() ---

Deno.test("MemoryIndex - getByCategory filters correctly", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();
    await index.appendEntry(makeEntry({ id: "m1", category: "fact" }));
    await index.appendEntry(makeEntry({ id: "m2", category: "preference" }));

    assertEquals(index.getByCategory("fact").length, 1);
    assertEquals(index.getByCategory("preference").length, 1);
    assertEquals(index.getByCategory("episode").length, 0);
  });
});

// --- getEnabled() ---

Deno.test("MemoryIndex - getEnabled returns only enabled entries", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    await index.load();
    await index.appendEntry(makeEntry({ id: "m1", enabled: true }));
    await index.appendEntry(makeEntry({ id: "m2", enabled: false }));
    await index.appendEntry(makeEntry({ id: "m3", enabled: true }));

    const enabled = index.getEnabled();
    assertEquals(enabled.length, 2);
    assertEquals(enabled.every((e) => e.enabled), true);
  });
});

// --- size ---

Deno.test("MemoryIndex - size reflects current entry count", async () => {
  await withTempDir(async (dir) => {
    const index = new MemoryIndex(dir);
    assertEquals(index.size, 0);

    await index.load();
    assertEquals(index.size, 0);

    await index.appendEntry(makeEntry({ id: "m1" }));
    assertEquals(index.size, 1);

    await index.appendEntry(makeEntry({ id: "m2" }));
    assertEquals(index.size, 2);
  });
});
