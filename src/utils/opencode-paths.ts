// src/utils/opencode-paths.ts
//
// Single source of truth for the session-scoped OpenCode data directory (F12).
// OpenCode computes its data dir from xdg-basedir semantics (`$XDG_DATA_HOME/opencode`,
// else `~/.local/share/opencode`); the truncated tool-output directory is hard-coded to
// `{dataDir}/tool-output` and is NOT configurable. By scoping `XDG_DATA_HOME` to a
// directory under the session TMPDIR we keep truncated tool outputs inside the session
// workspace, so (a) the agent can read its own tool-output files through the generic
// gate and (b) the shared, home-rooted data dir is never written or granted.
//
// These helpers are pure and derive everything from the session workspace path alone,
// so the subprocess environment (agent-factory) and the permission gate (client.ts)
// always agree without reading the parent process's `XDG_DATA_HOME`.

import { join } from "@std/path";

/**
 * Root of the session-scoped OpenCode data area: a directory under the session TMPDIR,
 * derived deterministically from the session workspace path alone.
 */
export function opencodeDataRoot(workingDir: string): string {
  return join(workingDir, "tmp", "opencode-data");
}

/**
 * Session-specific `XDG_DATA_HOME` for the agent subprocess. When a session id exists
 * the data home is scoped to that session (`{root}/{sessionId}`) so concurrent sessions
 * of the same user never share truncated tool outputs; without one it falls back to the
 * workspace-level root (used by internal system sessions with dedicated workspaces).
 */
export function sessionXdgDataHome(workingDir: string, sessionId?: string): string {
  return sessionId ? join(opencodeDataRoot(workingDir), sessionId) : opencodeDataRoot(workingDir);
}

/**
 * OpenCode's truncated tool-output directory under a given XDG data home
 * (`{xdgDataHome}/opencode/tool-output`), matching OpenCode's hard-coded layout.
 */
export function opencodeToolOutputDir(xdgDataHome: string): string {
  return join(xdgDataHome, "opencode", "tool-output");
}
