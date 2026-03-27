// tests/scripts/migrate-memory-v2.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

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

Deno.test("migrateLine - importance:high → tier:core, decay:1.0", () => {
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

Deno.test("migrateLine - importance:normal → tier:archive, decay:0.5", () => {
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

Deno.test("migrateLine - idempotency: entries with tier field are skipped", () => {
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

Deno.test("migrateLine - skips patch events", () => {
  const patch = { type: "patch", targetId: "mem_1", ts: "2024-01-01T00:00:00Z", enabled: false };
  const input = JSON.stringify(patch);
  const result = migrateLine(input);
  assertEquals(result.migrated, false);
  assertEquals(result.output, input);
});

Deno.test("migrateLine - preserves malformed lines", () => {
  const result = migrateLine("this is not json");
  assertEquals(result.migrated, false);
  assertEquals(result.output, "this is not json");
});

Deno.test("migrateLine - empty line returns empty", () => {
  const result = migrateLine("  ");
  assertEquals(result.migrated, false);
  assertEquals(result.output, "");
});

// ── File-level integration tests ──

Deno.test({
  name: "Migration - backup file creation",
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "migrate-test-" });
    try {
      const filePath = join(tempDir, "memory.public.jsonl");
      const entry = {
        type: "memory",
        id: "mem_1",
        ts: "2024-01-01T00:00:00Z",
        enabled: true,
        visibility: "public",
        importance: "normal",
        content: "test",
      };
      await Deno.writeTextFile(filePath, JSON.stringify(entry) + "\n");

      // Simulate backup creation (same logic as the script)
      const backupPath = filePath.replace(/\.jsonl$/, ".backup.jsonl");
      await Deno.copyFile(filePath, backupPath);

      assertEquals(await exists(backupPath), true);
      const backupContent = await Deno.readTextFile(backupPath);
      assertStringIncludes(backupContent, '"mem_1"');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Migration - full workspace migration flow",
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "migrate-test-" });
    try {
      // Set up workspace structure: data/workspaces/discord/user1/
      const wsPath = join(tempDir, "workspaces", "discord", "user1");
      await Deno.mkdir(wsPath, { recursive: true });

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
      await Deno.writeTextFile(filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      // Simulate full migration (migrateFile logic)
      const content = await Deno.readTextFile(filePath);
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

      await Deno.writeTextFile(filePath, outputLines.join("\n"));

      // Verify migration counts
      assertEquals(migrated, 2); // both memory entries
      assertEquals(skipped, 1); // patch entry

      // Verify migrated content
      const migratedContent = await Deno.readTextFile(filePath);
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
      const content2 = await Deno.readTextFile(filePath);
      const lines2 = content2.split("\n");
      let migrated2 = 0;
      for (const line of lines2) {
        if (!line.trim()) continue;
        const result = migrateLine(line);
        if (result.migrated) migrated2++;
      }
      assertEquals(migrated2, 0); // Nothing should be migrated a second time
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
