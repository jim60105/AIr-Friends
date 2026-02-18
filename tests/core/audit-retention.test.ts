// tests/core/audit-retention.test.ts

import { assertEquals } from "@std/assert";
import { cleanupAuditLogs } from "@core/audit-retention.ts";
import { join } from "@std/path";

Deno.test("cleanupAuditLogs - deletes old files", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Create directory structure
    const userDir = join(tmpDir, "discord", "user1");
    await Deno.mkdir(userDir, { recursive: true });

    // Create a file and set its mtime to 10 days ago
    const oldFile = join(userDir, "old_session.jsonl");
    await Deno.writeTextFile(oldFile, '{"ts":"2024-01-01","phase":"session_end","data":{}}\n');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await Deno.utime(oldFile, tenDaysAgo, tenDaysAgo);

    const result = await cleanupAuditLogs(tmpDir, 7);
    assertEquals(result.deletedCount, 1);

    // Verify file is gone
    try {
      await Deno.stat(oldFile);
      throw new Error("File should have been deleted");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("cleanupAuditLogs - keeps recent files", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const userDir = join(tmpDir, "discord", "user1");
    await Deno.mkdir(userDir, { recursive: true });

    const recentFile = join(userDir, "recent_session.jsonl");
    await Deno.writeTextFile(recentFile, '{"ts":"2024-01-01","phase":"session_end","data":{}}\n');

    // Use large retention (365 days) so nothing gets deleted
    const result = await cleanupAuditLogs(tmpDir, 365);
    assertEquals(result.deletedCount, 0);

    // Verify file still exists
    const stat = await Deno.stat(recentFile);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("cleanupAuditLogs - handles non-existent directory", async () => {
  const result = await cleanupAuditLogs("/nonexistent/audit/path", 7);
  assertEquals(result.deletedCount, 0);
});

Deno.test("cleanupAuditLogs - ignores non-jsonl files", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const userDir = join(tmpDir, "discord", "user1");
    await Deno.mkdir(userDir, { recursive: true });

    await Deno.writeTextFile(join(userDir, "notes.txt"), "not a jsonl file");
    const result = await cleanupAuditLogs(tmpDir, 0);
    assertEquals(result.deletedCount, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
