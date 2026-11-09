// scripts/omp/bundle-extension.ts — build-time trusted-extension bundler
// (OpenSpec `package-pinned-omp-runtime` D5, retargeted by
// `package-bun-compatible-omp-extension` C3, simplified by the
// `cutover-omp-native-runtime` core cutover, and moved to the Bun toolchain by
// `bundle-omp-extension-with-bun`).
//
// Mechanism: ONE generated artifact.
//
//   - `bun build --target=bun --format=esm --keep-names` (no minify) inlines
//     the canonical value closure of the trusted-extension entry into
//     <target>/index.js — the single file development launch and image
//     installation both consume (src/utils/omp-paths.ts exports the mapping).
//     The frozen-lock guarantee moves to the caller: <src>/bun.lock and
//     <src>/node_modules must come from `bun install --frozen-lockfile`, and
//     this script refuses to build until both exist, so no runtime download
//     occurs at load.
//   - The extension closure is the small capability-admission module only, so
//     it carries no external dependency edge at all. Documented native builtins
//     (`node:`/`bun:`) stay external because the native runtime provides them.
//     Every other emitted dependency edge — a package specifier, an unapproved
//     bare specifier, or a non-inlined path edge — fails the build: the
//     boundary is enforced on the EMITTED bundle, never trusted from the
//     source walk.
//   - Auditable provenance is retained through bun build's own non-minified
//     output. No deployment-module declaration is embedded and no synthetic
//     input-digest header is prepended: the artifact is exactly the bundler's
//     ESM output. The build stages that output beside the artifact and renames
//     it into place only after the audit passes, so a rejected bundle is never
//     published.
//
// Usage (via scripts/omp/bundle-omp-extension.sh):
//   bun run --no-env-file bundle-extension.ts <src-root> <extension-target>

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { auditEmittedBundle, emittedExternals } from "./bundle-audit.ts";

const [rawSrc, rawTarget] = process.argv.slice(2);
const ENTRY = "src/acp/omp/extension/index.ts";
const BUNDLE_NAME = "index.js";

if (!rawSrc || !rawTarget) {
  console.error(
    `usage: bundle-extension.ts <src-root> <extension-target> ` +
      `(missing ${rawSrc ? "target" : "src"})`,
  );
  process.exit(2);
}

// Absolute paths keep the spawn cwd (<src>) from re-basing a relative target:
// the mkdir, --outfile, and readFile must all name the same file.
const src = resolve(rawSrc);
const target = resolve(rawTarget);

// Installed-dependency precondition (design D1): checked before any write, so
// a missing copy is a usage-class failure (exit 2) with no partial artifact.
for (const required of ["bun.lock", "node_modules"]) {
  if (!existsSync(`${src}/${required}`)) {
    console.error(`bundle-extension.ts: ${src}/${required} missing`);
    process.exit(2);
  }
}

const bundlePath = `${target}/${BUNDLE_NAME}`;
const stagingPath = `${bundlePath}.tmp`;
await mkdir(target, { recursive: true });
await rm(stagingPath, { force: true });

const bundle = spawnSync(
  process.execPath,
  [
    "build",
    "--target=bun",
    "--format=esm",
    "--keep-names",
    `--outfile=${stagingPath}`,
    ENTRY,
  ],
  { cwd: src, encoding: "utf8" },
);
if (bundle.status !== 0) {
  console.error(`bun build failed:\n${bundle.stderr || bundle.error?.message || ""}`);
  await rm(stagingPath, { force: true });
  process.exit(1);
}

const emitted = await readFile(stagingPath, "utf8");

const problems: string[] = auditEmittedBundle(emitted);
const externals = emittedExternals(emitted);

if (problems.length) {
  console.error(
    `generated bundle is not native-loadable:\n${[...new Set(problems)].sort().join("\n")}`,
  );
  await rm(stagingPath, { force: true });
  process.exit(1);
}

await rename(stagingPath, bundlePath);

console.log(
  `bundled ${ENTRY} -> ${bundlePath} ` +
    `(${externals.length} external edge(s): ${externals.join(", ") || "none"})`,
);
