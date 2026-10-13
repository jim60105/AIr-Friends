/**
 * OMP Owned-Only Settings Discovery Source Observer (row 26, D3).
 *
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Metadata-only absence/identity checks over the bounded pinned forbidden-source
 * table (`PINNED_FORBIDDEN_SETTINGS_SOURCES` in `../omp-settings.ts`) at the
 * controlled HOME/agent roots and the ACTUAL session project cwd plus pinned
 * foreign-provider ancestor roots. Missing forbidden files is success; IO
 * errors, missing authority roots, symlinks/links and identity replacement fail
 * CLOSED. This module NEVER deletes, renames, parses, merges, chmods or rewrites
 * user files to make a check succeed, and it never claims to stop an
 * undetectable race: the accepted deployment posture keeps these discovery
 * files absent for the entire process lifetime; a preflight is a repository
 * snapshot decision, not a race-free native watcher filter (docs/OMP_SETTINGS.md).
 *
 * Legitimate non-settings workspace files stay untouched and invisible to this
 * observer — it only stats the exact pinned source paths.
 */

import { basename, dirname, join, resolve } from "@std/path";
import { isWithinRoot } from "../filesystem-roots.ts";
import { type OmpSettingsSourcePlan, type PinnedSettingsSource } from "../omp-settings.ts";

/** Metadata reader seam (testable; defaults to real filesystem metadata). */
export interface SourceMetadataReader {
  /** `lstat`: never follows symlinks. */
  lstat(path: string): Promise<Deno.FileInfo>;
  /** `realpath`: canonical resolution; rejects on missing/link errors. */
  realPath(path: string): Promise<string>;
}

export const defaultSourceMetadataReader: SourceMetadataReader = {
  lstat: (path) => Deno.lstat(path),
  realPath: (path) => Deno.realPath(path),
};

/** Bounded upward walk for pinned foreign-provider project roots (D3). */
export const MAX_SETTINGS_ANCESTOR_DEPTH = 16;

export type SourceCheckFailureKind =
  /** A pinned forbidden lower-layer settings source exists. */
  | "forbidden_source"
  /** The pinned source path is a link (symlink), not a plain file. */
  | "forbidden_source_link"
  /** An authority root (owned HOME / agent dir / neutral cwd) is missing. */
  | "authority_root_missing"
  /** An authority root resolved through a link (identity escape). */
  | "authority_root_link"
  /** Observation itself failed (IO/EACCES/etc.) — cannot prove absence. */
  | "observation_error"
  /** An owned overlay is missing, linked, or replaced (identity mismatch). */
  | "overlay_identity_mismatch";

export interface SourceCheckFailure {
  readonly kind: SourceCheckFailureKind;
  /** Bounded, credential-free, content-free path/label. */
  readonly label: string;
  readonly detail: string;
}

export interface AcceptedOverlayIdentity {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /**
   * Inode identity plus change time, on top of size/mtime: `mtime` alone is
   * restorable by whoever can write the overlay, so a same-length rewrite that
   * restores the accepted modification time is still revealed here. Metadata
   * only — the preflight never reads overlay content. An UNAVAILABLE identity
   * (`dev`/`ino`/`ctime` null) proves nothing and is refused, never trusted.
   */
  readonly dev: number;
  readonly ino: number;
  readonly ctimeMs: number;
}

export type SettingsSourceCheckResult =
  | { readonly ok: true; readonly overlays: readonly AcceptedOverlayIdentity[] }
  | { readonly ok: false; readonly failures: readonly SourceCheckFailure[] };

export interface SettingsSourceCheckOptions {
  readonly reader?: SourceMetadataReader;
  /**
   * Previously observed overlay identities: a same-path replacement between
   * checks (size/mtime change or link swap) fails closed as
   * `overlay_identity_mismatch` (repository-triggered rediscovery recheck).
   */
  readonly expectedOverlayIdentities?: readonly AcceptedOverlayIdentity[];
}

/** Fail-closed rejection carrying the bounded failure inventory. */
export class SettingsSourceRejectionError extends Error {
  readonly failures: readonly SourceCheckFailure[];
  constructor(failures: readonly SourceCheckFailure[]) {
    super(formatSettingsSourceError(failures));
    this.name = "SettingsSourceRejectionError";
    this.failures = failures;
  }
}

/**
 * Bounded, content-free, credential-free error formatter. Lists at most 8
 * failures; the rest are counted, never inlined.
 */
export function formatSettingsSourceError(
  failures: readonly SourceCheckFailure[],
): string {
  const shown = failures.slice(0, 8).map((f) => `${f.kind} at ${f.label} (${f.detail})`);
  const overflow = failures.length - shown.length;
  const tail = overflow > 0 ? ` (+${overflow} more)` : "";
  return (
    `OMP settings-source preflight rejected: lower settings sources or observation ` +
    `failures prevent the owned-only plan. ${shown.join("; ")}${tail}. ` +
    `No user file was modified; the deployment/workspace owner must remove the ` +
    `forbidden source before this workspace can be accepted.`
  );
}

interface Candidate {
  readonly source: PinnedSettingsSource;
  readonly path: string;
}

/** The exact forbidden-source candidates for a plan at an actual session cwd. */
export function forbiddenSourceCandidates(
  plan: OmpSettingsSourcePlan,
  sessionCwd: string,
): readonly Candidate[] {
  const cwd = resolve(sessionCwd);
  const ancestors = [cwd, ...ancestorRoots(cwd)];
  const candidates: Candidate[] = [];
  for (const source of plan.forbiddenSources) {
    switch (source.layer) {
      case "global": {
        // Global settings layer is discovered under the agent dir and HOME.
        candidates.push({ source, path: join(plan.agentDir, source.relativePath) });
        candidates.push({ source, path: join(plan.ownedHome, source.relativePath) });
        candidates.push({ source, path: join(plan.ownedHome, ".omp", source.relativePath) });
        break;
      }
      case "project": {
        // Native project layer discovers from the ACTUAL cwd (the neutral
        // launch cwd alone does not cover session/new and session/load cwds).
        candidates.push({ source, path: join(cwd, source.relativePath) });
        candidates.push({ source, path: join(plan.launchCwd, source.relativePath) });
        break;
      }
      case "foreign-global": {
        candidates.push({ source, path: join(plan.ownedHome, source.relativePath) });
        break;
      }
      case "foreign-project": {
        // Foreign discovery providers may contribute project settings from
        // ancestor/repo roots; a cwd-only path check would be incomplete.
        for (const root of ancestors) {
          candidates.push({ source, path: join(root, source.relativePath) });
        }
        break;
      }
    }
  }
  return candidates;
}

function ancestorRoots(cwd: string): readonly string[] {
  const roots: string[] = [];
  let current = dirname(cwd);
  while (roots.length < MAX_SETTINGS_ANCESTOR_DEPTH) {
    const parent = dirname(current);
    if (parent === current) break;
    roots.push(current);
    current = parent;
  }
  return roots;
}

/**
 * Run one metadata-only preflight for a plan and the ACTUAL session cwd.
 * Never throws for observed forbidden content — returns the failure inventory;
 * `assertOmpSettingsSourcesVisible` converts it into a fail-closed throw.
 */
export async function checkOmpSettingsSources(
  plan: OmpSettingsSourcePlan,
  sessionCwd: string,
  options: SettingsSourceCheckOptions = {},
): Promise<SettingsSourceCheckResult> {
  const reader = options.reader ?? defaultSourceMetadataReader;
  const failures: SourceCheckFailure[] = [];

  // 1. Authority roots must exist, be directories, and be link-free.
  for (
    const root of [
      { label: "owned HOME", path: plan.ownedHome },
      { label: "agent directory", path: plan.agentDir },
      { label: "neutral launch cwd", path: plan.launchCwd },
    ]
  ) {
    let info: Deno.FileInfo;
    try {
      info = await reader.lstat(root.path);
    } catch (error) {
      failures.push({
        kind: isNotFound(error) ? "authority_root_missing" : "observation_error",
        label: `${root.label} ${root.path}`,
        detail: describeError(error),
      });
      continue;
    }
    if (!info.isDirectory) {
      failures.push({
        kind: info.isSymlink ? "authority_root_link" : "authority_root_missing",
        label: `${root.label} ${root.path}`,
        detail: info.isSymlink ? "authority root is a link" : "authority root is not a directory",
      });
      continue;
    }
    try {
      // Link-escape test that tolerates benign OS-level ancestor links
      // (e.g. `/home -> /var/home`): canonicalizing the PARENT and re-joining
      // the root's own component stays inside the plan for a genuine directory,
      // while a root replaced by a link to a different location diverges. The
      // root itself being a link is already caught by the lstat check above.
      const canonical = await reader.realPath(root.path);
      const canonicalParent = await reader.realPath(dirname(root.path));
      const expectedCanonical = resolve(canonicalParent, basename(root.path));
      if (canonical !== expectedCanonical) {
        failures.push({
          kind: "authority_root_link",
          label: `${root.label} ${root.path}`,
          detail: `authority root canonicalizes outside the plan (${canonical})`,
        });
      }
    } catch (error) {
      failures.push({
        kind: "observation_error",
        label: `${root.label} ${root.path}`,
        detail: describeError(error),
      });
    }
  }

  // 2. Forbidden lower sources must be ABSENT at every pinned anchor.
  for (const candidate of forbiddenSourceCandidates(plan, sessionCwd)) {
    try {
      const info = await reader.lstat(candidate.path);
      failures.push({
        kind: info.isSymlink ? "forbidden_source_link" : "forbidden_source",
        label: `${candidate.source.id} ${candidate.path}`,
        detail: info.isSymlink
          ? "forbidden settings source reached via a link"
          : "forbidden settings source exists",
      });
    } catch (error) {
      if (!isNotFound(error)) {
        // Unreadable metadata cannot prove absence: fail closed.
        failures.push({
          kind: "observation_error",
          label: `${candidate.source.id} ${candidate.path}`,
          detail: describeError(error),
        });
      }
    }
  }

  // 3. Allowed overlays: plain regular files outside agent-writable roots with
  //    stable identity across rechecks.
  const overlays: AcceptedOverlayIdentity[] = [];
  const expected = new Map(
    (options.expectedOverlayIdentities ?? []).map((identity) => [identity.path, identity]),
  );
  for (const overlayPath of plan.allowedOverlayPaths) {
    let info: Deno.FileInfo;
    try {
      info = await reader.lstat(overlayPath);
    } catch (error) {
      failures.push({
        kind: "overlay_identity_mismatch",
        label: `owned overlay ${overlayPath}`,
        detail: isNotFound(error) ? "owned overlay missing" : describeError(error),
      });
      continue;
    }
    if (info.isSymlink || !info.isFile) {
      failures.push({
        kind: "overlay_identity_mismatch",
        label: `owned overlay ${overlayPath}`,
        detail: info.isSymlink ? "owned overlay is a link" : "owned overlay is not a file",
      });
      continue;
    }
    try {
      const canonical = await reader.realPath(overlayPath);
      // Same benign-ancestor-link tolerance as the authority-root check: the
      // overlay itself being a link is rejected above; a link anywhere in its
      // parent chain that moves the file OUT of the deployment placement is
      // caught by re-canonicalizing the parent.
      const canonicalParent = await reader.realPath(dirname(overlayPath));
      const expectedCanonical = resolve(canonicalParent, basename(overlayPath));
      // The generated skill-root declaration is the ONE overlay path exempt
      // from the agent-writable placement rule: the daemon must be able to
      // write it at spawn time (`align-omp-skill-trust-to-shared-root` D3), and
      // it lives under `{baseRoot}/omp-overlays/` — outside the mode-scoped
      // process state area by construction. Every other overlay check still
      // applies to it identically (link, regular file, canonical parent and
      // the accepted `(dev, ino, ctime, size, mtime)` identity below, which
      // reveals a post-spawn rewrite — a restored mtime does not reproduce the
      // accepted inode identity); this preflight keeps reading no content.
      const isGeneratedDeclaration = overlayPath === plan.skillRootDeclarationPath;
      if (
        canonical !== expectedCanonical ||
        (!isGeneratedDeclaration &&
          (isWithinRoot(canonical, plan.agentDir) || isWithinRoot(canonical, plan.ownedHome)))
      ) {
        failures.push({
          kind: "overlay_identity_mismatch",
          label: `owned overlay ${overlayPath}`,
          detail: "owned overlay escapes its deployment-owned placement",
        });
        continue;
      }
    } catch (error) {
      failures.push({
        kind: "overlay_identity_mismatch",
        label: `owned overlay ${overlayPath}`,
        detail: describeError(error),
      });
      continue;
    }
    const prior = expected.get(overlayPath);
    const observedMtimeMs = info.mtime?.getTime() ?? 0;
    const dev = info.dev;
    const ino = info.ino;
    const ctime = info.ctime;
    if (dev === null || ino === null || ctime === null) {
      failures.push({
        kind: "overlay_identity_mismatch",
        label: `owned overlay ${overlayPath}`,
        detail: "owned overlay identity unavailable",
      });
      continue;
    }
    const observedCtimeMs = ctime.getTime();
    if (
      prior && (prior.size !== info.size || prior.mtimeMs !== observedMtimeMs ||
        prior.dev !== dev || prior.ino !== ino || prior.ctimeMs !== observedCtimeMs)
    ) {
      failures.push({
        kind: "overlay_identity_mismatch",
        label: `owned overlay ${overlayPath}`,
        detail: "owned overlay content identity changed since the accepted check",
      });
      continue;
    }
    overlays.push({
      path: overlayPath,
      size: info.size,
      mtimeMs: observedMtimeMs,
      dev,
      ino,
      ctimeMs: observedCtimeMs,
    });
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true, overlays };
}

/**
 * Fail-closed gate: throws {@link SettingsSourceRejectionError} unless the plan
 * is the ONLY visible settings source for this session. Callers invoke this
 * strictly BEFORE any native protected request (spawn, session/new,
 * session/load, recovery, repository-triggered rediscovery).
 */
export async function assertOmpSettingsSourcesVisible(
  plan: OmpSettingsSourcePlan,
  sessionCwd: string,
  options: SettingsSourceCheckOptions = {},
): Promise<readonly AcceptedOverlayIdentity[]> {
  const result = await checkOmpSettingsSources(plan, sessionCwd, options);
  if (!result.ok) {
    throw new SettingsSourceRejectionError(result.failures);
  }
  return result.overlays;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound;
}

/** Bounded error descriptor: name + short message only, no file content. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.length > 120 ? `${error.message.slice(0, 120)}…` : error.message;
    return `${error.name}: ${message}`;
  }
  return "non-Error observation failure";
}
