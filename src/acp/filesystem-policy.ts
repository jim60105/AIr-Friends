/**
 * Pure authorization decision logic and context assembly for ACP filesystem operations.
 *
 * Implements OpenSpec change `enforce-acp-filesystem-authorization`.
 */

import { extname } from "@std/path";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  RootPathFailureReason,
  RootRole,
  SessionContext,
  TrustedSkillsRootConfig,
} from "./filesystem-roots.ts";
import type { FilesystemAccessFailureReason } from "./filesystem-access.ts";
import type { SessionGateContext } from "./client.ts";
import type { ClientConfig } from "./types.ts";
import {
  isWithinRoot,
  OMP_BASH_ARTIFACT_NAME_PATTERN,
  validateSessionContext,
} from "./filesystem-roots.ts";

/** Trusted lifecycle input; never derived from a requested path or ambient HOME. */
export interface TrustedSkillsSource extends TrustedSkillsRootConfig {
  readonly canonicalOwnedRootPath: string;
}

/**
 * Bounded denial reasons documented for ACP filesystem operations.
 */
export type FilesystemDenialReason =
  | "rejected_filesystem_context"
  | "rejected_filesystem_path_unavailable"
  | "rejected_filesystem_access"
  | "rejected_write_path_outside_workspace"
  | "rejected_agent_workspace_write_unauthorized"
  | "rejected_write_extension"
  | "rejected_workspace_write_restricted"
  | "rejected_trusted_skills_read_only"
  | "rejected_trusted_skills_identity"
  | "rejected_read_extension"
  | "rejected_omp_native_state";

/**
 * Result of an authorization evaluation.
 */
export interface FilesystemAuthorizationSuccess {
  readonly ok: true;
  readonly role: RootRole;
  readonly access: "read" | "overwrite" | "create";
  readonly useTrustedReadRule: boolean;
}

export interface FilesystemAuthorizationDenial {
  readonly ok: false;
  readonly reason: FilesystemDenialReason;
  readonly message: string;
}

export type FilesystemAuthorizationResult =
  | FilesystemAuthorizationSuccess
  | FilesystemAuthorizationDenial;

/**
 * Assembles a SessionContext for predecessor canonical root and access validation.
 * Rejects unregistered/missing session contexts immediately.
 */
export function buildSessionFilesystemContext(
  acpSessionId: string | undefined,
  gateCtx: SessionGateContext | undefined,
  clientConfig: ClientConfig,
  currentGeneration: string,
): { ok: true; context: SessionContext } | {
  ok: false;
  reason: "rejected_filesystem_context";
  message: string;
} {
  if (!acpSessionId || !gateCtx) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "No registered authoritative session context for ACP session",
    };
  }

  // Shell / skill session ID is required for explicit staging path
  const skillSessionId = gateCtx.shellSessionId;
  if (!skillSessionId || !currentGeneration) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "Missing registered filesystem owner or generation",
    };
  }

  const sessionCwd = gateCtx.cwd;
  if (!sessionCwd) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "Missing cwd in registered session context",
    };
  }

  // Normalize / resolve explicit staging path: {cwd}/tmp/{skillSessionId}
  const explicitStagingPath = `${sessionCwd.replace(/\/+$/, "")}/tmp/${skillSessionId}`;

  const context: SessionContext = {
    acpSessionId,
    skillSessionId,
    sessionCwd,
    explicitStagingPath,
    sharedWorkspacePath: clientConfig.agentWorkspacePath,
    sessionContextGeneration: currentGeneration,
    // OMP native-state provenance is bound to the cwd it was derived for. A
    // provenance from another cwd (a re-registration that moved the session) is
    // dropped rather than re-bound: the artifact capability and the reservation
    // belong to exactly one native state tree, and unrelated workspace
    // operations must keep working.
    ...(gateCtx.ompNativeState?.cwd === sessionCwd
      ? { ompNativeState: gateCtx.ompNativeState }
      : {}),
  };

  if (!validateSessionContext(context).ok) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "Invalid registered filesystem context",
    };
  }
  return { ok: true, context };
}

/**
 * Compile-time verified exhaustive map from RootPathFailureReason to bounded denial reasons.
 */
export const ROOT_PATH_FAILURE_MAP: Record<RootPathFailureReason, FilesystemDenialReason> = {
  invalid_context: "rejected_filesystem_context",
  invalid_path: "rejected_filesystem_path_unavailable",
  unresolved_token: "rejected_filesystem_path_unavailable",
  invalid_root: "rejected_filesystem_path_unavailable",
  root_unavailable: "rejected_filesystem_path_unavailable",
  root_overlap: "rejected_trusted_skills_identity",
  outside_roots: "rejected_filesystem_path_unavailable",
  symlink_escape: "rejected_filesystem_path_unavailable",
  dangling_symlink: "rejected_filesystem_path_unavailable",
  symlink_loop: "rejected_filesystem_path_unavailable",
  not_found: "rejected_filesystem_path_unavailable",
  wrong_target_type: "rejected_filesystem_path_unavailable",
  canonicalization_failed: "rejected_filesystem_path_unavailable",
  path_changed: "rejected_filesystem_path_unavailable",
  trusted_identity_mismatch: "rejected_trusted_skills_identity",
  reserved_native_state: "rejected_omp_native_state",
};

/**
 * Compile-time verified exhaustive map from FilesystemAccessFailureReason to bounded denial reasons.
 */
export const FILESYSTEM_ACCESS_FAILURE_MAP: Record<
  FilesystemAccessFailureReason,
  FilesystemDenialReason
> = {
  invalid_context: "rejected_filesystem_context",
  outside_roots: "rejected_filesystem_path_unavailable",
  identity_unavailable: "rejected_filesystem_access",
  path_changed: "rejected_filesystem_access",
  unsafe_traversal: "rejected_filesystem_access",
  root_unavailable: "rejected_filesystem_access",
  parent_missing: "rejected_filesystem_access",
  wrong_target_type: "rejected_filesystem_access",
  unsupported_platform: "rejected_filesystem_access",
  secure_access_unavailable: "rejected_filesystem_access",
  access_denied: "rejected_filesystem_access",
  io_failed: "rejected_filesystem_access",
};

/**
 * Map RootPathFailure to a bounded denial reason, preserving write-specific outside-workspace reason.
 */
export function mapRootPathFailureToDenial(
  reason: RootPathFailureReason,
  isWrite: boolean = false,
): FilesystemDenialReason {
  if (isWrite && (reason === "outside_roots" || reason === "symlink_escape")) {
    return "rejected_write_path_outside_workspace";
  }
  return ROOT_PATH_FAILURE_MAP[reason] ?? "rejected_filesystem_path_unavailable";
}

/**
 * Map FilesystemAccessFailure to a bounded denial reason, preserving write-specific outside-workspace reason.
 */
export function mapAccessFailureToDenial(
  reason: FilesystemAccessFailureReason,
  isWrite: boolean = false,
): FilesystemDenialReason {
  if (isWrite && reason === "outside_roots") {
    return "rejected_write_path_outside_workspace";
  }
  return FILESYSTEM_ACCESS_FAILURE_MAP[reason] ?? "rejected_filesystem_access";
}

export interface AuthorizeReadParams {
  readonly roots: CanonicalSessionRoots;
  readonly target: CanonicalTarget;
  readonly allowedReadExtensions?: readonly string[];
}

/**
 * Authorize read operation based on canonical target roles.
 * Trusted-skills root admits any extension (root-scoped).
 * Workspace, staging, and shared roots enforce allowedReadExtensions (.jsonl, .md, .txt).
 */
export function authorizeFilesystemRead(
  params: AuthorizeReadParams,
): FilesystemAuthorizationResult {
  const { target, allowedReadExtensions = [".jsonl", ".md", ".txt"] } = params;

  // 1. Trusted skills admission check (root-scoped, no extension restriction)
  if (target.roles.includes("trusted-skills")) {
    return {
      ok: true,
      role: "trusted-skills",
      access: "read",
      useTrustedReadRule: true,
    };
  }

  // 2. Current-session OMP bash artifacts (D2): the artifact role admits a
  // DIRECT regular `<numeric-id>.bash.log` child and nothing else. The ordinary
  // extension allowlist does not apply, and no other name, nested child or
  // broader root is substituted. Native state is reserved away from every broad
  // role, so this branch is the only read authority there.
  if (target.roles.includes("omp-session-artifacts")) {
    const name = target.rootRelativePath;
    if (
      name.includes("/") || name.includes("\\") || !OMP_BASH_ARTIFACT_NAME_PATTERN.test(name)
    ) {
      return {
        ok: false,
        reason: name.includes("/") || name.includes("\\")
          ? "rejected_filesystem_path_unavailable"
          : "rejected_read_extension",
        message: `OMP bash artifacts admit only direct '<numeric-id>.bash.log' children: '${name}'`,
      };
    }
    if (target.targetType !== "file" || target.observedSymlinks.length > 0) {
      return {
        ok: false,
        reason: "rejected_filesystem_path_unavailable",
        message: "OMP bash artifacts must be regular files reached without request-time links",
      };
    }
    return {
      ok: true,
      role: "omp-session-artifacts",
      access: "read",
      useTrustedReadRule: false,
    };
  }

  // 3. Workspace, staging, or shared root admission
  const hasWorkspaceRole = target.roles.includes("workspace") ||
    target.roles.includes("staging") ||
    target.roles.includes("shared");

  if (hasWorkspaceRole) {
    const ext = extname(target.canonicalTarget).toLowerCase();
    const isAllowed = allowedReadExtensions.some((allowed) => allowed.toLowerCase() === ext);
    if (!isAllowed) {
      return {
        ok: false,
        reason: "rejected_read_extension",
        message: `File extension '${ext}' not allowed for reads (permitted: ${
          allowedReadExtensions.join(", ")
        })`,
      };
    }

    // Role priority: staging -> shared -> workspace
    let selectedRole: RootRole = "workspace";
    if (target.roles.includes("staging")) {
      selectedRole = "staging";
    } else if (target.roles.includes("shared")) {
      selectedRole = "shared";
    }

    return {
      ok: true,
      role: selectedRole,
      access: "read",
      useTrustedReadRule: false,
    };
  }

  return {
    ok: false,
    reason: "rejected_filesystem_path_unavailable",
    message: "Path is outside authorized readable roots",
  };
}

export interface AuthorizeWriteParams {
  readonly roots: CanonicalSessionRoots;
  readonly target: CanonicalTarget;
  readonly yolo: boolean;
  readonly canWriteAgentWorkspace?: boolean;
  readonly allowedWriteExtensions?: readonly string[];
}

/**
 * Authorize write operation based on canonical target roles and session mode.
 */
export function authorizeFilesystemWrite(
  params: AuthorizeWriteParams,
): FilesystemAuthorizationResult {
  const {
    roots,
    target,
    yolo,
    canWriteAgentWorkspace = false,
    allowedWriteExtensions = [".md", ".txt"],
  } = params;

  // 1. Trusted skills root is ALWAYS write-denied in both restricted and YOLO modes
  if (target.roles.includes("trusted-skills")) {
    return {
      ok: false,
      reason: "rejected_trusted_skills_read_only",
      message: "Trusted skills root is read-only",
    };
  }

  // 2. Current-session OMP bash artifacts are read-only in every mode, and
  // reserved OMP native state admits no callback mutation at all. This precedes
  // the YOLO branch deliberately: broad workspace membership beneath the
  // session cwd never authorizes native-state writes or destructive targets
  // (D3). Native shell execution is unaffected — this gate only covers ACP
  // callbacks.
  if (
    target.roles.includes("omp-session-artifacts") ||
    (roots.reservedOmpState ?? []).some((reserved) =>
      isWithinRoot(target.canonicalTarget, reserved)
    )
  ) {
    return {
      ok: false,
      reason: "rejected_omp_native_state",
      message: "OMP native state is read-only for ACP callbacks",
    };
  }

  const access: "overwrite" | "create" = target.targetType === "file" ? "overwrite" : "create";

  // 3. YOLO mode: broad physical containment (workspace or shared role allowed for any extension)
  if (yolo) {
    if (target.roles.includes("staging")) {
      return { ok: true, role: "staging", access, useTrustedReadRule: false };
    }
    if (target.roles.includes("shared")) {
      return { ok: true, role: "shared", access, useTrustedReadRule: false };
    }
    if (target.roles.includes("workspace")) {
      return { ok: true, role: "workspace", access, useTrustedReadRule: false };
    }

    return {
      ok: false,
      reason: "rejected_write_path_outside_workspace",
      message: "Path is outside allowed workspace roots in YOLO mode",
    };
  }

  // 3. Restricted mode:
  // Role priority & ordering:
  // a. Staging root: allow (no extension filter)
  if (target.roles.includes("staging")) {
    return { ok: true, role: "staging", access, useTrustedReadRule: false };
  }

  // b. Shared Agent workspace: requires canWriteAgentWorkspace === true AND allowed extension
  if (target.roles.includes("shared")) {
    if (!canWriteAgentWorkspace) {
      return {
        ok: false,
        reason: "rejected_agent_workspace_write_unauthorized",
        message:
          "Session is not authorized to write to the shared agent workspace (canWriteAgentWorkspace not set)",
      };
    }

    const ext = extname(target.canonicalTarget).toLowerCase();
    const isAllowed = allowedWriteExtensions.some((allowed) => allowed.toLowerCase() === ext);
    if (!isAllowed) {
      return {
        ok: false,
        reason: "rejected_write_extension",
        message:
          `File extension '${ext}' not allowed for shared agent workspace writes (permitted: ${
            allowedWriteExtensions.join(", ")
          })`,
      };
    }

    return { ok: true, role: "shared", access, useTrustedReadRule: false };
  }

  // c. User workspace (ordinary user-workspace file that is not staging or shared)
  if (target.roles.includes("workspace")) {
    return {
      ok: false,
      reason: "rejected_workspace_write_restricted",
      message: "Direct user workspace writes outside session staging root are restricted",
    };
  }

  return {
    ok: false,
    reason: "rejected_write_path_outside_workspace",
    message: "Path is outside authorized writable roots",
  };
}
