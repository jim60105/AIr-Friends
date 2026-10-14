/**
 * Metadata-only owned skill observations; never evaluates discovered instructions.
 *
 * Accepted security posture (`align-omp-skill-trust-to-shared-root` D1, stated
 * once in design.md): the deployment resolves ONE shared skill root for both
 * agent types, and that tree is not required to be root-owned,
 * agent-non-writable or non-group/world-writable. Admission therefore judges an
 * owned object by canonical identity alone — an absolute canonical path, a
 * link-free walk of every component, a real directory or file, `nlink === 1`
 * for files, realpath containment and the caller's supplied `dev`/`ino`
 * identity. A writable permission bit neither admits a target those checks
 * reject nor denies one they accept.
 *
 * The ownership/mode observation is NOT deleted; it survives exactly where it
 * is load-bearing: {@link observeReadOnlyRoot} derives the root's read-only
 * fact from the observed root's OWN ownership and mode, and critical-skill
 * minting consults it (a writable tree mints no critical authority), while
 * ordinary skill admission never does.
 */
import { dirname, isAbsolute, join, resolve } from "@std/path";
import type { OmpSettingsSourcePlan } from "../omp-settings.ts";
import type { TrustedSkillsSource } from "../filesystem-policy.ts";
import type { ObservedIdentity } from "../filesystem-roots.ts";
import { evaluateCriticalSkillSelection, PINNED_CRITICAL_SKILLS } from "./discovery-guard.ts";

/**
 * OMP-only critical-skill provenance. It is not part of the shared ACP
 * callback contract: the daemon consumes only {@link TrustedSkillsSource},
 * while the still-live native extension bootstrap
 * (`extension/critical-skills.ts`, `observeDeclaredSkillRoots`) keeps its own
 * critical metadata through this producer.
 */
export interface CriticalSkillReference {
  readonly skillId: string;
  readonly canonicalInstructionPath: string;
  readonly sessionGenerationId: string;
  readonly source: "deployment_owned" | "workspace_project" | "symlink_escape";
  readonly sessionId?: string;
  readonly instructionIdentity?: ObservedIdentity;
}

/**
 * The producer's own observation: the shared trusted-skill root plus the
 * OMP-only critical references it mints. Never registered as an ACP callback
 * source directly — the connector derives the shared fields alone.
 */
export interface OwnedSkillsObservation extends TrustedSkillsSource {
  readonly criticalSkills: readonly CriticalSkillReference[];
}

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

/**
 * The root's OBSERVED read-only determination: the ownership and mode clauses
 * the admission ladder no longer applies, evaluated on the declared root
 * alone. Critical-skill minting consults this instead of assuming it, so a
 * tree the runtime agent user can write mints no critical authority (the
 * pinned-layout carve-out). `null` mode proves nothing and reads false.
 */
function observeReadOnlyRoot(path: string, reader: OwnedSkillMetadataReader): boolean {
  const info = reader.lstat(path);
  const mode = info.mode;
  if (mode === null) return false;
  if ((mode & 0o022) !== 0) return false;
  if ((mode & 0o222) !== 0 && info.uid !== 0) return false;
  return true;
}

function observe(
  path: string,
  directory: boolean,
  reader: OwnedSkillMetadataReader,
): ObservedIdentity {
  if (!isAbsolute(path) || resolve(path) !== path || reader.realPath(path) !== path) {
    throw new Error("Owned skill path is not canonical");
  }
  // Every component must be link-free. Ownership and writability are NOT
  // admission inputs (D1): canonical identity, link-free components,
  // containment, real type and the file's single-link count are.
  let component = path;
  while (true) {
    if (reader.lstat(component).isSymlink) throw new Error("Linked owned skill path");
    const parent = dirname(component);
    if (parent === component) break;
    component = parent;
  }
  const info = reader.lstat(path);
  if (directory ? !info.isDirectory : !info.isFile) throw new Error("Missing owned skill object");
  if (!directory && info.nlink !== 1) throw new Error("Aliased owned skill object");
  return identity(info);
}

/**
 * Mint the trusted-skills lifecycle input for one context registration.
 *
 * Fail-closed ladder (design D2/D3, plan duck B3/B5):
 * - An unobservable declared root (missing, linked, non-canonical, aliased)
 *   with no accepted baseline yields NO source at all: no trusted-skills root
 *   is attached, so workspace policy continues unchanged and no critical
 *   authority exists — never a fallback root, never a global disablement. A
 *   writable root is observable and IS admitted (the accepted posture).
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
  previous: OwnedSkillsObservation | null,
  reader: OwnedSkillMetadataReader = ownedSkillMetadataReader,
): OwnedSkillsObservation | null {
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
  // The pinned-critical-layout carve-out at its enforcement point: the flag is
  // DERIVED from this observation, never asserted. `evaluateCriticalSkillSelection`
  // mints only for a true flag, so an agent-writable tree mints no critical
  // reference (ordinary skill admission never consults it).
  let rootIsReadOnly = false;
  try {
    rootIsReadOnly = observeReadOnlyRoot(root, reader);
  } catch {
    rootIsReadOnly = false;
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
        isReadOnlyRoot: rootIsReadOnly,
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
