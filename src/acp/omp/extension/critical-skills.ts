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
import { OMP_IMAGE_SKILLS_ROOT } from "../../../utils/omp-paths.ts";
import { assertOwnedSettingsDocument, type OmpPermissionMode } from "../../omp-settings.ts";
import { observeOwnedSkills } from "../owned-skills.ts";

/** Consume the same actual mode document passed by the owned launch assembly. */
export function observeDeclaredSkillRoots(
  mode: OmpPermissionMode,
  baseRoot: string,
): readonly string[] {
  const imagePath = `/opt/air/omp/config/${mode}.yml`;
  const sourcePath = `${baseRoot}/owned-config/${mode}.yml`;
  let content: string;
  if (typeof Deno !== "undefined") {
    const path = (() => {
      try {
        Deno.lstatSync(imagePath);
        return imagePath;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        try {
          Deno.lstatSync(sourcePath);
          return sourcePath;
        } catch (fallback) {
          // The frozen settings-source contract (row 26) owns overlay
          // availability. Absence here denies critical authority without
          // switching to another source; it never crashes discovery.
          if (!(fallback instanceof Deno.errors.NotFound)) throw fallback;
          return undefined;
        }
      }
    })();
    if (path === undefined) return Object.freeze([]);
    const info = Deno.lstatSync(path);
    if (!info.isFile || info.isSymlink || info.size > 64 * 1024) {
      throw new Error("Invalid owned skill settings source");
    }
    content = Deno.readTextFileSync(path);
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
      return Object.freeze([]);
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
      throw new Error("Invalid owned skill settings source");
    }
    content = fs.readFileSync(imagePath, "utf8");
  }
  const document = parse(content) as Record<string, unknown>;
  // D1: the declaration is the single contracted root in every shipped form;
  // there is no resolver fallback, so the expected value is the constant.
  assertOwnedSettingsDocument(document, mode, [OMP_IMAGE_SKILLS_ROOT]);
  const roots = Object.freeze([OMP_IMAGE_SKILLS_ROOT]);
  // Startup observation is non-authorizing: the extension records the
  // declaration without minting critical references (no session, no native
  // generation — those exist only in the daemon's registration seam).
  observeOwnedSkills({ ownedSkillRoots: roots }, "", "", null);
  return roots;
}
