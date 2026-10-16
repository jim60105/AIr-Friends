/**
 * Core operation contracts, types, and pure validation logic for secure ACP filesystem access.
 *
 * Implements OpenSpec change `secure-acp-filesystem-access`.
 */

import { SEPARATOR } from "@std/path";
import {
  CanonicalRootInfo,
  CanonicalSessionRoots,
  CanonicalTarget,
  isWithinRoot,
  ObservedIdentity,
  RootRole,
  SessionContext,
  validateSessionContext,
} from "./filesystem-roots.ts";
import {
  DEFAULT_READ_PREFIX_BYTES,
  type LinuxNativeCalls,
  performLinuxSecureAccess,
  type ProtectedAccessAnchorGuard,
} from "./filesystem-access-linux.ts";

export type FilesystemAccessFailureReason =
  | "invalid_context"
  | "outside_roots"
  | "identity_unavailable"
  | "path_changed"
  | "unsafe_traversal"
  | "root_unavailable"
  | "parent_missing"
  | "wrong_target_type"
  | "unsupported_platform"
  | "secure_access_unavailable"
  | "access_denied"
  | "io_failed";

export interface FilesystemAccessFailure {
  readonly ok: false;
  readonly reason: FilesystemAccessFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}

export interface FilesystemAccessSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type FilesystemAccessResult<T> =
  | FilesystemAccessSuccess<T>
  | FilesystemAccessFailure;

export interface ReadCanonicalTextFileOptions {
  readonly context: SessionContext;
  readonly roots: CanonicalSessionRoots;
  readonly target: CanonicalTarget;
  readonly selectedRole: RootRole;
  /**
   * Current-session OMP artifact reads re-verify the proven journal and its
   * parent at the protected-opening boundary (D4, no-follow, descriptor-bound).
   */
  readonly ompAnchor?: ProtectedAccessAnchorGuard;
  /** Injectable native backend calls for testing */
  readonly nativeCalls?: LinuxNativeCalls;
}

export interface WriteCanonicalTextFileOptions {
  readonly context: SessionContext;
  readonly roots: CanonicalSessionRoots;
  readonly target: CanonicalTarget;
  readonly selectedRole: RootRole;
  readonly content: string;
  /** Injectable native backend calls for testing */
  readonly nativeCalls?: LinuxNativeCalls;
}

export interface ValidatedAccessAdmission {
  readonly selectedRoot: CanonicalRootInfo;
  readonly relativePath: string;
  readonly isNewFile: boolean;
}

/**
 * Validates that an ObservedIdentity has finite, safe, non-negative integer dev and ino.
 */
export function isValidSafeIdentity(identity?: ObservedIdentity): boolean {
  if (!identity) return false;
  const { dev, ino } = identity;
  if (typeof dev !== "number" || typeof ino !== "number") return false;
  if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)) return false;
  if (dev < 0 || ino < 0) return false;
  return true;
}

/**
 * Validate that a relative path consists of safe relative components without null bytes or .. traversal.
 */
export function isValidRelativeComponentPath(relPath: string): boolean {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  if (relPath.includes("\0")) return false;
  const parts = relPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (part === "." || part === "..") return false;
    if (part.includes("\0") || part.includes("\\")) return false;
  }
  return true;
}

/**
 * Pure admission check enforcing:
 * - Session and generation matching between context, roots, and target.
 * - Selected role presence in target.roles and roots.roots.
 * - Prohibition of writes to "trusted-skills" role.
 * - No request-time child symlinks (target.observedSymlinks must be empty).
 * - Root availability (no prospective roots).
 * - Exact identity availability for root (and existing target).
 * - Proper parent existence for prospective new files.
 * - Derivation of canonical-target relative path against the selected root.
 */
export function validateAccessAdmission(
  context: SessionContext,
  roots: CanonicalSessionRoots,
  target: CanonicalTarget,
  selectedRole: RootRole,
  isWrite: boolean,
): FilesystemAccessResult<ValidatedAccessAdmission> {
  // 1. Session context and generation alignment
  const contextValidation = validateSessionContext(context);
  if (!contextValidation.ok) {
    return {
      ok: false,
      reason: "invalid_context",
      message: `Invalid session context: ${contextValidation.message}`,
    };
  }
  if (
    typeof context.sessionContextGeneration !== "string" ||
    context.sessionContextGeneration.trim().length === 0 ||
    typeof roots.sessionContextGeneration !== "string" ||
    roots.sessionContextGeneration.trim().length === 0 ||
    typeof target.sessionContextGeneration !== "string" ||
    target.sessionContextGeneration.trim().length === 0 ||
    typeof context.acpSessionId !== "string" ||
    context.acpSessionId.trim().length === 0 ||
    typeof roots.acpSessionId !== "string" ||
    roots.acpSessionId.trim().length === 0 ||
    typeof target.acpSessionId !== "string" ||
    target.acpSessionId.trim().length === 0
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message: "Session context or generation is empty or not a valid string.",
    };
  }

  if (
    context.acpSessionId !== roots.acpSessionId ||
    context.acpSessionId !== target.acpSessionId ||
    context.sessionContextGeneration !== roots.sessionContextGeneration ||
    context.sessionContextGeneration !== target.sessionContextGeneration
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message:
        "Session ID or context generation mismatch between context, roots, and target observation.",
    };
  }
  // 2. Write to trusted-skills root is denied
  if (isWrite && selectedRole === "trusted-skills") {
    return {
      ok: false,
      reason: "access_denied",
      message: "Trusted-skills root is strictly read-only; writes are denied.",
    };
  }
  // 3. Selected role must exist in target.roles
  if (!target.roles.includes(selectedRole)) {
    return {
      ok: false,
      reason: "outside_roots",
      message:
        `Selected role '${selectedRole}' is not an applicable role for this target observation.`,
    };
  }

  // Find selected root record in roots.roots
  const selectedRoot = roots.roots.find((r) => r.role === selectedRole);
  if (!selectedRoot) {
    return {
      ok: false,
      reason: "outside_roots",
      message: `Selected root role '${selectedRole}' not found in canonical session roots.`,
    };
  }

  // Verify target.rootIdentities also contains a matching root entry
  const targetRootInfo = target.rootIdentities.find((r) => r.role === selectedRole);
  if (
    !targetRootInfo ||
    targetRootInfo.canonicalPath !== selectedRoot.canonicalPath
  ) {
    return {
      ok: false,
      reason: "outside_roots",
      message:
        `Root identity for selected role '${selectedRole}' does not match between roots and target.`,
    };
  }

  // 4. Prospective root is unavailable for IO
  if (selectedRoot.isProspective) {
    return {
      ok: false,
      reason: "root_unavailable",
      message:
        `Selected root '${selectedRole}' is prospective and cannot provide an IO capability.`,
    };
  }

  // 5. Root identity check: must have valid, finite, safe non-negative dev and ino
  if (!isValidSafeIdentity(selectedRoot.identity)) {
    return {
      ok: false,
      reason: "identity_unavailable",
      message: `Selected root '${selectedRole}' lacks a valid safe exact filesystem identity.`,
    };
  }

  if (
    !isValidSafeIdentity(targetRootInfo.identity) ||
    targetRootInfo.identity?.dev !== selectedRoot.identity?.dev ||
    targetRootInfo.identity?.ino !== selectedRoot.identity?.ino
  ) {
    return {
      ok: false,
      reason: "identity_unavailable",
      message:
        `Selected root identity for '${selectedRole}' does not match between roots and target or is unsafe.`,
    };
  }

  // 6. Child symlinks rejection (request-time traversal under candidate root)
  if (target.observedSymlinks && target.observedSymlinks.length > 0) {
    return {
      ok: false,
      reason: "unsafe_traversal",
      message: "Request-time child or final symlinks are not permitted under secure access.",
    };
  }

  // 7. Check target type & parent requirements
  const isNewFile = target.targetType === "prospective";
  if (isNewFile) {
    if (!isWrite) {
      return {
        ok: false,
        reason: "path_changed",
        message: "Cannot read prospective target that does not exist.",
      };
    }
    // For prospective new file, missing suffix must be exactly length 1 (only the final file name is missing)
    if (
      !target.prospectiveMissingSuffix ||
      target.prospectiveMissingSuffix.length !== 1
    ) {
      return {
        ok: false,
        reason: "parent_missing",
        message:
          "Creation requires a complete existing parent directory path; intermediate directories cannot be created.",
      };
    }
  } else {
    // Existing target: must be a regular file, not a directory
    if (target.targetType !== "file") {
      return {
        ok: false,
        reason: "wrong_target_type",
        message: `Target type is '${target.targetType}', but regular file is required.`,
      };
    }
    // Existing target must have a valid safe identity
    if (!isValidSafeIdentity(target.targetIdentity)) {
      return {
        ok: false,
        reason: "identity_unavailable",
        message: "Existing target lacks a valid safe exact filesystem identity.",
      };
    }
  }

  // 8. Derive the relative path beneath the selected root's canonical path
  const canonicalTarget = target.canonicalTarget;
  const canonicalRoot = selectedRoot.canonicalPath;

  if (canonicalTarget === canonicalRoot) {
    return {
      ok: false,
      reason: "wrong_target_type",
      message: "Target is the root directory itself, not a regular file.",
    };
  }

  if (!isWithinRoot(canonicalTarget, canonicalRoot)) {
    return {
      ok: false,
      reason: "outside_roots",
      message:
        `Canonical target '${canonicalTarget}' is not within selected canonical root '${canonicalRoot}'.`,
    };
  }

  // Extract relative path
  let relativePath = canonicalTarget.slice(canonicalRoot.length);
  if (relativePath.startsWith(SEPARATOR) || relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  if (!isValidRelativeComponentPath(relativePath)) {
    return {
      ok: false,
      reason: "outside_roots",
      message: `Derived relative path '${relativePath}' contains invalid components.`,
    };
  }

  return {
    ok: true,
    value: {
      selectedRoot,
      relativePath,
      isNewFile,
    },
  };
}

/**
 * Reads a UTF-8 text file securely using canonical observations and descriptor-only IO.
 */
export function readCanonicalTextFile(
  options: ReadCanonicalTextFileOptions,
): FilesystemAccessResult<string> {
  const admission = validateAccessAdmission(
    options.context,
    options.roots,
    options.target,
    options.selectedRole,
    false,
  );
  if (!admission.ok) {
    return admission;
  }

  return performLinuxSecureAccess({
    operation: "read",
    selectedRoot: admission.value.selectedRoot,
    target: options.target,
    relativePath: admission.value.relativePath,
    isNewFile: false,
    content: "",
    anchorGuard: options.ompAnchor,
    nativeCalls: options.nativeCalls,
  });
}

export interface ReadOmpSessionHeaderPrefixOptions {
  /**
   * The connector's trusted lifecycle observation of the native sessions root
   * (`<XDG_DATA_HOME>/omp/sessions`): canonical absolute path plus identity.
   * This is not a callback `RootRole` and confers no callback authority.
   */
  readonly sessionsRoot: {
    readonly canonicalPath: string;
    readonly identity: ObservedIdentity;
  };
  /** Root-relative components of the candidate journal beneath that root. */
  readonly relativePath: string;
  /** Identity of that candidate, observed through the same metadata reader. */
  readonly targetIdentity: ObservedIdentity;
  /** Byte bound for the bounded prefix read (default 64 KiB). */
  readonly maxBytes?: number;
  /** Injectable native backend calls for testing */
  readonly nativeCalls?: LinuxNativeCalls;
}

/**
 * Read a bounded prefix of one candidate session-journal file for
 * connector-internal lifecycle discovery (D1/D4).
 *
 * Authority is the connector's own trusted lifecycle root, never a requested
 * path or a callback role: this helper does NOT call the callback role
 * dispatcher and exposes no sessions-root grant. It reuses the same
 * constrained-open backend as protected callback IO — link-free, root-relative,
 * descriptor-bound and identity-checked — so a symlinked or replaced journal
 * fails closed instead of being read.
 */
export function readOmpSessionHeaderPrefix(
  options: ReadOmpSessionHeaderPrefixOptions,
): FilesystemAccessResult<string> {
  const { sessionsRoot, relativePath, targetIdentity } = options;
  if (
    typeof sessionsRoot.canonicalPath !== "string" || sessionsRoot.canonicalPath === "" ||
    !isValidSafeIdentity(sessionsRoot.identity)
  ) {
    return {
      ok: false,
      reason: "invalid_context",
      message: "Lifecycle discovery requires an identified sessions root.",
    };
  }
  if (!isValidRelativeComponentPath(relativePath) || relativePath.includes("\\")) {
    return {
      ok: false,
      reason: "unsafe_traversal",
      message: "Lifecycle candidate path must be safe root-relative components.",
    };
  }
  if (!isValidSafeIdentity(targetIdentity)) {
    return {
      ok: false,
      reason: "identity_unavailable",
      message: "Lifecycle candidate identity is unavailable.",
    };
  }

  const root: CanonicalRootInfo = {
    role: "omp-session-artifacts",
    configuredPath: sessionsRoot.canonicalPath,
    canonicalPath: sessionsRoot.canonicalPath,
    identity: sessionsRoot.identity,
    readOnly: true,
  };
  const canonicalTarget = `${sessionsRoot.canonicalPath.replace(/\/+$/, "")}/${relativePath}`;
  const target: CanonicalTarget = {
    acpSessionId: "omp-lifecycle-discovery",
    sessionContextGeneration: "omp-lifecycle-discovery",
    roles: [root.role],
    rootIdentities: [root],
    normalizedInput: canonicalTarget,
    canonicalTarget,
    rootRelativePath: relativePath,
    targetType: "file",
    targetIdentity,
    observedSymlinks: [],
  };

  return performLinuxSecureAccess<string>({
    operation: "read-prefix",
    selectedRoot: root,
    target,
    relativePath,
    isNewFile: false,
    content: "",
    maxBytes: options.maxBytes ?? DEFAULT_READ_PREFIX_BYTES,
    nativeCalls: options.nativeCalls,
  });
}

/**
 * Writes or overwrites a UTF-8 text file securely using canonical observations and descriptor-only IO.
 */
export function writeCanonicalTextFile(
  options: WriteCanonicalTextFileOptions,
): FilesystemAccessResult<void> {
  const admission = validateAccessAdmission(
    options.context,
    options.roots,
    options.target,
    options.selectedRole,
    true,
  );
  if (!admission.ok) {
    return admission;
  }

  return performLinuxSecureAccess({
    operation: "write",
    selectedRoot: admission.value.selectedRoot,
    target: options.target,
    relativePath: admission.value.relativePath,
    isNewFile: admission.value.isNewFile,
    content: options.content,
    nativeCalls: options.nativeCalls,
  });
}
