// scripts/omp/bundle-extension.ts — build-time trusted-extension bundler
// (OpenSpec `package-pinned-omp-runtime` D5, retargeted by
// `package-bun-compatible-omp-extension` C3: the pinned OMP executable embeds
// Bun and its legacy extension loader does NOT consume a sidecar Deno import
// map, so the mirror-copy + generated deno.json mechanism is replaced by a
// single reproducible ESM bundle built at packaging time from canonical
// source and locked dependencies).
//
// Mechanism: ONE generated artifact.
//
//   - `deno bundle --frozen --format esm` (no minify, names kept) inlines the
//     canonical `@std/*`/local VALUE closure of the trusted-extension entry
//     into <target>/index.js — the single file development launch and image
//     installation both consume (src/utils/omp-paths.ts exports the mapping).
//     `--frozen` enforces the committed deno.lock: locked dependencies are
//     checked, never re-resolved, and no runtime download occurs at load.
//   - The ONE documented external is the exact bare `@sinclair/typebox`
//     schema-builder facade (align-omp-native-tool-contracts D1): the pinned
//     legacy loader host-resolves that exact bare value import to the
//     runtime's own `Type` facade BEFORE any import-map lookup, so the bundle
//     keeps the canonical host-resolved spelling and the build deliberately
//     installs NO npm:/jsr: pin for it (a pin would bypass the host facade).
//     Subpaths of the package are NOT remapped by the host and stay outside
//     the boundary. Documented native builtins (`node:`/`bun:`) remain
//     external because the native runtime provides them. Every OTHER emitted
//     dependency edge — a leftover JSR URL, an import-map alias (@std/*,
//     @acp/*, @utils/*), an npm: package, or any unapproved bare specifier —
//     fails the build: the boundary is enforced on the EMITTED bundle, never
//     trusted from the source walk.
//   - Auditable provenance is retained: no minification (deno bundle's
//     `// deno:<locked-url>` provenance comments survive) and the generated
//     file carries a deterministic source/input digest inventory header — the
//     canonical entry and every locked external dependency fact this bundle
//     was cut from, plus the bundle's own byte digest recorded by the
//     PACKAGE-MANIFEST recut (recut invariant D5 unchanged: installed inputs
//     changed => manifest recut in the same change).
//
// Canonical source stays single-owned: this script READS the committed tree
// and writes only the generated bundle; there is no independently edited
// mirror or augmentation (content-faithfulness now means deterministic
// transformation of canonical source plus locked dependencies, per the
// amended container-packaging requirement).
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

/**
 * The ONE non-builtin external the bundle may reference: the exact BARE
 * schema-builder facade specifier (align-omp-native-tool-contracts D1),
 * emitted in its canonical host-resolved spelling (NEVER `npm:` form — see
 * docs/OMP_PACKAGING.md §5; adding an image-side npm pin here would bypass
 * the documented host remap and add an unowned module to the load-time
 * graph). Subpaths like `@sinclair/typebox/value` are NOT remapped by the
 * host and fail closed below.
 */
const HOST_FACADE_EXTERNAL = "@sinclair/typebox";

/** Documented native builtins the pinned native runtime provides itself. */
const NATIVE_BUILTIN_PREFIXES = ["node:", "bun:"];

function isAllowedExternal(spec: string): boolean {
  if (spec === HOST_FACADE_EXTERNAL) return true;
  return NATIVE_BUILTIN_PREFIXES.some((p) => spec.startsWith(p));
}

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
    "--external",
    HOST_FACADE_EXTERNAL,
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

// Emitted dependency edges: static import/export-from specifiers plus dynamic
// import() literal specifiers. A generated ESM bundle resolves everything
// else internally, so anything matched here is a load-time external.
function emittedExternals(text: string): string[] {
  const out = new Set<string>();
  const staticRe = /(?:^|[\s;}])(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g;
  const bareImportRe = /(?:^|[\s;}])import\s+["']([^"']+)["']/g;
  const dynRe = /(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, bareImportRe, dynRe]) {
    for (const m of text.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

const problems: string[] = [];
const externals = emittedExternals(emitted);
for (const spec of externals) {
  if (isAllowedExternal(spec)) continue;
  // Every non-allowlisted edge fails closed, with the specific class named.
  const cls = spec.startsWith("jsr:") || spec.startsWith("https://") || spec.startsWith("http://")
    ? "runtime-download edge (JSR/remote URL)"
    : spec.startsWith("npm:")
    ? "npm: package edge"
    : spec.startsWith("@std/") || spec.startsWith("@acp/") || spec.startsWith("@utils/") ||
        spec.startsWith("@core/") || spec.startsWith("@types/") || spec.startsWith("@skills/") ||
        spec.startsWith("@platforms/")
    ? "import-map alias edge"
    : "unapproved bare package";
  problems.push(`emitted dependency ${spec} (${cls}) is outside the native-loadable boundary`);
}
// A self-contained bundle must carry no relative/absolute edges either: every
// canonical module is inlined, so a leftover `./`/`/` import proves the
// closure leaked past the bundler and the native loader would resolve it
// against the IMAGE tree — fail closed.
for (const spec of externals) {
  if (
    spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") ||
    spec.startsWith("file:")
  ) {
    problems.push(`emitted dependency ${spec} (non-inlined path edge)`);
  }
}

// Provenance-comment completeness: non-minified deno bundle output names
// every inlined locked module with a `// deno:<url>` comment; the @std/*
// closure must therefore be INLINED (present as provenance), not left as an
// alias edge (already covered above) — assert the inlining actually happened.
const inlinedStd = /\/\/ deno:https:\/\/jsr\.io\/@std\//.test(emitted);
if (!inlinedStd) {
  problems.push(
    "emitted bundle carries no inlined @std/* provenance (bundling did not inline the locked std closure)",
  );
}

if (problems.length) {
  console.error(
    `generated bundle is not native-loadable:\n${[...new Set(problems)].sort().join("\n")}`,
  );
  Deno.exit(1);
}

// Deterministic source/input digest inventory (auditable provenance header).
// Computed over the canonical inputs only — never timestamps — so rebuilds
// from the same checkout produce byte-identical bundle content apart from
// deno bundle's own deterministic output.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const lockBytes = new TextEncoder().encode(await Deno.readTextFile(denoLockPath));
const entryBytes = await Deno.readFile(`${src}/${ENTRY}`);
const inventory = [
  `entry sha256 ${await sha256Hex(entryBytes)}  ${ENTRY}`,
  `lock sha256 ${await sha256Hex(lockBytes)}  ${denoLockPath.replace(`${src}/`, "")}`,
];

// Prepend the inventory header to the generated bundle (pure comment: the
// module's behavior is the bundler's ESM output, verbatim below the header).
const header = [
  "// Generated by scripts/omp/bundle-extension.ts (package-bun-compatible-omp-extension).",
  "// DO NOT EDIT — deterministic ESM bundle of the trusted-extension value closure,",
  "// built from canonical source and frozen-lock dependencies. The only externals",
  "// are documented native builtins (node:/bun:) and the exact bare",
  `// ${HOST_FACADE_EXTERNAL} schema-builder host-facade import, which the pinned native`,
  "// loader host-resolves BEFORE any import-map lookup (no npm: pin is installed",
  "// for it on purpose — docs/OMP_PACKAGING.md §5).",
  "// Source/input digest inventory:",
  ...inventory.map((line) => `//   ${line}`),
  "",
].join("\n");
await Deno.writeTextFile(bundlePath, `${header}${emitted}`);

console.log(
  `bundled ${ENTRY} -> ${bundlePath} ` +
    `(${externals.length} external edge(s): ${externals.join(", ") || "none"})`,
);
