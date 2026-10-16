/**
 * Canonical ACP Filesystem Roots & Target Resolution
 *
 * Implements deterministic contextual session path resolution, canonical root
 * identification, and fail-closed physical target observations for ACP sessions.
 *
 * This module provides operation-neutral observations only. It does not perform
 * protected read-content, write, mkdir, delete, or move operations, and does not
 * grant authorization tokens or guarantee race-free execution across later IO.
 */

import { basename, dirname, isAbsolute, normalize, resolve, SEPARATOR } from "@std/path";

export type RootRole =
  | "workspace"
  | "staging"
  | "shared"
  | "trusted-skills"
  | "omp-session-artifacts";

/**
 * The fixed root-relative file name a current-session OMP bash artifact must
 * have: `<numeric-id>.bash.log`. The native artifact writer publishes exactly
 * this shape, and the read-only artifact role admits nothing else.
 */
export const OMP_BASH_ARTIFACT_NAME_PATTERN = /^[0-9]+\.bash\.log$/;

export type TargetExpectation =
  | "existing-file"
  | "existing-directory"
  | "existing-any"
  | "file-or-new";

export type RootPathFailureReason =
  | "invalid_context"
  | "invalid_path"
  | "unresolved_token"
  | "invalid_root"
  | "root_unavailable"
  | "root_overlap"
  | "outside_roots"
  | "symlink_escape"
  | "dangling_symlink"
  | "symlink_loop"
  | "not_found"
  | "wrong_target_type"
  | "canonicalization_failed"
  | "path_changed"
  | "trusted_identity_mismatch"
  | "reserved_native_state";

export interface RootPathFailure {
  readonly ok: false;
  readonly reason: RootPathFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}

export interface RootPathSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type RootPathResult<T> = RootPathSuccess<T> | RootPathFailure;

export interface SessionContext {
  readonly acpSessionId: string;
  readonly skillSessionId: string;
  readonly sessionCwd: string; // Absolute path
  readonly explicitStagingPath: string; // Absolute path
  readonly sharedWorkspacePath?: string; // Optional absolute path
  readonly sessionContextGeneration: string;
  /**
   * OMP-only (D2/D3): the connector's lifecycle-derived reservation of this
   * session's native state, plus the current-session artifact provenance when
   * a unique persisted journal was proven. Absent for OpenCode callbacks and
   * for unregistered contexts, in which case no reservation or artifact role
   * exists.
   */
  readonly ompNativeState?: OmpNativeStateProvenance;
}

/**
 * Lifecycle-proven location of the current ACP session's spilled bash
 * artifacts. Every field is observed by the connector from factory-selected
 * state; no model-supplied path or Skill API identity contributes.
 *
 * The expected artifact directory is exactly `journalPath` minus its `.jsonl`
 * suffix, so it is derived (never stored) and cannot drift from the journal.
 */
export interface OmpArtifactProvenance {
  /** The native ACP session UUID this journal was proven to belong to. */
  readonly acpSessionId: string;
  /** Absolute canonical persisted journal path. */
  readonly journalPath: string;
  /** Observed identity of that journal at discovery. */
  readonly journalIdentity: ObservedIdentity;
  /** Absolute canonical directory holding the journal (the anchor). */
  readonly anchorDirectory: string;
  /** Observed identity of the anchor directory at discovery. */
  readonly anchorIdentity: ObservedIdentity;
  /**
   * Identity bound on the first observation of the (lazily created) artifact
   * directory. Absent until that first binding; once present, a different
   * directory identity at the same path denies.
   */
  readonly artifactDirectoryIdentity?: ObservedIdentity;
}

/**
 * The connector's OMP native-state reservation for one ACP session.
 *
 * It exists independently of artifact discovery: an unavailable journal keeps
 * the reservation (so sibling/mode state stays private) and only omits
 * `artifacts`.
 */
export interface OmpNativeStateProvenance {
  /** The ACP session cwd this reservation was derived for. */
  readonly cwd: string;
  /** Factory-selected native data root (`XDG_DATA_HOME`) when derivable. */
  readonly nativeDataRoot?: string;
  /** Observed identity of that data root at derivation. */
  readonly dataRootIdentity?: ObservedIdentity;
  /** Present only when a unique current-session journal was proven. */
  readonly artifacts?: OmpArtifactProvenance;
}

export interface ResolvedSessionPath {
  readonly acpSessionId: string;
  readonly sessionContextGeneration: string;
  readonly rawPath: string;
  readonly expandedPath: string;
  readonly normalizedPath: string;
}

export interface ObservedIdentity {
  readonly dev?: number;
  readonly ino?: number;
}

export interface CanonicalRootInfo {
  readonly role: RootRole;
  readonly configuredPath: string;
  readonly canonicalPath: string;
  readonly identity?: ObservedIdentity;
  readonly isProspective?: boolean;
  readonly prospectiveAncestor?: string;
  readonly prospectiveMissingSuffix?: readonly string[];
  readonly readOnly: boolean;
}

export interface CanonicalSessionRoots {
  readonly acpSessionId: string;
  readonly sessionContextGeneration: string;
  readonly roots: readonly CanonicalRootInfo[];
  /**
   * Absolute paths reserved as OMP native state for this context (D3). They
   * confer no authority; every non-artifact role is suppressed for targets
   * physically inside them. Empty for non-OMP contexts.
   */
  readonly reservedOmpState?: readonly string[];
}

export interface ObservedSymlink {
  readonly path: string;
  readonly target: string;
}

export interface CanonicalTarget {
  readonly acpSessionId: string;
  readonly sessionContextGeneration: string;
  readonly roles: readonly RootRole[];
  readonly rootIdentities: readonly CanonicalRootInfo[];
  readonly normalizedInput: string;
  readonly canonicalTarget: string;
  readonly rootRelativePath: string;
  readonly targetType: "file" | "directory" | "prospective";
  readonly targetIdentity?: ObservedIdentity;
  readonly prospectiveAncestor?: string;
  readonly prospectiveMissingSuffix?: readonly string[];
  readonly observedSymlinks: readonly ObservedSymlink[];
}

export interface TrustedSkillsRootConfig {
  readonly ownedRootPath: string;
  readonly source: "deployment_owned";
  readonly rootIdentity?: ObservedIdentity;
}

export interface MetadataReader {
  lstat(path: string): Promise<Deno.FileInfo>;
  realPath(path: string): Promise<string>;
}

export const defaultMetadataReader: MetadataReader = {
  lstat: (path: string) => Deno.lstat(path),
  realPath: (path: string) => Deno.realPath(path),
};

/**
 * Validate that a session ID is a literal single path component.
 * Excludes empty strings, '.', '..', and any path separators or null bytes.
 */
function isValidSessionIdComponent(id: string): boolean {
  if (!id || id.trim() === "") return false;
  if (id === "." || id === "..") return false;
  if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  return true;
}

export function validateSessionContext(context: SessionContext): RootPathResult<void> {
  if (!context || typeof context !== "object") {
    return {
      ok: false,
      reason: "invalid_context",
      message: "Session context must not be null or undefined",
    };
  }

  if (
    !isValidSessionIdComponent(context.acpSessionId) ||
    !isValidSessionIdComponent(context.skillSessionId)
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        `Invalid ACP session ID ('${context.acpSessionId}') or Skill session ID ('${context.skillSessionId}')`,
    };
  }

  if (!context.sessionContextGeneration || context.sessionContextGeneration.trim() === "") {
    return {
      ok: false,
      reason: "invalid_context",
      message: "Session context generation must be a non-empty string",
    };
  }

  if (!context.sessionCwd || !isAbsolute(context.sessionCwd)) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `sessionCwd must be an absolute path: '${context.sessionCwd}'`,
    };
  }

  if (!context.explicitStagingPath || !isAbsolute(context.explicitStagingPath)) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `explicitStagingPath must be an absolute path: '${context.explicitStagingPath}'`,
    };
  }

  const expectedStaging = resolve(context.sessionCwd, "tmp", context.skillSessionId);
  if (resolve(context.explicitStagingPath) !== expectedStaging) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        `explicitStagingPath '${context.explicitStagingPath}' does not match expected staging '${expectedStaging}'`,
    };
  }

  if (
    context.sharedWorkspacePath !== undefined &&
    (!isAbsolute(context.sharedWorkspacePath) || context.sharedWorkspacePath.trim() === "")
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        `sharedWorkspacePath must be an absolute path when provided: '${context.sharedWorkspacePath}'`,
    };
  }

  // OMP native-state provenance is bound to exactly one session cwd. A
  // provenance for another cwd is never accepted, and a malformed reservation
  // is rejected here rather than silently widening or narrowing authorization.
  const ompState = context.ompNativeState;
  if (ompState !== undefined) {
    if (ompState.cwd !== context.sessionCwd) {
      return {
        ok: false,
        reason: "invalid_context",
        message:
          `OMP native-state provenance cwd '${ompState.cwd}' does not match session cwd '${context.sessionCwd}'`,
      };
    }
    if (
      ompState.nativeDataRoot !== undefined &&
      (!isAbsolute(ompState.nativeDataRoot) || ompState.nativeDataRoot.trim() === "")
    ) {
      return {
        ok: false,
        reason: "invalid_context",
        message:
          `OMP native data root must be an absolute path when provided: '${ompState.nativeDataRoot}'`,
      };
    }
    const artifacts = ompState.artifacts;
    if (artifacts !== undefined) {
      if (
        !artifacts.acpSessionId ||
        !isAbsolute(artifacts.journalPath) ||
        !isAbsolute(artifacts.anchorDirectory)
      ) {
        return {
          ok: false,
          reason: "invalid_context",
          message: "OMP artifact provenance is malformed",
        };
      }
    }
  }

  return { ok: true, value: undefined };
}

/**
 * Boundary-safe containment check using exact equality or trailing separator prefix.
 */
export function isWithinRoot(path: string, root: string): boolean {
  const normPath = normalize(path);
  const normRoot = normalize(root);
  if (normPath === normRoot) return true;
  const prefix = normRoot.endsWith(SEPARATOR) ? normRoot : normRoot + SEPARATOR;
  return normPath.startsWith(prefix);
}

/**
 * Deterministic contextual session path resolution and token expansion.
 */
export function resolveSessionPath(
  rawPath: string,
  context: SessionContext,
): RootPathResult<ResolvedSessionPath> {
  const contextCheck = validateSessionContext(context);
  if (!contextCheck.ok) return contextCheck;

  if (rawPath === undefined || rawPath === null || rawPath === "") {
    return { ok: false, reason: "invalid_path", message: "Path must be a non-empty string" };
  }

  if (rawPath.includes("\0")) {
    return { ok: false, reason: "invalid_path", message: "Path contains null byte" };
  }

  // Reject URI schemes (http:, https:, file:, skill:, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath)) {
    return {
      ok: false,
      reason: "invalid_path",
      message: `URI scheme references are rejected as filesystem paths: '${rawPath}'`,
    };
  }

  // Reject Windows device syntax and Unix device paths (/dev/)
  if (
    rawPath.startsWith("\\\\.\\") ||
    rawPath.startsWith("\\\\?\\") ||
    rawPath.startsWith("/dev/") ||
    rawPath === "/dev"
  ) {
    return {
      ok: false,
      reason: "invalid_path",
      message: `Device references are rejected: '${rawPath}'`,
    };
  }

  // Single-pass token scanner to avoid re-evaluating replaced values or $& patterns
  let tokenFailure: RootPathFailure | undefined;
  const expanded = rawPath.replace(
    /\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g,
    (fullMatch, braced, unbraced) => {
      const varName = braced || unbraced;
      if (varName === "TMPDIR") {
        return resolve(context.sessionCwd, "tmp");
      }
      if (varName === "SESSION_ID") {
        return context.skillSessionId;
      }
      if (varName === "AGENT_WORKSPACE") {
        if (!context.sharedWorkspacePath) {
          tokenFailure = {
            ok: false,
            reason: "unresolved_token",
            message:
              `${fullMatch} token used but no sharedWorkspacePath configured in session context`,
          };
          return fullMatch;
        }
        return context.sharedWorkspacePath;
      }

      // Any other variable name is unresolved
      tokenFailure = {
        ok: false,
        reason: "unresolved_token",
        message: `Path contains unresolved variable or shell token: '${rawPath}'`,
      };
      return fullMatch;
    },
  );

  if (tokenFailure) {
    return tokenFailure;
  }

  // Any remaining variable syntax ($VAR or ${VAR}) is unresolved
  if (/\$[A-Za-z_{]/.test(expanded) || expanded.includes("${")) {
    return {
      ok: false,
      reason: "unresolved_token",
      message: `Path contains unresolved variable or shell token: '${rawPath}'`,
    };
  }

  // Anchor relative path to sessionCwd (NEVER Deno.cwd())
  let normalized: string;
  if (isAbsolute(expanded)) {
    normalized = normalize(expanded);
  } else {
    normalized = resolve(context.sessionCwd, expanded);
  }

  return {
    ok: true,
    value: {
      acpSessionId: context.acpSessionId,
      sessionContextGeneration: context.sessionContextGeneration,
      rawPath,
      expandedPath: expanded,
      normalizedPath: normalized,
    },
  };
}

function extractIdentity(info: Deno.FileInfo): ObservedIdentity | undefined {
  if (info.dev !== null && info.dev !== undefined && info.ino !== null && info.ino !== undefined) {
    return { dev: info.dev, ino: info.ino };
  }
  return undefined;
}

/**
 * Observe configured and canonical session roots.
 */
export async function canonicalizeSessionRoots(
  context: SessionContext,
  trustedSkills?: TrustedSkillsRootConfig,
  reader: MetadataReader = defaultMetadataReader,
): Promise<RootPathResult<CanonicalSessionRoots>> {
  const contextCheck = validateSessionContext(context);
  if (!contextCheck.ok) return contextCheck;

  const roots: CanonicalRootInfo[] = [];

  // 1. Workspace root
  let canonicalWorkspace: string;
  let workspaceIdentity: ObservedIdentity | undefined;
  try {
    const lstatWorkspace = await reader.lstat(context.sessionCwd);
    if (!lstatWorkspace.isDirectory && !lstatWorkspace.isSymlink) {
      return {
        ok: false,
        reason: "invalid_root",
        message: `Workspace root '${context.sessionCwd}' is not a directory`,
      };
    }
    canonicalWorkspace = await reader.realPath(context.sessionCwd);
    const destInfo = await reader.lstat(canonicalWorkspace);
    if (!destInfo.isDirectory) {
      return {
        ok: false,
        reason: "invalid_root",
        message: `Canonical workspace root '${canonicalWorkspace}' is not a directory`,
      };
    }
    workspaceIdentity = extractIdentity(destInfo);
  } catch (err) {
    return {
      ok: false,
      reason: "root_unavailable",
      message: `Workspace root unavailable: '${context.sessionCwd}'`,
      cause: err,
    };
  }

  roots.push({
    role: "workspace",
    configuredPath: normalize(context.sessionCwd),
    canonicalPath: canonicalWorkspace,
    identity: workspaceIdentity,
    readOnly: false,
  });

  // 2. Exact Staging root: must resolve physically to {canonicalWorkspace}/tmp/{skillSessionId}
  const expectedCanonicalStaging = resolve(canonicalWorkspace, "tmp", context.skillSessionId);
  const configuredStaging = resolve(context.sessionCwd, "tmp", context.skillSessionId);

  let stagingInfo: CanonicalRootInfo;
  let stagingLstat: Deno.FileInfo | undefined;
  try {
    stagingLstat = await reader.lstat(configuredStaging);
  } catch {
    stagingLstat = undefined;
  }

  if (stagingLstat !== undefined) {
    try {
      // Staging exists physically
      const canonicalStaging = await reader.realPath(configuredStaging);
      const destInfo = await reader.lstat(canonicalStaging);
      if (!destInfo.isDirectory) {
        return {
          ok: false,
          reason: "invalid_root",
          message: `Staging target '${canonicalStaging}' is not a directory`,
        };
      }

      if (canonicalStaging !== expectedCanonicalStaging) {
        return {
          ok: false,
          reason: "invalid_root",
          message:
            `Physical staging path '${canonicalStaging}' does not match expected canonical staging '${expectedCanonicalStaging}'`,
        };
      }

      stagingInfo = {
        role: "staging",
        configuredPath: configuredStaging,
        canonicalPath: canonicalStaging,
        identity: extractIdentity(destInfo),
        readOnly: false,
      };
    } catch (err) {
      const errName =
        (err && typeof err === "object" && "name" in err && typeof err.name === "string")
          ? err.name
          : undefined;
      if (
        stagingLstat.isSymlink &&
        (errName === "NotFound" ||
          (err instanceof Error && err.message.toLowerCase().includes("no such file")))
      ) {
        return {
          ok: false,
          reason: "dangling_symlink",
          message: `Staging directory '${configuredStaging}' is a dangling symlink`,
          cause: err,
        };
      }
      return {
        ok: false,
        reason: "canonicalization_failed",
        message: `Failed to canonicalize existing staging path '${configuredStaging}'`,
        cause: err,
      };
    }
  } else {
    // Initial lstat failed; check if it was true NotFound
    let lstatErr: unknown;
    try {
      await reader.lstat(configuredStaging);
    } catch (e) {
      lstatErr = e;
    }
    const isNotFound = (lstatErr && typeof lstatErr === "object" && "name" in lstatErr &&
      lstatErr.name === "NotFound") ||
      (lstatErr instanceof Error && lstatErr.message.toLowerCase().includes("no such file"));
    if (!isNotFound) {
      return {
        ok: false,
        reason: "root_unavailable",
        message: `Failed to inspect staging path '${configuredStaging}'`,
        cause: lstatErr,
      };
    }

    // Prospective staging: find nearest existing directory ancestor under canonical workspace
    // First check tmp/ under workspace
    const configuredTmp = resolve(context.sessionCwd, "tmp");
    let tmpExists = false;
    let canonicalTmp: string | undefined;
    try {
      await reader.lstat(configuredTmp);
      canonicalTmp = await reader.realPath(configuredTmp);
      const tmpInfo = await reader.lstat(canonicalTmp);
      if (tmpInfo.isDirectory) {
        tmpExists = true;
      }
    } catch {
      tmpExists = false;
    }

    let prospectiveAncestor: string;
    let missingSuffix: string[];

    if (tmpExists && canonicalTmp !== undefined) {
      // tmp exists! Check if tmp links to an outside or ordinary directory that alters physical destination
      const expectedTmp = resolve(canonicalWorkspace, "tmp");
      if (canonicalTmp !== expectedTmp) {
        return {
          ok: false,
          reason: "invalid_root",
          message:
            `Workspace 'tmp' directory links to '${canonicalTmp}', which diverges from expected '${expectedTmp}'`,
        };
      }
      const tmpDestInfo = await reader.lstat(canonicalTmp);
      if (!tmpDestInfo.isDirectory) {
        return { ok: false, reason: "invalid_root", message: `Workspace 'tmp' is not a directory` };
      }
      prospectiveAncestor = canonicalTmp;
      missingSuffix = [context.skillSessionId];
    } else {
      // tmp does not exist; anchor is canonical workspace
      prospectiveAncestor = canonicalWorkspace;
      missingSuffix = ["tmp", context.skillSessionId];
    }

    stagingInfo = {
      role: "staging",
      configuredPath: configuredStaging,
      canonicalPath: expectedCanonicalStaging,
      isProspective: true,
      prospectiveAncestor,
      prospectiveMissingSuffix: missingSuffix,
      readOnly: false,
    };
  }

  roots.push(stagingInfo);

  // 3. Shared Workspace (optional)
  if (context.sharedWorkspacePath) {
    try {
      const lstatShared = await reader.lstat(context.sharedWorkspacePath);
      if (!lstatShared.isDirectory && !lstatShared.isSymlink) {
        return {
          ok: false,
          reason: "invalid_root",
          message: `Shared workspace '${context.sharedWorkspacePath}' is not a directory`,
        };
      }
      const canonicalShared = await reader.realPath(context.sharedWorkspacePath);
      const destInfo = await reader.lstat(canonicalShared);
      if (!destInfo.isDirectory) {
        return {
          ok: false,
          reason: "invalid_root",
          message: `Canonical shared workspace '${canonicalShared}' is not a directory`,
        };
      }

      roots.push({
        role: "shared",
        configuredPath: normalize(context.sharedWorkspacePath),
        canonicalPath: canonicalShared,
        identity: extractIdentity(destInfo),
        readOnly: false,
      });
    } catch (err) {
      return {
        ok: false,
        reason: "root_unavailable",
        message: `Configured shared workspace unavailable: '${context.sharedWorkspacePath}'`,
        cause: err,
      };
    }
  }

  // 4. Trusted Skills Root (optional)
  if (trustedSkills) {
    if (trustedSkills.source !== "deployment_owned") {
      return {
        ok: false,
        reason: "invalid_root",
        message: `Trusted skills source must be 'deployment_owned', got '${trustedSkills.source}'`,
      };
    }

    try {
      const lstatSkills = await reader.lstat(trustedSkills.ownedRootPath);
      if (!lstatSkills.isDirectory && !lstatSkills.isSymlink) {
        return {
          ok: false,
          reason: "invalid_root",
          message: `Trusted skills root '${trustedSkills.ownedRootPath}' is not a directory`,
        };
      }
      const canonicalSkills = await reader.realPath(trustedSkills.ownedRootPath);
      const destInfo = await reader.lstat(canonicalSkills);
      if (
        // Row 28 review follow-up: an ABSENT identity proves nothing and is
        // treated as a mismatch — the hardening is unconditional, matching
        // the client gate's discipline.
        // `align-omp-skill-trust-to-shared-root` D1: the root's ownership and
        // permission bits are NOT admission inputs (the shared root the
        // deployment resolves is agent-writable). Identity, link-freedom,
        // canonical spelling, directory type and writable-root disjointness
        // remain mandatory.
        !trustedSkills.rootIdentity ||
        (
          lstatSkills.isSymlink || canonicalSkills !== trustedSkills.ownedRootPath ||
          destInfo.dev !== trustedSkills.rootIdentity.dev ||
          destInfo.ino !== trustedSkills.rootIdentity.ino
        )
      ) {
        return {
          ok: false,
          reason: "trusted_identity_mismatch",
          message: "Owned skill root identity changed",
        };
      }
      if (!destInfo.isDirectory) {
        return {
          ok: false,
          reason: "invalid_root",
          message: `Canonical trusted skills root '${canonicalSkills}' is not a directory`,
        };
      }

      // Check disjointness from all writable roots
      for (const r of roots) {
        if (!r.readOnly) {
          // Check if canonicalSkills is within r.canonicalPath or r.canonicalPath is within canonicalSkills
          if (
            isWithinRoot(canonicalSkills, r.canonicalPath) ||
            isWithinRoot(r.canonicalPath, canonicalSkills)
          ) {
            return {
              ok: false,
              reason: "root_overlap",
              message:
                `Trusted skills root '${canonicalSkills}' overlaps writable root '${r.canonicalPath}' (role: ${r.role})`,
            };
          }
        }
      }

      roots.push({
        role: "trusted-skills",
        configuredPath: normalize(trustedSkills.ownedRootPath),
        canonicalPath: canonicalSkills,
        identity: extractIdentity(destInfo),
        readOnly: true,
      });
    } catch (err) {
      return {
        ok: false,
        reason: "root_unavailable",
        message: `Configured trusted skills root unavailable: '${trustedSkills.ownedRootPath}'`,
        cause: err,
      };
    }
  }

  // 5. OMP native-state reservation and the optional current-session artifact
  // root (D1/D2/D3). Evaluated last so the reservation can refuse overlaps with
  // every already-observed shared/trusted root.
  const ompState = await observeOmpNativeState(context, canonicalWorkspace, roots, reader);
  if (!ompState.ok) return ompState;
  if (ompState.value.artifactRoot !== undefined) roots.push(ompState.value.artifactRoot);

  return {
    ok: true,
    value: {
      acpSessionId: context.acpSessionId,
      sessionContextGeneration: context.sessionContextGeneration,
      roots,
      reservedOmpState: ompState.value.reservedPaths,
    },
  };
}

/** Same observed device+inode pair, or both absent (never a partial match). */
export function sameObservedIdentity(
  observed: ObservedIdentity | undefined,
  expected: ObservedIdentity | undefined,
): boolean {
  if (expected === undefined) return observed === undefined;
  if (observed === undefined) return false;
  return observed.dev === expected.dev && observed.ino === expected.ino;
}

/** A link-free existing directory whose identity is available. */
async function observeLinkFreeDirectory(
  path: string,
  reader: MetadataReader,
): Promise<{ canonicalPath: string; identity?: ObservedIdentity } | undefined> {
  try {
    const info = await reader.lstat(path);
    if (!info.isDirectory || info.isSymlink) return undefined;
    const canonicalPath = await reader.realPath(path);
    if (canonicalPath !== path) return undefined;
    const destInfo = await reader.lstat(canonicalPath);
    if (!destInfo.isDirectory) return undefined;
    return { canonicalPath, identity: extractIdentity(destInfo) };
  } catch {
    return undefined;
  }
}

interface OmpNativeStateObservation {
  readonly reservedPaths: readonly string[];
  /**
   * The current-session artifact root, real or prospective. Absent whenever the
   * capability could not be fully proven — never a partial grant.
   */
  readonly artifactRoot?: CanonicalRootInfo;
}

/**
 * Observe the OMP native-state reservation and, when fully proven, the
 * current-session artifact root (D1/D2/D3).
 *
 * The reservation exists independently of artifact discovery: a missing,
 * ambiguous or unsafe journal still reserves native state (so sibling journals,
 * sibling modes and native auth/database files stay outside every broad
 * callback role) and only omits the read-only artifact capability. A failed
 * artifact observation never fails the context, so unrelated workspace
 * operations keep their normal outcome.
 */
async function observeOmpNativeState(
  context: SessionContext,
  canonicalWorkspace: string,
  roots: readonly CanonicalRootInfo[],
  reader: MetadataReader,
): Promise<RootPathResult<OmpNativeStateObservation>> {
  const state = context.ompNativeState;
  if (state === undefined || state.cwd !== context.sessionCwd) {
    return { ok: true, value: { reservedPaths: [] } };
  }

  const reservedPaths: string[] = [];
  // Both mode children (`<mode>/xdg-data/...`) live beneath `omp-agent`, so the
  // per-spawn workspace native-state tree is reserved as one path.
  const configuredState = resolve(context.sessionCwd, "tmp", "omp-agent");
  reservedPaths.push(normalize(configuredState));
  const canonicalState = resolve(canonicalWorkspace, "tmp", "omp-agent");
  if (canonicalState !== normalize(configuredState)) reservedPaths.push(canonicalState);

  let dataRootUsable = false;
  if (state.nativeDataRoot !== undefined) {
    const configuredDataRoot = normalize(state.nativeDataRoot);
    reservedPaths.push(configuredDataRoot);
    const observed = await observeLinkFreeDirectory(configuredDataRoot, reader);
    if (observed !== undefined) {
      if (observed.canonicalPath !== configuredDataRoot) reservedPaths.push(observed.canonicalPath);
      dataRootUsable = sameObservedIdentity(observed.identity, state.dataRootIdentity) &&
        state.dataRootIdentity !== undefined;
    }
  }

  // A reservation overlapping a trusted read-only root or the shared writable
  // root is a deployment contradiction: refuse rather than borrow those roles.
  for (const reserved of reservedPaths) {
    for (const root of roots) {
      if (root.role !== "shared" && root.role !== "trusted-skills") continue;
      if (
        isWithinRoot(reserved, root.canonicalPath) || isWithinRoot(root.canonicalPath, reserved)
      ) {
        return {
          ok: false,
          reason: "root_overlap",
          message:
            `Reserved OMP native state '${reserved}' overlaps root '${root.canonicalPath}' (role: ${root.role})`,
        };
      }
    }
  }

  const artifacts = state.artifacts;
  if (
    !dataRootUsable || artifacts === undefined || artifacts.acpSessionId !== context.acpSessionId
  ) {
    return { ok: true, value: { reservedPaths } };
  }

  // The anchor (journal parent) and the journal itself must still be the exact
  // link-free objects the connector proved, inside the selected data root.
  if (
    !isWithinRoot(artifacts.anchorDirectory, state.nativeDataRoot!) ||
    !isWithinRoot(artifacts.journalPath, state.nativeDataRoot!)
  ) {
    return { ok: true, value: { reservedPaths } };
  }
  const anchor = await observeLinkFreeDirectory(artifacts.anchorDirectory, reader);
  if (
    anchor === undefined || anchor.canonicalPath !== artifacts.anchorDirectory ||
    !sameObservedIdentity(anchor.identity, artifacts.anchorIdentity)
  ) {
    return { ok: true, value: { reservedPaths } };
  }
  let journalInfo: Deno.FileInfo;
  try {
    journalInfo = await reader.lstat(artifacts.journalPath);
  } catch {
    return { ok: true, value: { reservedPaths } };
  }
  if (
    !journalInfo.isFile || journalInfo.isSymlink ||
    dirname(artifacts.journalPath) !== artifacts.anchorDirectory ||
    !sameObservedIdentity(extractIdentity(journalInfo), artifacts.journalIdentity)
  ) {
    return { ok: true, value: { reservedPaths } };
  }

  const expectedArtifactDirectory = artifacts.journalPath.slice(0, -".jsonl".length);
  if (
    !artifacts.journalPath.endsWith(".jsonl") ||
    !isWithinRoot(expectedArtifactDirectory, state.nativeDataRoot!)
  ) {
    return { ok: true, value: { reservedPaths } };
  }

  const observedArtifactDir = await observeLinkFreeDirectory(expectedArtifactDirectory, reader);
  if (observedArtifactDir === undefined) {
    // Lazily absent (or unusable) artifact directory: retain a prospective path
    // anchored to the proven journal parent without creating anything.
    let anchorExists = false;
    try {
      const anchorInfo = await reader.lstat(artifacts.anchorDirectory);
      anchorExists = anchorInfo.isDirectory && !anchorInfo.isSymlink;
    } catch {
      anchorExists = false;
    }
    if (!anchorExists) return { ok: true, value: { reservedPaths } };
    return {
      ok: true,
      value: {
        reservedPaths,
        artifactRoot: {
          role: "omp-session-artifacts",
          configuredPath: expectedArtifactDirectory,
          canonicalPath: expectedArtifactDirectory,
          isProspective: true,
          prospectiveAncestor: artifacts.anchorDirectory,
          prospectiveMissingSuffix: [basename(expectedArtifactDirectory)],
          readOnly: true,
        },
      },
    };
  }

  // A bound identity makes any later replacement at the same path deny; the
  // first usable observation is bound by the client under a generation fence.
  if (
    artifacts.artifactDirectoryIdentity !== undefined &&
    !sameObservedIdentity(observedArtifactDir.identity, artifacts.artifactDirectoryIdentity)
  ) {
    return { ok: true, value: { reservedPaths } };
  }

  return {
    ok: true,
    value: {
      reservedPaths,
      artifactRoot: {
        role: "omp-session-artifacts",
        configuredPath: expectedArtifactDirectory,
        canonicalPath: expectedArtifactDirectory,
        identity: observedArtifactDir.identity,
        readOnly: true,
      },
    },
  };
}

interface PathComponentCheck {
  readonly status: "exists" | "missing" | "symlink_escape" | "dangling" | "loop" | "error";
  readonly finalCanonicalPath?: string;
  readonly fileInfo?: Deno.FileInfo;
  readonly observedSymlinks: ObservedSymlink[];
  readonly prospectiveAncestor?: string;
  readonly missingSuffix?: string[];
  readonly failureReason?: RootPathFailureReason;
  readonly failureMessage?: string;
  readonly error?: unknown;
}

/**
 * Traverse physical components of a path under a specific candidate root.
 * Validates that all symlinks encountered during traversal stay strictly within candidateRoot.
 */
async function tracePathUnderRoot(
  targetPath: string,
  candidateRoot: CanonicalRootInfo,
  reader: MetadataReader,
): Promise<PathComponentCheck> {
  const normTarget = normalize(targetPath);
  const baseCanonical = candidateRoot.canonicalPath;
  const observedSymlinks: ObservedSymlink[] = [];

  // For prospective roots, candidateRoot.configuredPath or canonicalPath represents the eventual staging path.
  // E.g. /workspace/tmp/skill-x.
  // Relative part from candidateRoot:
  // Break the relative path into segments from base
  let relativePart: string;
  if (normTarget === candidateRoot.configuredPath) {
    relativePart = "";
  } else if (normTarget.startsWith(candidateRoot.configuredPath + SEPARATOR)) {
    relativePart = normTarget.slice(candidateRoot.configuredPath.length + 1);
  } else if (normTarget === baseCanonical) {
    relativePart = "";
  } else if (normTarget.startsWith(baseCanonical + SEPARATOR)) {
    relativePart = normTarget.slice(baseCanonical.length + 1);
  } else {
    return {
      status: "symlink_escape",
      observedSymlinks,
      failureReason: "outside_roots",
      failureMessage: `Target path '${normTarget}' is not lexically inside candidate root`,
    };
  }

  if (candidateRoot.isProspective) {
    // For prospective roots, physical traversal starts from prospectiveAncestor
    // and the segments to traverse are the prospectiveMissingSuffix followed by relativePart
    const missingSuffix = candidateRoot.prospectiveMissingSuffix || [];
    const extraSegments = relativePart ? relativePart.split(SEPARATOR).filter(Boolean) : [];
    const allProspectiveSegments = [...missingSuffix, ...extraSegments];
    return {
      status: "missing",
      observedSymlinks,
      prospectiveAncestor: candidateRoot.prospectiveAncestor || baseCanonical,
      missingSuffix: allProspectiveSegments,
    };
  }

  const segments = relativePart ? relativePart.split(SEPARATOR).filter(Boolean) : [];
  let currentPhysicalPath = baseCanonical;

  for (let i = 0; i < segments.length; i++) {
    const nextPath = resolve(currentPhysicalPath, segments[i]);

    let stat: Deno.FileInfo;
    try {
      stat = await reader.lstat(nextPath);
    } catch (err) {
      const errName =
        (err && typeof err === "object" && "name" in err && typeof err.name === "string")
          ? err.name
          : undefined;
      const isNotFound = errName === "NotFound" ||
        (err instanceof Error && err.message.toLowerCase().includes("no such file"));
      if (isNotFound) {
        // Component does not exist.
        // Current physical path is the prospective ancestor.
        const missingSuffix = segments.slice(i);
        return {
          status: "missing",
          observedSymlinks,
          prospectiveAncestor: currentPhysicalPath,
          missingSuffix,
        };
      }

      // Permission or other IO error
      return {
        status: "error",
        observedSymlinks,
        failureReason: "canonicalization_failed",
        failureMessage: `Failed to inspect path component '${nextPath}'`,
        error: err,
      };
    }

    if (stat.isSymlink) {
      let linkTargetCanonical: string;
      try {
        linkTargetCanonical = await reader.realPath(nextPath);
      } catch (err) {
        const errName =
          (err && typeof err === "object" && "name" in err && typeof err.name === "string")
            ? err.name
            : undefined;
        if (
          errName === "NotFound" ||
          (err instanceof Error && err.message.toLowerCase().includes("no such file"))
        ) {
          return {
            status: "dangling",
            observedSymlinks,
            failureReason: "dangling_symlink",
            failureMessage: `Dangling symlink encountered at '${nextPath}'`,
            error: err,
          };
        }
        if (
          errName === "FilesystemLoop" ||
          (err instanceof Error &&
            (err.message.includes("loop") || err.message.includes("too many levels")))
        ) {
          return {
            status: "loop",
            observedSymlinks,
            failureReason: "symlink_loop",
            failureMessage: `Symlink loop encountered at '${nextPath}'`,
            error: err,
          };
        }
        return {
          status: "error",
          observedSymlinks,
          failureReason: "canonicalization_failed",
          failureMessage: `Failed to resolve symlink '${nextPath}'`,
          error: err,
        };
      }

      observedSymlinks.push({ path: nextPath, target: linkTargetCanonical });

      // Symlink containment check: must stay within candidateRoot.canonicalPath
      if (!isWithinRoot(linkTargetCanonical, baseCanonical)) {
        return {
          status: "symlink_escape",
          observedSymlinks,
          failureReason: "symlink_escape",
          failureMessage:
            `Symlink at '${nextPath}' points to '${linkTargetCanonical}', escaping root '${baseCanonical}'`,
        };
      }

      currentPhysicalPath = linkTargetCanonical;
    } else {
      currentPhysicalPath = nextPath;
    }
  }

  // Final path exists
  try {
    const finalInfo = await reader.lstat(currentPhysicalPath);
    return {
      status: "exists",
      finalCanonicalPath: currentPhysicalPath,
      fileInfo: finalInfo,
      observedSymlinks,
    };
  } catch (err) {
    return {
      status: "error",
      observedSymlinks,
      failureReason: "canonicalization_failed",
      failureMessage: `Failed to inspect final canonical path '${currentPhysicalPath}'`,
      error: err,
    };
  }
}

/**
 * Resolve and classify target against session roots and expectation.
 */
export async function resolveFilesystemTarget(
  resolvedPath: ResolvedSessionPath,
  roots: CanonicalSessionRoots,
  expectation: TargetExpectation,
  reader: MetadataReader = defaultMetadataReader,
): Promise<RootPathResult<CanonicalTarget>> {
  if (resolvedPath.acpSessionId !== roots.acpSessionId) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        `Session ID mismatch: resolvedPath is for '${resolvedPath.acpSessionId}', roots are for '${roots.acpSessionId}'`,
    };
  }

  if (resolvedPath.sessionContextGeneration !== roots.sessionContextGeneration) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        `Generation mismatch: resolvedPath has generation '${resolvedPath.sessionContextGeneration}', roots have '${roots.sessionContextGeneration}'`,
    };
  }

  // Find candidate roots via lexical containment
  const candidateRoots = roots.roots.filter((r) =>
    isWithinRoot(resolvedPath.normalizedPath, r.configuredPath) ||
    isWithinRoot(resolvedPath.normalizedPath, r.canonicalPath)
  );

  if (candidateRoots.length === 0) {
    return {
      ok: false,
      reason: "outside_roots",
      message:
        `Path '${resolvedPath.normalizedPath}' does not fall within any configured session root`,
    };
  }

  // Evaluate candidate roots independently
  const admittedRoles: RootRole[] = [];
  const admittedRootInfos: CanonicalRootInfo[] = [];
  // D3: reserved OMP native state dominates every broad workspace/staging/shared
  // role for OMP callback contexts. A reserved target can be admitted only by
  // the current artifact capability, so overlapping broad roots are dropped
  // before any role/extension decision.
  const reservedState = roots.reservedOmpState ?? [];
  const inReservedState = (path: string): boolean =>
    reservedState.some((reserved) => isWithinRoot(path, reserved));
  let sawReservedState = false;
  let primarySuccess: {
    canonicalTarget: string;
    targetType: "file" | "directory" | "prospective";
    targetIdentity?: ObservedIdentity;
    prospectiveAncestor?: string;
    prospectiveMissingSuffix?: readonly string[];
    observedSymlinks: ObservedSymlink[];
    rootRelativePath: string;
  } | undefined;

  let firstEscapeFailure: RootPathFailure | undefined;
  let firstFatalFailure: RootPathFailure | undefined;

  for (const root of candidateRoots) {
    const check = await tracePathUnderRoot(resolvedPath.normalizedPath, root, reader);

    if (check.status === "error") {
      firstFatalFailure = {
        ok: false,
        reason: check.failureReason ?? "canonicalization_failed",
        message: check.failureMessage ?? "Canonicalization error",
        cause: check.error,
      };
      continue;
    }

    if (check.status === "dangling" || check.status === "loop") {
      firstFatalFailure = {
        ok: false,
        reason: check.failureReason ?? "dangling_symlink",
        message: check.failureMessage ?? "Symlink error",
        cause: check.error,
      };
      continue;
    }

    if (check.status === "symlink_escape") {
      if (!firstEscapeFailure) {
        firstEscapeFailure = {
          ok: false,
          reason: check.failureReason ?? "symlink_escape",
          message: check.failureMessage ?? "Symlink escape",
        };
      }
      continue;
    }

    if (check.status === "missing") {
      const prospectiveCanonical = resolve(check.prospectiveAncestor!, ...check.missingSuffix!);
      if (
        reservedState.length > 0 && root.role !== "omp-session-artifacts" &&
        (inReservedState(check.prospectiveAncestor!) || inReservedState(prospectiveCanonical))
      ) {
        sawReservedState = true;
        continue;
      }
      if (expectation !== "file-or-new") {
        if (!firstFatalFailure) {
          firstFatalFailure = {
            ok: false,
            reason: "not_found",
            message:
              `Path '${resolvedPath.normalizedPath}' does not exist for expectation '${expectation}'`,
          };
        }
        continue;
      }

      // file-or-new prospective check
      const ancestor = check.prospectiveAncestor!;
      const missingSuffix = check.missingSuffix!;

      // Ancestor must be an existing directory
      try {
        const ancInfo = await reader.lstat(ancestor);
        if (!ancInfo.isDirectory) {
          firstFatalFailure = {
            ok: false,
            reason: "wrong_target_type",
            message: `Prospective parent '${ancestor}' exists but is not a directory`,
          };
          continue;
        }
      } catch (err) {
        firstFatalFailure = {
          ok: false,
          reason: "canonicalization_failed",
          message: `Failed to inspect prospective ancestor '${ancestor}'`,
          cause: err,
        };
        continue;
      }

      const computedCanonicalTarget = resolve(ancestor, ...missingSuffix);
      if (!isWithinRoot(computedCanonicalTarget, root.canonicalPath)) {
        if (!firstEscapeFailure) {
          firstEscapeFailure = {
            ok: false,
            reason: "symlink_escape",
            message:
              `Prospective path '${computedCanonicalTarget}' escapes root '${root.canonicalPath}'`,
          };
        }
        continue;
      }

      admittedRoles.push(root.role);
      admittedRootInfos.push(root);

      if (!primarySuccess) {
        let rootRel = computedCanonicalTarget.slice(root.canonicalPath.length);
        if (rootRel.startsWith(SEPARATOR)) rootRel = rootRel.slice(1);
        primarySuccess = {
          canonicalTarget: computedCanonicalTarget,
          targetType: "prospective",
          prospectiveAncestor: ancestor,
          prospectiveMissingSuffix: missingSuffix,
          observedSymlinks: check.observedSymlinks,
          rootRelativePath: rootRel,
        };
      }
      continue;
    }

    if (check.status === "exists") {
      const canonicalDest = check.finalCanonicalPath!;
      if (
        reservedState.length > 0 && root.role !== "omp-session-artifacts" &&
        inReservedState(canonicalDest)
      ) {
        sawReservedState = true;
        continue;
      }
      const fileInfo = check.fileInfo!;
      // For file-or-new, if target exists, it must be a regular file, NOT a directory
      if (expectation === "file-or-new" && !fileInfo.isFile) {
        firstFatalFailure = {
          ok: false,
          reason: "wrong_target_type",
          message:
            `Target '${canonicalDest}' exists but is a directory; 'file-or-new' expects a regular file`,
        };
        continue;
      }

      // Special node check: reject FIFO, socket, block/char device
      if (!fileInfo.isFile && !fileInfo.isDirectory && !fileInfo.isSymlink) {
        firstFatalFailure = {
          ok: false,
          reason: "wrong_target_type",
          message: `Target '${canonicalDest}' is a special node, not a regular file or directory`,
        };
        continue;
      }

      // Check expectation
      if (expectation === "existing-file" && !fileInfo.isFile) {
        firstFatalFailure = {
          ok: false,
          reason: "wrong_target_type",
          message:
            `Target '${canonicalDest}' is not a regular file as expected by '${expectation}'`,
        };
        continue;
      }

      if (expectation === "existing-directory" && !fileInfo.isDirectory) {
        firstFatalFailure = {
          ok: false,
          reason: "wrong_target_type",
          message: `Target '${canonicalDest}' is not a directory as expected by '${expectation}'`,
        };
        continue;
      }

      // Consistency check: verify path hasn't changed between lstat and realPath
      try {
        const verifyDest = await reader.realPath(canonicalDest);
        if (verifyDest !== canonicalDest) {
          firstFatalFailure = {
            ok: false,
            reason: "path_changed",
            message: `Target changed between observations: '${canonicalDest}' vs '${verifyDest}'`,
          };
          continue;
        }
      } catch (err) {
        firstFatalFailure = {
          ok: false,
          reason: "path_changed",
          message: `Target disappeared during canonicalization check: '${canonicalDest}'`,
          cause: err,
        };
        continue;
      }

      admittedRoles.push(root.role);
      admittedRootInfos.push(root);

      if (!primarySuccess) {
        let rootRel = canonicalDest.slice(root.canonicalPath.length);
        if (rootRel.startsWith(SEPARATOR)) rootRel = rootRel.slice(1);
        primarySuccess = {
          canonicalTarget: canonicalDest,
          targetType: fileInfo.isDirectory ? "directory" : "file",
          targetIdentity: extractIdentity(fileInfo),
          observedSymlinks: check.observedSymlinks,
          rootRelativePath: rootRel,
        };
      }
    }
  }

  if (admittedRoles.length === 0) {
    if (firstFatalFailure) return firstFatalFailure;
    if (sawReservedState) {
      return {
        ok: false,
        reason: "reserved_native_state",
        message:
          `Target '${resolvedPath.normalizedPath}' is reserved OMP native state and no current artifact capability admits it`,
      };
    }
    if (firstEscapeFailure) return firstEscapeFailure;
    return {
      ok: false,
      reason: "outside_roots",
      message:
        `Target '${resolvedPath.normalizedPath}' failed containment under all candidate roots`,
    };
  }

  return {
    ok: true,
    value: {
      acpSessionId: roots.acpSessionId,
      sessionContextGeneration: roots.sessionContextGeneration,
      roles: admittedRoles,
      rootIdentities: admittedRootInfos,
      normalizedInput: resolvedPath.normalizedPath,
      canonicalTarget: primarySuccess!.canonicalTarget,
      rootRelativePath: primarySuccess!.rootRelativePath,
      targetType: primarySuccess!.targetType,
      targetIdentity: primarySuccess!.targetIdentity,
      prospectiveAncestor: primarySuccess!.prospectiveAncestor,
      prospectiveMissingSuffix: primarySuccess!.prospectiveMissingSuffix,
      observedSymlinks: primarySuccess!.observedSymlinks,
    },
  };
}
