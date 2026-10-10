// scripts/omp/bundle-extension.ts — build-time trusted-extension bundler
// (OpenSpec `package-pinned-omp-runtime`; design D5 extension dependency closure).
//
// Assembles the FINAL trusted-extension tree at <target> (the image's
// /opt/air/omp/extension) from committed sources under <src> (the repo
// checkout; in the image, the same /app/src the daemon itself consumes).
// Mechanism: a REPO-RELATIVE MIRROR copy, not a fork.
//
//   - Every bundled module is copied VERBATIM at its repo-relative path under
//     <target>/mirror/ (content-faithful: no rewriting, templating, or
//     augmentation anywhere — dev and image load byte-identical sources).
//   - The ONLY generated module is the image-mode entry adapter
//     <target>/index.ts: it resolves row 9's contracted image path
//     /opt/air/omp/extension/index.ts and forwards the load (named + default
//     exports, identical load-time side effects) to the verbatim mirror entry
//     at mirror/src/acp/omp/extension/index.ts.
//   - A generated deno.json import map at <target>/deno.json pins the ONE
//     external specifier family the mirror closure needs (@std/*) to exact
//     versions from the committed deno.lock, so the installed tree resolves
//     every import inside itself with no deno.json walk-out and no network at
//     load time.
//
// Because the mirror preserves the repo-relative layout, the image-mode face
// of the re-export barrel (extension/_daemon/mod.ts) IS the committed file —
// no specifier mapping is required or performed. Dev mode resolves the same
// committed sources through the barrel's dev specifiers; the copy direction is
// daemon tree -> installed extension only, never reverse (D5).
//
// Bundled set = the VALUE-import closure walked from the entry (runtime
// surfaces; the loader fully erases `import type` declarations and type-only
// specifier clauses, so TYPE-only-only daemon modules — e.g.
// code-search-transport.ts, whose own closure note pins it OUT of the
// installed set, and the /app daemon surface behind client.ts types — are
// deliberately NOT installed). Every VALUE edge must resolve INSIDE the
// installed tree (fail closed otherwise), and any external bare VALUE
// specifier outside the @std/* family fails the build — the boundary is
// enforced, never trusted. The bundled set is DERIVED from the walk, never a
// hand-maintained list: a successor change that extends the closure changes
// the derived set AND forces the PACKAGE-MANIFEST.sha256 recut in the same
// change (recut invariant D5).
//
// Serial-composition fact (recorded in the manifest header; recut invariant):
// serial composition 12 -> 13 -> 14b -> 17 -> 18 landed; the 6th serial slot
// is reserved-but-unconsumed (the public-code-search row lands no sibling).
//
// Usage (via scripts/omp/bundle-omp-extension.sh):
//   deno run --allow-read --allow-write bundle-extension.ts \
//     <src-root> <extension-target> <repo-deno-lock>

const [src, target, denoLockPath] = Deno.args;
const ENTRY = "src/acp/omp/extension/index.ts";

for (const [name, v] of [["src", src], ["target", target], ["deno.lock", denoLockPath]] as const) {
  if (!v) {
    console.error(
      `usage: bundle-extension.ts <src-root> <extension-target> <repo-deno-lock> (missing ${name})`,
    );
    Deno.exit(2);
  }
}

interface Dep {
  ref: string;
  value: boolean;
}

/**
 * Static + dynamic import specifiers with value-vs-type-only classification.
 * Handles double- AND single-quote specifiers (prettier enforces double, but
 * the walk must not silently miss a hand-edited single-quote edge) and dynamic
 * `import("...")`. A bare side-effect import (`import "./setup.ts";`) has no
 * from-clause and is rejected fail-closed below — silently excluding it from
 * the closure would throw at image load far from its cause.
 */
function parseImports(text: string): Dep[] {
  const out: Dep[] = [];
  const re = /\b(import|export)\b([\s\S]*?)from\s+"([^"]+)"/g;
  const reQ = /\b(import|export)\b([\s\S]*?)from\s+'([^']+)'/g;
  const dyn = /(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/g;
  // Fail closed on bare side-effect imports: they carry values but no
  // from-clause this parser classifies.
  if (/^\s*import\s+["'][^"']+["']\s*;?\s*$/m.test(text)) {
    console.error(
      "bare side-effect import is outside the bundler's classifier; refactor to a named import",
    );
    Deno.exit(1);
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(classify(m));
  }
  while ((m = reQ.exec(text))) {
    out.push(classify(m));
  }
  for (const d of text.matchAll(dyn)) out.push({ ref: d[1], value: true });
  return out;
}

function classify(m: RegExpExecArray): Dep {
  const [, kw, clause, spec] = m;
  const b = clause.trim();
  const symHasValue = (inner: string) =>
    inner.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).some((s) => !s.startsWith("type "));
  let value: boolean;
  if (kw === "export") {
    if (b.startsWith("type ")) value = false;
    else if (b.startsWith("*")) value = true;
    else value = symHasValue(b.replace(/^\{/, "").replace(/\}[\s\S]*$/, ""));
  } else if (b.startsWith("type ")) {
    value = false;
  } else if (b === "" || b.startsWith("*") || /^[A-Za-z_$]/.test(b)) {
    value = true;
  } else {
    value = symHasValue(b.replace(/^\{/, "").replace(/\}[\s\S]*$/, ""));
  }
  return { ref: spec, value };
}

/** Resolve a relative specifier; null for bare/absolute refs. */
function resolveRef(from: string, ref: string): string | null {
  if (!ref.startsWith(".")) return null;
  const base = from.split("/").slice(0, -1);
  for (const p of ref.split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      if (base.length && base[base.length - 1] !== "..") base.pop();
      else base.push("..");
    } else base.push(p);
  }
  return base.join("/");
}

const importCache = new Map<string, Dep[]>();
async function importsOf(rel: string): Promise<Dep[]> {
  if (importCache.has(rel)) return importCache.get(rel)!;
  let f = `${src}/${rel}`;
  try {
    if ((await Deno.stat(f)).isDirectory) f += "/index.ts";
  } catch { /* read failure below */ }
  let text: string;
  try {
    text = await Deno.readTextFile(f);
  } catch {
    importCache.set(rel, []);
    return [];
  }
  const deps = parseImports(text);
  importCache.set(rel, deps);
  return deps;
}

// VALUE-import closure from the entry: the runtime surfaces of the installed
// tree. Type-only edges are erased by the loader and carry no installed-input
// requirement; value edges missing at their target fail the build.
const closure = new Set<string>([ENTRY]);
let frontier = [ENTRY];
while (frontier.length) {
  const next: string[] = [];
  for (const f of frontier) {
    for (const d of await importsOf(f)) {
      if (!d.value) continue;
      let r = resolveRef(f, d.ref);
      if (r === null || closure.has(r)) continue;
      // Directory-valued relative import resolves to its index.ts (matching
      // the loader and importsOf); copying a directory path would crash below.
      try {
        const st = await Deno.stat(`${src}/${r}`);
        if (st.isDirectory) {
          const viaIndex = `${r}/index.ts`;
          await Deno.stat(`${src}/${viaIndex}`);
          r = viaIndex;
        }
      } catch {
        console.error(`value import edge resolves to a missing module: ${f} -> ${d.ref}`);
        Deno.exit(1);
      }
      closure.add(r);
      next.push(r);
    }
  }
  frontier = next;
}

// External bare specifier families used by VALUE edges of the closure.
const externals = new Set<string>();
for (const f of closure) {
  for (const d of await importsOf(f)) {
    if (!d.value || d.ref.startsWith(".")) continue;
    const pkg = d.ref.startsWith("@")
      ? d.ref.split("/").slice(0, 2).join("/")
      : d.ref.split("/")[0];
    externals.add(pkg);
  }
}
// The installed trusted-extension closure may depend on ONLY the std library
// (mapped through the generated import map). Anything else (npm/jsr app
// runtime deps) means the closure leaked past the boundary — fail closed.
for (const pkg of externals) {
  if (!pkg.startsWith("@std/")) {
    console.error(`trusted-extension closure references unsupported external: ${pkg}`);
    Deno.exit(1);
  }
}

// Copy every closure file verbatim at its repo-relative path under mirror/.
for (const rel of [...closure].sort()) {
  const dest = `${target}/mirror/${rel}`;
  await Deno.mkdir(dest.split("/").slice(0, -1).join("/"), { recursive: true });
  await Deno.copyFile(`${src}/${rel}`, dest);
}

// Generated import map: pin every @std/* external (and its transitively
// locked jsr deps, e.g. @std/internal under @std/path) to the exact versions
// the committed deno.lock resolves.
const lock = JSON.parse(await Deno.readTextFile(denoLockPath));
const specifiers: Record<string, string> = lock.specifiers ?? {};
const imports: Record<string, string> = {};
function pin(pkg: string, ver: string): void {
  if (imports[pkg]) return;
  imports[`${pkg}/`] = `jsr:${pkg}@${ver}/`;
  imports[pkg] = `jsr:${pkg}@${ver}`;
  const queue = [`${pkg}@${ver}`];
  const seen = new Set<string>();
  while (queue.length) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const dep of lock.jsr?.[k]?.dependencies ?? []) {
      const dm = dep.match(/^jsr:([^@]+)@(.+)$/);
      if (!dm) continue;
      const depVer = specifiers[dep];
      if (depVer) {
        pin(dm[1], depVer);
        queue.push(`${dm[1]}@${depVer}`);
      }
    }
  }
}
for (const pkg of [...externals].sort()) {
  // The lockfile's specifiers table maps every range form the project uses
  // (e.g. `jsr:@std/path@1` for the `^1.0.0` import-map range) to the exact
  // resolved version; resolve to the highest exact version the lock names for
  // this package, so the generated import map pins exactly what the committed
  // lock resolves today.
  const candidates = Object.entries(specifiers)
    .filter(([k, v]) => k.startsWith(`jsr:${pkg}@`) && typeof v === "string")
    .map(([, v]) => v as string)
    // Only plain x.y.z versions participate in the highest-of-candidates
    // sort: a prerelease suffix maps to NaN components and would make the
    // pin order implementation-defined. Fail closed rather than guess.
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const ver = candidates.sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    return (pa[0] ?? 0) - (pb[0] ?? 0) || (pa[1] ?? 0) - (pb[1] ?? 0) ||
      (pa[2] ?? 0) - (pb[2] ?? 0);
  }).at(-1);
  if (!ver) {
    console.error(`cannot pin ${pkg}: deno.lock names no exact version for "jsr:${pkg}@..."`);
    Deno.exit(1);
  }
  pin(pkg, ver);
}
await Deno.writeTextFile(`${target}/deno.json`, `${JSON.stringify({ imports }, null, 2)}\n`);

// Generated entry adapter (the ONLY generated module): the contracted image
// path forwards to the verbatim mirror entry. Named exports via `export *`,
// the default export explicitly; the load-time side effects (row 12 gate,
// row 14b/read/search attachments) run exactly once, inside the mirror entry.
await Deno.writeTextFile(
  `${target}/index.ts`,
  [
    "// Generated by scripts/omp/bundle-extension.ts at image build time",
    "// (package-pinned-omp-runtime D5). Image-mode entry adapter: resolves the",
    "// contracted image path /opt/air/omp/extension/index.ts (row 9 seam:",
    "// src/utils/omp-paths.ts image-first resolution) and forwards the load",
    "// VERBATIM to the repo-relative mirror copy of the committed trusted-",
    "// extension entry. Pure re-export: no logic, no policy, no duplication;",
    "// named + default exports and every load-time side effect are the mirror",
    "// entry's own. The committed tree under mirror/ is the single authoring",
    "// location; the copy direction is daemon tree -> installed extension only,",
    "// never reverse.",
    `export * from "./mirror/${ENTRY}";`,
    `export { default } from "./mirror/${ENTRY}";`,
    "",
  ].join("\n"),
);

// Completeness gate: every VALUE relative specifier of every installed file
// resolves INSIDE the installed tree and exists there; externals are @std/*
// only (import-mapped above). Type-only edges are erased at load; the
// packaging suite proves the erasure claim by actually loading the bundle.
const problems: string[] = [];
for (const rel of [...closure].sort()) {
  for (const d of await importsOf(rel)) {
    if (!d.value) continue;
    if (d.ref.startsWith(".")) {
      const r = resolveRef(`mirror/${rel}`, d.ref);
      if (r === null || !r.startsWith("mirror/")) {
        problems.push(`mirror/${rel} -> ${d.ref} (ESCAPES installed tree)`);
        continue;
      }
      try {
        await Deno.stat(`${target}/${r}`);
      } catch {
        problems.push(`mirror/${rel} -> ${d.ref} (MISSING at ${r})`);
      }
    } else if (!d.ref.startsWith("@std/")) {
      problems.push(`mirror/${rel} -> ${d.ref} (UNMAPPED external)`);
    }
  }
}
{
  const r = resolveRef("index.ts", `./mirror/${ENTRY}`)!;
  try {
    await Deno.stat(`${target}/${r}`);
  } catch {
    problems.push(`index.ts -> ./mirror/${ENTRY} (MISSING)`);
  }
}
if (problems.length) {
  console.error(
    `trusted-extension closure incomplete:\n${[...new Set(problems)].sort().join("\n")}`,
  );
  Deno.exit(1);
}

console.log(`bundled ${closure.size} mirror modules + entry adapter under ${target}`);
