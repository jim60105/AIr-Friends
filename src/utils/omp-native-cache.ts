// src/utils/omp-native-cache.ts
//
// Single source of truth for the SHARED, prepared OMP native runtime payload.
//
// Native OMP extracts its embedded native addons into `$XDG_DATA_HOME/omp/natives/{version}`
// (falling back to `~/.omp/natives`) and appends its own package version. Per mode/pool/
// per-spawn root that meant a fresh ~380 MB extraction per root — bytes that also entered
// the unrestricted data backup. This module instead:
//
//   1. resolves ONE prepared payload per (pinned version, platform), published outside the
//      backup data root and every agent workspace;
//   2. connects each root's loader-supported `omp/natives` entry to that payload through an
//      absolute symlink, so the loader appends `18.6.1` itself;
//   3. validates the payload (version/platform/expected addon files/executable identity)
//      BEFORE the agent spawns, failing closed with a preparation remedy.
//   4. owns the reserved backup SHAPES (`isReservedOmpNativeCachePath`,
//      `ompNativeCacheExclusionPathspecs`) so the data backup excludes those paths from its
//      index whatever their entry kind, without touching operator ignore rules.
//
// Cache identity is the pinned version and platform. It is deliberately independent of the
// operator-tunable `AGENT_OMP_MIN_VERSION` override: that value tunes the bootstrap WARN-only
// compatibility check, never this payload's identity.
//
// The payload bytes are made immutable to the confined agent by the launch mount policy
// (a hard read-only bind), not by file permissions here.

import { dirname, join, resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { getMemoizedOmpVersionProbe } from "@utils/omp-version.ts";
import { parseOmpSemver } from "@utils/omp-version.ts";
import type { OmpPermissionMode } from "../acp/types.ts";

const logger = createLogger("OmpNativeCache");

/**
 * The pinned OMP release whose extracted native payload every root consumes. Equal to the
 * `Containerfile` `OMP_VERSION` pin and to `KNOWN_GOOD_OMP_MIN_VERSION`, but a SEPARATE
 * constant: the cache identity must never follow the `AGENT_OMP_MIN_VERSION` override.
 */
export const OMP_NATIVE_CACHE_VERSION = "18.6.1";

/** Supported `(os, architecture)` identities, spelled `<os>-<arch>`. */
export const OMP_NATIVE_CACHE_PLATFORMS = ["linux-x64", "linux-arm64"] as const;

/** One supported native-cache identity. */
export type OmpNativeCachePlatform = (typeof OMP_NATIVE_CACHE_PLATFORMS)[number];

/** Installed image tree base of the prepared native cache (one `{platform}` child each). */
export const OMP_IMAGE_NATIVE_CACHE_ROOT = "/opt/air/omp/native-cache";

/**
 * Development cache base. A daemon-side resolver convention — never an environment variable
 * handed to OMP.
 */
export const OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE = join("air-friends", "omp");

/** The directory the loader itself appends the package version under. */
export const OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME = "natives";

/** Sidecar manifest file name, published OUTSIDE the native payload subtree. */
export const OMP_NATIVE_CACHE_MANIFEST_NAME = "native-manifest.json";

/** Preparation lock directory name (a directory, so creation is atomic). */
export const OMP_NATIVE_CACHE_LOCK_NAME = ".prepare-omp-natives.lock";

/** Preparation staging directory prefix (a same-filesystem sibling of the install root). */
export const OMP_NATIVE_CACHE_STAGING_PREFIX = ".staging-omp-natives-";

/**
 * The addon file names the pinned `linux-x64` executable extracts, as MEASURED by the
 * investigation (design "Investigation evidence and limits").
 */
export const OMP_NATIVE_CACHE_X64_ADDONS: readonly string[] = [
  "pi_natives.linux-x64-baseline.node",
  "pi_natives.linux-x64-modern.node",
];

/**
 * The `linux-arm64` payload file pattern. The design records the arm64 file set as
 * NOT characterised (no arm64 execution was available during the investigation), while the
 * container-packaging delta spec requires "at least `pi_natives.linux-arm64.node`". The
 * pinned arm64 executable may therefore emit the plain name or baseline/modern variants, so
 * the requirement is "at least one arm64 addon", never an unverified exact name.
 */
export const OMP_NATIVE_CACHE_ARM64_ADDON_PATTERN = /^pi_natives\..*linux-arm64.*\.node$/;

/**
 * Per-platform SHA-256 of the official pinned standalone executable. Mirrors the
 * `Containerfile` `OMP_SHA256_X64`/`OMP_SHA256_ARM64` build arguments (a drift test asserts
 * equality); the preparation entry verifies the bytes it is about to execute.
 */
export const OMP_NATIVE_CACHE_EXECUTABLE_SHA256: Readonly<Record<OmpNativeCachePlatform, string>> =
  Object.freeze({
    "linux-x64": "c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463",
    "linux-arm64": "cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a",
  });

/** Resolve the supported cache identity for the running target. */
export function ompNativeCachePlatform(
  arch: string = Deno.build.arch,
  os: string = Deno.build.os,
): OmpNativeCachePlatform {
  if (os === "linux" && arch === "x86_64") return "linux-x64";
  if (os === "linux" && arch === "aarch64") return "linux-arm64";
  throw new Error(
    `Unsupported OMP native runtime cache identity "${os}-${arch}" — the supported identities ` +
      `are ${OMP_NATIVE_CACHE_PLATFORMS.join(", ")} for the pinned OMP executable ` +
      `${OMP_NATIVE_CACHE_VERSION}. Install the supported pinned executable on a supported ` +
      `platform, or run \`deno task prepare:omp-natives\` on one.`,
  );
}

/** `{versionDir}`-relative names the pinned executable must have extracted for `platform`. */
export function ompNativeCacheExpectedAddons(platform: OmpNativeCachePlatform): {
  /** Names that must all be present (measured). */
  readonly exact: readonly string[];
  /** At least one listed file must match each pattern. */
  readonly atLeastOne: readonly RegExp[];
} {
  if (platform === "linux-x64") {
    return { exact: OMP_NATIVE_CACHE_X64_ADDONS, atLeastOne: [] };
  }
  return { exact: [], atLeastOne: [OMP_NATIVE_CACHE_ARM64_ADDON_PATTERN] };
}

/** One published payload file. */
export interface OmpNativeCacheFileEntry {
  /** Path relative to the extracted version directory (never contains a separator). */
  readonly name: string;
  readonly size: number;
}

/**
 * Sidecar manifest. Defines payload COMPLETENESS for the resolver and the per-root launch
 * preflight, so no consumer re-derives variant naming.
 */
export interface OmpNativeCacheManifest {
  readonly version: string;
  readonly platform: OmpNativeCachePlatform;
  /** SHA-256 of the pinned executable that produced the payload. */
  readonly executableSha256: string;
  readonly files: readonly OmpNativeCacheFileEntry[];
}

/** A resolved prepared native payload. */
export interface OmpNativeCache {
  /** Which deployment face the payload came from. */
  readonly mode: "image" | "development";
  readonly platform: OmpNativeCachePlatform;
  readonly version: string;
  /** `{base}/{platform}` — holds `natives/` and the sidecar manifest. */
  readonly installRoot: string;
  /** The loader-supported link target: `{installRoot}/natives` (the loader appends the version). */
  readonly payloadDir: string;
  /** `{payloadDir}/{version}` — the extracted regular addon files. */
  readonly versionDir: string;
  readonly manifestPath: string;
}

/**
 * The internal native-cache selection seam (tests, embedded harnesses, advanced installs).
 * Production leaves it empty so the contracted image/development mapping selects the payload.
 */
export interface OmpNativeCacheSelection {
  /** The `{...}/{platform}` install root to consume instead of the resolved one. */
  installRoot?: string;
  /**
   * The resolved launch executable's version for this process. `null` (or omitted with no
   * memoised probe) means undeterminable, which skips ONLY the executable agreement check —
   * the payload identity check always runs.
   */
  launchExecutableVersion?: string | null;
}

/** Build the descriptor for `{base}/{platform}`. */
export function ompNativeCacheDescriptor(
  base: string,
  platform: OmpNativeCachePlatform,
  mode: "image" | "development",
): OmpNativeCache {
  const installRoot = resolve(join(base, platform));
  const payloadDir = resolve(join(installRoot, OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME));
  return {
    mode,
    platform,
    version: OMP_NATIVE_CACHE_VERSION,
    installRoot,
    payloadDir,
    versionDir: resolve(join(payloadDir, OMP_NATIVE_CACHE_VERSION)),
    manifestPath: resolve(join(installRoot, OMP_NATIVE_CACHE_MANIFEST_NAME)),
  };
}

/** Development cache base: `${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp`. */
export function ompDevelopmentNativeCacheBase(
  env: { get(key: string): string | undefined } = Deno.env,
): string {
  const cacheHome = env.get("XDG_CACHE_HOME")?.trim();
  if (cacheHome) return resolve(join(cacheHome, OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE));
  const home = env.get("HOME")?.trim();
  if (!home) {
    throw new Error(
      "Cannot resolve the development OMP native runtime cache root: neither XDG_CACHE_HOME " +
        "nor HOME is set. Set HOME (or XDG_CACHE_HOME) or install the image payload under " +
        `${OMP_IMAGE_NATIVE_CACHE_ROOT}.`,
    );
  }
  return resolve(join(home, ".cache", OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE));
}

/** Real-filesystem existence probe used by the resolvers below. */
function defaultExists(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Select the prepared native cache: an INSTALLED image root for this platform wins; otherwise
 * the development cache root. An installed but INCOMPLETE root fails rather than falling back
 * to development bytes (the caller's completeness check reports the remedy).
 */
export function resolveOmpNativeCache(options: {
  platform?: OmpNativeCachePlatform;
  imageBase?: string;
  developmentBase?: string;
  exists?: (path: string) => boolean;
} = {}): OmpNativeCache {
  const platform = options.platform ?? ompNativeCachePlatform();
  const exists = options.exists ?? defaultExists;
  const imageRoot = ompNativeCacheDescriptor(
    options.imageBase ?? OMP_IMAGE_NATIVE_CACHE_ROOT,
    platform,
    "image",
  );
  if (exists(imageRoot.installRoot)) return imageRoot;
  return ompNativeCacheDescriptor(
    options.developmentBase ?? ompDevelopmentNativeCacheBase(),
    platform,
    "development",
  );
}

/**
 * Turn a selection seam value into a descriptor. The selected install root must be THIS
 * platform's root (its final path segment), so a payload prepared for another identity is
 * never consumed.
 */
export function ompNativeCacheFromSelection(
  selection: OmpNativeCacheSelection,
  platform: OmpNativeCachePlatform = ompNativeCachePlatform(),
): OmpNativeCache {
  if (!selection.installRoot) return resolveOmpNativeCache({ platform });
  const installRoot = resolve(selection.installRoot);
  const descriptor = ompNativeCacheDescriptor(dirname(installRoot), platform, "development");
  if (descriptor.installRoot !== installRoot) {
    throw new Error(
      `Configured OMP native runtime cache root "${installRoot}" does not match the ` +
        `supported identity for this target ("${descriptor.installRoot}" for ` +
        `${platform} @ ${OMP_NATIVE_CACHE_VERSION}).`,
    );
  }
  return descriptor;
}

/** Root-aware containment (handles `/`): is `path` equal to or under `root`? */
function containsPath(root: string, path: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  return path.startsWith(`${root}/`);
}

/**
 * Refuse a canonical cache location inside the backup data root or any configured user or
 * shared workspace root: those trees are staged into the backup, so a payload (or its
 * symlink) there would re-enter the index this change exists to keep it out of.
 */
export function assertOmpNativeCacheLocationAllowed(
  installRoot: string,
  forbiddenRoots: readonly (string | undefined)[],
): void {
  const target = resolve(installRoot);
  for (const candidate of forbiddenRoots) {
    if (candidate === undefined || candidate === "") continue;
    const root = resolve(candidate);
    if (containsPath(root, target) || containsPath(target, root)) {
      throw new Error(
        `Refusing the OMP native runtime cache location "${target}": it overlaps the ` +
          `configured data/workspace root "${root}". The prepared native payload must live ` +
          `outside the backed-up data root and every agent workspace; move ` +
          `\`workspace.repoPath\`/\`workspace.workspacesDir\` or XDG_CACHE_HOME instead.`,
      );
    }
  }
}

/** The backup data root and every configured user/shared workspace root of a deployment. */
export function ompNativeCacheForbiddenRoots(
  workspace: { repoPath: string; workspacesDir?: string },
): string[] {
  const roots = [resolve(workspace.repoPath)];
  if (workspace.workspacesDir) {
    roots.push(resolve(join(workspace.repoPath, workspace.workspacesDir)));
  }
  roots.push(resolve(join(workspace.repoPath, "agent-workspace")));
  return roots;
}

/** Read and structurally validate the sidecar manifest. */
export function readOmpNativeCacheManifest(manifestPath: string): OmpNativeCacheManifest | null {
  let text: string;
  try {
    text = Deno.readTextFileSync(manifestPath);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<OmpNativeCacheManifest>;
    if (
      typeof candidate.version !== "string" ||
      typeof candidate.platform !== "string" ||
      typeof candidate.executableSha256 !== "string" ||
      !Array.isArray(candidate.files)
    ) {
      return null;
    }
    const files: OmpNativeCacheFileEntry[] = [];
    for (const entry of candidate.files) {
      if (
        typeof entry !== "object" || entry === null ||
        typeof (entry as OmpNativeCacheFileEntry).name !== "string" ||
        typeof (entry as OmpNativeCacheFileEntry).size !== "number"
      ) {
        return null;
      }
      files.push({
        name: (entry as OmpNativeCacheFileEntry).name,
        size: (entry as OmpNativeCacheFileEntry).size,
      });
    }
    return {
      version: candidate.version,
      platform: candidate.platform as OmpNativeCachePlatform,
      executableSha256: candidate.executableSha256,
      files,
    };
  } catch {
    return null;
  }
}

/** Serialise a manifest deterministically (files sorted by name). */
export function serializeOmpNativeCacheManifest(manifest: OmpNativeCacheManifest): string {
  const files = [...manifest.files].sort((
    a,
    b,
  ) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return `${
    JSON.stringify(
      {
        version: manifest.version,
        platform: manifest.platform,
        executableSha256: manifest.executableSha256,
        files,
      },
      null,
      2,
    )
  }\n`;
}

/** The preparation remedy every native-cache failure names. */
export function ompNativeCachePrepareRemedy(): string {
  return "Run `deno task prepare:omp-natives` (optionally `--executable <path>`) with the " +
    `pinned OMP ${OMP_NATIVE_CACHE_VERSION} executable for this platform, then restart.`;
}

/**
 * Validate payload completeness against the pin and the manifest: version, platform,
 * expected addon files and every recorded file's existence and size. Cheap (a manifest read
 * plus one stat per recorded file — no hashing of hundreds of MiB on the launch hot path).
 */
export function assertOmpNativeCacheComplete(
  cache: OmpNativeCache,
  options: { stat?: (path: string) => Deno.FileInfo | undefined } = {},
): OmpNativeCacheManifest {
  const stat = options.stat ?? ((path: string) => {
    try {
      return Deno.lstatSync(path);
    } catch {
      return undefined;
    }
  });

  const payloadInfo = stat(cache.payloadDir);
  if (payloadInfo === undefined || !payloadInfo.isDirectory) {
    throw new Error(
      `OMP native runtime cache payload directory "${cache.payloadDir}" is missing. ` +
        `${ompNativeCachePrepareRemedy()}`,
    );
  }

  const manifest = readOmpNativeCacheManifest(cache.manifestPath);
  if (manifest === null) {
    throw new Error(
      `OMP native runtime cache manifest "${cache.manifestPath}" is missing or invalid — the ` +
        `installed cache root is incomplete. ${ompNativeCachePrepareRemedy()}`,
    );
  }
  if (manifest.version !== cache.version || manifest.platform !== cache.platform) {
    throw new Error(
      `OMP native runtime cache identity mismatch: the payload at "${cache.installRoot}" ` +
        `declares ${manifest.platform} @ ${manifest.version}, but this launch requires ` +
        `${cache.platform} @ ${cache.version}. ${ompNativeCachePrepareRemedy()}`,
    );
  }
  if (manifest.executableSha256 !== OMP_NATIVE_CACHE_EXECUTABLE_SHA256[cache.platform]) {
    throw new Error(
      `OMP native runtime cache executable identity mismatch: the payload at ` +
        `"${cache.installRoot}" was prepared by ${manifest.executableSha256}, but the pinned ` +
        `${cache.platform} executable is ` +
        `${OMP_NATIVE_CACHE_EXECUTABLE_SHA256[cache.platform]}. ${ompNativeCachePrepareRemedy()}`,
    );
  }

  const missingExpected = missingExpectedAddons(cache.platform, manifest.files.map((f) => f.name));
  if (missingExpected.length > 0) {
    throw new Error(
      `OMP native runtime cache is incomplete: the pinned ${cache.platform} executable must ` +
        `extract ${missingExpected.join(", ")} but the payload at "${cache.versionDir}" does ` +
        `not contain ${missingExpected.length === 1 ? "it" : "them"}. ` +
        `${ompNativeCachePrepareRemedy()}`,
    );
  }

  for (const file of manifest.files) {
    const info = stat(resolve(join(cache.versionDir, file.name)));
    if (info === undefined || !info.isFile || info.size !== file.size) {
      throw new Error(
        `OMP native runtime cache file "${file.name}" is missing or has the wrong size in ` +
          `"${cache.versionDir}" (expected ${file.size} bytes). ${ompNativeCachePrepareRemedy()}`,
      );
    }
  }
  return manifest;
}

/** Which of the platform's required addon names are absent from `names`. */
export function missingExpectedAddons(
  platform: OmpNativeCachePlatform,
  names: readonly string[],
): string[] {
  const expected = ompNativeCacheExpectedAddons(platform);
  const present = new Set(names);
  const missing = expected.exact.filter((name) => !present.has(name));
  for (const pattern of expected.atLeastOne) {
    if (!names.some((name) => pattern.test(name))) {
      missing.push(`at least one file matching ${pattern}`);
    }
  }
  return missing;
}

/**
 * Require the RESOLVED launch executable to agree with the cache identity. An absent or
 * undeterminable probe result (no `omp` on PATH, `omp --version` failing, or the bootstrap
 * probe never having run) simply skips this check — the payload identity check above still
 * ran, so an absent probe never inherits a fatal verdict.
 */
export function assertOmpLaunchExecutableAgreement(
  cache: OmpNativeCache,
  launchExecutableVersion: string | null | undefined,
): void {
  if (launchExecutableVersion === null || launchExecutableVersion === undefined) return;
  const detected = parseOmpSemver(launchExecutableVersion);
  const pinned = parseOmpSemver(cache.version);
  if (
    detected !== null && pinned !== null && detected.major === pinned.major &&
    detected.minor === pinned.minor && detected.patch === pinned.patch
  ) {
    return;
  }
  throw new Error(
    `OMP native runtime cache identity mismatch: the resolved launch executable reports ` +
      `"${launchExecutableVersion}", but the prepared native payload is pinned to OMP ` +
      `${cache.version}. Install the pinned executable on PATH (or point the launch at it), ` +
      `otherwise its loader would append its own version directory beneath the shared ` +
      `read-only payload. ${ompNativeCachePrepareRemedy()}`,
  );
}

/** The reserved `<XDG_DATA_HOME>/omp/natives` entry of a mode root. */
export function ompNativeCacheLinkPath(baseRoot: string, mode: OmpPermissionMode): string {
  return resolve(join(baseRoot, "omp-agent", mode, "xdg-data", "omp", "natives"));
}

/** Permission modes whose roots hold a reserved native-cache entry. */
export const OMP_NATIVE_CACHE_MODES = ["restricted", "native-yolo"] as const;

/**
 * The two reserved BACKUP shapes, in repository-relative spelling:
 *
 *   - `omp-pools/<one or more pool-key components>/omp-agent/<mode>/xdg-data/omp/natives`
 *   - `<any working-directory path>/tmp/omp-agent/<mode>/xdg-data/omp/natives`
 *
 * The pool-key path holds one or more components because real keys contain separators
 * (`memory-maintenance:<platform>/<user-id>`), so a single-component pattern would
 * under-match and re-stage the native payload.
 */
const OMP_NATIVE_CACHE_RESERVED_RE = new RegExp(
  "^(?:omp-pools/(?:[^/]+/)+|(?:[^/]+/)*tmp/)" +
    `omp-agent/(?:${OMP_NATIVE_CACHE_MODES.join("|")})/xdg-data/omp/` +
    `${OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME}(?:/.*)?$`,
);

/**
 * Lexical test for one repository-relative path: is it a reserved native-cache entry, or a
 * descendant of one? Independent of entry kind — a real directory, a valid or dangling
 * symlink, a currently missing, ignored, staged or tracked path all answer the same way, and
 * the test never touches the filesystem or follows a link.
 */
export function isReservedOmpNativeCachePath(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  return OMP_NATIVE_CACHE_RESERVED_RE.test(normalized);
}

/**
 * Top-anchored `:(top,exclude,glob)` pathspecs excluding every reserved shape from a staging
 * command. `**` spans separators, so one pattern per shape and mode covers any pool-key depth
 * and any working-directory depth; the trailing `/**` variant keeps descendants excluded even
 * where a pathspec matches only the entry itself. Emitted for `git add` as the LAST arguments
 * so a root created between index removal and staging still cannot be staged.
 */
export function ompNativeCacheExclusionPathspecs(): string[] {
  const patterns: string[] = [];
  for (const mode of OMP_NATIVE_CACHE_MODES) {
    const suffix = `omp-agent/${mode}/xdg-data/omp/${OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME}`;
    for (const prefix of ["omp-pools/**", "**/tmp", "tmp"]) {
      patterns.push(`:(top,exclude,glob)${prefix}/${suffix}`);
      patterns.push(`:(top,exclude,glob)${prefix}/${suffix}/**`);
    }
  }
  return patterns;
}

/** A stat result that never throws. */
function lstatOrNull(path: string): Deno.FileInfo | undefined {
  try {
    return Deno.lstatSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Create the mode root's `omp` application directory (and its managed parents), refusing any
 * managed component that is a symlink or a non-directory: a symlinked/escaping parent would
 * let the reserved `natives` entry be installed outside the selected root.
 */
function ensureModeApplicationDirectory(baseRoot: string, mode: OmpPermissionMode): string {
  const appDir = resolve(join(baseRoot, "omp-agent", mode, "xdg-data", "omp"));
  let current = resolve(baseRoot);
  for (const component of ["omp-agent", mode, "xdg-data", "omp"]) {
    current = join(current, component);
    const info = lstatOrNull(current);
    if (info === undefined) {
      Deno.mkdirSync(current, { recursive: true });
      continue;
    }
    if (info.isSymlink) {
      throw new Error(
        `Refusing the OMP native runtime cache entry: managed parent "${current}" is a ` +
          `symbolic link, so the reserved "natives" entry could escape the selected native ` +
          `data root. Replace it with a real directory, then restart.`,
      );
    }
    if (!info.isDirectory) {
      throw new Error(
        `Refusing the OMP native runtime cache entry: managed parent "${current}" is not a ` +
          `directory. Remove or rename it, then restart.`,
      );
    }
  }
  return appDir;
}

/**
 * Install (atomically, idempotently) the reserved `omp/natives` symlink of one mode root to
 * the shared prepared payload. An identical existing link is success; a dangling link, a
 * different target, a regular file or a real directory at the reserved entry fails before
 * the agent spawns, naming the exact path and the operator action. A legacy native directory
 * is NEVER followed, removed or migrated.
 */
export function installOmpNativeCacheLink(options: {
  baseRoot: string;
  mode: OmpPermissionMode;
  cache: Pick<OmpNativeCache, "payloadDir">;
}): string {
  const appDir = ensureModeApplicationDirectory(options.baseRoot, options.mode);
  const linkPath = join(appDir, "natives");
  const target = options.cache.payloadDir;

  const existing = lstatOrNull(linkPath);
  if (existing !== undefined) {
    if (existing.isSymlink) {
      const current = Deno.readLinkSync(linkPath);
      if (current === target) return linkPath;
      throw new Error(
        `Refusing the OMP native runtime cache entry "${linkPath}": it is a symbolic link to ` +
          `"${current}", not to the selected shared payload "${target}". Stop the bot, remove ` +
          `or rename that link, then start it again so the shared prepared payload can be ` +
          `linked.`,
      );
    }
    if (existing.isDirectory) {
      throw new Error(
        `OMP native runtime cache entry "${linkPath}" is an existing directory — a previous ` +
          `OMP release extracted channel-local native copies there, so this root stays ` +
          `launch-blocked. Stop the bot and remove or rename that directory by hand (for ` +
          `example: rm -rf '${linkPath}'), then start it again so the one shared prepared ` +
          `payload can be linked. This deployment never deletes or migrates legacy native ` +
          `copies automatically.`,
      );
    }
    throw new Error(
      `OMP native runtime cache entry "${linkPath}" is an existing non-symlink file. Stop the ` +
        `bot, remove or rename it, then start it again so the shared prepared payload can be ` +
        `linked.`,
    );
  }

  // Atomic: create the link under a temporary name in the SAME directory, then rename it
  // over the reserved entry. A concurrent creator installing the identical link is success.
  const temporary = join(appDir, `.natives.link-${Deno.pid}-${crypto.randomUUID()}`);
  Deno.symlinkSync(target, temporary);
  try {
    Deno.renameSync(temporary, linkPath);
  } catch (error) {
    const racer = lstatOrNull(linkPath);
    if (racer?.isSymlink && Deno.readLinkSync(linkPath) === target) {
      try {
        Deno.removeSync(temporary);
      } catch {
        // Already gone — ignore.
      }
      return linkPath;
    }
    try {
      Deno.removeSync(temporary);
    } catch {
      // Already gone — ignore.
    }
    throw error;
  }
  // A rename replaces whatever it lands on, so re-read the survivor: a different-target link
  // created in the race window must be refused, never silently adopted.
  const installed = lstatOrNull(linkPath);
  const installedTarget = installed?.isSymlink ? Deno.readLinkSync(linkPath) : null;
  if (installedTarget !== target) {
    throw new Error(
      `Refusing the OMP native runtime cache entry "${linkPath}": it holds ` +
        `${
          installedTarget === null
            ? "a non-symlink entry"
            : `a symbolic link to "${installedTarget}"`
        } ` +
        `instead of the selected shared payload "${target}". Stop the bot, remove or rename that ` +
        `entry, then start it again so the shared prepared payload can be linked.`,
    );
  }
  return linkPath;
}

/**
 * The launch-side entry used by BOTH the pooled and the per-spawn root preparation:
 * select the payload, refuse a forbidden location, require a complete matching payload,
 * require launch-executable agreement when a version is known, then install the reserved
 * `omp/natives` link. Throws before spawn; a failure leaves the payload and existing private
 * state untouched apart from empty managed directories created for a fresh root.
 */
export function prepareOmpNativeCacheRoot(options: {
  baseRoot: string;
  mode: OmpPermissionMode;
  selection?: OmpNativeCacheSelection;
  forbiddenRoots?: readonly (string | undefined)[];
}): OmpNativeCache {
  const cache = ompNativeCacheFromSelection(options.selection ?? {});
  assertOmpNativeCacheLocationAllowed(cache.installRoot, options.forbiddenRoots ?? []);
  assertOmpNativeCacheComplete(cache);
  const launchVersion = options.selection?.launchExecutableVersion ??
    getMemoizedOmpVersionProbe();
  assertOmpLaunchExecutableAgreement(cache, launchVersion);
  installOmpNativeCacheLink({ baseRoot: options.baseRoot, mode: options.mode, cache });
  logger.debug("Connected OMP native runtime cache root {baseRoot}/{mode} to {payload}", {
    baseRoot: options.baseRoot,
    mode: options.mode,
    payload: cache.payloadDir,
  });
  return cache;
}
