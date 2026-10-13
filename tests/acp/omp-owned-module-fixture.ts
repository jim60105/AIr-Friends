/**
 * Shared owned-module evidence fixtures (`bind-omp-owned-module-evidence`).
 *
 * HONESTY NOTE: these are API-shaped FIXTURE values. They reproduce the REAL
 * declared deployment faces (`OMP_IMAGE_MODULE_DECLARATION` and the declared
 * development artifact contract) and the real metadata shapes those faces
 * present — the image face's root-owned 0755/0644 entries and the
 * developer-owned source face — plus explicit METADATA MUTATIONS for the
 * changed-identity cases. They are values handed to the pure policy and to
 * API-shaped harnesses; they are never presented as observations of a real
 * installation, and the real generated-bundle smoke in
 * tests/utils/omp-packaging.test.ts is what exercises the production producer.
 * No fixture carries a session id, a session role or a `CanonicalTarget`:
 * module evidence deliberately has none.
 */

import {
  acceptOwnedModuleAnchor,
  DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
  type DeploymentModuleDeclaration,
  OMP_IMAGE_MODULE_DECLARATION,
  type OwnedModuleAnchor,
  type OwnedModuleObservation,
  type OwnedModulePathEvidence,
  replacementFingerprintFor,
  verifyOwnedModuleAnchor,
  verifyOwnedModuleObservation,
} from "@acp/omp/deployment-module.ts";
import type {
  OwnedModuleEvidenceSource,
  OwnedModuleFreshness,
} from "@acp/omp/owned-module-evidence.ts";

/** Declared development-face fixture paths (a checkout's generated bundle). */
export const FIXTURE_DEVELOPMENT_ROOT = "/checkout/build/omp-extension";
export const FIXTURE_DEVELOPMENT_ARTIFACT = `${FIXTURE_DEVELOPMENT_ROOT}/index.js`;

/** The declared development face as the build-owned declaration carries it. */
export const FIXTURE_DEVELOPMENT_DECLARATION: DeploymentModuleDeclaration = Object.freeze({
  artifact: FIXTURE_DEVELOPMENT_ARTIFACT,
  root: FIXTURE_DEVELOPMENT_ROOT,
  posture: "development",
  dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
});

/** The image face every image-shaped fixture uses (the real declared constants). */
export const FIXTURE_IMAGE_DECLARATION: DeploymentModuleDeclaration = OMP_IMAGE_MODULE_DECLARATION;

/** Deterministic metadata baseline so fingerprints are reproducible. */
const FIXTURE_DEV = 2049;
const FIXTURE_ROOT_INO = 4242;
const FIXTURE_ARTIFACT_INO = 4243;
const FIXTURE_MTIME_MS = 1_700_000_000_000;
const FIXTURE_ARTIFACT_SIZE = 409_600;

/** One observed path's metadata baseline for a declared face. */
export function fixturePathEvidence(params: {
  readonly declaration: DeploymentModuleDeclaration;
  readonly path: string;
  readonly kind: "root" | "artifact";
  readonly overrides?: Partial<OwnedModulePathEvidence>;
}): OwnedModulePathEvidence {
  const image = params.declaration.posture === "image";
  const base: OwnedModulePathEvidence = params.kind === "root"
    ? {
      path: params.path,
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
      dev: FIXTURE_DEV,
      ino: FIXTURE_ROOT_INO,
      size: 4096,
      mtimeMs: FIXTURE_MTIME_MS,
      mode: 0o755,
      uid: image ? 0 : 1000,
      nlink: 2,
    }
    : {
      path: params.path,
      isDirectory: false,
      isFile: true,
      isSymbolicLink: false,
      dev: FIXTURE_DEV,
      ino: FIXTURE_ARTIFACT_INO,
      size: FIXTURE_ARTIFACT_SIZE,
      mtimeMs: FIXTURE_MTIME_MS,
      mode: 0o644,
      // The development face is OWNER-writable in reality; the owner is the
      // fixture developer, the SAME owner as the declared root.
      uid: image ? 0 : 1000,
      nlink: 1,
    };
  return { ...base, ...params.overrides };
}

/**
 * One physical observation of a declared face. `freshness` defaults to a
 * coherent live read; overrides steer metadata for the mutation cases, and the
 * replacement fingerprint is always DERIVED from the resulting artifact
 * metadata (tests that need a moved fingerprint pass `fingerprint`).
 */
export function fixtureModuleObservation(params: {
  readonly declaration: DeploymentModuleDeclaration;
  readonly generation?: string;
  readonly epoch?: number;
  readonly presentedArtifactPath?: string;
  readonly root?: Partial<OwnedModulePathEvidence>;
  readonly artifact?: Partial<OwnedModulePathEvidence>;
  readonly fingerprint?: string;
}): OwnedModuleObservation {
  const { declaration } = params;
  const artifact = fixturePathEvidence({
    declaration,
    path: declaration.artifact,
    kind: "artifact",
    overrides: params.artifact,
  });
  return {
    declaration,
    presentedArtifactPath: params.presentedArtifactPath ?? declaration.artifact,
    canonicalArtifactPath: declaration.artifact,
    root: fixturePathEvidence({
      declaration,
      path: declaration.root,
      kind: "root",
      overrides: params.root,
    }),
    artifact,
    replacementFingerprint: params.fingerprint ?? replacementFingerprintFor(artifact),
    resourceGeneration: params.generation ?? "gen-0",
    registryEpoch: params.epoch ?? 0,
  };
}

/** The image-face observation (root-owned declared image paths). */
export function fixtureImageObservation(
  overrides: Omit<Parameters<typeof fixtureModuleObservation>[0], "declaration"> = {},
): OwnedModuleObservation {
  return fixtureModuleObservation({ declaration: FIXTURE_IMAGE_DECLARATION, ...overrides });
}

/** The development-face observation (developer-owned declared bundle paths). */
export function fixtureDevelopmentObservation(
  overrides: Omit<Parameters<typeof fixtureModuleObservation>[0], "declaration"> = {},
): OwnedModuleObservation {
  return fixtureModuleObservation({ declaration: FIXTURE_DEVELOPMENT_DECLARATION, ...overrides });
}

/** Anchor a fixture observation through the REAL acceptance path. */
export function fixtureAnchor(observation: OwnedModuleObservation): OwnedModuleAnchor {
  const verdict = verifyOwnedModuleObservation(observation.declaration, observation);
  if (!verdict.trusted) {
    throw new Error(`fixture observation is not acceptable: ${verdict.reason}`);
  }
  return acceptOwnedModuleAnchor(observation);
}

/**
 * An evidence source over a fixture observation that re-verifies through the
 * REAL anchor path on every observation: `mutate` steers the per-call
 * observation (replacement, inode reuse, generation rotation), exactly as a
 * real mutation would present itself. `anchor: undefined` models the
 * fail-closed state (unrecognized artifact / failed acceptance).
 */
export function fixtureEvidenceSource(params: {
  readonly observation: OwnedModuleObservation;
  readonly mutate?: (observation: OwnedModuleObservation) => OwnedModuleObservation;
}): OwnedModuleEvidenceSource {
  const accepted = verifyOwnedModuleObservation(params.observation.declaration, params.observation)
    .trusted;
  if (!accepted) return { anchor: undefined, observe: () => undefined };
  const anchor = acceptOwnedModuleAnchor(params.observation);
  return {
    anchor,
    observe: (current: OwnedModuleFreshness) => {
      const steered = params.mutate ? params.mutate(params.observation) : params.observation;
      const fresh: OwnedModuleObservation = {
        ...steered,
        resourceGeneration: current.resourceGeneration,
        registryEpoch: current.registryEpoch,
      };
      return verifyOwnedModuleAnchor(anchor, fresh).trusted ? fresh : undefined;
    },
  };
}

/** The owned-extension provenance record shape (pure value, no session identity). */
export interface FixtureOwnedExtensionRecord {
  readonly origin: "owned-extension";
  readonly modulePath: string;
  readonly moduleEvidence: OwnedModuleObservation;
  readonly registryEpochObserved: number;
  readonly currentRegistryEpoch: number;
  readonly observedResourceGeneration: string;
  readonly currentResourceGeneration: string;
}

/**
 * One coherent owned-extension record: every stamp comes from ONE live read of
 * the given observation, which is exactly the coherence the provenance
 * decision requires. Tests that exercise staleness pass explicit halves.
 */
export function fixtureOwnedExtensionRecord(params: {
  readonly observation: OwnedModuleObservation;
  readonly generation?: string;
  readonly epoch?: number;
  readonly recordOverrides?: Partial<
    Omit<FixtureOwnedExtensionRecord, "origin" | "modulePath" | "moduleEvidence">
  >;
}): FixtureOwnedExtensionRecord {
  const generation = params.generation ?? params.observation.resourceGeneration;
  const epoch = params.epoch ?? params.observation.registryEpoch;
  return {
    origin: "owned-extension",
    modulePath: params.observation.artifact.path,
    moduleEvidence: params.observation,
    registryEpochObserved: epoch,
    currentRegistryEpoch: epoch,
    observedResourceGeneration: generation,
    currentResourceGeneration: generation,
    ...params.recordOverrides,
  };
}
