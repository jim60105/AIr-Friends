// tests/core/audit-retention.test.ts

import { assertEquals } from "@std/assert";
import { cleanupAuditLogs } from "@core/audit-retention.ts";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { isNotFoundError, makeTempDir } from "../../src/utils/fs-compat.ts";

test("cleanupAuditLogs - deletes old files", async () => {
  const tmpDir = await makeTempDir();
  try {
    // Create directory structure
    const userDir = join(tmpDir, "discord", "user1");
    await fsp.mkdir(userDir, { recursive: true });

    // Create a file and set its mtime to 10 days ago
    const oldFile = join(userDir, "old_session.jsonl");
    await fsp.writeFile(oldFile, '{"ts":"2024-01-01","phase":"session_end","data":{}}\n');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fsp.utimes(oldFile, tenDaysAgo, tenDaysAgo);

    const result = await cleanupAuditLogs(tmpDir, 7);
    assertEquals(result.deletedCount, 1);

    // Verify file is gone
    try {
      await fsp.stat(oldFile);
      throw new Error("File should have been deleted");
    } catch (error) {
      assertEquals(isNotFoundError(error), true);
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true });
  }
});

test("cleanupAuditLogs - keeps recent files", async () => {
  const tmpDir = await makeTempDir();
  try {
    const userDir = join(tmpDir, "discord", "user1");
    await fsp.mkdir(userDir, { recursive: true });

    const recentFile = join(userDir, "recent_session.jsonl");
    await fsp.writeFile(recentFile, '{"ts":"2024-01-01","phase":"session_end","data":{}}\n');

    // Use large retention (365 days) so nothing gets deleted
    const result = await cleanupAuditLogs(tmpDir, 365);
    assertEquals(result.deletedCount, 0);

    // Verify file still exists
    const stat = await fsp.stat(recentFile);
    assertEquals(stat.isFile(), true);
  } finally {
    await fsp.rm(tmpDir, { recursive: true });
  }
});

test("cleanupAuditLogs - handles non-existent directory", async () => {
  const result = await cleanupAuditLogs("/nonexistent/audit/path", 7);
  assertEquals(result.deletedCount, 0);
});

test("cleanupAuditLogs - ignores non-jsonl files", async () => {
  const tmpDir = await makeTempDir();
  try {
    const userDir = join(tmpDir, "discord", "user1");
    await fsp.mkdir(userDir, { recursive: true });

    await fsp.writeFile(join(userDir, "notes.txt"), "not a jsonl file");
    const result = await cleanupAuditLogs(tmpDir, 0);
    assertEquals(result.deletedCount, 0);
  } finally {
    await fsp.rm(tmpDir, { recursive: true });
  }
});
