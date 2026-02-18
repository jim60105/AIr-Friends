// src/core/audit-retention.ts

import { createLogger } from "@utils/logger.ts";
import { join } from "@std/path";

const logger = createLogger("AuditRetention");

/**
 * Delete audit JSONL files older than retentionDays.
 * Scans data/audit/ recursively, checks file mtime.
 */
export async function cleanupAuditLogs(
  auditBasePath: string,
  retentionDays: number,
): Promise<{ deletedCount: number }> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    for await (const entry of Deno.readDir(auditBasePath)) {
      if (!entry.isDirectory) continue;
      const platformDir = join(auditBasePath, entry.name);
      for await (const userEntry of Deno.readDir(platformDir)) {
        if (!userEntry.isDirectory) continue;
        const userDir = join(platformDir, userEntry.name);
        for await (const fileEntry of Deno.readDir(userDir)) {
          if (!fileEntry.name.endsWith(".jsonl")) continue;
          const filePath = join(userDir, fileEntry.name);
          const stat = await Deno.stat(filePath);
          if (stat.mtime && stat.mtime.getTime() < cutoff) {
            await Deno.remove(filePath);
            deletedCount++;
          }
        }
        // Remove empty user directories
        try {
          await Deno.remove(userDir);
        } catch { /* non-empty directory, skip */ }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      logger.warn("Audit cleanup encountered an error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deletedCount > 0) {
    logger.info("Cleaned up {deletedCount} old audit log files", { deletedCount });
  }

  return { deletedCount };
}
