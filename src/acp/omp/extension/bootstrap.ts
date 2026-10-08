/**
 * Trusted Extension Load-Time Bootstrap.
 *
 * Executes the load-time discovery bootstrap sequence in order:
 * 1. Identity observation (deployment base root and launch cwd)
 * 2. Dependency-closure trust set computation
 * 3. Surface enumeration and decision computation
 * 4. Deep freeze
 *
 * Structurally free of dynamic imports or candidate module evaluation.
 */

import { computeDiscoveryDecision, type DiscoveryDecision } from "../discovery-guard.ts";

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

  return computeDiscoveryDecision({
    baseRoot,
    mode: "restricted",
    observedEnv,
    observedCwd,
  });
}
