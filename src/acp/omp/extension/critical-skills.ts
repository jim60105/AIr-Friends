/**
 * Critical Skills Ownership Composition.
 *
 * Re-exports the critical skill ownership evaluation from discovery-guard.ts.
 */

export {
  type CriticalSkillSelectionRecord,
  type EvaluateCriticalSkillOptions,
  evaluateCriticalSkillSelection,
  PINNED_CRITICAL_SKILLS,
  type SessionSkillLifecycleState,
  transitionSkillLifecycleState,
} from "../discovery-guard.ts";

export { observeOwnedSkills } from "../owned-skills.ts";

import { parse } from "@std/yaml";
import { isAbsolute, resolve } from "@std/path";
import {
  assertOwnedSettingsDocument,
  OMP_DECLARED_SKILL_ROOT_ENV,
  type OmpPermissionMode,
} from "../../omp-settings.ts";
import { observeOwnedSkills } from "../owned-skills.ts";

/**
 * The declared skill root for THIS launch, taken from the deployment-owned
 * spawn environment (`align-omp-skill-trust-to-shared-root` D4).
 *
 * The daemon resolves ONE skill root (the same root both agent types resolve),
 * writes it into the generated single-key declaration and assigns it in this
 * child's launch environment, which `finalizeOmpSpawnEnvironment` verifies
 * before the spawn. The extension therefore treats that value as its ONLY
 * witness of the declared root — never a name, a workspace, HOME, the launch
 * cwd or the document's own bytes — and re-observes it with the same admission
 * ladder the daemon uses (canonical absolute spelling, link-free directory,
 * real directory). An absent, relative, non-canonical, linked, missing or
 * non-directory value returns the frozen EMPTY roots: zero skill authority,
 * no fallback.
 *
 * The installed mode document is still consumed as the SECOND contracted
 * source: it must validate its registered pins and must declare NO skill
 * directory of its own (`null` expectation), because the generated declaration
 * carries the directory. A drifted image document therefore denies instead of
 * silently minting a root the daemon never resolved.
 *
 * Row 28 review follow-up: the installed `/opt/air/omp/config` document is the
 * ONLY contracted document source — there is no dev/`owned-config` fallback, so
 * both backends deny identically off-image (frozen [] = zero critical
 * authority) and no undocumented third path exists.
 */
export function observeDeclaredSkillRoots(
  mode: OmpPermissionMode,
  env: Record<string, string | undefined>,
): readonly string[] {
  // The owned mode document must exist and validate: on a host without the
  // owned tree there is no declared-root authority at all (the pre-existing
  // fail-closed posture), and a drifted document never mints authority.
  if (!validateInstalledModeDocument(mode)) return Object.freeze([]);

  const declared = env[OMP_DECLARED_SKILL_ROOT_ENV];
  if (typeof declared !== "string" || declared.length === 0) return Object.freeze([]);
  if (!isAbsolute(declared) || resolve(declared) !== declared) return Object.freeze([]);

  const roots = Object.freeze([declared]);
  // The same producer observation the daemon runs: canonical, link-free,
  // real-directory, identity-bearing. A null result (unobservable or
  // non-canonical) mints no authority — never a fallback root.
  const source = observeOwnedSkills({ ownedSkillRoots: roots }, "", "", null);
  if (source === null || source.ownedRootPath !== declared) return Object.freeze([]);
  // Non-authorizing: the extension records the declaration without minting
  // critical references (no session, no native generation — those exist only in
  // the daemon's registration seam).
  return roots;
}

/**
 * Validate the installed `{mode}` mode document. Returns false when it is
 * absent (no declared-root authority), throws when it is not a plain bounded
 * file or when its registered shape drifted, and returns true when it carries
 * the registered pins while declaring no skill directory.
 */
function validateInstalledModeDocument(mode: OmpPermissionMode): boolean {
  const imagePath = `/opt/air/omp/config/${mode}.yml`;
  let content: string;
  if (typeof Deno !== "undefined") {
    let info: Deno.FileInfo;
    try {
      info = Deno.lstatSync(imagePath);
    } catch (error) {
      // The frozen settings-source contract (row 26) owns overlay
      // availability. Absence here denies critical authority without
      // switching to another source; it never crashes discovery.
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
    if (!info.isFile || info.isSymlink || info.size > 64 * 1024) {
      throw new Error("Invalid owned skill settings source");
    }
    content = Deno.readTextFileSync(imagePath);
  } else {
    const require = (globalThis as { require?: (id: string) => unknown }).require;
    if (!require) throw new Error("Owned skill settings backend unavailable");
    const fs = require("node:fs") as {
      lstatSync(path: string): { isFile(): boolean; isSymbolicLink(): boolean; size: number };
      readFileSync(path: string, encoding: string): string;
    };
    let info: { isFile(): boolean; isSymbolicLink(): boolean; size: number };
    try {
      info = fs.lstatSync(imagePath);
    } catch {
      // Same non-switching denial as the Deno backend: absence of the
      // installed declaration denies critical authority, never falls back.
      return false;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
      throw new Error("Invalid owned skill settings source");
    }
    content = fs.readFileSync(imagePath, "utf8");
  }
  const document = parse(content) as Record<string, unknown>;
  // The authored document carries the enablement and source-toggle pins and
  // declares NO skill directory: the resolved root arrives through the launch
  // environment, so there is no expected root to compare against here.
  assertOwnedSettingsDocument(document, mode, null);
  return true;
}
