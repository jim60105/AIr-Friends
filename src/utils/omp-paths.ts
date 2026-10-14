// src/utils/omp-paths.ts
//
// Single source of truth for the mode-scoped native OMP data root and the
// contracted trusted-extension dev→image path selector.
//
// Mirroring the pure-helper pattern of opencode-paths.ts: the selected native
// data root is derived deterministically per approval mode so restricted and
// native-yolo OMP processes never share a mutable native data directory.

import { basename, join, resolve } from "@std/path";
import type { OmpPermissionMode } from "../acp/types.ts";

/**
 * Canonical SOURCE origin of the deployment-owned trusted extension. Shared with
 * downstream rows (12, 13, 14b, 17, 18, 20).
 *
 * `package-bun-compatible-omp-extension` (C3): this is the single-owned canonical
 * SOURCE, not a loadable entry. The artifact that development launch and image
 * installation actually consume is the generated native-loadable bundle —
 * `OMP_TRUSTED_EXTENSION_BUNDLE_PATH` in development,
 * `<OMP_IMAGE_EXTENSION_ROOT>/index.js` in the image. Nothing launches this raw
 * Deno-only source tree any more.
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

/** The single generated artifact's file name (both deployment faces). */
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

/** Image path of the trusted-extension tree root (D4's contracted constant). */
export const OMP_IMAGE_EXTENSION_ROOT = `${OMP_IMAGE_ROOT}/extension`;

/**
 * Image artifact of the trusted extension: the SAME generated bundle contract
 * installed at the owned image root (`<root>/index.js`) by packaging.
 */
export const OMP_IMAGE_EXTENSION_ARTIFACT =
  `${OMP_IMAGE_EXTENSION_ROOT}/${OMP_TRUSTED_EXTENSION_ARTIFACT_NAME}`;

/** Image path of the authored native mode settings (dirs 0755, files 0644). */
export const OMP_IMAGE_CONFIG_ROOT = `${OMP_IMAGE_ROOT}/config`;

/** Image path of the installed SYSTEM.md prompt artifact. */
export const OMP_IMAGE_PROMPT_PATH = `${OMP_IMAGE_ROOT}/prompt/SYSTEM.md`;

/**
 * Contracted system-prompt operator-mount path (the mapping the launch
 * assembly consumes; operator-owned and never relocated by this module).
 */
export const OMP_SYSTEM_PROMPT_MOUNT_PATH = "/app/prompts/system_prompt_override.md";

/**
 * Resolve a contracted authored mode-settings dev path (e.g.
 * `agent-config/omp/restricted.yml`) to its installed copy when present,
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
 * Resolve the required native-loadable extension bundle for the restricted
 * launch: the installed image artifact when present, otherwise the
 * deterministic generated development entry. A missing artifact is reported by
 * the caller with the build remedy — this resolver never falls back to the raw
 * Deno-only source tree.
 */
export function resolveOmpExtensionPath(options: {
  /** Injectable existence probe; defaults to the real filesystem. */
  exists?: (path: string) => boolean;
  /** Injectable image artifact; defaults to the contracted constant. */
  imageArtifact?: string;
  /** Injectable development artifact; defaults to the contracted constant. */
  developmentArtifact?: string;
} = {}): string {
  const exists = options.exists ?? defaultExists;
  const imageArtifact = options.imageArtifact ?? OMP_IMAGE_EXTENSION_ARTIFACT;
  if (exists(imageArtifact)) return imageArtifact;
  return options.developmentArtifact ?? OMP_TRUSTED_EXTENSION_BUNDLE_PATH;
}

/**
 * Resolve the SYSTEM.md prompt artifact (operator-mount mapping).
 *
 * Priority: the mount path wins whenever it exists — mounts are operator-owned
 * and never relocated, and in a stock image that path is populated (bundled
 * default or operator mount). The installed artifact serves installs where the
 * mount path is absent but the image tree is present; without either, the
 * pre-existing development path returns unchanged.
 */
export function resolveOmpSystemPromptPath(options: {
  /** Injectable existence probe; defaults to the real filesystem. */
  exists?: (path: string) => boolean;
  /** Dev/mount path; defaults to the contracted constant. */
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
 * Mode-distinct native `XDG_DATA_HOME` root
 * ({baseRoot}/omp-agent/{mode}/xdg-data).
 *
 * Native OMP redirects its data directory (sessions, database, auth side
 * files) to `$XDG_DATA_HOME/omp` when that application directory already
 * exists, so the launch creates `<this>/omp` before spawn. Restricted and
 * native-yolo never share one mutable native data root.
 */
export function ompXdgDataHome(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(baseRoot, "omp-agent", mode, "xdg-data"));
}
