/**
 * Context-Free Owned-Module Physical Observer
 * (`bind-omp-owned-module-evidence`).
 *
 * Produces and re-verifies the physical deployment-module evidence the
 * provenance decision consumes. Context-free by construction: the observer
 * reads THIS process's own module URL, the declared deployment faces and the
 * declared paths' metadata — never a cwd, a mode-scoped state root, a session
 * id, a session role, a `CanonicalTarget` or model input. Absence of any of
 * those is simply irrelevant here, which is exactly why controlled network and
 * owned skill/local read replacement admission can complete without an
 * invented session context.
 *
 * Runtime portability: the metadata backend picks the present runtime's own
 * surface — `Deno.lstatSync`/`Deno.realPathSync` under Deno, the pinned Bun
 * host's `node:fs` (`lstatSync`/`realpathSync` through the host `require`
 * bridge) otherwise. No `Deno`-only call runs under the native host, and
 * nothing here performs IO at module load.
 *
 * Acceptance anchors ONCE (at registration) and every later observation is
 * compared against that anchor: a changed module denies rather than silently
 * re-anchoring (see `verifyOwnedModuleAnchor`).
 */

import {
  acceptOwnedModuleAnchor,
  DEPLOYMENT_MODULE_DECLARATIONS,
  type DeploymentModuleDeclaration,
  moduleUrlToPath,
  type OwnedModuleAnchor,
  type OwnedModuleObservation,
  type OwnedModulePathEvidence,
  replacementFingerprintFor,
  verifyOwnedModuleAnchor,
  verifyOwnedModuleObservation,
} from "./deployment-module.ts";

/**
 * The metadata surface the observer consumes: one complete lstat-shaped
 * observation per path plus the canonical path resolver. Every numeric field
 * is REQUIRED — a backend that cannot observe one reports a non-integer and
 * the policy denies as missing metadata, never as a permissive default.
 */
export interface OwnedModuleMetadataReader {
  observe(path: string): OwnedModulePathEvidence;
  realpath(path: string): string;
}

/** The `node:fs` metadata surface the pinned Bun host provides. */
interface NodeFsMetadataSurface {
  lstatSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    mode: number;
    uid: number;
    nlink: number;
  };
  realpathSync(path: string): string;
}

/** Host require bridge for the pinned Bun runtime (same shape as the read replacement). */
function requireModuleNodeFs(): NodeFsMetadataSurface | undefined {
  // The host `require` is untyped by nature; the interface above IS the
  // checked boundary every field access goes through.
  const hostRequire = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof hostRequire !== "function") return undefined;
  return hostRequire("node:fs") as NodeFsMetadataSurface;
}

/**
 * The runtime-portable metadata reader (the read replacement's posture,
 * shared verbatim so both producers observe identities the same way).
 * Unobservable numeric fields become `NaN`, which the ownership policy
 * rejects as missing metadata.
 */
export function defaultOwnedModuleMetadataReader(): OwnedModuleMetadataReader {
  return {
    observe: (path) => {
      if (typeof Deno !== "undefined") {
        const info = Deno.lstatSync(path);
        return {
          path,
          isDirectory: info.isDirectory,
          isFile: info.isFile,
          isSymbolicLink: info.isSymlink,
          dev: info.dev ?? Number.NaN,
          ino: info.ino ?? Number.NaN,
          size: info.size ?? Number.NaN,
          mtimeMs: info.mtime?.getTime() ?? Number.NaN,
          mode: info.mode ?? Number.NaN,
          uid: info.uid ?? Number.NaN,
          nlink: info.nlink ?? Number.NaN,
        };
      }
      const fs = requireModuleNodeFs();
      if (!fs) throw new Error("owned-module metadata backend unavailable");
      const info = fs.lstatSync(path);
      return {
        path,
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        isSymbolicLink: info.isSymbolicLink(),
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        mode: info.mode,
        uid: info.uid,
        nlink: info.nlink,
      };
    },
    realpath: (path) => {
      if (typeof Deno !== "undefined") return Deno.realPathSync(path);
      const fs = requireModuleNodeFs();
      if (!fs) throw new Error("owned-module metadata backend unavailable");
      return fs.realpathSync(path);
    },
  };
}

/** Freshness stamp one observation carries (from the live surface read). */
export interface OwnedModuleFreshness {
  readonly resourceGeneration: string;
  readonly registryEpoch: number;
}

/**
 * Select the DECLARED face this process's own loaded artifact belongs to. The
 * presented path is observed FIRST and must itself be a real, non-symlink
 * regular file: a leaf alias (a link at the loaded location pointing into a
 * declared tree) is not the declared artifact and gets no declaration. Only
 * then is the presented path canonicalized and matched against the declared
 * canonical artifacts — which is what lets a trusted ancestor normalization
 * (e.g. `/home -> /var/home`) keep working while an aliased leaf still denies.
 * An unreadable URL, an unmatched path or an unobservable leaf yields
 * `undefined`: no declaration, no module authority.
 */
export function selectLoadedDeploymentModule(params: {
  readonly moduleUrl: string;
  readonly reader: OwnedModuleMetadataReader;
  /**
   * The declared faces to match against. Defaults to the build-owned
   * declarations this bundle carries; an explicit list exists for an
   * embedding (or a real-filesystem test) that declares its OWN deployment
   * faces — the metadata is still observed for real, and an unmatched URL
   * still yields no declaration.
   */
  readonly declarations?: readonly DeploymentModuleDeclaration[];
}): { declaration: DeploymentModuleDeclaration; presentedArtifactPath: string } | undefined {
  let presentedArtifactPath: string;
  try {
    presentedArtifactPath = moduleUrlToPath(params.moduleUrl);
  } catch {
    return undefined;
  }
  if (!presentedArtifactPath.startsWith("/")) return undefined;
  let presented: OwnedModulePathEvidence;
  let canonicalArtifactPath: string;
  try {
    presented = params.reader.observe(presentedArtifactPath);
    if (presented.isSymbolicLink || !presented.isFile) return undefined;
    canonicalArtifactPath = params.reader.realpath(presentedArtifactPath);
  } catch {
    return undefined;
  }
  const declaration = (params.declarations ?? DEPLOYMENT_MODULE_DECLARATIONS).find(
    (candidate) => candidate.artifact === canonicalArtifactPath,
  );
  return declaration === undefined ? undefined : { declaration, presentedArtifactPath };
}

/**
 * One physical observation of the DECLARED artifact and its declared root, or
 * `undefined` when anything about them is missing, linked, replaced or
 * posture-violating. Every failure is a bounded `undefined` (the callers
 * record unowned-discovery); no error escapes into the registration path.
 */
export function observeDeclaredDeploymentModule(params: {
  readonly declaration: DeploymentModuleDeclaration;
  readonly presentedArtifactPath: string;
  readonly reader: OwnedModuleMetadataReader;
  readonly freshness: OwnedModuleFreshness;
}): OwnedModuleObservation | undefined {
  const { declaration, presentedArtifactPath, reader, freshness } = params;
  let observation: OwnedModuleObservation;
  try {
    const root = reader.observe(declaration.root);
    const artifact = reader.observe(declaration.artifact);
    observation = {
      declaration,
      presentedArtifactPath,
      canonicalArtifactPath: reader.realpath(declaration.artifact),
      root,
      artifact,
      replacementFingerprint: replacementFingerprintFor(artifact),
      resourceGeneration: freshness.resourceGeneration,
      registryEpoch: freshness.registryEpoch,
    };
  } catch {
    return undefined;
  }
  return verifyOwnedModuleObservation(declaration, observation).trusted ? observation : undefined;
}

/**
 * The producer seam the registration site consumes. `anchor` is `undefined`
 * when this process's own loaded artifact belongs to no declared face or the
 * initial physical acceptance failed — the fail-closed state in which no owned
 * replacement can be admitted. `observe` re-reads the declared paths NOW and
 * returns the fresh evidence only when it still matches the anchor (identity,
 * fingerprint and accepted generation), so the recorded provenance and the
 * network-admission registration evidence both ride one live verification.
 */
export interface OwnedModuleEvidenceSource {
  readonly anchor: OwnedModuleAnchor | undefined;
  observe(current: OwnedModuleFreshness): OwnedModuleObservation | undefined;
}

/**
 * The production producer: select the face from this module's own URL, accept
 * the initial physical evidence synchronously (registration time) and
 * re-verify per observation. No session context, no cwd and no fixture input
 * participates — the default factory builds exactly this.
 */
export function createOwnedModuleEvidenceSource(deps: {
  /** This process's own loaded module URL (production: `import.meta.url`). */
  readonly moduleUrl: string;
  /** Row-12 live resource-generation getter. */
  readonly resourceGeneration: () => string;
  readonly reader?: OwnedModuleMetadataReader;
  /**
   * Declared deployment faces (default: the build-owned declarations this
   * bundle carries). See `selectLoadedDeploymentModule`.
   */
  readonly declarations?: readonly DeploymentModuleDeclaration[];
}): OwnedModuleEvidenceSource {
  const reader = deps.reader ?? defaultOwnedModuleMetadataReader();
  const selected = selectLoadedDeploymentModule({
    moduleUrl: deps.moduleUrl,
    reader,
    ...(deps.declarations !== undefined ? { declarations: deps.declarations } : {}),
  });
  const uninstrumented: OwnedModuleEvidenceSource = { anchor: undefined, observe: () => undefined };
  if (selected === undefined) return uninstrumented;
  const accepted = observeDeclaredDeploymentModule({
    ...selected,
    reader,
    freshness: { resourceGeneration: deps.resourceGeneration(), registryEpoch: 0 },
  });
  if (accepted === undefined) return uninstrumented;
  const anchor = acceptOwnedModuleAnchor(accepted);
  return {
    anchor,
    observe: (current) => {
      const observation = observeDeclaredDeploymentModule({
        ...selected,
        reader,
        freshness: current,
      });
      if (observation === undefined) return undefined;
      return verifyOwnedModuleAnchor(anchor, observation).trusted ? observation : undefined;
    },
  };
}
