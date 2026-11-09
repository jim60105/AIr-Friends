// src/core/audit-retention.ts

import { createLogger } from "@utils/logger.ts";
import { join } from "node:path";
import fsp from "node:fs/promises";
import { isNotFoundError, removePath } from "../utils/fs-compat.ts";

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
    for (const entry of await fsp.readdir(auditBasePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const platformDir = join(auditBasePath, entry.name);
      for (const userEntry of await fsp.readdir(platformDir, { withFileTypes: true })) {
        if (!userEntry.isDirectory()) continue;
        const userDir = join(platformDir, userEntry.name);
        for (const fileEntry of await fsp.readdir(userDir, { withFileTypes: true })) {
          if (!fileEntry.name.endsWith(".jsonl")) continue;
          const filePath = join(userDir, fileEntry.name);
          const stat = await fsp.stat(filePath);
          if (stat.mtime && stat.mtime.getTime() < cutoff) {
            await removePath(filePath);
            deletedCount++;
          }
        }
        // Remove empty user directories
        try {
          await removePath(userDir);
        } catch { /* non-empty directory, skip */ }
      }
    }
  } catch (error) {
    if (!(isNotFoundError(error))) {
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
