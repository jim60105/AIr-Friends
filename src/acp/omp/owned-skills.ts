/** Metadata-only owned skill observations; never evaluates discovered instructions. */
import { dirname, isAbsolute, join, resolve } from "@std/path";
import type { OmpSettingsSourcePlan } from "../omp-settings.ts";
import type { CriticalSkillReference } from "../filesystem-roots.ts";
import type { TrustedSkillsSource } from "../filesystem-policy.ts";
import type { ObservedIdentity } from "../filesystem-roots.ts";
import { evaluateCriticalSkillSelection, PINNED_CRITICAL_SKILLS } from "./discovery-guard.ts";

export interface OwnedSkillMetadataReader {
  lstat(path: string): Pick<
    Deno.FileInfo,
    "isDirectory" | "isFile" | "isSymlink" | "dev" | "ino" | "mode" | "uid" | "nlink"
  >;
  realPath(path: string): string;
}
export const ownedSkillMetadataReader: OwnedSkillMetadataReader = {
  lstat: (path) => {
    if (typeof Deno !== "undefined") return Deno.lstatSync(path);
    const fs = nodeFs();
    const info = fs.lstatSync(path);
    return {
      isDirectory: info.isDirectory(),
      isFile: info.isFile(),
      isSymlink: info.isSymbolicLink(),
      dev: info.dev,
      ino: info.ino,
      mode: info.mode,
      uid: info.uid,
      nlink: info.nlink,
    };
  },
  realPath: (path) =>
    typeof Deno !== "undefined" ? Deno.realPathSync(path) : nodeFs().realpathSync(path),
};

function nodeFs(): {
  lstatSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    dev: number;
    ino: number;
    mode: number;
    uid: number;
    nlink: number;
  };
  realpathSync(path: string): string;
} {
  const require = (globalThis as { require?: (id: string) => unknown }).require;
  if (!require) throw new Error("Owned skill metadata backend unavailable");
  return require("node:fs") as ReturnType<typeof nodeFs>;
}

function identity(info: ReturnType<OwnedSkillMetadataReader["lstat"]>): ObservedIdentity {
  if (info.dev === null || info.ino === null || info.mode === null) {
    throw new Error("Owned skill identity unavailable");
  }
  return Object.freeze({ dev: info.dev, ino: info.ino });
}

function observe(
  path: string,
  directory: boolean,
  reader: OwnedSkillMetadataReader,
): ObservedIdentity {
  if (!isAbsolute(path) || resolve(path) !== path || reader.realPath(path) !== path) {
    throw new Error("Owned skill path is not canonical");
  }
  // Every component must be link-free. Instructions additionally require
  // read-only ancestors up to their separately observed declared root.
  let component = path;
  while (true) {
    if (reader.lstat(component).isSymlink) throw new Error("Linked owned skill path");
    const parent = dirname(component);
    if (parent === component) break;
    component = parent;
  }
  const info = reader.lstat(path);
  if (directory ? !info.isDirectory : !info.isFile) throw new Error("Missing owned skill object");
  if (info.mode === null || (info.mode & 0o222) !== 0 && info.uid !== 0) {
    throw new Error("Agent-writable owned skill object");
  }
  if (info.mode === null || (info.mode & 0o022) !== 0 || (!directory && info.nlink !== 1)) {
    throw new Error("Writable or aliased owned skill object");
  }
  return identity(info);
}

/**
 * Mint the trusted-skills lifecycle input for one context registration.
 *
 * Fail-closed ladder (design D2/D3, plan duck B3/B5):
 * - An unobservable declared root (missing, linked, agent-writable, aliased)
 *   with no accepted baseline yields NO source at all: no trusted-skills root
 *   is attached, so workspace policy continues unchanged and no critical
 *   authority exists — never a fallback root, never a global disablement.
 * - A baseline whose accepted root identity the current observation cannot
 *   confirm is a SAME-PATH REPLACEMENT: it throws BEFORE any caller state
 *   changes, so the accepted trust is neither silently kept nor silently
 *   refreshed with new metadata.
 * - A confirmed root mints per-pinned-identifier selections only when a real
 *   session AND the client's real registration generation are supplied; a
 *   non-authorizing observation (empty id/generation) carries the root for
 *   ordinary root-scoped reads but zero critical references. Missing or
 *   invalid instructions deny their identifier only — no same-name fallback.
 */
export function observeOwnedSkills(
  plan: Pick<OmpSettingsSourcePlan, "ownedSkillRoots">,
  sessionId: string,
  generation: string,
  previous: TrustedSkillsSource | null,
  reader: OwnedSkillMetadataReader = ownedSkillMetadataReader,
): TrustedSkillsSource | null {
  if (plan.ownedSkillRoots.length !== 1) {
    throw new Error("Owned skill declaration requires exactly one root");
  }
  const root = plan.ownedSkillRoots[0];
  let rootIdentity: ObservedIdentity;
  try {
    rootIdentity = observe(root, true, reader);
  } catch (error) {
    if (previous) {
      throw new Error(
        `Accepted owned skill root no longer observable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
  if (
    previous && (previous.ownedRootPath !== root ||
      previous.rootIdentity?.dev !== rootIdentity.dev ||
      previous.rootIdentity?.ino !== rootIdentity.ino)
  ) {
    throw new Error("Owned skill root replaced since the accepted observation");
  }
  const criticalSkills: CriticalSkillReference[] = [];
  if (!sessionId || !generation) {
    return Object.freeze({
      ownedRootPath: root,
      canonicalOwnedRootPath: root,
      source: "deployment_owned" as const,
      rootIdentity,
      criticalSkills: Object.freeze(criticalSkills),
    });
  }
  for (const [skillId, relative] of Object.entries(PINNED_CRITICAL_SKILLS)) {
    const path = join(root, relative);
    try {
      observe(dirname(path), true, reader);
      const instructionIdentity = observe(path, false, reader);
      // A previously accepted instruction identity that no longer matches is
      // a replacement: that identifier fails closed (denied selection), it
      // never re-mints trust from fresh metadata.
      const prior = previous?.criticalSkills.find((reference) => reference.skillId === skillId);
      if (
        prior && (prior.instructionIdentity?.dev !== instructionIdentity.dev ||
          prior.instructionIdentity?.ino !== instructionIdentity.ino)
      ) {
        continue;
      }
      const selection = evaluateCriticalSkillSelection(skillId, {
        skillId,
        resolvedPath: path,
        canonicalPath: path,
        source: "deployment_owned",
        sessionGenerationId: generation,
      }, {
        ownedSkillRoot: root,
        ownedSkillRoots: plan.ownedSkillRoots,
        currentSessionId: sessionId,
        candidateSessionId: sessionId,
        currentSessionGenerationId: generation,
        isReadOnlyRoot: true,
      });
      if (!selection.authoritative) continue;
      criticalSkills.push(Object.freeze({
        skillId,
        canonicalInstructionPath: path,
        sessionGenerationId: generation,
        sessionId,
        instructionIdentity,
        source: "deployment_owned" as const,
      }));
    } catch {
      // Absence/invalidity denies this identifier only. No same-name fallback.
    }
  }
  return Object.freeze({
    ownedRootPath: root,
    canonicalOwnedRootPath: root,
    source: "deployment_owned" as const,
    rootIdentity,
    criticalSkills: Object.freeze(criticalSkills),
  });
}
