/**
 * Context-free owned-module physical evidence suite
 * (`bind-omp-owned-module-evidence` tasks 1.2/1.3/3.2).
 *
 * Two honest evidence sources:
 *   - a REAL temporary filesystem for the development face (real dev/ino/
 *     mtime/mode of a real generated artifact, including its real developer
 *     ownership and owner-writability), and
 *   - a metadata reader fixture for the IMAGE face, whose root-owned 0755/0644
 *     metadata cannot be reproduced as a non-root test user. The fixture
 *     carries the real declared image paths and the real deployment metadata
 *     shapes, and every mutation case is an explicit metadata snapshot change.
 *
 * Nothing here claims the official host loaded the extension: that stays
 * user-owned runtime verification.
 */

import { assert, assertEquals } from "@std/assert";
import {
  acceptOwnedModuleAnchor,
  DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
  type DeploymentModuleDeclaration,
  moduleUrlToPath,
  OMP_IMAGE_MODULE_DECLARATION,
  type OwnedModuleObservation,
  replacementFingerprintFor,
  verifyOwnedModuleAnchor,
  verifyOwnedModuleObservation,
} from "@acp/omp/deployment-module.ts";
import {
  createOwnedModuleEvidenceSource,
  type OwnedModuleMetadataReader,
} from "@acp/omp/owned-module-evidence.ts";
import {
  FIXTURE_DEVELOPMENT_DECLARATION,
  fixtureImageObservation,
} from "./omp-owned-module-fixture.ts";

/** A metadata reader over ONE mutable observation (identity data, no IO). */
function mutableReader(
  state: { observation: OwnedModuleObservation },
  realpath: (path: string) => string = (path) => path,
): OwnedModuleMetadataReader {
  return {
    observe: (path) =>
      path === state.observation.root.path
        ? state.observation.root
        : { ...state.observation.artifact, path },
    realpath,
  };
}

/** A real temporary development face: a real generated artifact on disk. */
async function withRealDevelopmentFace(
  fn: (
    declaration: DeploymentModuleDeclaration,
    artifactPath: string,
  ) => Promise<void>,
): Promise<void> {
  const base = await Deno.makeTempDir({ prefix: "omp-owned-module-" });
  // The declaration is a CANONICAL path (as a build-owned declaration is):
  // realpath the temporary checkout before declaring its bundle.
  const canonicalBase = await Deno.realPath(base);
  const root = `${canonicalBase}/build/omp-extension`;
  const artifact = `${root}/index.js`;
  try {
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(artifact, "// generated bundle\n");
    await fn({
      artifact,
      root,
      posture: "development",
      dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
    }, artifact);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Real development face: acceptance, real mutation, generation binding.
// ---------------------------------------------------------------------------

Deno.test("evidence: the real generated development artifact is accepted at its declared path", async () => {
  await withRealDevelopmentFace(async (declaration) => {
    const source = createOwnedModuleEvidenceSource({
      moduleUrl: `file://${declaration.artifact}`,
      resourceGeneration: () => "gen-0",
      declarations: [declaration],
    });
    assert(source.anchor !== undefined, "the real artifact must satisfy its declaration");
    const observation = source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 });
    assert(observation !== undefined);
    assertEquals(observation.declaration.artifact, declaration.artifact);
    assertEquals(observation.artifact.path, declaration.artifact);
    // The evidence carries REAL identities, and the developer-owned posture
    // (owner-writable file, the developer as owner) is exactly what the
    // development face permits.
    const real = Deno.lstatSync(declaration.artifact);
    assertEquals(observation.artifact.ino, real.ino);
    assertEquals(observation.artifact.nlink, 1);
    assertEquals(
      observation.replacementFingerprint,
      replacementFingerprintFor(observation.artifact),
    );
  });
});

Deno.test("evidence: a real artifact replacement or metadata movement denies against the anchor", async () => {
  await withRealDevelopmentFace(async (declaration) => {
    const source = createOwnedModuleEvidenceSource({
      moduleUrl: `file://${declaration.artifact}`,
      resourceGeneration: () => "gen-0",
      declarations: [declaration],
    });
    assert(source.anchor !== undefined);
    assert(source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 }) !== undefined);
    // Byte-content rewrite within the same inode: the metadata fingerprint
    // moves (size), so the accepted identity no longer matches.
    await Deno.writeTextFile(declaration.artifact, "// regenerated bundle with different bytes\n");
    assertEquals(source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 }), undefined);
  });
});

Deno.test("evidence: a replaced artifact inode denies; a rotated generation denies", async () => {
  await withRealDevelopmentFace(async (declaration) => {
    let generation = "gen-0";
    const source = createOwnedModuleEvidenceSource({
      moduleUrl: `file://${declaration.artifact}`,
      resourceGeneration: () => generation,
      declarations: [declaration],
    });
    assert(source.anchor !== undefined);
    // Rotation first: the anchor pins the accepted generation, so a rebuild
    // requires a fresh launch rather than a silent re-anchor.
    generation = "gen-1";
    assertEquals(source.observe({ resourceGeneration: generation, registryEpoch: 0 }), undefined);
    generation = "gen-0";
    assert(source.observe({ resourceGeneration: generation, registryEpoch: 0 }) !== undefined);
    // Replace the artifact file itself (new inode).
    await Deno.remove(declaration.artifact);
    await Deno.writeTextFile(declaration.artifact, "// replaced bundle\n");
    assertEquals(source.observe({ resourceGeneration: generation, registryEpoch: 0 }), undefined);
  });
});

Deno.test("evidence: a leaf alias into a declared tree is not the declared artifact", async () => {
  const base = await Deno.makeTempDir({ prefix: "omp-owned-module-" });
  const canonicalBase = await Deno.realPath(base);
  const realRoot = `${canonicalBase}/real/build/omp-extension`;
  const aliasRoot = `${base}/aliased`;
  const declaration: DeploymentModuleDeclaration = {
    artifact: `${realRoot}/index.js`,
    root: realRoot,
    posture: "development",
    dependencyClosure: DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
  };
  try {
    await Deno.mkdir(realRoot, { recursive: true });
    await Deno.writeTextFile(`${realRoot}/index.js`, "// bundle\n");
    await Deno.symlink(`${canonicalBase}/real`, aliasRoot);
    // The presented leaf is a real file under an ANCESTOR alias: its realpath
    // IS the declared artifact, so trusted ancestor normalization keeps this
    // load working.
    const normalized = createOwnedModuleEvidenceSource({
      moduleUrl: `file://${aliasRoot}/build/omp-extension/index.js`,
      resourceGeneration: () => "gen-0",
      declarations: [declaration],
    });
    assert(normalized.anchor !== undefined, "ancestor normalization keeps the dev face loadable");

    // A LINK AT the loaded location pointing into the declared tree is a
    // different file identity: it gets no declaration at all.
    const leafAlias = `${base}/leaf-alias.js`;
    await Deno.symlink(`${realRoot}/index.js`, leafAlias);
    const aliased = createOwnedModuleEvidenceSource({
      moduleUrl: `file://${leafAlias}`,
      resourceGeneration: () => "gen-0",
      declarations: [declaration],
    });
    assertEquals(aliased.anchor, undefined);
    assertEquals(aliased.observe({ resourceGeneration: "gen-0", registryEpoch: 0 }), undefined);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("evidence: an artifact outside every declared face yields no owned authority", () => {
  for (
    const moduleUrl of [
      // The canonical source file is a build input, never a load entry.
      "file:///opt/air/src/acp/omp/extension/index.ts",
      // A bundle copy in a workspace/HOME/cache tree.
      "file:///home/attacker/build/omp-extension/index.js",
      // Not even a file URL.
      "not-a-url",
    ]
  ) {
    const source = createOwnedModuleEvidenceSource({
      moduleUrl,
      resourceGeneration: () => "gen-0",
    });
    assertEquals(source.anchor, undefined, moduleUrl);
    assertEquals(source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 }), undefined);
  }
});

// ---------------------------------------------------------------------------
// Image face: reader-fixture metadata, posture, missing metadata, anchoring.
// ---------------------------------------------------------------------------

Deno.test("evidence: the declared image face accepts root-owned non-writable metadata and re-anchors nothing", () => {
  const state = { observation: fixtureImageObservation({ generation: "gen-0" }) };
  const reader = mutableReader(state, (path) => path);
  const source = createOwnedModuleEvidenceSource({
    moduleUrl: `file://${OMP_IMAGE_MODULE_DECLARATION.artifact}`,
    resourceGeneration: () => "gen-0",
    reader,
  });
  assert(source.anchor !== undefined);
  assertEquals(
    source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 })?.artifact.path,
    OMP_IMAGE_MODULE_DECLARATION.artifact,
  );
  // Identity movement after acceptance: same-name metadata cannot re-anchor.
  state.observation = fixtureImageObservation({
    generation: "gen-0",
    artifact: { ino: 9999 },
  });
  assertEquals(source.observe({ resourceGeneration: "gen-0", registryEpoch: 0 }), undefined);
});

Deno.test("evidence: image posture, link, hardlink and fingerprint violations deny acceptance", () => {
  // The base observation itself is acceptable.
  const base = fixtureImageObservation({ generation: "gen-0" });
  assertEquals(verifyOwnedModuleObservation(OMP_IMAGE_MODULE_DECLARATION, base).trusted, true);
  for (
    const [label, observation] of [
      ["non-root owner", fixtureImageObservation({ generation: "gen-0", artifact: { uid: 1000 } })],
      [
        "group-writable root",
        fixtureImageObservation({ generation: "gen-0", root: { mode: 0o775 } }),
      ],
      [
        "group-writable artifact",
        fixtureImageObservation({ generation: "gen-0", artifact: { mode: 0o664 } }),
      ],
      [
        "linked artifact",
        fixtureImageObservation({
          generation: "gen-0",
          artifact: { isFile: false, isSymbolicLink: true },
        }),
      ],
      [
        "linked root",
        fixtureImageObservation({ generation: "gen-0", root: { isSymbolicLink: true } }),
      ],
      [
        "hard-linked artifact",
        fixtureImageObservation({ generation: "gen-0", artifact: { nlink: 2 } }),
      ],
      [
        "missing metadata",
        fixtureImageObservation({ generation: "gen-0", artifact: { dev: Number.NaN } }),
      ],
      [
        "moved fingerprint",
        fixtureImageObservation({ generation: "gen-0", fingerprint: "not-derived" }),
      ],
      [
        "wrong artifact path",
        fixtureImageObservation({ generation: "gen-0", artifact: { path: "/tmp/index.js" } }),
      ],
    ] as const
  ) {
    const verdict = verifyOwnedModuleObservation(OMP_IMAGE_MODULE_DECLARATION, observation);
    assertEquals(verdict.trusted, false, label);
    assert(
      verifyOwnedModuleObservation(OMP_IMAGE_MODULE_DECLARATION, observation).failureReason !==
        undefined,
      label,
    );
  }
});

Deno.test("evidence: the anchor pins identity and generation, and stale evidence denies", () => {
  const base = fixtureImageObservation({ generation: "gen-0" });
  const anchor = acceptOwnedModuleAnchor(base);
  assertEquals(verifyOwnedModuleAnchor(anchor, base).trusted, true);
  const moved = fixtureImageObservation({ generation: "gen-0", artifact: { ino: 777 } });
  assertEquals(verifyOwnedModuleAnchor(anchor, moved).trusted, false);
  const rotated = fixtureImageObservation({ generation: "gen-1" });
  assertEquals(verifyOwnedModuleAnchor(anchor, rotated).trusted, false);
  // A different declared face never satisfies another face's anchor.
  const development = fixtureImageObservation({ generation: "gen-0" });
  assertEquals(
    verifyOwnedModuleAnchor(anchor, {
      ...development,
      declaration: FIXTURE_DEVELOPMENT_DECLARATION,
      canonicalArtifactPath: FIXTURE_DEVELOPMENT_DECLARATION.artifact,
    }).trusted,
    false,
  );
});

Deno.test("evidence: moduleUrlToPath rejects non-file URLs instead of guessing a path", () => {
  assertEquals(
    moduleUrlToPath("file:///opt/air/omp/extension/index.js"),
    "/opt/air/omp/extension/index.js",
  );
  assertEquals(moduleUrlToPath("https://example.com/index.js"), "");
  assertEquals(moduleUrlToPath("bun:sqlite"), "");
  assertEquals(moduleUrlToPath("not a url"), "");
});
