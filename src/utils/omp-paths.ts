// src/utils/omp-paths.ts
//
// Single source of truth for mode-scoped OMP state, working directory, and
// process temporary roots, plus the contracted trusted extension path selector
// and the row-20 (package-pinned-omp-runtime) dev→image path seam.
//
// Mirroring the pure-helper pattern of opencode-paths.ts:
// All helpers deterministically derive mode-separated paths so restricted and
// native-yolo OMP processes never share a mutable state root or discoverable cwd.

import { basename, join, resolve } from "@std/path";
import type { OmpPermissionMode } from "../acp/omp-settings.ts";

/**
 * Canonical SOURCE origin of the deployment-owned trusted extension. Shared with
 * downstream rows (12, 13, 14b, 17, 18, 20).
 *
 * `package-bun-compatible-omp-extension` (C3): this is the single-owned canonical
 * SOURCE, not a loadable entry. The artifact that development launch and image
 * installation actually consume is the generated native-loadable bundle —
 * `OMP_TRUSTED_EXTENSION_BUNDLE_PATH` in development,
 * `<OMP_IMAGE_EXTENSION_ROOT>/index.js` in the image. Canonical extension-root and
 * source-origin observations of the SELECTED artifact identify that generated file;
 * nothing launches this raw Deno-only source tree any more.
 */
export const OMP_TRUSTED_EXTENSION_PATH = "src/acp/omp/extension/index.ts";

/**
 * Deterministic GENERATED development entry for the trusted extension (C3 D2): the
 * single ESM bundle `scripts/omp/bundle-omp-extension.sh` emits from canonical
 * source plus locked dependencies (frozen lock; `deno task bundle:omp-extension`
 * builds it). Development launch and the image consume the SAME artifact contract;
 * a missing generated development entry fails the launch preflight with the build
 * remedy — the resolver NEVER falls back to the raw Deno-only source tree.
 */
export const OMP_TRUSTED_EXTENSION_BUNDLE_DIR = "build/omp-extension";

/**
 * The single generated artifact's file name. One name serves BOTH deployment
 * faces (`bind-omp-owned-module-evidence`): the fixed image artifact and the
 * development bundle are the same generated contract installed in two trees,
 * so the declared root + this name is the whole module-identity surface.
 */
export const OMP_TRUSTED_EXTENSION_ARTIFACT_NAME = "index.js";

/** Deterministic generated development artifact path (relative to the checkout). */
export const OMP_TRUSTED_EXTENSION_BUNDLE_PATH =
  `${OMP_TRUSTED_EXTENSION_BUNDLE_DIR}/${OMP_TRUSTED_EXTENSION_ARTIFACT_NAME}`;

/**
 * Root-owned image tree installed by the OMP packaging steps (design D3/D4:
 * outside every agent-writable root — never under /app/data, /app/prompts, or
 * /home/deno). Existence of this root IS the deployment signal; development
 * checkouts never own /opt/air, so every image-first resolution below keeps
 * byte-identical dev behavior.
 */
export const OMP_IMAGE_ROOT = "/opt/air/omp";

/**
 * Generated skill-root declaration path for one mode
 * (`align-omp-skill-trust-to-shared-root` D3): `{baseRoot}/omp-overlays/{mode}-skill-root.yml`,
 * written at spawn time with exactly one key — the deployment-RESOLVED skill
 * custom-directory array. There is no fixed skill-root constant anymore: the
 * declaration carries whatever root the deployment resolved from
 * `agent.skillsDir` (the ONE root both agent types share), and the declaration
 * is passed FIRST among the `--config` overlays so the authored mode document
 * stays last.
 *
 * The directory sits outside the mode-scoped process state area
 * (`{baseRoot}/omp-agent/{mode}`), so the pre-native-request overlay observer
 * accepts the path by placement; like every other overlay it is link-,
 * regular-file-, canonical-parent- and accepted-identity-checked, and the
 * daemon rewrites it (symlink-refusing, unconditional overwrite) at every
 * spawn, so a post-spawn rewrite is revealed by the accepted identity.
 */
export function ompSkillRootDeclarationPath(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(baseRoot, "omp-overlays", `${mode}-skill-root.yml`));
}

/** Image path of the trusted-extension tree root (D4's contracted constant). */
export const OMP_IMAGE_EXTENSION_ROOT = `${OMP_IMAGE_ROOT}/extension`;

/**
 * Image artifact of the trusted extension: the SAME generated bundle contract
 * installed at the owned image root (`<root>/index.js`) by packaging. This is
 * the fixed image face of the deployment-module declaration
 * (`bind-omp-owned-module-evidence`), never a development-tree path.
 */
export const OMP_IMAGE_EXTENSION_ARTIFACT =
  `${OMP_IMAGE_EXTENSION_ROOT}/${OMP_TRUSTED_EXTENSION_ARTIFACT_NAME}`;

/** Image path of the owned settings overlays (D3: dirs 0755, files 0644). */
export const OMP_IMAGE_CONFIG_ROOT = `${OMP_IMAGE_ROOT}/config`;

/** Image path of the owned SYSTEM.md prompt artifact. */
export const OMP_IMAGE_PROMPT_PATH = `${OMP_IMAGE_ROOT}/prompt/SYSTEM.md`;

/**
 * Row-8 contracted system-prompt operator-mount path (the mapping the launch
 * assembly consumes; operator-owned and never relocated by this module).
 */
export const OMP_SYSTEM_PROMPT_MOUNT_PATH = "/app/prompts/system_prompt_override.md";

/**
 * Resolve a contracted owned-settings dev path (e.g.
 * `agent-config/omp/restricted.yml`) to its installed overlay when present,
 * otherwise the pre-existing development-tree path, verbatim.
 */
export function resolveOmpConfigPath(
  devPath: string,
  options: {
    /** Injectable existence probe; defaults to the real filesystem. */
    exists?: (path: string) => boolean;
    /** Injectable image config root; defaults to the contracted constant. */
    imageConfigRoot?: string;
  } = {},
): string {
  const exists = options.exists ?? defaultExists;
  const imagePath = join(options.imageConfigRoot ?? OMP_IMAGE_CONFIG_ROOT, basename(devPath));
  return exists(imagePath) ? imagePath : devPath;
}

/**
 * Resolve the owned SYSTEM.md prompt artifact (row-8 mapping).
 *
 * Priority (D4, spec "Operator prompt mount honored"): the row-8 mount path
 * wins whenever it exists — mounts are operator-owned and never relocated, and
 * in a stock image that path is populated (bundled default or operator mount),
 * exactly as row 8 defined. The owned artifact serves installs where the
 * mount path is absent but the owned tree is present (its digest is covered by
 * PACKAGE-MANIFEST.sha256 either way); without either, the pre-existing
 * development path returns unchanged.
 */
export function resolveOmpSystemPromptPath(options: {
  /** Injectable existence probe; defaults to the real filesystem. */
  exists?: (path: string) => boolean;
  /** Row-8 dev/mount path; defaults to the contracted constant. */
  devPath?: string;
  /** Injectable image prompt path; defaults to the contracted constant. */
  imagePromptPath?: string;
} = {}): string {
  const exists = options.exists ?? defaultExists;
  const devPath = options.devPath ?? OMP_SYSTEM_PROMPT_MOUNT_PATH;
  if (exists(devPath)) return devPath;
  const imagePath = options.imagePromptPath ?? OMP_IMAGE_PROMPT_PATH;
  return exists(imagePath) ? imagePath : devPath;
}

/** Real-filesystem existence probe used by the resolvers above. */
function defaultExists(path: string): boolean {
  try {
    const info = Deno.statSync(path);
    return info.isFile;
  } catch {
    return false;
  }
}

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

/**
 * Deployment-owned HOME for the OMP child ({baseRoot}/omp-agent/{mode}/home).
 * Row 26 (`isolate-omp-settings-discovery`): HOME is assigned explicitly to
 * this owned directory so the native homedir fallback can never return the
 * daemon home; it stays mode-distinct and separate from payload staging
 * ({workspace}/tmp/{sessionId}) by construction.
 */
export function ompOwnedHome(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(ompAgentDir(baseRoot, mode), "home"));
}
