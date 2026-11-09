// tests/scripts/migrate-memory-v2.test.ts

import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { makeTempDir, pathExists as exists, removePath } from "../../src/utils/fs-compat.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";

// ── migrateLine logic (extracted inline to test the transform without running the script) ──

function migrateLine(line: string): { output: string; migrated: boolean } {
  const trimmed = line.trim();
  if (!trimmed) return { output: "", migrated: false };

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return { output: trimmed, migrated: false };
  }

  if (event.type !== "memory") {
    return { output: trimmed, migrated: false };
  }

  if ("tier" in event && event.tier !== undefined) {
    return { output: trimmed, migrated: false };
  }

  const importance = event.importance as string;
  if (importance === "high") {
    event.tier = "core";
    event.decay = 1.0;
  } else {
    event.tier = "archive";
    event.decay = 0.5;
  }
  event.category = "fact";
  event.scope = "user";

  return { output: JSON.stringify(event), migrated: true };
}

// ── Unit tests for migrateLine ──

test("migrateLine - importance:high → tier:core, decay:1.0", () => {
  const entry = {
    type: "memory",
    id: "mem_1",
    ts: "2024-01-01T00:00:00Z",
    enabled: true,
    visibility: "public",
    importance: "high",
    content: "Important fact",
  };
  const result = migrateLine(JSON.stringify(entry));
  assertEquals(result.migrated, true);

  const parsed = JSON.parse(result.output);
  assertEquals(parsed.tier, "core");
  assertEquals(parsed.decay, 1.0);
  assertEquals(parsed.category, "fact");
  assertEquals(parsed.scope, "user");
});

test("migrateLine - importance:normal → tier:archive, decay:0.5", () => {
  const entry = {
    type: "memory",
    id: "mem_2",
    ts: "2024-01-01T00:00:00Z",
    enabled: true,
    visibility: "public",
    importance: "normal",
    content: "Normal fact",
  };
  const result = migrateLine(JSON.stringify(entry));
  assertEquals(result.migrated, true);

  const parsed = JSON.parse(result.output);
  assertEquals(parsed.tier, "archive");
  assertEquals(parsed.decay, 0.5);
  assertEquals(parsed.category, "fact");
  assertEquals(parsed.scope, "user");
});

test("migrateLine - idempotency: entries with tier field are skipped", () => {
  const entry = {
    type: "memory",
    id: "mem_3",
    ts: "2024-01-01T00:00:00Z",
    enabled: true,
    visibility: "public",
    importance: "high",
    content: "Already migrated",
    tier: "core",
    decay: 1.0,
    category: "fact",
    scope: "user",
  };
  const input = JSON.stringify(entry);
  const result = migrateLine(input);
  assertEquals(result.migrated, false);
  assertEquals(result.output, input);
});

test("migrateLine - skips patch events", () => {
  const patch = { type: "patch", targetId: "mem_1", ts: "2024-01-01T00:00:00Z", enabled: false };
  const input = JSON.stringify(patch);
  const result = migrateLine(input);
  assertEquals(result.migrated, false);
  assertEquals(result.output, input);
});

test("migrateLine - preserves malformed lines", () => {
  const result = migrateLine("this is not json");
  assertEquals(result.migrated, false);
  assertEquals(result.output, "this is not json");
});

test("migrateLine - empty line returns empty", () => {
  const result = migrateLine("  ");
  assertEquals(result.migrated, false);
  assertEquals(result.output, "");
});

// ── File-level integration tests ──

test("Migration - empty file is removed", async function () {
  const tempDir = await makeTempDir({ prefix: "migrate-test-" });
  try {
    const filePath = join(tempDir, "memory.public.jsonl");
    await fsp.writeFile(filePath, "");

    assertEquals(await exists(filePath), true);

    // Simulate empty file check and removal (same logic as the script)
    const content = await fsp.readFile(filePath, "utf8");
    if (content.trim().length === 0) {
      await removePath(filePath);
    }

    assertEquals(await exists(filePath), false);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Migration - full workspace migration flow", async function () {
  const tempDir = await makeTempDir({ prefix: "migrate-test-" });
  try {
    // Set up workspace structure: data/workspaces/discord/user1/
    const wsPath = join(tempDir, "workspaces", "discord", "user1");
    await fsp.mkdir(wsPath, { recursive: true });

    const entries = [
      {
        type: "memory",
        id: "mem_high",
        ts: "2024-01-01T00:00:00Z",
        enabled: true,
        visibility: "public",
        importance: "high",
        content: "High importance",
      },
      {
        type: "memory",
        id: "mem_normal",
        ts: "2024-01-01T00:00:00Z",
        enabled: true,
        visibility: "public",
        importance: "normal",
        content: "Normal importance",
      },
      {
        type: "patch",
        targetId: "mem_high",
        ts: "2024-01-02T00:00:00Z",
        enabled: false,
      },
    ];

    const filePath = join(wsPath, "memory.public.jsonl");
    await fsp.writeFile(filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    // Simulate full migration (migrateFile logic)
    const content = await fsp.readFile(filePath, "utf8");
    const lines = content.split("\n");
    let migrated = 0;
    let skipped = 0;
    const outputLines: string[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        outputLines.push(line);
        continue;
      }
      const result = migrateLine(line);
      outputLines.push(result.output);
      if (result.migrated) migrated++;
      else skipped++;
    }

    await fsp.writeFile(filePath, outputLines.join("\n"));

    // Verify migration counts
    assertEquals(migrated, 2); // both memory entries
    assertEquals(skipped, 1); // patch entry

    // Verify migrated content
    const migratedContent = await fsp.readFile(filePath, "utf8");
    const migratedLines = migratedContent.split("\n").filter((l) => l.trim());

    const highEntry = JSON.parse(migratedLines[0]);
    assertEquals(highEntry.tier, "core");
    assertEquals(highEntry.decay, 1.0);

    const normalEntry = JSON.parse(migratedLines[1]);
    assertEquals(normalEntry.tier, "archive");
    assertEquals(normalEntry.decay, 0.5);

    // Patch line should be unchanged
    const patchEntry = JSON.parse(migratedLines[2]);
    assertEquals(patchEntry.type, "patch");
    assertEquals(patchEntry.targetId, "mem_high");

    // Run again to verify idempotency
    const content2 = await fsp.readFile(filePath, "utf8");
    const lines2 = content2.split("\n");
    let migrated2 = 0;
    for (const line of lines2) {
      if (!line.trim()) continue;
      const result = migrateLine(line);
      if (result.migrated) migrated2++;
    }
    assertEquals(migrated2, 0); // Nothing should be migrated a second time
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
