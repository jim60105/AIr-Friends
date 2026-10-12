// scripts/omp/bundle-audit.ts — the emitted-bundle native-loadability audit
// (OpenSpec `package-bun-compatible-omp-extension` D1), factored out of
// bundle-extension.ts so packaging tests exercise the exact production
// predicate on synthetic bundle text (deterministic, zero network — the
// real-runtime loader behavior stays user-owned per docs/OMP_PACKAGING.md §7).
//
// The boundary: the generated ESM bundle must be self-contained for the
// pinned native (Bun-embedded) runtime. Only documented native builtins
// (`node:`/`bun:`) and the ONE pinned host-provided compatibility import —
// the exact bare `@sinclair/typebox` schema-builder facade the loader
// host-resolves before any import-map lookup — may remain external. Every
// other emitted edge (a leftover JSR/remote URL, an import-map alias such as
// @std/*, an npm: package, any unapproved bare specifier, or a non-inlined
// path edge) is a problem: the sidecar import map can NOT satisfy native
// loadability, so packaging fails before installation.

/**
 * The ONE non-builtin external the bundle may reference: the exact BARE
 * `@sinclair/typebox` value import. The pinned legacy loader host-resolves
 * that exact bare specifier to the runtime's own `Type` facade BEFORE any
 * import-map lookup, so the bundle keeps the canonical host-resolved
 * spelling and the build installs NO npm:/jsr: pin for it (a pin would
 * bypass the host facade — docs/OMP_PACKAGING.md §5). Subpaths of the
 * package are NOT remapped by the host and stay outside the boundary.
 */
export const HOST_FACADE_EXTERNAL = "@sinclair/typebox";

/** Documented native builtins the pinned native runtime provides itself. */
export const NATIVE_BUILTIN_PREFIXES = ["node:", "bun:"] as const;

export function isAllowedExternal(spec: string): boolean {
  return spec === HOST_FACADE_EXTERNAL ||
    NATIVE_BUILTIN_PREFIXES.some((prefix) => spec.startsWith(prefix));
}

/**
 * Emitted dependency edges: static import/export-from specifiers plus dynamic
 * import() literal specifiers. A generated ESM bundle resolves everything
 * else internally, so anything matched here is a load-time external.
 */
export function emittedExternals(text: string): string[] {
  const out = new Set<string>();
  const staticRe = /(?:^|[\s;}])(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g;
  const bareImportRe = /(?:^|[\s;}])import\s+["']([^"']+)["']/g;
  const dynRe = /(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, bareImportRe, dynRe]) {
    for (const m of text.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

/**
 * The production audit over generated bundle text. Returns one problem line
 * per boundary violation (empty = native-loadable). The `@std/*` provenance
 * check (the inlined locked-closure claim) is bundle-extension.ts's own
 * build step; this function owns the EDGE boundary.
 */
export function auditEmittedBundle(text: string): string[] {
  const problems: string[] = [];
  const externals = emittedExternals(text);
  for (const spec of externals) {
    if (isAllowedExternal(spec)) continue;
    // Every non-allowlisted edge fails closed, with the specific class named.
    const cls = spec.startsWith("jsr:") || spec.startsWith("https://") ||
        spec.startsWith("http://")
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
  return problems;
}
