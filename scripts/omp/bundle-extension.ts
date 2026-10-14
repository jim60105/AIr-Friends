// scripts/omp/bundle-extension.ts — build-time trusted-extension bundler
// (OpenSpec `package-pinned-omp-runtime` D5, retargeted by
// `package-bun-compatible-omp-extension` C3 and simplified by the
// `cutover-omp-native-runtime` core cutover).
//
// Mechanism: ONE generated artifact.
//
//   - `deno bundle --frozen --format esm` (no minify, names kept) inlines the
//     canonical value closure of the trusted-extension entry into
//     <target>/index.js — the single file development launch and image
//     installation both consume (src/utils/omp-paths.ts exports the mapping).
//     `--frozen` enforces the committed deno.lock: locked dependencies are
//     checked, never re-resolved, and no runtime download occurs at load.
//   - The extension closure is the small capability-admission module only, so
//     it carries no external dependency edge at all. Documented native builtins
//     (`node:`/`bun:`) stay external because the native runtime provides them.
//     Every other emitted dependency edge — a JSR/remote URL, an import-map
//     alias (@std/*, @acp/*, @utils/*), an npm: package, an unapproved bare
//     specifier, or a non-inlined path edge — fails the build: the boundary is
//     enforced on the EMITTED bundle, never trusted from the source walk.
//   - Auditable provenance is retained through deno bundle's own non-minified
//     output. No deployment-module declaration is embedded, no dependency
//     closure is declared and no synthetic input-digest header is prepended:
//     the artifact is exactly the bundler's ESM output.
//
// Usage (via scripts/omp/bundle-omp-extension.sh):
//   deno run --allow-read --allow-write --allow-run bundle-extension.ts \
//     <src-root> <extension-target> <repo-deno-lock>

const [src, target, denoLockPath] = Deno.args;
const ENTRY = "src/acp/omp/extension/index.ts";
const BUNDLE_NAME = "index.js";

for (const [name, v] of [["src", src], ["target", target], ["deno.lock", denoLockPath]] as const) {
  if (!v) {
    console.error(
      `usage: bundle-extension.ts <src-root> <extension-target> <repo-deno-lock> (missing ${name})`,
    );
    Deno.exit(2);
  }
}

// The native-loadability boundary (documented native builtins plus the
// emitted-edge audit) lives in bundle-audit.ts beside this script so packaging
// tests exercise the exact production predicate on synthetic bundle text.
import { auditEmittedBundle, emittedExternals } from "./bundle-audit.ts";

// The bundle is cut from canonical source at <src> with the repo's own deno
// configuration and committed lock (cwd = <src> so both resolve there). The
// frozen-lock flag makes any drift between deno.json ranges and deno.lock a
// build failure rather than a silent re-resolution.
const bundlePath = `${target}/${BUNDLE_NAME}`;
await Deno.mkdir(target, { recursive: true });

const bundle = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--frozen=true",
    "--format",
    "esm",
    "--keep-names",
    "--output",
    bundlePath,
    ENTRY,
  ],
  cwd: src,
  stdout: "piped",
  stderr: "piped",
}).output();
if (bundle.code !== 0) {
  console.error(`deno bundle failed:\n${new TextDecoder().decode(bundle.stderr)}`);
  Deno.exit(1);
}

const emitted = await Deno.readTextFile(bundlePath);

const problems: string[] = auditEmittedBundle(emitted);
const externals = emittedExternals(emitted);

if (problems.length) {
  console.error(
    `generated bundle is not native-loadable:\n${[...new Set(problems)].sort().join("\n")}`,
  );
  Deno.exit(1);
}

console.log(
  `bundled ${ENTRY} -> ${bundlePath} ` +
    `(${externals.length} external edge(s): ${externals.join(", ") || "none"})`,
);
