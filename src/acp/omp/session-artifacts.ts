/**
 * Bounded discovery of the current OMP ACP session's persisted journal, and of
 * the bash-artifact directory derived from it (change
 * `admit-current-omp-bash-artifacts`, design D1).
 *
 * Provenance comes ONLY from the connector's trusted lifecycle inputs: the
 * factory-selected `XDG_DATA_HOME`, the ACP session id OMP returned from
 * `session/new` (which IS the native session UUID) and the registered session
 * cwd. A request path, a tool-output string, the Skill API session id, ambient
 * HOME and any caller-supplied artifact root confer nothing.
 *
 * The pinned native layout (OMP v18.6.1, revision 2a2c6dc) is:
 *   <XDG_DATA_HOME>/omp/sessions/<cwdBucket>/<fileSafeISO>_<uuidv7>.jsonl
 * with the artifact directory exactly that journal path minus `.jsonl`. The cwd
 * bucket encoding is deliberately NOT reproduced: bucket directories are
 * enumerated and match by journal basename, journal header id and canonical cwd.
 *
 * Physical line 1 of a modern journal is a fixed-width title-slot record
 * (`type: "title"`), line 2 the session header (`type: "session"`, `id`, `cwd`);
 * a legacy journal starts with the header directly.
 */

import { basename, dirname, isAbsolute, join, normalize } from "@std/path";
import type { LinuxNativeCalls } from "../filesystem-access-linux.ts";
import { readOmpSessionHeaderPrefix } from "../filesystem-access.ts";
import type {
  MetadataReader,
  ObservedIdentity,
  OmpArtifactProvenance,
} from "../filesystem-roots.ts";
import { defaultMetadataReader, isWithinRoot } from "../filesystem-roots.ts";

/**
 * Discovery bounds (D1). A larger native index loses this optional capability
 * with a bounded diagnostic instead of authorizing a broader root.
 */
export const OMP_SESSION_BUCKET_LIMIT = 4096;
export const OMP_SESSION_ENTRY_LIMIT = 16384;

/** Physical file name of a persisted journal: `<fileSafeISO>_<uuidv7>.jsonl`. */
const JOURNAL_NAME_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

const JSONL_SUFFIX = ".jsonl";

/**
 * Discovery failure categories. Every one of them denies the artifact
 * capability only — the session stays available for otherwise-authorized work.
 */
export type OmpArtifactUnavailableReason =
  | "not_selected"
  | "invalid_input"
  | "sessions_root_unavailable"
  | "bounds_exceeded"
  | "no_match"
  | "ambiguous"
  | "unsafe_component"
  | "unreadable";

export type OmpArtifactResolution =
  | {
    readonly ok: true;
    readonly provenance: OmpArtifactProvenance;
    /** Observed identity of the factory-selected data root. */
    readonly dataRootIdentity: ObservedIdentity;
  }
  | {
    readonly ok: false;
    readonly reason: OmpArtifactUnavailableReason;
    readonly message: string;
  };

export interface ResolveOmpSessionArtifactsOptions {
  /** The connector's selected agent type; only `"omp"` is discoverable. */
  readonly agentType: "opencode" | "omp";
  /** Factory-produced absolute `XDG_DATA_HOME`, or undefined when unavailable. */
  readonly xdgDataHome: string | undefined;
  /** The native ACP session UUID returned by `session/new`. */
  readonly acpSessionId: string;
  /** The registered session cwd for the same session. */
  readonly sessionCwd: string;
  /** Metadata reader seam (defaults to the real filesystem). */
  readonly reader?: MetadataReader;
  /** Native backend calls for the bounded prefix read (test seam). */
  readonly nativeCalls?: LinuxNativeCalls;
  /**
   * Discovery bounds. Production always uses the exported defaults; tests
   * override them to exercise the exceedance path without materializing
   * thousands of directories.
   */
  readonly limits?: {
    readonly buckets?: number;
    readonly entries?: number;
  };
}

function unavailable(
  reason: OmpArtifactUnavailableReason,
  message: string,
): OmpArtifactResolution {
  return { ok: false, reason, message };
}

/** The session header of a journal prefix, or undefined when not yet present. */
function readJournalHeader(prefix: string): { id?: string; cwd?: string } | undefined {
  // Only the leading metadata records are inspected: the header is physical
  // line 1 (legacy) or line 2 (title-slot prefix), and transcript bodies are
  // never parsed.
  const lines = prefix.split("\n", 4);
  for (const line of lines) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== "session") continue;
    return {
      id: typeof record.id === "string" ? record.id : undefined,
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    };
  }
  return undefined;
}

/**
 * Resolve the current session's artifact provenance from trusted lifecycle
 * inputs. Never throws; every failure is a bounded, non-authorizing result.
 */
export async function resolveOmpSessionArtifacts(
  options: ResolveOmpSessionArtifactsOptions,
): Promise<OmpArtifactResolution> {
  const reader = options.reader ?? defaultMetadataReader;
  if (options.agentType !== "omp") {
    return unavailable("not_selected", "Artifact provenance requires the OMP agent type");
  }
  if (!options.xdgDataHome || !isAbsolute(options.xdgDataHome)) {
    return unavailable("invalid_input", "A factory absolute XDG data home is required");
  }
  if (!options.acpSessionId || !options.sessionCwd || !isAbsolute(options.sessionCwd)) {
    return unavailable("invalid_input", "A native session id and registered cwd are required");
  }
  const dataRoot = normalize(options.xdgDataHome);

  // The data root and sessions root must be existing, link-free directories;
  // otherwise nothing is discovered and no root is granted.
  let dataRootIdentity: ObservedIdentity | undefined;
  try {
    const dataInfo = await reader.lstat(dataRoot);
    if (!dataInfo.isDirectory || dataInfo.isSymlink) {
      return unavailable("sessions_root_unavailable", "Native data root is not a plain directory");
    }
    if ((await reader.realPath(dataRoot)) !== dataRoot) {
      return unavailable("sessions_root_unavailable", "Native data root path is not canonical");
    }
    if (dataInfo.dev === null || dataInfo.ino === null) {
      return unavailable("sessions_root_unavailable", "Native data root identity unavailable");
    }
    dataRootIdentity = { dev: dataInfo.dev, ino: dataInfo.ino };
  } catch {
    return unavailable("sessions_root_unavailable", "Native data root is unavailable");
  }

  const sessionsRoot = join(dataRoot, "omp", "sessions");
  let sessionsRootIdentity: ObservedIdentity;
  try {
    const ompInfo = await reader.lstat(join(dataRoot, "omp"));
    if (!ompInfo.isDirectory || ompInfo.isSymlink) {
      return unavailable("sessions_root_unavailable", "Native OMP data directory is not plain");
    }
    const sessionsInfo = await reader.lstat(sessionsRoot);
    if (!sessionsInfo.isDirectory || sessionsInfo.isSymlink) {
      return unavailable("sessions_root_unavailable", "Native sessions root is not plain");
    }
    if ((await reader.realPath(sessionsRoot)) !== sessionsRoot) {
      return unavailable("sessions_root_unavailable", "Native sessions root is not canonical");
    }
    if (sessionsInfo.dev === null || sessionsInfo.ino === null) {
      return unavailable("sessions_root_unavailable", "Native sessions root identity unavailable");
    }
    sessionsRootIdentity = { dev: sessionsInfo.dev, ino: sessionsInfo.ino };
  } catch {
    return unavailable("sessions_root_unavailable", "Native sessions root is unavailable");
  }

  // Enumerate only the immediate bucket directories, bounded in both dimensions.
  const bucketLimit = options.limits?.buckets ?? OMP_SESSION_BUCKET_LIMIT;
  const entryLimit = options.limits?.entries ?? OMP_SESSION_ENTRY_LIMIT;
  let totalEntries = 0;
  const buckets: string[] = [];
  try {
    for await (const entry of Deno.readDir(sessionsRoot)) {
      totalEntries += 1;
      if (totalEntries > entryLimit) {
        return unavailable("bounds_exceeded", "Native sessions index exceeds the entry bound");
      }
      if (!entry.isDirectory || entry.isSymlink) continue;
      buckets.push(join(sessionsRoot, entry.name));
      if (buckets.length > bucketLimit) {
        return unavailable("bounds_exceeded", "Native sessions index exceeds the bucket bound");
      }
    }
  } catch {
    return unavailable("sessions_root_unavailable", "Native sessions root is not enumerable");
  }

  const wantedId = options.acpSessionId;
  const candidates: { path: string; bucket: string }[] = [];
  for (const bucket of buckets) {
    let realBucket: string;
    try {
      const bucketInfo = await reader.lstat(bucket);
      if (!bucketInfo.isDirectory || bucketInfo.isSymlink) continue;
      realBucket = await reader.realPath(bucket);
    } catch {
      continue;
    }
    if (realBucket !== bucket || !isWithinRoot(bucket, sessionsRoot)) continue;

    const names: string[] = [];
    try {
      for await (const entry of Deno.readDir(bucket)) {
        totalEntries += 1;
        if (totalEntries > entryLimit) {
          return unavailable("bounds_exceeded", "Native sessions index exceeds the entry bound");
        }
        if (!entry.isFile || entry.isSymlink) continue;
        const match = JOURNAL_NAME_PATTERN.exec(entry.name);
        if (match === null) continue;
        if (match[2].toLowerCase() !== wantedId.toLowerCase()) continue;
        names.push(entry.name);
      }
    } catch {
      continue;
    }
    for (const name of names.sort()) candidates.push({ path: join(bucket, name), bucket });
  }

  // Exactly one candidate may exist: a duplicate native UUID is not
  // disambiguated by guessing.
  if (candidates.length === 0) {
    return unavailable("no_match", "No persisted journal matches the native session id");
  }
  if (candidates.length > 1) {
    return unavailable("ambiguous", "Multiple persisted journals match the native session id");
  }
  const candidate = candidates[0];
  const candidateName = basename(candidate.path);

  let journalInfo: Deno.FileInfo;
  try {
    journalInfo = await reader.lstat(candidate.path);
  } catch {
    return unavailable("no_match", "Candidate journal is no longer present");
  }
  if (
    !journalInfo.isFile || journalInfo.isSymlink ||
    journalInfo.dev === null || journalInfo.ino === null
  ) {
    return unavailable("unsafe_component", "Candidate journal is not a plain regular file");
  }
  const journalIdentity: ObservedIdentity = { dev: journalInfo.dev, ino: journalInfo.ino };

  // The anchor (journal parent) identity is proven here and re-verified at every
  // later protected artifact open.
  let anchorIdentity: ObservedIdentity;
  try {
    const anchorInfo = await reader.lstat(candidate.bucket);
    if (
      !anchorInfo.isDirectory || anchorInfo.isSymlink ||
      anchorInfo.dev === null || anchorInfo.ino === null
    ) {
      return unavailable("unsafe_component", "Journal parent is not a plain directory");
    }
    anchorIdentity = { dev: anchorInfo.dev, ino: anchorInfo.ino };
  } catch {
    return unavailable("unsafe_component", "Journal parent is unavailable");
  }

  const relativePath = `${basename(candidate.bucket)}/${candidateName}`;
  const prefix = readOmpSessionHeaderPrefix({
    sessionsRoot: {
      canonicalPath: sessionsRoot,
      identity: sessionsRootIdentity,
    },
    relativePath,
    targetIdentity: journalIdentity,
    nativeCalls: options.nativeCalls,
  });
  if (!prefix.ok) {
    // A symlinked or replaced journal fails closed at the protected open.
    return unavailable(
      prefix.reason === "unsafe_traversal" ? "unsafe_component" : "unreadable",
      `Candidate journal prefix is not readable: ${prefix.reason}`,
    );
  }
  const header = readJournalHeader(prefix.value);

  if (
    !header || header.id !== wantedId || typeof header.cwd !== "string" ||
    !isAbsolute(header.cwd)
  ) {
    return unavailable("no_match", "Candidate journal header does not match the session");
  }
  let canonicalHeaderCwd: string;
  let canonicalSessionCwd: string;
  try {
    canonicalHeaderCwd = await reader.realPath(header.cwd);
    canonicalSessionCwd = await reader.realPath(options.sessionCwd);
  } catch {
    return unavailable("no_match", "Session cwd could not be canonicalized");
  }
  if (canonicalHeaderCwd !== canonicalSessionCwd) {
    return unavailable("no_match", "Candidate journal belongs to a different workspace");
  }

  const artifactDirectory = candidate.path.slice(0, -JSONL_SUFFIX.length);
  if (!isWithinRoot(artifactDirectory, dataRoot)) {
    return unavailable("unsafe_component", "Candidate artifact directory escapes the data root");
  }

  // An already-created artifact directory binds its identity now; a later
  // replacement is then denied by the root observation.
  let artifactDirectoryIdentity: ObservedIdentity | undefined;
  try {
    const artifactInfo = await reader.lstat(artifactDirectory);
    if (artifactInfo.isSymlink || !artifactInfo.isDirectory) {
      return unavailable("unsafe_component", "Artifact directory is not a plain directory");
    }
    if ((await reader.realPath(artifactDirectory)) !== artifactDirectory) {
      return unavailable("unsafe_component", "Artifact directory path is not canonical");
    }
    if (artifactInfo.dev === null || artifactInfo.ino === null) {
      return unavailable("unsafe_component", "Artifact directory identity unavailable");
    }
    artifactDirectoryIdentity = { dev: artifactInfo.dev, ino: artifactInfo.ino };
  } catch (error) {
    const isNotFound = error instanceof Deno.errors.NotFound ||
      (error instanceof Error && error.message.toLowerCase().includes("no such file"));
    if (!isNotFound) {
      return unavailable("unsafe_component", "Artifact directory is unusable");
    }
  }

  return {
    ok: true,
    provenance: {
      acpSessionId: wantedId,
      journalPath: candidate.path,
      journalIdentity,
      anchorDirectory: dirname(candidate.path),
      anchorIdentity,
      ...(artifactDirectoryIdentity === undefined ? {} : { artifactDirectoryIdentity }),
    },
    dataRootIdentity,
  };
}
