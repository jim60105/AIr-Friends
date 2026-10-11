// src/acp/omp/executable-sources.ts
//
// Row 27 `check-omp-workspace-executables`: the DECIDED (2026-10-09) decision-1
// startup check. Decision 1 keeps executable custom tools and plugin entry
// points OUT of the workspace by deployment control and REJECTS the session
// when a pre-native startup check finds an importable executable module in the
// workspace; the guard's fail-closed session rejection stays the fallback.
// This module is the startup check: a SYNCHRONOUS metadata-only observation of
// the loader-recognized executable discovery shapes along the pinned routes
// (`sdk.ts` `discoverCustomToolPaths`/`loadCustomTools`,
// `custom-tools/loader.ts` `loadTool`, `plugins/loader.ts` `getEnabledPlugins`
// — OMP v18.6.1, the same pinned commit as the row-11/13 ledgers). The shape
// inventory below is the traced subset — a repository inventory, never a claim
// of native support; the native verdicts stay `no-supported-mechanism`.
//
// Discipline (row-26 `settings-sources.ts` is the pattern, plus the spec deltas):
// - Observation reads ONLY filesystem metadata plus deterministic package-entry
//   declarations (`package.json` manifests). NEVER dynamic import, require,
//   factory call, subprocess or execution for inspection — the pinned loader
//   evidence says imports can run before metadata/factory inspection, so
//   nothing outside the owned image is ever imported or executed here.
// - An executable entry is a loader-recognized custom-tool module, plugin
//   entry point or linked dependency: `.ts`/`.js`/`.mjs`/`.cjs`/ESM/package
//   entries may execute on import, so NO POSIX execute bit is required, while
//   ordinary source files outside the discovery roots (e.g. the application's
//   own `src/`, or owned skill scripts outside discovery roots) are NEVER
//   inspected or rejected.
// - Any present importable entry, discovery/symlinked/broken link, IO failure,
//   missing workspace authority, or unknown entry shape is fail-closed: a
//   bounded named-surface rejection listing surfaces, bounded categories and
//   counts — never entry content or raw discovery inventories.
// - Rejection performs ZERO repository session/process/discovery side effects;
//   callers never catch the rejection to continue.
// - Every native request runs a FRESH observation (D2: "checks the current
//   requested workspace afresh"); the accepted snapshot carries the canonical
//   workspace identity + resourceGeneration so a workspace replaced between
//   checks is a different identity and can never reuse a previous clean result.
// - The observation is a point-in-time startup snapshot: no race-free barrier
//   against arbitrary external mutation or autonomous native imports exists
//   (decision 5), and native lifecycle reload timing stays a user-owned
//   runtime observation.

import { dirname, join, resolve } from "@std/path";

/** Max issues listed in one rejection reason (plus a truncation count). */
export const MAX_EXECUTABLE_REJECTION_DETAILS = 8;

/** Max entries inspected per directory and levels descended before fail-closed. */
const MAX_ENTRIES_PER_DIRECTORY = 64;
const MAX_DESCENT_DEPTH = 3;
/** Byte ceiling for a manifest read before fail-closed (bounded inspection). */
const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * Seam check for injected readers: the interface contract is "bounded
 * manifest text", so an over-cap string (or a throw) fails closed through
 * the caller's unparsable-manifest path. The DEFAULT backends enforce the
 * cap at the fd level in BYTES (Duck fold2 blocking): they never read or
 * decode more than MAX_MANIFEST_BYTES+1 bytes, so no arbitrarily large
 * manifest can be materialized — the `text.length` check here is the
 * injected-reader belt, not the byte bound (UTF-16 units are not UTF-8
 * bytes; multibyte manifests are byte-capped by the backends).
 */
function boundedManifestText(path: string, reader: ExecutableSourceMetadataReader): string {
  const text = reader.readFile(path);
  if (text.length > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }
  return text;
}

/** Module suffixes the pinned custom-tool loader recognizes as importable. */
const CUSTOM_TOOL_SUFFIXES = [".ts", ".js", ".mjs", ".cjs"] as const;

/** Surfaces an executable-source rejection can name (bounded vocabulary). */
export type ExecutableRejectionSurface =
  | "native-custom-tool-discovery"
  | "plugin-entry-points"
  | "workspace-owned-dependencies"
  | "configured-module-roots";

/** Bounded failure categories (never raw discovery inventories or content). */
export type ExecutableFailureCategory =
  | "executable_entry_found"
  | "linked_dependency_found"
  | "symlinked_discovery_candidate"
  | "broken_link"
  | "inaccessible_path"
  | "missing_workspace_authority"
  | "unknown_entry_shape"
  | "unreadable_package_manifest"
  | "configured_module_selector_present";

/** One bounded rejection detail. */
export interface ExecutableSourceIssue {
  surface: ExecutableRejectionSurface;
  category: ExecutableFailureCategory;
  /** Repository-derived path or name (bounded, content-free). */
  detail: string;
}

/** Bounded, credential-free rejection for executable-source posture. */
export class ExecutableSourceRejectionError extends Error {
  readonly phase: "preflight" | "extension_load";
  readonly surfaces: ExecutableRejectionSurface[];
  readonly issues: ExecutableSourceIssue[];
  readonly issueCount: number;
  readonly sessionCwd: string;

  constructor(params: {
    phase: "preflight" | "extension_load";
    sessionCwd: string;
    issues: ExecutableSourceIssue[];
  }) {
    const listed = params.issues.slice(0, MAX_EXECUTABLE_REJECTION_DETAILS);
    const reason = listed.map((i) => `${i.surface}/${i.category}: ${i.detail}`).join(", ");
    const truncated = params.issues.length - listed.length;
    super(
      `OMP executable-source ${params.phase} rejected session before the native request: ` +
        `${params.issues.length} issue(s) [${reason}${truncated > 0 ? ` +${truncated} more` : ""}]`,
    );
    this.name = "ExecutableSourceRejectionError";
    this.phase = params.phase;
    this.sessionCwd = params.sessionCwd;
    this.surfaces = [...new Set(listed.map((i) => i.surface))];
    this.issues = listed;
    this.issueCount = params.issues.length;
  }
}

/**
 * Sync metadata reader seam (tests inject failing readers; production uses the
 * host-appropriate synchronous fs APIs). Inspection NEVER follows a link:
 * `kind` lstats and `exists` distinguishes broken links from plain absence
 * via lstat.
 */
export interface ExecutableSourceMetadataReader {
  /** Directory names or null when the directory is absent; throws on IO failure. */
  readDirectory(path: string): string[] | null;
  /**
   * 'file' | 'dir' | 'link' | 'missing' | 'other'; throws on IO failure.
   * 'link' covers symlinks of any target (never treated as trust); a broken
   * link reports 'link' (lstat succeeds, stat would not).
   */
  kind(path: string): "file" | "dir" | "link" | "missing" | "other";
  /** Deterministic manifest text (bounded); throws on IO failure. */
  readFile(path: string): string;
  /** Canonical identity of an existing path (realPath); throws on failure. */
  identity(path: string): string;
  /** True when `real(parent) === realPath(parent)` — a plain, non-aliased parent. */
  parentIsCanonical(parent: string): boolean;
}

/** One accepted absence/inert record for an observed discovery root. */
export interface ExecutableObservationEntry {
  root: string;
  surface: ExecutableRejectionSurface;
  /** 'absent' | 'empty' | 'inert' (present, no importable entry). */
  status: "absent" | "empty" | "inert";
}

/** Accepted executable-source observation (fresh snapshot with authority identity). */
export interface AcceptedExecutableObservation {
  readonly sessionCwd: string;
  readonly resourceGeneration: string;
  /** Canonical workspace identity the acceptance is bound to. */
  readonly workspaceIdentity: string;
  readonly entries: readonly ExecutableObservationEntry[];
}

/** Guard-shaped observation for the decision-1 deployment admission (task 2.1). */
export interface ExecutableObservationForGuard {
  status: "absent-clean";
  sessionCwd: string;
  resourceGeneration: string;
}

/**
 * Dual-runtime metadata backend (Duck B4). The packaged extension is loaded
 * by OMP's EMBEDDED runtime — an open, user-owned UNVERIFIED question
 * (`docs/OMP_PACKAGING.md` §5: the `deno.json` import-map load path); the
 * packaging boundary simultaneously allows ONLY `@std/*` externals in the
 * closure (`scripts/omp/bundle-extension.ts`), so a static `node:fs` import
 * is build-fail-closed and a Deno-only reader is host-risk. Resolution
 * therefore rides the same runtime-global dispatch the extension already
 * uses for env/cwd (`typeof Deno`/`typeof process`, bootstrap.ts): a host
 * `require` of `node:fs` (Bun and Deno's node-compat both expose one) takes
 * precedence; the Deno sync namespace is the fallback; a host exposing
 * NEITHER gets a reader that throws on every call, which the observer
 * records as `inaccessible_path` — fail-closed, never silently clean. No
 * new static external enters the closure either way.
 */
interface NodeFsSyncModule {
  lstatSync(path: string): {
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
  };
  opendirSync(path: string): { readSync(): { name: string } | null; close(): void };
  openSync(path: string): number;
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): number;
  closeSync(fd: number): void;
  realpathSync(path: string): string;
}

function loadNodeFsSync(): NodeFsSyncModule | null {
  const req = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  try {
    const mod = req("node:fs") as Partial<NodeFsSyncModule> | null;
    if (
      mod !== null && typeof mod.lstatSync === "function" &&
      typeof mod.opendirSync === "function" && typeof mod.openSync === "function" &&
      typeof mod.readSync === "function" && typeof mod.closeSync === "function" &&
      typeof mod.realpathSync === "function"
    ) {
      return mod as NodeFsSyncModule;
    }
  } catch {
    // Host require exists but cannot resolve node:fs: fall to the Deno face.
  }
  return null;
}

const manifestDecoder = new TextDecoder("utf-8", { fatal: false });

/** Fill `buffer` from `pull` up to one byte over the manifest cap; the pull
 * stops at EOF (n <= 0) and the caller rejects any overflow un-decoded. */
function fillBoundedManifest(
  buffer: Uint8Array,
  pull: (into: Uint8Array) => number,
): number {
  let filled = 0;
  while (filled < buffer.length) {
    const n = pull(buffer.subarray(filled));
    if (n <= 0) break; // EOF (or empty read; never spin)
    filled += n;
  }
  return filled;
}

function defaultReader(): ExecutableSourceMetadataReader {
  const nodeFs = loadNodeFsSync();
  const denoHost = typeof Deno !== "undefined" && typeof Deno.lstatSync === "function"
    ? Deno
    : null;
  if (nodeFs === null && denoHost === null) {
    // No synchronous metadata surface in this host: every observation
    // throws and is recorded fail-closed as inaccessible_path.
    const unavailable = (): never => {
      throw new Error("host runtime exposes no synchronous filesystem metadata surface");
    };
    return {
      readDirectory: unavailable,
      kind: unavailable,
      readFile: unavailable,
      identity: unavailable,
      parentIsCanonical: () => false,
    };
  }
  return {
    readDirectory(path) {
      // Stop after one entry past the cap on BOTH faces (Duck fold2
      // non-blocking): the Deno iterator is lazy and the node face uses
      // opendirSync/readSync, so an oversized directory is never fully
      // enumerated or materialized before the fail-closed overflow.
      const names: string[] = [];
      if (nodeFs !== null) {
        const dir = nodeFs.opendirSync(path);
        try {
          for (;;) {
            const entry = dir.readSync();
            if (entry === null) break;
            names.push(entry.name);
            if (names.length > MAX_ENTRIES_PER_DIRECTORY) return names;
          }
        } finally {
          dir.close();
        }
      } else {
        for (const entry of denoHost!.readDirSync(path)) {
          names.push(entry.name);
          if (names.length > MAX_ENTRIES_PER_DIRECTORY) return names;
        }
      }
      return names.sort();
    },
    kind(path) {
      try {
        if (nodeFs !== null) {
          // Node `Stats` shape: lstat never follows the link, so a link
          // reports isSymbolicLink() whether or not its target exists.
          const info = nodeFs.lstatSync(path);
          if (info.isSymbolicLink()) return "link"; // includes broken links
          if (info.isDirectory()) return "dir";
          if (info.isFile()) return "file";
          return "other";
        }
        const info = denoHost!.lstatSync(path);
        if (info.isSymlink) return "link"; // includes broken links
        if (info.isDirectory) return "dir";
        if (info.isFile) return "file";
        return "other";
      } catch (error) {
        const missing = nodeFs !== null
          ? (error as { code?: string }).code === "ENOENT"
          : error instanceof Deno.errors.NotFound;
        if (missing) return "missing";
        throw error;
      }
    },
    readFile(path) {
      // Genuinely bounded read (Duck fold2 blocking): open + read at most
      // MAX_MANIFEST_BYTES+1 BYTES, reject the overflow BEFORE decoding or
      // parsing, and close the handle in finally. Neither face ever
      // materializes an arbitrarily large manifest.
      const buffer = new Uint8Array(MAX_MANIFEST_BYTES + 1);
      if (nodeFs !== null) {
        const fd = nodeFs.openSync(path);
        try {
          const filled = fillBoundedManifest(
            buffer,
            (into) => nodeFs.readSync(fd, into, 0, into.length, null),
          );
          if (filled > MAX_MANIFEST_BYTES) {
            throw new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
          }
          return manifestDecoder.decode(buffer.subarray(0, filled));
        } finally {
          nodeFs.closeSync(fd);
        }
      }
      const file = denoHost!.openSync(path);
      try {
        const filled = fillBoundedManifest(buffer, (into) => file.readSync(into) ?? 0);
        if (filled > MAX_MANIFEST_BYTES) {
          throw new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
        }
        return manifestDecoder.decode(buffer.subarray(0, filled));
      } finally {
        file.close();
      }
    },
    identity: (path) => nodeFs !== null ? nodeFs.realpathSync(path) : denoHost!.realPathSync(path),
    parentIsCanonical(parent) {
      try {
        const real = nodeFs !== null ? nodeFs.realpathSync(parent) : denoHost!.realPathSync(parent);
        return real === resolve(parent);
      } catch {
        return false;
      }
    },
  };
}

function issue(
  surface: ExecutableRejectionSurface,
  category: ExecutableFailureCategory,
  detail: string,
): ExecutableSourceIssue {
  return { surface, category, detail: detail.slice(0, 160) };
}

/** Bounded directory listing; null when absent; records a failure and returns null. */
function listBounded(
  dir: string,
  surface: ExecutableRejectionSurface,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): string[] | null {
  let names: string[] | null;
  try {
    names = reader.readDirectory(dir);
  } catch {
    issues.push(issue(surface, "inaccessible_path", dir));
    return null;
  }
  if (names === null) return null;
  if (names.length > MAX_ENTRIES_PER_DIRECTORY) {
    issues.push(issue(surface, "unknown_entry_shape", `${dir} listing truncated`));
    return null;
  }
  return names;
}

function kindOf(
  path: string,
  surface: ExecutableRejectionSurface,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): string | null {
  try {
    return reader.kind(path);
  } catch {
    issues.push(issue(surface, "inaccessible_path", path));
    return null;
  }
}

/**
 * Walk the workspace-root-relative component path without following links:
 * every intermediate directory must exist and not be a link. Returns the kind
 * of the final component, or null (issue recorded) on a linking/absent/broken
 * intermediate or unreadable component.
 */
function walkComponents(
  workspaceRoot: string,
  components: readonly string[],
  surface: ExecutableRejectionSurface,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): { path: string; kind: string } | null {
  let path = workspaceRoot;
  for (const component of components) {
    path = join(path, component);
    const kind = kindOf(path, surface, reader, issues);
    if (kind === null) return null;
    if (kind === "missing") return { path, kind };
    if (kind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", path));
      return null;
    }
    if (component !== components[components.length - 1] && kind !== "dir") {
      issues.push(issue(surface, "unknown_entry_shape", path));
      return null;
    }
  }
  return { path, kind: kindOf(path, surface, reader, issues) ?? "missing" };
}

function hasToolSuffix(name: string): boolean {
  return CUSTOM_TOOL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Recursively observe one custom-tool discovery root (`<ws>/.omp/tools`,
 * `<ws>/tools`, or the foreign-provider `<ws>/.claude/tools` route). The
 * pinned route enumerates these roots (including package/
 * index forms) and imports every module found before factory inspection, so
 * any importable suffix, package manifest or unknown shape under the root —
 * at any bounded depth — is fail-closed. Only provably inert non-module files
 * are accepted.
 */
function observeToolTree(
  dir: string,
  surface: ExecutableRejectionSurface,
  depth: number,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): void {
  const names = listBounded(dir, surface, reader, issues);
  if (names === null) return; // failure recorded (or absent root handled upstream)
  for (const name of names) {
    const path = `${dir}/${name}`;
    const kind = kindOf(path, surface, reader, issues);
    if (kind === null || kind === "missing") continue;
    if (kind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", path));
      continue;
    }
    if (kind === "dir") {
      if (depth >= MAX_DESCENT_DEPTH) {
        issues.push(issue(surface, "unknown_entry_shape", `${path} depth limit`));
        continue;
      }
      observeToolTree(path, surface, depth + 1, reader, issues);
      continue;
    }
    if (kind !== "file") {
      issues.push(issue(surface, "unknown_entry_shape", path));
      continue;
    }
    if (name === "package.json") {
      // A custom-tool package form is importable via its declared entry; a
      // manifest's mere presence inside a tool root determines rejection, so
      // its content is NEVER read (bounded, content-free contract).
      issues.push(issue(surface, "executable_entry_found", path));
      continue;
    }
    if (hasToolSuffix(name)) {
      issues.push(issue(surface, "executable_entry_found", path));
      continue;
    }
    // Provably inert (e.g. README.md); ordinary source stays un-inspected.
  }
}

/** Observe one custom-tool root by its workspace-relative components. */
function observeCustomToolRoot(
  workspaceRoot: string,
  components: readonly string[],
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): ExecutableObservationEntry | null {
  const surface: ExecutableRejectionSurface = "native-custom-tool-discovery";
  const walked = walkComponents(workspaceRoot, components, surface, reader, issues);
  if (walked === null) return null;
  const { path, kind } = walked;
  if (kind === "missing") return { root: path, surface, status: "absent" };
  if (kind === "file") {
    // `tools` occupied by a file: unknown layout, fail closed.
    issues.push(issue(surface, "unknown_entry_shape", path));
    return null;
  }
  if (kind !== "dir") {
    issues.push(issue(surface, "unknown_entry_shape", path));
    return null;
  }
  const before = issues.length;
  observeToolTree(path, surface, 0, reader, issues);
  if (issues.length > before) return null;
  return { root: path, surface, status: "empty" };
}

/**
 * Observe one plugin discovery root (`<ws>/.omp/plugins` or `<ws>/plugins`):
 * each child directory is a plugin candidate; index/package entry points are
 * importable (rejected), unparsable manifests or unknown child shapes fail
 * closed, children with no entry point are inert.
 */
function observePluginRoot(
  workspaceRoot: string,
  components: readonly string[],
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): ExecutableObservationEntry | null {
  const surface: ExecutableRejectionSurface = "plugin-entry-points";
  const walked = walkComponents(workspaceRoot, components, surface, reader, issues);
  if (walked === null) return null;
  const { path, kind } = walked;
  if (kind === "missing") return { root: path, surface, status: "absent" };
  if (kind !== "dir") {
    issues.push(issue(surface, "unknown_entry_shape", path));
    return null;
  }
  const names = listBounded(path, surface, reader, issues);
  if (names === null) return null;
  let sawInert = false;
  for (const name of names) {
    const child = `${path}/${name}`;
    const childKind = kindOf(child, surface, reader, issues);
    if (childKind === null || childKind === "missing") continue;
    if (childKind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", child));
      continue;
    }
    if (childKind !== "dir") {
      // Loose files directly under a plugin root are an unknown layout.
      issues.push(issue(surface, "unknown_entry_shape", child));
      continue;
    }
    const index = CUSTOM_TOOL_SUFFIXES.map((suffix) => `${child}/index${suffix}`)
      .find((candidate) => {
        const candidateKind = kindOf(candidate, surface, reader, issues);
        if (candidateKind === "other") {
          // A special file at an index candidate position has unknown
          // importability (fail-closed): never recorded inert.
          issues.push(issue(surface, "unknown_entry_shape", candidate));
          return false;
        }
        return candidateKind === "file" || candidateKind === "link";
      });
    if (index !== undefined) {
      issues.push(issue(surface, "executable_entry_found", index));
      continue;
    }
    const manifestKind = kindOf(`${child}/package.json`, surface, reader, issues);
    if (manifestKind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", `${child}/package.json`));
      continue;
    }
    if (manifestKind === "file") {
      let declaresEntry = false;
      try {
        const manifest = JSON.parse(boundedManifestText(`${child}/package.json`, reader)) as {
          main?: unknown;
          module?: unknown;
          exports?: unknown;
        };
        declaresEntry = typeof manifest.main === "string" ||
          typeof manifest.module === "string" || manifest.exports !== undefined;
      } catch {
        issues.push(issue(surface, "unreadable_package_manifest", `${child}/package.json`));
        continue;
      }
      if (declaresEntry) {
        issues.push(issue(surface, "executable_entry_found", `${child}/package.json entry`));
        continue;
      }
    } else if (manifestKind !== null && manifestKind !== "missing") {
      issues.push(issue(surface, "unknown_entry_shape", `${child}/package.json`));
      continue;
    }
    sawInert = true; // candidate directory with no importable entry point
  }
  return { root: path, surface, status: sawInert ? "inert" : "empty" };
}

/**
 * Observe workspace linked dependencies: `package.json` `file:`/`link:`/
 * `workspace:` dependency specifiers plus symlinked `node_modules` entries
 * (including `@scope` groups). The pinned plugin route includes linked
 * dependencies, so any linked dependency reachable from the workspace is
 * importable and fails closed.
 */
function observeLinkedDependencies(
  workspaceRoot: string,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): void {
  const surface: ExecutableRejectionSurface = "workspace-owned-dependencies";
  const manifestPath = `${workspaceRoot}/package.json`;
  const manifestKind = kindOf(manifestPath, surface, reader, issues);
  if (manifestKind === "link") {
    issues.push(issue(surface, "symlinked_discovery_candidate", manifestPath));
    // Rejection decided; node_modules below cannot add actionable detail.
    return;
  } else if (manifestKind === "file") {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(boundedManifestText(manifestPath, reader)) as Record<string, unknown>;
    } catch {
      issues.push(issue(surface, "unknown_entry_shape", `${manifestPath} unparsable`));
      return;
    }
    for (
      const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    ) {
      const deps = manifest[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, specifier] of Object.entries(deps as Record<string, unknown>)) {
        if (typeof specifier === "string" && /^(file:|link:|workspace:)/.test(specifier)) {
          issues.push(issue(surface, "linked_dependency_found", `${name} (${field})`));
        }
      }
    }
  } else if (manifestKind !== null && manifestKind !== "missing") {
    // A directory or special file occupying the manifest position has unknown
    // importability semantics (Duck B5): never silently clean.
    issues.push(issue(surface, "unknown_entry_shape", manifestPath));
  }
  const modulesKind = kindOf(`${workspaceRoot}/node_modules`, surface, reader, issues);
  if (modulesKind === "link") {
    issues.push(issue(surface, "symlinked_discovery_candidate", `${workspaceRoot}/node_modules`));
    return;
  }
  if (modulesKind === null) return; // IO failure recorded
  if (modulesKind === "other") {
    // A special file occupying the node_modules position: unknown importability.
    issues.push(issue(surface, "unknown_entry_shape", `${workspaceRoot}/node_modules`));
    return;
  }
  if (modulesKind !== "dir") return; // missing or plain file: nothing linked
  const names = listBounded(`${workspaceRoot}/node_modules`, surface, reader, issues);
  if (names === null) return;
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const path = `${workspaceRoot}/node_modules/${name}`;
    const childKind = kindOf(path, surface, reader, issues);
    if (childKind === null || childKind === "missing") continue;
    if (childKind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", path));
      continue;
    }
    if (childKind === "other") {
      issues.push(issue(surface, "unknown_entry_shape", path));
      continue;
    }
    if (name.startsWith("@") && childKind === "dir") {
      const scoped = listBounded(path, surface, reader, issues);
      if (scoped === null) continue;
      for (const scopedName of scoped) {
        if (scopedName.startsWith(".")) continue;
        const scopedPath = `${path}/${scopedName}`;
        const scopedKind = kindOf(scopedPath, surface, reader, issues);
        if (scopedKind === null || scopedKind === "missing") continue;
        if (scopedKind === "link") {
          issues.push(issue(surface, "symlinked_discovery_candidate", scopedPath));
        } else if (scopedKind === "other") {
          issues.push(issue(surface, "unknown_entry_shape", scopedPath));
        }
      }
    }
  }
}

/**
 * Observe reachable global discovery routes under the owned state roots:
 * custom-tool routes (`<ownedHome>/.omp/tools`, `<agentDir>/tools`) plus the
 * plugin routes the pinned plugin loader anchors at the user directory and
 * the agent/home namespace (`<ownedHome>/.omp/plugins`, `<agentDir>/plugins`)
 * (Duck B1: a populated global plugin install is an importable global tool
 * supply even with both tools routes empty). The pinned route includes
 * agent-dir/home routes reachable from owned state/HOME, so ANYTHING present
 * there — even owned or empty — cannot satisfy deployment exclusion for the
 * ambient/native surface and fails closed. Absent is clean.
 */
function observeGlobalRoutes(
  roots: ExecutableOwnedRoots,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): ExecutableObservationEntry[] {
  const entries: ExecutableObservationEntry[] = [];
  const globalRoutes: { root: string; surface: ExecutableRejectionSurface }[] = [
    { root: `${roots.ownedHome}/.omp/tools`, surface: "native-custom-tool-discovery" },
    { root: `${roots.agentDir}/tools`, surface: "native-custom-tool-discovery" },
    { root: `${roots.ownedHome}/.omp/plugins`, surface: "plugin-entry-points" },
    { root: `${roots.agentDir}/plugins`, surface: "plugin-entry-points" },
  ];
  for (const { root, surface } of globalRoutes) {
    const kind = kindOf(root, surface, reader, issues);
    if (kind === null) continue; // failure already recorded
    if (kind === "missing") {
      entries.push({ root, surface, status: "absent" });
      continue;
    }
    issues.push(
      issue(
        surface,
        kind === "link" ? "symlinked_discovery_candidate" : "unknown_entry_shape",
        root,
      ),
    );
  }
  return entries;
}

/**
 * Configured-module selector posture: `PI_CONFIG_FILES` / `OMP_PROFILE` /
 * `PI_PROFILE` add module/config layers through the same import surface, so a
 * selector present in the OBSERVED process env cannot establish deployment
 * exclusion. `XDG_CONFIG_HOME`/`PI_CODING_AGENT_DIR` are owned namespace
 * variables already enforced by the row-2 plan gate and the row-30 profile
 * pin — never rejected here.
 */
function observeConfiguredModuleSelectors(
  processEnv: Record<string, string | undefined>,
  issues: ExecutableSourceIssue[],
): void {
  for (const key of ["PI_CONFIG_FILES", "OMP_PROFILE", "PI_PROFILE"]) {
    const value = processEnv[key];
    if (value !== undefined && value !== "") {
      issues.push(issue("configured-module-roots", "configured_module_selector_present", key));
    }
  }
}

/** Owned settings-state roots the workspace must not alias into: the same
 * authority the row-26 plan carries. The connector passes them from the plan;
 * the extension-load fallback derives them from the owned launch env. */
export interface ExecutableOwnedRoots {
  readonly ownedHome: string;
  readonly agentDir: string;
  /**
   * The plan's neutral, deployment-owned launch cwd (row 9's mode-distinct
   * cwd). It lives INSIDE the mode namespace BY DESIGN, so `connect()`'s
   * pre-spawn check (which observes this exact directory) admits it as an
   * exact identity; its executable discovery shapes are still observed and
   * fail closed. Any OTHER workspace inside the namespace is aliasing into
   * owned settings state and stays rejected.
   */
  readonly launchCwd?: string;
}

/** Workspace authority: the actual session workspace (+ optional shared Agent
 * workspace) as observed against the owned settings roots. */
interface WorkspaceAuthority {
  sessionCwd: string;
  sharedWorkspace: string;
  identity: string;
}

function deriveWorkspaceAuthority(
  roots: ExecutableOwnedRoots,
  sessionCwd: string,
  sharedWorkspace: string | undefined,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
  phase: "preflight" | "extension_load",
): WorkspaceAuthority | null {
  const surface: ExecutableRejectionSurface = "workspace-owned-dependencies";
  const check = (raw: string, label: string): { path: string; identity: string } | null => {
    const path = resolve(raw);
    const kind = kindOf(path, surface, reader, issues);
    if (kind === "missing") {
      issues.push(issue(surface, "missing_workspace_authority", `${label} absent`));
      return null;
    }
    if (kind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", `${label} is a link`));
      return null;
    }
    if (kind !== "dir") {
      issues.push(issue(surface, "missing_workspace_authority", `${label} not a directory`));
      return null;
    }
    // A link-free path: the immediate parent must canonicalize to itself, so
    // the observed path can never alias into an owned root via an ancestor
    // link (same trick as row 26's accepted-overlay identity).
    if (!reader.parentIsCanonical(dirname(path))) {
      issues.push(issue(surface, "symlinked_discovery_candidate", `${label} parent`));
      return null;
    }
    let identity: string;
    try {
      identity = reader.identity(path);
    } catch {
      issues.push(issue(surface, "inaccessible_path", `${label} identity`));
      return null;
    }
    // Preflight (connector seam): the ACTUAL user workspace must never alias
    // into the owned settings state — an identity inside an owned root is a
    // foreign admission attempt — with the sole designed exception of the
    // plan's OWN neutral launch cwd (the `connect()` seam observes exactly
    // that directory; its executable shapes are still scanned fail-closed
    // below). Extension load: the authority IS the owned, neutral launch cwd
    // (row 9's mode-distinct cwd under the namespace), so containment in the
    // namespace is the production posture; its executable discovery shapes
    // are still observed and fail closed below, and the global routes get
    // their own explicit check.
    if (phase === "preflight") {
      const neutral = roots.launchCwd !== undefined ? resolve(roots.launchCwd) : undefined;
      if (identity !== neutral) {
        for (const owned of [roots.ownedHome, roots.agentDir]) {
          if (identity === owned || identity.startsWith(owned.replace(/\/+$/, "") + "/")) {
            issues.push(issue(surface, "unknown_entry_shape", `${label} inside owned state root`));
            return null;
          }
        }
      }
    }
    return { path, identity };
  };
  const session = check(sessionCwd, "session workspace");
  if (session === null) return null;
  if (sharedWorkspace === undefined) {
    return { sessionCwd: session.path, sharedWorkspace: session.path, identity: session.identity };
  }
  const shared = check(sharedWorkspace, "shared Agent workspace");
  if (shared === null) return null;
  return { sessionCwd: session.path, sharedWorkspace: shared.path, identity: session.identity };
}

/**
 * Run the synchronous metadata-only executable-source observation for one
 * actual session workspace. Returns the accepted observation or throws the
 * bounded fail-closed rejection. `phase` distinguishes the repository pre-native
 * preflight ("preflight") from the extension-load fallback ("extension_load").
 */
export function checkOmpExecutableSources(params: {
  phase: "preflight" | "extension_load";
  sessionCwd: string;
  /** Actual shared Agent workspace (AGENT_WORKSPACE) when the connector set one. */
  sharedWorkspace?: string;
  roots: ExecutableOwnedRoots;
  resourceGeneration?: string;
  /** Observed process env (production: Deno.env.toObject()). */
  processEnv: Record<string, string | undefined>;
  reader?: ExecutableSourceMetadataReader;
}): AcceptedExecutableObservation {
  const reader = params.reader ?? defaultReader();
  const issues: ExecutableSourceIssue[] = [];
  // Owned-root authority (Duck B3): discovery-route interpolation of an
  // empty/relative HOME or agent dir would scan filesystem-root-adjacent
  // paths (`/.omp/tools`) and admit their absence as clean — a fake
  // "authority". Both owned roots must be absolute, existing, non-link
  // directories before any route is observed; otherwise fail closed.
  for (
    const [label, root] of [
      ["owned home root", params.roots.ownedHome],
      ["agent dir root", params.roots.agentDir],
    ] as const
  ) {
    const surface: ExecutableRejectionSurface = "workspace-owned-dependencies";
    if (root === "" || !root.startsWith("/")) {
      issues.push(issue(surface, "missing_workspace_authority", `${label} unset or relative`));
      continue;
    }
    const rootKind = kindOf(resolve(root), surface, reader, issues);
    if (rootKind === "missing") {
      issues.push(issue(surface, "missing_workspace_authority", `${label} absent`));
    } else if (rootKind === "link") {
      issues.push(issue(surface, "symlinked_discovery_candidate", `${label} is a link`));
    } else if (rootKind !== "dir") {
      issues.push(issue(surface, "missing_workspace_authority", `${label} not a directory`));
    }
  }
  const authority = deriveWorkspaceAuthority(
    params.roots,
    params.sessionCwd,
    params.sharedWorkspace,
    reader,
    issues,
    params.phase,
  );
  observeConfiguredModuleSelectors(params.processEnv, issues);
  if (authority === null) {
    throw new ExecutableSourceRejectionError({
      phase: params.phase,
      sessionCwd: params.sessionCwd,
      issues,
    });
  }
  const entries: ExecutableObservationEntry[] = [];
  const workspaces = authority.sharedWorkspace === authority.sessionCwd
    ? [authority.sessionCwd]
    : [authority.sessionCwd, authority.sharedWorkspace];
  for (const workspace of workspaces) {
    for (
      const components of [
        [".omp", "tools"],
        ["tools"],
        // Foreign-provider project route at the pin (Duck B1): the Claude
        // discovery provider enumerates project `.claude/tools/*.ts|js`
        // independently of the settings files row 26 already gates, so a
        // clean settings posture cannot imply this route is empty.
        [".claude", "tools"],
        [".omp", "plugins"],
        ["plugins"],
      ] as const
    ) {
      const observe = components[components.length - 1] === "plugins"
        ? observePluginRoot
        : observeCustomToolRoot;
      const entry = observe(workspace, components, reader, issues);
      if (entry !== null) entries.push(entry);
    }
    observeLinkedDependencies(workspace, reader, issues);
  }
  for (const entry of observeGlobalRoutes(params.roots, reader, issues)) entries.push(entry);
  if (issues.length > 0) {
    throw new ExecutableSourceRejectionError({
      phase: params.phase,
      sessionCwd: params.sessionCwd,
      issues,
    });
  }
  return {
    sessionCwd: authority.sessionCwd,
    resourceGeneration: params.resourceGeneration ?? `gen:${authority.identity}`,
    workspaceIdentity: authority.identity,
    entries,
  };
}

/**
 * Guard-shaped deployment observation for an accepted check (task 2.1): the
 * admission input that replaces the unconditional unsupported-native-status
 * application rejection. Incomplete/failed observations never reach the guard —
 * they reject at the caller before the protected native request.
 */
export function executableObservationForGuard(
  accepted: AcceptedExecutableObservation,
): ExecutableObservationForGuard {
  return {
    status: "absent-clean",
    sessionCwd: accepted.sessionCwd,
    resourceGeneration: accepted.resourceGeneration,
  };
}
