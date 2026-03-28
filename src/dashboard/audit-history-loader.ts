// src/dashboard/audit-history-loader.ts

import { createLogger } from "@utils/logger.ts";
import { join } from "@std/path";
import type { CompletedSession } from "./completed-session-store.ts";
import type { SessionType } from "../types/config.ts";
import type { SessionAuditEntry } from "../types/audit.ts";

const logger = createLogger("AuditHistoryLoader");
const MAX_RESULTS = 100;

/** Parse a single JSONL line safely */
function parseLine(line: string): SessionAuditEntry | null {
  try {
    return JSON.parse(line) as SessionAuditEntry;
  } catch {
    return null;
  }
}

/** Extract first and last non-empty lines from JSONL content */
function getFirstAndLastEntries(
  content: string,
): { first: SessionAuditEntry | null; last: SessionAuditEntry | null } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { first: null, last: null };
  return {
    first: parseLine(lines[0]),
    last: parseLine(lines[lines.length - 1]),
  };
}

/**
 * Parse a single audit log file into a CompletedSession record.
 * Returns null if the file cannot be parsed.
 */
async function parseAuditFile(
  filePath: string,
  platform: string,
  userId: string,
  sessionId: string,
): Promise<CompletedSession | null> {
  try {
    const content = await Deno.readTextFile(filePath);
    const { first, last } = getFirstAndLastEntries(content);
    if (!first) return null;

    const startedAt = first.ts;
    const endedAt = last?.ts ?? first.ts;
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(endedAt).getTime();

    // Determine success from session_end entry
    const hasSessionEnd = last?.phase === "session_end";
    const success = hasSessionEnd ? (last!.data?.success === true) : false;

    // Infer session type from session_end data or default
    let sessionType: SessionType = "message";
    if (hasSessionEnd && last!.data?.sessionType) {
      sessionType = last!.data.sessionType as SessionType;
    }

    return {
      auditSessionId: sessionId,
      type: sessionType,
      platform,
      userId,
      startedAt,
      endedAt,
      status: success ? "success" : "failure",
      durationMs: Math.max(0, endMs - startMs),
    };
  } catch (error) {
    logger.warn("Failed to parse audit file {filePath}", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Scan audit log directory and reconstruct CompletedSession records.
 * Returns up to MAX_RESULTS most recent sessions sorted by endedAt descending.
 */
export async function loadSessionsFromAuditLogs(
  auditBasePath: string,
): Promise<CompletedSession[]> {
  const sessions: CompletedSession[] = [];

  try {
    await Deno.stat(auditBasePath);
  } catch {
    logger.debug("Audit directory does not exist, skipping history load", {
      auditBasePath,
    });
    return [];
  }

  try {
    // Walk: {auditBasePath}/{platform}/{userId}/{sessionId}.jsonl
    for await (const platformEntry of Deno.readDir(auditBasePath)) {
      if (!platformEntry.isDirectory) continue;
      const platformPath = join(auditBasePath, platformEntry.name);

      for await (const userEntry of Deno.readDir(platformPath)) {
        if (!userEntry.isDirectory) continue;
        const userPath = join(platformPath, userEntry.name);

        for await (const fileEntry of Deno.readDir(userPath)) {
          if (!fileEntry.isFile || !fileEntry.name.endsWith(".jsonl")) continue;

          const sessionId = fileEntry.name.replace(/\.jsonl$/, "");
          const filePath = join(userPath, fileEntry.name);
          const session = await parseAuditFile(
            filePath,
            platformEntry.name,
            userEntry.name,
            sessionId,
          );
          if (session) {
            sessions.push(session);
          }
        }
      }
    }
  } catch (error) {
    logger.warn("Error scanning audit directory {auditBasePath}", {
      auditBasePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Sort newest first and limit
  sessions.sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
  return sessions.slice(0, MAX_RESULTS);
}
