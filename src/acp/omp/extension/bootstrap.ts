/**
 * Trusted Extension Load-Time Bootstrap.
 *
 * Executes the load-time discovery bootstrap sequence in order:
 * 1. Identity observation (deployment base root and launch cwd)
 * 2. Dependency-closure trust set computation
 * 3. Surface enumeration and decision computation
 * 4. Deep freeze
 *
 * Row 27 (check-omp-workspace-executables) extends the sequence with the
 * DECIDED decision-1 pre-native STARTUP CHECK as a distinct step: a
 * synchronous metadata-only observation of the launch workspace's executable
 * discovery shapes (`checkOmpExecutableSources`, phase `extension_load`). The
 * repository NEVER catches its rejection to continue — an executable module
 * found at load throws the bounded fail-closed rejection out of the load
 * before any decision is returned, exactly the "startup check REJECTS"
 * disposition. When the observation is clean, the accepted observation rides
 * the decision as the decision-1 deployment admission input; the pinned
 * surfaces table and no-supported-mechanism verdicts stay verbatim, and the
 * guard's fail-closed blocker stays the fallback whenever no matching
 * observation exists (observation IO failure, stale generation).
 *
 * The check is STRUCTURALLY gated on the row-16 restricted launch identity
 * (mode-distinct cwd `{baseRoot}/omp-agent/restricted/cwd`): an unidentified
 * or native-YOLO process never runs it, so the source-owned development
 * import path keeps its pre-existing fail-closed pre-import blockers verbatim
 * (row-12/16 load-parity posture — unit/mock contracts exercise the dev path
 * unchanged, and the startup check is production-only like the row-16
 * registration branch).
 *
 * Structurally free of dynamic imports or candidate module evaluation.
 */

import { computeDiscoveryDecision, type DiscoveryDecision } from "../discovery-guard.ts";
import {
  checkOmpExecutableSources,
  executableObservationForGuard,
  type ExecutableOwnedRoots,
} from "../executable-sources.ts";
import { observeLaunchMode } from "./enforcement.ts";
import { observeDeclaredSkillRoots } from "./critical-skills.ts";

export interface BootstrapDiscoveryOptions {
  readonly deploymentBaseRoot?: string;
  readonly observedEnv?: Record<string, string | undefined>;
  readonly observedCwd?: string;
}

/**
 * Bootstrap function executed at extension module load.
 */
export function bootstrapDiscoveryGuard(
  options: BootstrapDiscoveryOptions = {},
): DiscoveryDecision {
  let observedEnv: Record<string, string | undefined> = options.observedEnv ?? {};
  let observedCwd: string | undefined = options.observedCwd;

  if (!options.observedEnv) {
    if (typeof Deno !== "undefined" && Deno.env) {
      try {
        observedEnv = Deno.env.toObject();
      } catch {
        // Permission restricted
      }
    } else if (typeof process !== "undefined" && process.env) {
      observedEnv = { ...process.env };
    }
  }

  if (!observedCwd) {
    if (typeof Deno !== "undefined" && Deno.cwd) {
      try {
        observedCwd = Deno.cwd();
      } catch {
        // Permission restricted
      }
    } else if (typeof process !== "undefined" && process.cwd) {
      try {
        observedCwd = process.cwd();
      } catch {
        // Ignore
      }
    }
  }

  // Derive deployment base root:
  // If launched in mode cwd ({baseRoot}/omp-agent/{mode}/cwd), baseRoot is 3 levels up
  const baseRoot = options.deploymentBaseRoot ??
    (observedCwd && observedCwd.includes("/omp-agent/")
      ? observedCwd.replace(/\/omp-agent\/[^/]+\/cwd\/?$/, "")
      : (observedCwd ?? "."));

  // Row 27: the pre-native startup check — restricted production identity
  // only (structural gate, row-16 pattern). The owned settings roots derive
  // from the owned launch env (HOME / PI_CODING_AGENT_DIR); the workspace
  // authority is the launch cwd. `checkOmpExecutableSources` validates both
  // owned roots as absolute, existing, non-link directories first: absent or
  // relative launch env is a missing authority, NEVER an empty route scanned
  // under a filesystem-root interpolation. A found executable module, broken
  // link, missing authority, or IO failure throws fail-closed HERE — before
  // the decision is even computed — and the repository never catches it to
  // continue. Outside the restricted identity (dev imports, YOLO,
  // unidentified cwd) NO observation is taken: the guard's fail-closed
  // blockers stay, and the dev path's pinned fail-closed load posture is
  // byte-for-byte the pre-row-27 behavior.
  const launchEnv = observedEnv as Record<string, string | undefined>;
  const ownedSkillRoots = observeLaunchMode(observedCwd) === "restricted"
    ? observeDeclaredSkillRoots("restricted", baseRoot)
    : undefined;
  const executableObservation = observeLaunchMode(observedCwd) === "restricted"
    ? checkOmpExecutableSources({
      phase: "extension_load",
      sessionCwd: observedCwd ?? "",
      roots: deriveOwnedRoots(launchEnv, observedCwd),
      processEnv: launchEnv,
    })
    : undefined;

  return computeDiscoveryDecision({
    baseRoot,
    mode: "restricted",
    observedEnv,
    observedCwd,
    ownedSkillRoots,
    ...(executableObservation !== undefined
      ? {
        resourceGeneration: executableObservation.resourceGeneration,
        executableObservation: executableObservationForGuard(executableObservation),
      }
      : {}),
  });
}

/**
 * Owned settings-state roots as the extension's OWN process sees them: the
 * factory's child env is the only authority (HOME + exact PI_CODING_AGENT_DIR
 * under the mode namespace, row 26). An unowned/absent value is deliberately
 * kept as-is — the observer validates the roots and fails closed at the
 * authority check rather than trusting an inferred path. The restricted
 * launch cwd rides along so the observer's neutral-launch-cwd exception and
 * workspace-authority binding use the plan's own identity (the structural
 * `observeLaunchMode` gate already guarantees the cwd IS the mode namespace's
 * `omp-agent/restricted/cwd`).
 */
function deriveOwnedRoots(
  env: Record<string, string | undefined>,
  launchCwd?: string,
): ExecutableOwnedRoots {
  return {
    ownedHome: env.HOME ?? "",
    agentDir: env.PI_CODING_AGENT_DIR ?? "",
    ...(launchCwd !== undefined ? { launchCwd } : {}),
  };
}
