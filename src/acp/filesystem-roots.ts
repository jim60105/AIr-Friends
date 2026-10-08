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

import { isAbsolute, normalize, resolve, SEPARATOR } from "@std/path";
import {
  type CriticalSkillDecision,
  type SkillCandidate,
  validateCriticalSkillContract,
} from "./omp/compatibility-contracts.ts";

export type RootRole = "workspace" | "staging" | "shared" | "trusted-skills";

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
  | "trusted_identity_mismatch";

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
}

export interface CriticalSkillReference {
  readonly skillId: string;
  readonly canonicalInstructionPath: string;
  readonly sessionGenerationId: string;
  readonly source: "deployment_owned" | "workspace_project" | "symlink_escape";
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
    return { ok: false, reason: "invalid_context", message: "Session context must not be null or undefined" };
  }

  if (
    !isValidSessionIdComponent(context.acpSessionId) ||
    !isValidSessionIdComponent(context.skillSessionId)
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `Invalid ACP session ID ('${context.acpSessionId}') or Skill session ID ('${context.skillSessionId}')`,
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
      message: `explicitStagingPath '${context.explicitStagingPath}' does not match expected staging '${expectedStaging}'`,
    };
  }

  if (
    context.sharedWorkspacePath !== undefined &&
    (!isAbsolute(context.sharedWorkspacePath) || context.sharedWorkspacePath.trim() === "")
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `sharedWorkspacePath must be an absolute path when provided: '${context.sharedWorkspacePath}'`,
    };
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
    return { ok: false, reason: "invalid_path", message: `Device references are rejected: '${rawPath}'` };
  }

  const tmpDir = resolve(context.sessionCwd, "tmp");
  const skillSessionId = context.skillSessionId;
  const sharedWorkspace = context.sharedWorkspacePath;

  let expanded = rawPath;

  // Exact braced forms first
  if (expanded.includes("${TMPDIR}")) {
    expanded = expanded.split("${TMPDIR}").join(tmpDir);
  }
  if (expanded.includes("${SESSION_ID}")) {
    expanded = expanded.split("${SESSION_ID}").join(skillSessionId);
  }
  if (expanded.includes("${AGENT_WORKSPACE}")) {
    if (!sharedWorkspace) {
      return {
        ok: false,
        reason: "unresolved_token",
        message: "${AGENT_WORKSPACE} token used but no sharedWorkspacePath configured in session context",
      };
    }
    expanded = expanded.split("${AGENT_WORKSPACE}").join(sharedWorkspace);
  }

  // Unbraced forms with variable-name boundary
  // $TMPDIR
  if (/\$TMPDIR(?![A-Za-z0-9_])/.test(expanded)) {
    expanded = expanded.replace(/\$TMPDIR(?![A-Za-z0-9_])/g, tmpDir);
  }

  // $SESSION_ID
  if (/\$SESSION_ID(?![A-Za-z0-9_])/.test(expanded)) {
    expanded = expanded.replace(/\$SESSION_ID(?![A-Za-z0-9_])/g, skillSessionId);
  }

  // $AGENT_WORKSPACE
  if (/\$AGENT_WORKSPACE(?![A-Za-z0-9_])/.test(expanded)) {
    if (!sharedWorkspace) {
      return {
        ok: false,
        reason: "unresolved_token",
        message: "$AGENT_WORKSPACE token used but no sharedWorkspacePath configured in session context",
      };
    }
    expanded = expanded.replace(/\$AGENT_WORKSPACE(?![A-Za-z0-9_])/g, sharedWorkspace);
  }

  // Any remaining variable syntax ($VAR or ${VAR}) is unresolved
  if (/\$[A-Za-z_{]/.test(expanded)) {
    return {
      ok: false,
      reason: "unresolved_token",
      message: `Path contains unresolved variable or shell token: '${expanded}'`,
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
  try {
    await reader.lstat(configuredStaging);
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
        message: `Physical staging path '${canonicalStaging}' does not match expected canonical staging '${expectedCanonicalStaging}'`,
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
    // If not found, staging is prospective
    const errorKind = (err && typeof err === "object" && "name" in err && typeof err.name === "string")
      ? err.name
      : undefined;
    const isNotFound = errorKind === "NotFound" ||
      (err instanceof Error && err.message.toLowerCase().includes("no such file"));
    if (!isNotFound) {
      return {
        ok: false,
        reason: "root_unavailable",
        message: `Failed to inspect staging path '${configuredStaging}'`,
        cause: err,
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
          message: `Workspace 'tmp' directory links to '${canonicalTmp}', which diverges from expected '${expectedTmp}'`,
        };
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
              message: `Trusted skills root '${canonicalSkills}' overlaps writable root '${r.canonicalPath}' (role: ${r.role})`,
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

  return {
    ok: true,
    value: {
    acpSessionId: context.acpSessionId,
    sessionContextGeneration: context.sessionContextGeneration,
    roots,
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

  const segments = relativePart ? relativePart.split(SEPARATOR).filter(Boolean) : [];
  let currentPhysicalPath = baseCanonical;

  for (let i = 0; i < segments.length; i++) {
    const nextPath = resolve(currentPhysicalPath, segments[i]);

    let stat: Deno.FileInfo;
    try {
      stat = await reader.lstat(nextPath);
    } catch (err) {
      const errName = (err && typeof err === "object" && "name" in err && typeof err.name === "string")
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
        const errName = (err && typeof err === "object" && "name" in err && typeof err.name === "string")
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
          failureMessage: `Symlink at '${nextPath}' points to '${linkTargetCanonical}', escaping root '${baseCanonical}'`,
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
  criticalRef?: CriticalSkillReference,
  reader: MetadataReader = defaultMetadataReader,
): Promise<RootPathResult<CanonicalTarget>> {
  if (resolvedPath.acpSessionId !== roots.acpSessionId) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `Session ID mismatch: resolvedPath is for '${resolvedPath.acpSessionId}', roots are for '${roots.acpSessionId}'`,
    };
  }

  if (resolvedPath.sessionContextGeneration !== roots.sessionContextGeneration) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `Generation mismatch: resolvedPath has generation '${resolvedPath.sessionContextGeneration}', roots have '${roots.sessionContextGeneration}'`,
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
      message: `Path '${resolvedPath.normalizedPath}' does not fall within any configured session root`,
    };
  }

  // Evaluate candidate roots independently
  const admittedRoles: RootRole[] = [];
  const admittedRootInfos: CanonicalRootInfo[] = [];
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
      if (expectation !== "file-or-new") {
        if (!firstFatalFailure) {
          firstFatalFailure = {
            ok: false,
            reason: "not_found",
            message: `Path '${resolvedPath.normalizedPath}' does not exist for expectation '${expectation}'`,
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
            message: `Prospective path '${computedCanonicalTarget}' escapes root '${root.canonicalPath}'`,
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
      const fileInfo = check.fileInfo!;

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
          message: `Target '${canonicalDest}' is not a regular file as expected by '${expectation}'`,
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
    if (firstEscapeFailure) return firstEscapeFailure;
    return {
      ok: false,
      reason: "outside_roots",
      message: `Target '${resolvedPath.normalizedPath}' failed containment under all candidate roots`,
    };
  }

  // Handle critical skill reference validation if supplied
  if (criticalRef) {
    if (criticalRef.sessionGenerationId !== roots.sessionContextGeneration) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: `Critical skill session generation mismatch: candidate has '${criticalRef.sessionGenerationId}', session has '${roots.sessionContextGeneration}'`,
      };
    }

    const skillsRoot = roots.roots.find((r) => r.role === "trusted-skills");
    if (!skillsRoot) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: `No trusted-skills root configured for session, cannot validate critical skill '${criticalRef.skillId}'`,
      };
    }

    if (!admittedRoles.includes("trusted-skills")) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: `Target '${primarySuccess!.canonicalTarget}' does not possess 'trusted-skills' role`,
      };
    }

    // Call P0's validateCriticalSkillContract
    const candidate: SkillCandidate = {
      skillId: criticalRef.skillId,
      resolvedPath: resolvedPath.normalizedPath,
      canonicalPath: primarySuccess!.canonicalTarget,
      source: criticalRef.source,
      sessionGenerationId: criticalRef.sessionGenerationId,
    };

    const decision: CriticalSkillDecision = validateCriticalSkillContract(
      criticalRef.skillId,
      candidate,
      skillsRoot.canonicalPath,
      roots.sessionContextGeneration,
    );

    if (!decision.authoritative) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: `Critical skill contract validation rejected: ${decision.reason}`,
      };
    }

    if (primarySuccess!.canonicalTarget !== criticalRef.canonicalInstructionPath) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: `Canonical target '${primarySuccess!.canonicalTarget}' does not match expected instruction path '${criticalRef.canonicalInstructionPath}'`,
      };
    }
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
