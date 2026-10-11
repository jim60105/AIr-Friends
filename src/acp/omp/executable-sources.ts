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
 * synchronous Deno fs APIs). Inspection NEVER follows a link: `kind` lstats and
 * `exists` distinguishes broken links from plain absence via lstat.
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

function defaultReader(): ExecutableSourceMetadataReader {
  return {
    readDirectory(path) {
      const names: string[] = [];
      for (const entry of Deno.readDirSync(path)) names.push(entry.name);
      return names.sort();
    },
    kind(path) {
      try {
        const info = Deno.lstatSync(path);
        if (info.isSymlink) return "link"; // includes broken links
        if (info.isDirectory) return "dir";
        if (info.isFile) return "file";
        return "other";
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return "missing";
        throw error;
      }
    },
    readFile(path) {
      return Deno.readTextFileSync(path);
    },
    identity(path) {
      return Deno.realPathSync(path);
    },
    parentIsCanonical(parent) {
      try {
        return Deno.realPathSync(parent) === resolve(parent);
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
 * Recursively observe one custom-tool discovery root (`<ws>/.omp/tools` or
 * `<ws>/tools`). The pinned route enumerates these roots (including package/
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
      // A custom-tool package form is importable via its declared entry; when
      // the declaration cannot even be read, importability is unknown.
      try {
        JSON.parse(reader.readFile(path));
      } catch {
        issues.push(issue(surface, "unreadable_package_manifest", path));
        continue;
      }
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
        const manifest = JSON.parse(reader.readFile(`${child}/package.json`)) as {
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
  } else if (manifestKind === "file") {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(reader.readFile(manifestPath)) as Record<string, unknown>;
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
  }
  const modulesKind = kindOf(`${workspaceRoot}/node_modules`, surface, reader, issues);
  if (modulesKind === "link") {
    issues.push(issue(surface, "symlinked_discovery_candidate", `${workspaceRoot}/node_modules`));
    return;
  }
  if (modulesKind !== "dir") return;
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
        }
      }
    }
  }
}

/**
 * Observe reachable global discovery routes under the owned state roots
 * (`<ownedHome>/.omp/tools`, `<agentDir>/tools`). The pinned route includes
 * agent-dir/home tools reachable from owned state/HOME, so ANYTHING present
 * there — even owned or empty — cannot satisfy deployment exclusion for the
 * ambient/native surface and fails closed. Absent is clean.
 */
function observeGlobalRoutes(
  roots: ExecutableOwnedRoots,
  reader: ExecutableSourceMetadataReader,
  issues: ExecutableSourceIssue[],
): ExecutableObservationEntry[] {
  const entries: ExecutableObservationEntry[] = [];
  for (const root of [`${roots.ownedHome}/.omp/tools`, `${roots.agentDir}/tools`]) {
    const kind = kindOf(root, "native-custom-tool-discovery", reader, issues);
    if (kind === null) continue; // failure already recorded
    if (kind === "missing") {
      entries.push({ root, surface: "native-custom-tool-discovery", status: "absent" });
      continue;
    }
    issues.push(
      issue(
        "native-custom-tool-discovery",
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
    for (const owned of [roots.ownedHome, roots.agentDir]) {
      if (identity === owned || identity.startsWith(owned.replace(/\/+$/, "") + "/")) {
        issues.push(issue(surface, "unknown_entry_shape", `${label} inside owned state root`));
        return null;
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
  const authority = deriveWorkspaceAuthority(
    params.roots,
    params.sessionCwd,
    params.sharedWorkspace,
    reader,
    issues,
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
        [".omp", "plugins"],
        ["plugins"],
      ] as const
    ) {
      const observe = components[1] === "plugins" ? observePluginRoot : observeCustomToolRoot;
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
