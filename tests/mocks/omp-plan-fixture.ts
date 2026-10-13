// tests/mocks/omp-plan-fixture.ts
//
// Shared owned-settings-source plan fixture for the OMP suites
// (`align-omp-skill-trust-to-shared-root`). Since the declared skill root is
// the deployment-RESOLVED one (never a constant), every fixture that drives
// the pre-native-request preflight needs TWO real filesystem facts: the
// resolved skill-root directory and the generated single-key declaration the
// plan puts FIRST among its overlays. One implementation keeps the call sites
// honest — the fixture stages exactly what the launch assembly stages.

import {
  type OmpPermissionMode,
  type OmpSettingsSourcePlan,
  ompSettingsSourcePlan,
} from "@acp/omp-settings.ts";
import { ompSkillRootDeclarationPath } from "@utils/omp-paths.ts";
import { writeOmpSkillRootDeclaration } from "@acp/omp/skill-root-declaration.ts";

/**
 * Stage the fixture roots and build the plan over them: the resolved skill
 * root exists as a real directory (default `{baseRoot}/skills`), the generated
 * declaration exists at its contracted path, and the authored overlays are the
 * caller's (mode document last).
 */
export function stageOmpSettingsSourcePlan(input: {
  baseRoot: string;
  mode: OmpPermissionMode;
  /** The deployment-resolved skill root; defaults to `{baseRoot}/skills`. */
  skillRoot?: string;
  /** Authored `--config` overlay paths (mode document last). */
  authoredOverlayPaths: readonly string[];
}): OmpSettingsSourcePlan {
  const skillRoot = input.skillRoot ?? `${input.baseRoot}/skills`;
  // Materialization is scoped to an EXISTING base root: consumers that pass a
  // synthetic path (e.g. `/composed-harness-only`) intend an unusable plan whose
  // pre-native preflight fails closed, not a write outside their temp tree.
  if (baseRootIsDirectory(input.baseRoot)) {
    Deno.mkdirSync(skillRoot, { recursive: true });
    writeOmpSkillRootDeclaration(
      ompSkillRootDeclarationPath(input.baseRoot, input.mode),
      skillRoot,
    );
  }
  return ompSettingsSourcePlan(input.mode, {
    baseRoot: input.baseRoot,
    ownedSkillRoots: [skillRoot],
    allowedOverlayPaths: [...input.authoredOverlayPaths],
  });
}

/** Existence probe: is the caller's base root a real directory right now? */
function baseRootIsDirectory(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}
