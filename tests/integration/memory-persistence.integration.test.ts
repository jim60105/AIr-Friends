// tests/integration/memory-persistence.integration.test.ts

import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

// Use temp directory for integration tests
const TEST_DIR = await makeTempDir({
  prefix: "air-friends-test-",
});

test("Integration: Memory file can be written and read", async function () {
  const memoryPath = join(TEST_DIR, "memory");
  await fsp.mkdir(memoryPath, { recursive: true });

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

  await fsp.writeFile(memoryFile, JSON.stringify(entry) + "\n");

  // Read memory entry
  const content = await fsp.readFile(memoryFile, "utf8");
  const lines = content.trim().split("\n");

  assertEquals(lines.length, 1);
  const parsedEntry = JSON.parse(lines[0]);
  assertEquals(parsedEntry.content, "User prefers dark mode");
  assertEquals(parsedEntry.visibility, "public");
  assertEquals(parsedEntry.importance, "high");
});

test("Integration: Multiple memory entries can be appended", async function () {
  const memoryPath = join(TEST_DIR, "memory-multi");
  await fsp.mkdir(memoryPath, { recursive: true });

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
    await fsp.appendFile(memoryFile, JSON.stringify(entry) + "\n");
  }

  // Read all entries
  const content = await fsp.readFile(memoryFile, "utf8");
  const lines = content.trim().split("\n");

  assertEquals(lines.length, 3);

  const parsedEntries = lines.map((line) => JSON.parse(line));
  assert(parsedEntries[0].content.includes("TypeScript"));
  assert(parsedEntries[1].content.includes("Python"));
  assert(parsedEntries[2].content.includes("chess"));
  assertEquals(parsedEntries[2].importance, "high");
});

test("Integration: Memory patch events can be appended", async function () {
  const memoryPath = join(TEST_DIR, "memory-patch");
  await fsp.mkdir(memoryPath, { recursive: true });

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

  await fsp.writeFile(memoryFile, JSON.stringify(memoryEntry) + "\n");

  // Write patch to disable it
  const patchEntry = {
    type: "patch",
    target_id: "mem_123",
    ts: new Date().toISOString(),
    changes: {
      enabled: false,
    },
  };

  await fsp.appendFile(memoryFile, JSON.stringify(patchEntry) + "\n");

  // Verify both entries exist
  const content = await fsp.readFile(memoryFile, "utf8");
  const lines = content.trim().split("\n");

  assertEquals(lines.length, 2);

  const entries = lines.map((line) => JSON.parse(line));
  assertEquals(entries[0].type, "memory");
  assertEquals(entries[1].type, "patch");
  assertEquals(entries[1].target_id, "mem_123");
  assertEquals(entries[1].changes.enabled, false);
});

// Clean up test directory after all tests
test("Integration: relatedTo and supersedes survive write-read cycle", async function () {
  const memoryPath = join(TEST_DIR, "memory-relations");
  await fsp.mkdir(memoryPath, { recursive: true });

  const memoryFile = join(memoryPath, "memory.public.jsonl");

  // Write memory entry with supersedes
  const entry = {
    type: "memory",
    id: "mem_summary",
    ts: new Date().toISOString(),
    enabled: true,
    visibility: "public",
    importance: "high",
    content: "Summary of old memories",
    supersedes: ["mem_old1", "mem_old2"],
    relatedTo: ["mem_related1"],
  };

  await fsp.writeFile(memoryFile, JSON.stringify(entry) + "\n");

  // Write patch adding more relatedTo
  const patch = {
    type: "patch",
    id: "patch_1",
    ts: new Date().toISOString(),
    targetId: "mem_summary",
    relatedTo: ["mem_related2"],
  };

  await fsp.appendFile(memoryFile, JSON.stringify(patch) + "\n");

  // Read and verify
  const content = await fsp.readFile(memoryFile, "utf8");
  const lines = content.trim().split("\n");
  assertEquals(lines.length, 2);

  const parsedEntry = JSON.parse(lines[0]);
  assertEquals(parsedEntry.supersedes, ["mem_old1", "mem_old2"]);
  assertEquals(parsedEntry.relatedTo, ["mem_related1"]);

  const parsedPatch = JSON.parse(lines[1]);
  assertEquals(parsedPatch.relatedTo, ["mem_related2"]);
});

// Clean up test directory after all tests
test("Cleanup: Remove test directory", async function () {
  try {
    await fsp.rm(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});
