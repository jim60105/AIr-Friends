// src/core/session-staging.ts

/**
 * The canonical, prompt-facing payload staging directory for one session.
 *
 * Pure string composition of two values the orchestrator already owns — the
 * session workspace's absolute tmp root and the literal Skill API session id:
 * `{workspace.tmpPath}/{shellSessionId}`, or the tmp root itself when the
 * session has no id (Skill-API-disabled deployments keep the legacy
 * `{workspace}/tmp` form the payload helper falls back to).
 *
 * This is NOT a resolver: it reads no environment variables, performs no
 * pointer lookup, no path normalization, and consults nothing else. The
 * canonical root stays the row-4 authorized staging target — deliberately
 * distinct from the process-level `TMPDIR`, which is mode/channel state and
 * never a staging area (row 9). Callers MUST pass the LITERAL Skill API
 * session id (`skillSessionId(shellSessionId)` in the orchestrator), never a
 * raw internal registry id, so an id-keyed path appears only when the Skill
 * API is enabled.
 */
export function sessionStagingDir(
  workspace: { tmpPath: string },
  shellSessionId?: string | null,
): string {
  return shellSessionId ? `${workspace.tmpPath}/${shellSessionId}` : workspace.tmpPath;
}
