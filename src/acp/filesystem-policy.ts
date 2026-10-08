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
} from "./filesystem-roots.ts";
import type {
  FilesystemAccessFailureReason,
} from "./filesystem-access.ts";
import type { SessionGateContext } from "./client.ts";
import type { ClientConfig } from "./types.ts";

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
  | "rejected_read_extension";

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
): { ok: true; context: SessionContext } | { ok: false; reason: "rejected_filesystem_context"; message: string } {
  if (!acpSessionId || !gateCtx) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "No registered authoritative session context for ACP session",
    };
  }

  // Shell / skill session ID is required for explicit staging path
  const skillSessionId = gateCtx.shellSessionId ?? clientConfig.sessionId;
  if (!skillSessionId) {
    return {
      ok: false,
      reason: "rejected_filesystem_context",
      message: "Missing shell/skill session ID in registered session context",
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
  };

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
};

/**
 * Compile-time verified exhaustive map from FilesystemAccessFailureReason to bounded denial reasons.
 */
export const FILESYSTEM_ACCESS_FAILURE_MAP: Record<FilesystemAccessFailureReason, FilesystemDenialReason> = {
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

  // 2. Workspace, staging, or shared root admission
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
        message: `File extension '${ext}' not allowed for reads (permitted: ${allowedReadExtensions.join(", ")})`,
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
    target,
    yolo,
    canWriteAgentWorkspace = false,
    allowedWriteExtensions = [".md", ".txt"],
  } = params;

  // 1. Trusted skills root is ALWAYS write-denied in both restricted and YOLO modes
  if (target.roles.includes("trusted-skills") && target.roles.length === 1) {
    return {
      ok: false,
      reason: "rejected_trusted_skills_read_only",
      message: "Trusted skills root is read-only",
    };
  }

  const access: "overwrite" | "create" = target.targetType === "file" ? "overwrite" : "create";

  // 2. YOLO mode: broad physical containment (workspace or shared role allowed for any extension)
  if (yolo) {
    if (target.roles.includes("trusted-skills")) {
      return {
        ok: false,
        reason: "rejected_trusted_skills_read_only",
        message: "Trusted skills root is read-only even in YOLO mode",
      };
    }

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
        message: "Session is not authorized to write to the shared agent workspace (canWriteAgentWorkspace not set)",
      };
    }

    const ext = extname(target.canonicalTarget).toLowerCase();
    const isAllowed = allowedWriteExtensions.some((allowed) => allowed.toLowerCase() === ext);
    if (!isAllowed) {
      return {
        ok: false,
        reason: "rejected_write_extension",
        message: `File extension '${ext}' not allowed for shared agent workspace writes (permitted: ${allowedWriteExtensions.join(", ")})`,
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

  // d. If target has trusted-skills role along with others (though roots should be disjoint)
  if (target.roles.includes("trusted-skills")) {
    return {
      ok: false,
      reason: "rejected_trusted_skills_read_only",
      message: "Trusted skills root is read-only",
    };
  }

  return {
    ok: false,
    reason: "rejected_write_path_outside_workspace",
    message: "Path is outside authorized writable roots",
  };
}
