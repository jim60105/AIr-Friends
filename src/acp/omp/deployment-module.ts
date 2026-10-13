/**
 * Declared Deployment-Module Identity (`bind-omp-owned-module-evidence`).
 *
 * The trusted extension is ONE generated artifact (a single ESM bundle) that
 * can be installed in two DECLARED trees: the fixed root-owned image face
 * (`/opt/air/omp/extension/index.js`) and the development build-owned face
 * (`<canonical checkout>/build/omp-extension/index.js`). This module owns that
 * declaration — the artifact, its canonical root, its ownership posture and
 * the permitted dependency closure — plus the PURE policy that decides whether
 * a physical observation of those exact paths is a trustworthy deployment
 * module. It is deliberately free of filesystem IO, runtime globals and
 * session data: the physical reader lives in `owned-module-evidence.ts` and
 * the launch assembly consumes the SAME declaration type.
 *
 * Three identities stay distinct (design "Three distinct identities"):
 *   1. process launch identity — observed cwd / mode / mode-scoped state
 *      namespace (mutable, never module authority);
 *   2. deployment module identity — the declaration and its physical
 *      observation below;
 *   3. session filesystem context — acquired elsewhere, absent in production,
 *      and never manufactured from either of the other two.
 *
 * Honesty boundaries: physical self-evidence proves the DECLARED deployment
 * location, ownership posture and identity stability of the running artifact;
 * it does not authenticate the bundle's bytes, does not prove the official
 * host loaded the extension, and does not claim ACL-, capability- or
 * mount-independent immutability. The image posture (`uid 0` plus no
 * group/other write on the declared root and artifact) is the stock image's
 * non-root deployment precondition, and exclusion of ancestors ABOVE the
 * declared root remains a packaging fact, not something this observer checks.
 * The replacement fingerprint is metadata-derived, not a content digest: an
 * owner who rewrites equal-sized bytes and restores mtime within the same
 * inode is outside what this evidence can detect — that residual is the
 * declared development/source-ownership contract, not a claim of image-grade
 * integrity.
 */

import { dirname } from "@std/path";
import {
  OMP_IMAGE_EXTENSION_ARTIFACT,
  OMP_IMAGE_EXTENSION_ROOT,
  OMP_TRUSTED_EXTENSION_ARTIFACT_NAME,
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
} from "../../utils/omp-paths.ts";
import { isWithinRoot, type RootPathFailureReason } from "../filesystem-roots.ts";

/** Which declared deployment face an artifact belongs to. */
export type DeploymentModulePosture = "image" | "development";

/**
 * One declared generated-artifact face: the exact artifact, its canonical
 * module root, the ownership posture the artifact must present, and the
 * permitted dependency closure (the emitted external edges the artifact may
 * carry — the single documented host facade plus the documented native
 * builtins this closure consumes). One declaration type is shared by the
 * launch argument assembly (which selects the face to launch) and the runtime
 * verifier (which observes and anchors the loaded face).
 */
export interface DeploymentModuleDeclaration {
  /** Exact absolute canonical artifact path (the loaded generated bundle). */
  readonly artifact: string;
  /** Declared canonical module root the artifact must sit directly under. */
  readonly root: string;
  readonly posture: DeploymentModulePosture;
  /** Permitted emitted dependency edges of this artifact (never a path list). */
  readonly dependencyClosure: readonly string[];
}

/**
 * The permitted dependency closure of the generated bundle: the ONE host
 * facade external (host-resolved before any import-map lookup), the
 * runtime-portable DNS seam, and the metadata-reader `require` edge the
 * runtime reads its own deployment evidence through. Native `node:`/`bun:`
 * builtins outside this list stay governed by the emitted-edge audit's
 * documented native-builtin policy; no workspace/package-cache closure is
 * ever added.
 */
export const DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE: readonly string[] = Object.freeze([
  "@sinclair/typebox",
  "node:dns/promises",
  "node:fs",
]);

/**
 * Build-time placeholder the existing bundler replaces with the canonical
 * source checkout root of the artifact it is cutting. The placeholder exists
 * ONLY so a source-imported copy of this module (a plain `deno test` import,
 * never a launch) can carry the declaration type; no consumer of an
 * unsubstituted placeholder ever obtains module authority, because the
 * placeholder path is not a loadable canonical artifact.
 */
export const OMP_CANONICAL_SOURCE_ROOT_PLACEHOLDER = "@@OMP_CANONICAL_SOURCE_ROOT@@";

/**
 * Development face: the canonical checkout's own generated artifact. The root
 * is the bundle's output directory, NEVER the checkout or the repository (a
 * whole-repository or module-parent inference is exactly what this change
 * removes).
 */
export const OMP_DEVELOPMENT_MODULE_ROOT = `${OMP_CANONICAL_SOURCE_ROOT_PLACEHOLDER}/${
  dirname(OMP_TRUSTED_EXTENSION_BUNDLE_PATH)
}`;

/** Development artifact path (canonical checkout root + the generated bundle). */
export const OMP_DEVELOPMENT_MODULE_ARTIFACT =
  `${OMP_DEVELOPMENT_MODULE_ROOT}/${OMP_TRUSTED_EXTENSION_ARTIFACT_NAME}`;

/** The fixed image face: the same generated artifact installed in the image. */
export const OMP_IMAGE_MODULE_DECLARATION: DeploymentModuleDeclaration = Object.freeze({
  artifact: OMP_IMAGE_EXTENSION_ARTIFACT,
  root: OMP_IMAGE_EXTENSION_ROOT,
  posture: "image",
  dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
});

/** The build-owned development face. */
export const OMP_DEVELOPMENT_MODULE_DECLARATION: DeploymentModuleDeclaration = Object.freeze({
  artifact: OMP_DEVELOPMENT_MODULE_ARTIFACT,
  root: OMP_DEVELOPMENT_MODULE_ROOT,
  posture: "development",
  dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
});

/** Both declared faces, image first (the image face is the deployed truth). */
export const DEPLOYMENT_MODULE_DECLARATIONS: readonly DeploymentModuleDeclaration[] = Object.freeze(
  [
    OMP_IMAGE_MODULE_DECLARATION,
    OMP_DEVELOPMENT_MODULE_DECLARATION,
  ],
);

/**
 * Local `file:` module URL → filesystem path (runtime-supported reader only;
 * no Deno-only API at module scope). A remote/opaque or unparseable URL yields
 * "" — module identity is NEVER inferred from a URL that does not name a local
 * file, and the callers fail closed on the empty answer.
 */
export function moduleUrlToPath(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "file:") return "";
  try {
    return decodeURIComponent(parsed.pathname);
  } catch {
    return "";
  }
}

/**
 * The launch-time face selection: the image face when the installed artifact
 * exists, otherwise the generated development artifact CONTRACT (the
 * repository bundling command emits it; a missing one fails the launch
 * preflight with the build remedy, so no raw-source or module-parent fallback
 * exists). Behavior is byte-identical to the pre-existing image-first
 * resolver; the returned declaration is the same type the runtime verifier
 * consumes.
 */
export function selectLaunchDeploymentModule(options: {
  /** Injectable existence probe; defaults to the real filesystem. */
  exists?: (path: string) => boolean;
} = {}): DeploymentModuleDeclaration {
  const exists = options.exists ?? defaultExists;
  if (exists(OMP_IMAGE_MODULE_DECLARATION.artifact)) return OMP_IMAGE_MODULE_DECLARATION;
  // The development face is launched by its repository-relative generated
  // path (the checkout's own bundling contract); only the BUNDLE carries the
  // canonical absolute development declaration, because only the build that
  // emitted it knows the checkout it was cut from.
  return {
    artifact: OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
    root: dirname(OMP_TRUSTED_EXTENSION_BUNDLE_PATH),
    posture: "development",
    dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
  };
}

/** Real-filesystem existence probe (launch selection only). */
function defaultExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Physical observation evidence (pure data produced by the metadata reader).
// ---------------------------------------------------------------------------

/** One observed path's complete metadata evidence (no nullable/coerced fields). */
export interface OwnedModulePathEvidence {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
  readonly uid: number;
  readonly nlink: number;
}

/**
 * One deployment-specific physical observation of the declared module. This is
 * a MODULE evidence value: it is not a `CanonicalTarget`, carries no session
 * id/role and grants no read/write/destructive authority, and no conversion
 * from it to session authority exists.
 */
export interface OwnedModuleObservation {
  readonly declaration: DeploymentModuleDeclaration;
  /** Artifact path THIS process's own module URL presented (never roster/model input). */
  readonly presentedArtifactPath: string;
  /** `realpath(presentedArtifactPath)` — must equal the declared canonical artifact. */
  readonly canonicalArtifactPath: string;
  /** The declared root's metadata (observed link-free, directly above the artifact). */
  readonly root: OwnedModulePathEvidence;
  /** The declared artifact's metadata (observed link-free, singly linked regular file). */
  readonly artifact: OwnedModulePathEvidence;
  /** Metadata replacement fingerprint derived from the observed identities. */
  readonly replacementFingerprint: string;
  /** Row-12 resource generation observed together with this physical read. */
  readonly resourceGeneration: string;
  /** Live registry epoch this observation is stamped with (current-call freshness). */
  readonly registryEpoch: number;
}

/**
 * The accepted (anchored) module identity. Acceptance happens once, at
 * registration: later observations are compared against it and never replace
 * it — a changed module or failed observation denies instead of silently
 * re-anchoring to whatever is present now.
 */
export interface OwnedModuleAnchor {
  readonly accepted: true;
  readonly declaration: DeploymentModuleDeclaration;
  readonly canonicalArtifactPath: string;
  readonly root: OwnedModulePathEvidence;
  readonly artifact: OwnedModulePathEvidence;
  readonly replacementFingerprint: string;
  /** Accepted generation; a rotated generation denies (a rebuild needs a fresh launch). */
  readonly resourceGeneration: string;
}

/** Bounded ownership verdict (reason text plus the canonical failure taxonomy). */
export interface OwnedModuleOwnershipVerdict {
  readonly trusted: boolean;
  readonly reason: string;
  readonly failureReason?: RootPathFailureReason;
}

/** Derive the replacement fingerprint from observed identities (single derivation). */
export function replacementFingerprintFor(evidence: OwnedModulePathEvidence): string {
  return [
    evidence.dev,
    evidence.ino,
    evidence.size,
    evidence.mtimeMs,
    evidence.mode,
  ].join(":");
}

/**
 * Anchor one physically accepted observation (the single acceptance point).
 * Acceptance is the caller's decision to TRUST this observation; callers run
 * `verifyOwnedModuleObservation` first, and the anchor deliberately keeps only
 * the identity facts a later observation must still present.
 */
export function acceptOwnedModuleAnchor(observation: OwnedModuleObservation): OwnedModuleAnchor {
  return {
    accepted: true,
    declaration: observation.declaration,
    canonicalArtifactPath: observation.canonicalArtifactPath,
    root: observation.root,
    artifact: observation.artifact,
    replacementFingerprint: observation.replacementFingerprint,
    resourceGeneration: observation.resourceGeneration,
  };
}

function denied(reason: string, failureReason: RootPathFailureReason): OwnedModuleOwnershipVerdict {
  return { trusted: false, reason, failureReason };
}

/** Every numeric metadata field must be a real non-negative integer (never coerced). */
function hasCompleteMetadata(evidence: OwnedModulePathEvidence): boolean {
  const numeric: readonly number[] = [
    evidence.dev,
    evidence.ino,
    evidence.size,
    evidence.mode,
    evidence.uid,
    evidence.nlink,
  ];
  if (!numeric.every((value) => Number.isInteger(value) && value >= 0)) return false;
  return Number.isFinite(evidence.mtimeMs) && evidence.mtimeMs >= 0;
}

function sameDeclaration(
  a: DeploymentModuleDeclaration,
  b: DeploymentModuleDeclaration,
): boolean {
  return a.artifact === b.artifact && a.root === b.root && a.posture === b.posture;
}

/**
 * The pure deployment-module ownership policy: does this physical observation
 * of the DECLARED artifact satisfy its declaration? Checks, in fail-closed
 * order — declaration coherence (artifact directly under its declared root,
 * absolute spelling), observation coherence (the recorded declaration and both
 * observed paths), complete numeric metadata, a link-free root over a
 * link-free singly-linked regular artifact file inside the declared root, the
 * posture-specific ownership/mode requirement, and a fingerprint that really
 * is derived from the observed identities. No session role, no session id and
 * no cross-policy canonicalizer participates: containment reuses the shared
 * canonical `isWithinRoot` predicate.
 */
export function verifyOwnedModuleObservation(
  declaration: DeploymentModuleDeclaration,
  observation: OwnedModuleObservation,
): OwnedModuleOwnershipVerdict {
  if (
    declaration.artifact !== `${declaration.root}/${OMP_TRUSTED_EXTENSION_ARTIFACT_NAME}` ||
    !declaration.artifact.startsWith("/") || declaration.root === "/"
  ) {
    return denied(
      "Declared deployment module artifact is not a rooted bundle path",
      "invalid_path",
    );
  }
  if (!sameDeclaration(declaration, observation.declaration)) {
    return denied(
      "Module observation does not match the evaluated deployment declaration",
      "trusted_identity_mismatch",
    );
  }
  if (
    observation.presentedArtifactPath === "" ||
    !observation.presentedArtifactPath.startsWith("/") ||
    observation.canonicalArtifactPath !== declaration.artifact ||
    observation.artifact.path !== declaration.artifact ||
    observation.root.path !== declaration.root
  ) {
    return denied(
      "Module artifact identity does not match the declared deployment artifact",
      "trusted_identity_mismatch",
    );
  }
  if (!hasCompleteMetadata(observation.root) || !hasCompleteMetadata(observation.artifact)) {
    return denied("Module metadata is missing or not fully observed", "not_found");
  }
  if (observation.root.isSymbolicLink || !observation.root.isDirectory) {
    return denied("Declared module root is not a plain directory", "symlink_escape");
  }
  if (observation.artifact.isSymbolicLink || !observation.artifact.isFile) {
    return denied("Declared module artifact is not a link-free regular file", "symlink_escape");
  }
  if (observation.artifact.nlink !== 1) {
    return denied("Declared module artifact is aliased (hard-linked)", "path_changed");
  }
  if (!isWithinRoot(observation.artifact.path, observation.root.path)) {
    return denied(
      `Module artifact '${observation.artifact.path}' outside its declared root`,
      "outside_roots",
    );
  }
  const postureVerdict = verifyOwnedModulePosture(declaration, observation);
  if (!postureVerdict.trusted) return postureVerdict;
  if (observation.replacementFingerprint !== replacementFingerprintFor(observation.artifact)) {
    return denied(
      "Module replacement fingerprint is not derived from the observed artifact identity",
      "trusted_identity_mismatch",
    );
  }
  return {
    trusted: true,
    reason: `Module verified at its declared ${declaration.posture} deployment root`,
  };
}

/**
 * Posture-specific ownership requirement:
 *   - image — root-owned (uid 0) and not group/other-writable on BOTH the
 *     declared root and the artifact (the stock image installs 0755/0644 as
 *     root before dropping to the runtime user);
 *   - development — source-owned by ONE owner: not group/other-writable on the
 *     declared root or the artifact, and the artifact's owner is the declared
 *     root's owner (an "unowned" substitution, e.g. an artifact dropped in by
 *     another user, denies). Developer OWNER-writability stays permitted: the
 *     source-owned artifact is exactly that. Later root/artifact replacement or
 *     metadata movement denies against the anchor; a trusted developer rebuild
 *     requires a fresh launch.
 */
function verifyOwnedModulePosture(
  declaration: DeploymentModuleDeclaration,
  observation: OwnedModuleObservation,
): OwnedModuleOwnershipVerdict {
  const artifact = observation.artifact;
  const root = observation.root;
  if (declaration.posture === "image") {
    if (root.uid !== 0 || artifact.uid !== 0) {
      return denied(
        "Declared image module artifact is not root-owned",
        "outside_roots",
      );
    }
  } else if (artifact.uid !== root.uid) {
    return denied(
      "Declared development module artifact owner differs from its declared root owner",
      "outside_roots",
    );
  }
  for (const evidence of [root, artifact]) {
    if ((evidence.mode & 0o022) !== 0) {
      return denied(
        `Declared ${declaration.posture} module path '${evidence.path}' is group/other-writable`,
        "outside_roots",
      );
    }
  }
  return {
    trusted: true,
    reason: `Declared ${declaration.posture} module ownership posture satisfied`,
  };
}

/** Structural identity equality of one observed path (the anchored fields). */
function samePathIdentity(a: OwnedModulePathEvidence, b: OwnedModulePathEvidence): boolean {
  return a.path === b.path && a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink;
}

/**
 * Re-observation verdict: the observation must satisfy its declaration AND
 * match the accepted anchor on every declared identity, fingerprint and the
 * accepted resource generation. Movement, inode reuse, replacement, a moved
 * fingerprint or a rotated generation denies — the anchor is never replaced by
 * what is present now.
 *
 * Freshness note: the ANCHOR pins physical identity and the accepted
 * generation. CURRENT-call freshness (the observation's epoch matching the
 * roster stamp of the call being decided) is enforced by the provenance
 * decision, which compares the record's observed/current epoch pair — this
 * function deliberately does not encode roster movement as a permanent
 * denial.
 */
export function verifyOwnedModuleAnchor(
  anchor: OwnedModuleAnchor,
  observation: OwnedModuleObservation,
): OwnedModuleOwnershipVerdict {
  const observationVerdict = verifyOwnedModuleObservation(observation.declaration, observation);
  if (!observationVerdict.trusted) return observationVerdict;
  if (
    !sameDeclaration(anchor.declaration, observation.declaration) ||
    anchor.canonicalArtifactPath !== observation.canonicalArtifactPath
  ) {
    return denied(
      "Accepted module declaration was replaced by another deployment face",
      "trusted_identity_mismatch",
    );
  }
  if (
    !samePathIdentity(anchor.root, observation.root) ||
    !samePathIdentity(anchor.artifact, observation.artifact) ||
    anchor.replacementFingerprint !== observation.replacementFingerprint
  ) {
    return denied(
      "Accepted module identity changed after anchoring (replaced or moved)",
      "path_changed",
    );
  }
  if (observation.resourceGeneration !== anchor.resourceGeneration) {
    return denied(
      "Accepted module observation is stale for the current resource generation",
      "path_changed",
    );
  }
  return {
    trusted: true,
    reason: "Module re-observation matches the accepted deployment anchor",
  };
}
