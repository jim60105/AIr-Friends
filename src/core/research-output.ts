// src/core/research-output.ts
//
// Self-research completion verification (F16). A self-research session's deliverable
// is a research note written under `$AGENT_WORKSPACE/notes/` or `$AGENT_WORKSPACE/journal/`
// through edit/write permission approvals — NOT through the Skill API, so the skill-call
// counters cannot see it. The orchestrator snapshots the agent workspace recursively
// before the prompt and re-checks it after `end_turn`: a session only counts as
// successful when the agent actually produced research output.
//
// I/O errors here are NEVER fatal: both helpers fail towards "produced" (the caller
// treats a null snapshot as output produced) so verification uncertainty can never
// trigger a retry loop.

import { join } from "@std/path";
import { sha256Hash } from "@utils/hash.ts";

/**
 * Fingerprint of a single research output file: size, modification time, and a
 * SHA-256 content hash. The hash removes same-size / same-millisecond overwrite
 * blind spots that size+mtime alone would miss.
 */
export interface NoteFingerprint {
  size: number;
  mtimeMs: number;
  contentHash: string;
}

/**
 * Recursively fingerprint `notes/` and `journal/` under the agent workspace,
 * mapping each file's workspace-relative path (e.g. `notes/topic.md`) to its
 * fingerprint.
 *
 * Returns `null` when any I/O error occurs (missing root, unreadable file, ...):
 * the caller SHALL log a WARN and treat the session as having produced output
 * (fail-safe — never retry on verification uncertainty). A missing `notes/` or
 * `journal/` subdirectory contributes no entries (both are created by
 * `getOrCreateAgentWorkspace`).
 */
export async function snapshotAgentWorkspaceNotes(
  agentWorkspacePath: string,
): Promise<Map<string, NoteFingerprint> | null> {
  const snapshot = new Map<string, NoteFingerprint>();
  try {
    await collectFiles(snapshot, join(agentWorkspacePath, "notes"), "notes");
    await collectFiles(snapshot, join(agentWorkspacePath, "journal"), "journal");
    return snapshot;
  } catch {
    return null;
  }
}

async function collectFiles(
  snapshot: Map<string, NoteFingerprint>,
  dir: string,
  relPrefix: string,
): Promise<void> {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return; // missing dir → empty
    throw error;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collectFiles(snapshot, fullPath, relPath);
    } else if (entry.isFile) {
      const stat = await Deno.stat(fullPath);
      const bytes = await Deno.readFile(fullPath);
      snapshot.set(relPath, {
        size: stat.size,
        mtimeMs: stat.mtime?.getTime() ?? 0,
        contentHash: await sha256Hash(bytes),
      });
    }
  }
}

/**
 * Decide whether research output was produced, comparing the pre-prompt snapshot
 * with the current state:
 *
 * - A null snapshot on either side means verification was impossible (I/O error)
 *   → returns `true` (fail-safe: uncertainty counts as produced, never retries).
 * - Any file that is NEW relative to the snapshot counts as produced.
 * - A file whose content hash CHANGED counts as produced only when its mtime is at
 *   or after the session start (minus at most 1s of clock slack): a file modified
 *   before the session began (or by a concurrent writer before our session) does
 *   not count as this session's output. The scheduler is single-flight, user
 *   sessions cannot write the agent workspace, and memory-maintenance does not
 *   touch it; multi-replica shared-workspace writes remain a documented limitation.
 */
export function producedResearchOutput(
  before: Map<string, NoteFingerprint> | null,
  after: Map<string, NoteFingerprint> | null,
  sessionStartMs: number,
): boolean {
  if (before === null || after === null) return true;
  for (const [relPath, current] of after) {
    const previous = before.get(relPath);
    if (previous === undefined) return true; // new file
    if (previous.contentHash !== current.contentHash && current.mtimeMs >= sessionStartMs - 1000) {
      return true; // content-changed within the session window
    }
  }
  return false;
}
