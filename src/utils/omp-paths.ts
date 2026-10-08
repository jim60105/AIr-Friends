// src/utils/omp-paths.ts
//
// Single source of truth for mode-scoped OMP state, working directory, and
// process temporary roots, plus the contracted trusted extension path selector.
//
// Mirroring the pure-helper pattern of opencode-paths.ts:
// All helpers deterministically derive mode-separated paths so restricted and
// native-yolo OMP processes never share a mutable state root or discoverable cwd.

import { join, resolve } from "@std/path";
import type { OmpPermissionMode } from "../acp/omp-settings.ts";

/**
 * Pinned development-tree source path constant for the deployment-owned trusted extension.
 * Shared with downstream rows (12, 13, 14b, 17, 18, 20).
 * Packaging (row 20) installs this under /opt/air/omp/extension/index.ts.
 */
export const OMP_TRUSTED_EXTENSION_PATH = "src/acp/omp/extension/index.ts";

/**
 * Common parent root for OMP agent state under a given base root.
 */
export function ompProcessStateRoot(baseRoot: string): string {
  return resolve(join(baseRoot, "omp-agent"));
}

/**
 * Mode-distinct PI_CODING_AGENT_DIR root for the process ({baseRoot}/omp-agent/{mode}).
 * This guarantees restricted and native-yolo never share a mutable agent state root.
 */
export function ompAgentDir(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(ompProcessStateRoot(baseRoot), mode));
}

/**
 * Mode-distinct process temporary directory ({baseRoot}/omp-agent/{mode}/tmp).
 */
export function ompProcessTmpDir(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(ompAgentDir(baseRoot, mode), "tmp"));
}

/**
 * Neutral deployment-owned launch working directory ({baseRoot}/omp-agent/{mode}/cwd).
 * By construction, its .omp/ layer is empty, preventing hostile project config discovery.
 */
export function ompLaunchCwd(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(ompAgentDir(baseRoot, mode), "cwd"));
}

/**
 * Process-scoped XDG_DATA_HOME ({baseRoot}/omp-agent/{mode}/xdg-data).
 * Prevents tool-output or data artifacts from polluting the shared home root.
 */
export function ompXdgDataHome(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(ompAgentDir(baseRoot, mode), "xdg-data"));
}
