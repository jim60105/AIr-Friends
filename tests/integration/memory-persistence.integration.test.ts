// tests/integration/memory-persistence.integration.test.ts

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

// Use temp directory for integration tests
const TEST_DIR = await Deno.makeTempDir({
  prefix: "ai-friend-test-",
});

Deno.test({
  name: "Integration: Memory file can be written and read",
  async fn() {
    const memoryPath = join(TEST_DIR, "memory");
    await Deno.mkdir(memoryPath, { recursive: true });

    const memoryFile = join(memoryPath, "memory.public.jsonl");

    // Write memory entry
    const entry = {
      type: "memory",
      id: "mem_1",
      ts: new Date().toISOString(),
      enabled: true,
      visibility: "public",
      importance: "high",
      content: "User prefers dark mode",
    };

    await Deno.writeTextFile(memoryFile, JSON.stringify(entry) + "\n");

    // Read memory entry
    const content = await Deno.readTextFile(memoryFile);
    const lines = content.trim().split("\n");

    assertEquals(lines.length, 1);
    const parsedEntry = JSON.parse(lines[0]);
    assertEquals(parsedEntry.content, "User prefers dark mode");
    assertEquals(parsedEntry.visibility, "public");
    assertEquals(parsedEntry.importance, "high");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: Multiple memory entries can be appended",
  async fn() {
    const memoryPath = join(TEST_DIR, "memory-multi");
    await Deno.mkdir(memoryPath, { recursive: true });

    const memoryFile = join(memoryPath, "memory.public.jsonl");

    // Write multiple entries
    const entries = [
      {
        type: "memory",
        id: "mem_1",
        ts: new Date().toISOString(),
        enabled: true,
        visibility: "public",
        importance: "normal",
        content: "User likes TypeScript programming",
      },
      {
        type: "memory",
        id: "mem_2",
        ts: new Date().toISOString(),
        enabled: true,
        visibility: "public",
        importance: "normal",
        content: "User dislikes Python",
      },
      {
        type: "memory",
        id: "mem_3",
        ts: new Date().toISOString(),
        enabled: true,
        visibility: "public",
        importance: "high",
        content: "User enjoys playing chess",
      },
    ];

    for (const entry of entries) {
      await Deno.writeTextFile(
        memoryFile,
        JSON.stringify(entry) + "\n",
        { append: true },
      );
    }

    // Read all entries
    const content = await Deno.readTextFile(memoryFile);
    const lines = content.trim().split("\n");

    assertEquals(lines.length, 3);

    const parsedEntries = lines.map((line) => JSON.parse(line));
    assert(parsedEntries[0].content.includes("TypeScript"));
    assert(parsedEntries[1].content.includes("Python"));
    assert(parsedEntries[2].content.includes("chess"));
    assertEquals(parsedEntries[2].importance, "high");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Integration: Memory patch events can be appended",
  async fn() {
    const memoryPath = join(TEST_DIR, "memory-patch");
    await Deno.mkdir(memoryPath, { recursive: true });

    const memoryFile = join(memoryPath, "memory.public.jsonl");

    // Write original memory
    const memoryEntry = {
      type: "memory",
      id: "mem_123",
      ts: new Date().toISOString(),
      enabled: true,
      visibility: "public",
      importance: "normal",
      content: "Original content",
    };

    await Deno.writeTextFile(memoryFile, JSON.stringify(memoryEntry) + "\n");

    // Write patch to disable it
    const patchEntry = {
      type: "patch",
      target_id: "mem_123",
      ts: new Date().toISOString(),
      changes: {
        enabled: false,
      },
    };

    await Deno.writeTextFile(
      memoryFile,
      JSON.stringify(patchEntry) + "\n",
      { append: true },
    );

    // Verify both entries exist
    const content = await Deno.readTextFile(memoryFile);
    const lines = content.trim().split("\n");

    assertEquals(lines.length, 2);

    const entries = lines.map((line) => JSON.parse(line));
    assertEquals(entries[0].type, "memory");
    assertEquals(entries[1].type, "patch");
    assertEquals(entries[1].target_id, "mem_123");
    assertEquals(entries[1].changes.enabled, false);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Clean up test directory after all tests
Deno.test({
  name: "Cleanup: Remove test directory",
  async fn() {
    try {
      await Deno.remove(TEST_DIR, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  },
});
