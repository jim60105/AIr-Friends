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
 * Emitted dependency edges: static import/export-from specifiers (newline-
 * tolerant between the clause and `from`, quote-barred so the window can
 * never straddle a string literal) plus dynamic import() literal specifiers.
 * A generated ESM bundle resolves everything else internally, so anything
 * matched here is a load-time external.
 */
export function emittedExternals(text: string): string[] {
  const out = new Set<string>();
  const staticRe = /(?:^|[\s;}])(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g;
  // Cross-line form: `import {\n  a,\n} from "spec"` — a future bundler
  // output shape must not silently dodge the audit. [^"'] cannot cross a
  // quote, so this window can never stitch two unrelated statements.
  const multilineStaticRe =
    /(?:^|[\s;}])(?:import|export)\b[^"']{0,400}?\bfrom\s*["']([^"']+)["']/g;
  const bareImportRe = /(?:^|[\s;}])import\s+["']([^"']+)["']/g;
  const dynRe = /(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, multilineStaticRe, bareImportRe, dynRe]) {
    for (const m of text.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

/**
 * Runtime `require(...)` edges: literal `require("spec")` calls plus the
 * aliases `deno bundle` emits when source binds `globalThis.require` to a
 * local (`const req = globalThis.require; req("node:fs")`). These load at
 * runtime exactly like static edges, so the every-edge contract covers them;
 * only documented native builtins may arrive through this door — the host
 * facade contract is a VALUE IMPORT remap, not a require remap.
 */
export function emittedRequireEdges(text: string): string[] {
  const names = new Set<string>(["require"]);
  for (
    const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*globalThis\.require\b/g)
  ) names.add(m[1]!);
  const out = new Set<string>();
  for (const name of names) {
    const re = new RegExp(`(?:^|[^\\w.$])${name}\\s*\\(\\s*["']([^"']+)["']\\s*\\)`, "g");
    for (const m of text.matchAll(re)) out.add(m[1]!);
  }
  return [...out].sort();
}

/**
 * The production audit over generated bundle text. Returns one problem line
 * per boundary violation (empty = native-loadable). The `@std/*` provenance
 * check (the inlined locked-closure claim) is bundle-extension.ts's own
 * build step; this function owns the EDGE boundary — every static, dynamic,
 * and runtime-require edge, plus non-static (template-literal) dynamic import
 * specifiers, which cannot be audited and therefore fail closed.
 */
export function auditEmittedBundle(text: string): string[] {
  const problems: string[] = [];
  // A computed import specifier (`import(\`…\`)`) is unauditable — whatever
  // it resolves to at load never passed this boundary: fail closed.
  if (/import\(\s*`/.test(text)) {
    problems.push("emitted dynamic import with a non-static specifier cannot be audited");
  }
  for (const spec of emittedRequireEdges(text)) {
    if (!spec.startsWith("node:") && !spec.startsWith("bun:")) {
      problems.push(`emitted runtime require edge ${spec} is outside the native-builtin boundary`);
    }
  }
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
