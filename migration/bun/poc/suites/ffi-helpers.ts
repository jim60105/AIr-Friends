/**
 * Fixture and option builders for the FFI confinement suites.
 *
 * Every suite drives the unmodified production `performLinuxSecureAccess`
 * through the `bun:ffi` backend, so the observed identities must come from the
 * real filesystem. Type-only imports are erased by Bun, which matters because
 * the proof-of-concept image copies only `src/acp/filesystem-access-linux.ts`
 * and not this module's type sources.
 */
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalRootInfo, CanonicalTarget } from "../../../../src/acp/filesystem-roots.ts";
import type {
  LinuxNativeCalls,
  PerformLinuxAccessOptions,
} from "../../../../src/acp/filesystem-access-linux.ts";

function observedIdentity(path: string): { dev: number; ino: number } {
  const info = lstatSync(path);
  return { dev: info.dev, ino: info.ino };
}

/** Minimal root description for a real directory; identity from `lstat`. */
export function rootInfo(path: string): CanonicalRootInfo {
  const canonicalPath = realpathSync(path);
  return {
    role: "workspace",
    configuredPath: path,
    canonicalPath,
    identity: observedIdentity(canonicalPath),
    readOnly: false,
  };
}

/**
 * Minimal target description. The identity is absent when the path does not
 * exist, which is exactly the state a missing-target failure must observe.
 */
export function targetFor(path: string, relativePath: string): CanonicalTarget {
  const canonicalPath = realpathSync(path);
  let targetIdentity: { dev: number; ino: number } | undefined;
  try {
    targetIdentity = observedIdentity(join(canonicalPath, relativePath));
  } catch {
    targetIdentity = undefined;
  }
  return {
    acpSessionId: "",
    sessionContextGeneration: "",
    roles: ["workspace"],
    rootIdentities: [],
    normalizedInput: relativePath,
    canonicalTarget: join(canonicalPath, relativePath),
    rootRelativePath: relativePath,
    targetType: "file",
    targetIdentity,
    observedSymlinks: [],
  } as unknown as CanonicalTarget;
}

export function openFdCount(): number {
  return readdirSync("/proc/self/fd").length;
}

/** Read options for `relativePath` beneath `root`. */
export function readOptions(
  root: string,
  relativePath: string,
  nativeCalls: LinuxNativeCalls,
): PerformLinuxAccessOptions {
  return {
    operation: "read",
    selectedRoot: rootInfo(root),
    target: targetFor(root, relativePath),
    relativePath,
    isNewFile: false,
    content: "",
    nativeCalls,
  };
}

/** Write options; `isNewFile` selects exclusive create versus overwrite. */
export function writeOptions(
  root: string,
  relativePath: string,
  content: string,
  isNewFile: boolean,
  nativeCalls: LinuxNativeCalls,
): PerformLinuxAccessOptions {
  return {
    operation: "write",
    selectedRoot: rootInfo(root),
    target: targetFor(root, relativePath),
    relativePath,
    isNewFile,
    content,
    nativeCalls,
  };
}
