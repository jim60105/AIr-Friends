/**
 * Trusted Extension Load-Time Bootstrap.
 *
 * Executes the load-time discovery bootstrap sequence in order:
 * 1. Identity observation
 * 2. Dependency-closure trust set
 * 3. Surface enumeration and decision computation
 * 4. Deep freeze
 *
 * Structurally free of dynamic imports or candidate module evaluation.
 */

import { computeDiscoveryDecision, type DiscoveryDecision } from "../discovery-guard.ts";

/**
 * Bootstrap function executed at extension module load.
 */
export function bootstrapDiscoveryGuard(): DiscoveryDecision {
  // Read process environment posture
  let observedEnv: Record<string, string | undefined> = {};
  let observedCwd: string | undefined;

  // Global Deno / Bun environment inspection
  if (typeof Deno !== "undefined" && Deno.env) {
    try {
      observedEnv = Deno.env.toObject();
    } catch {
      // Permission restricted, empty object
    }
    try {
      observedCwd = Deno.cwd();
    } catch {
      // Permission restricted
    }
  } else if (typeof process !== "undefined" && process.env) {
    observedEnv = { ...process.env };
    try {
      observedCwd = process.cwd();
    } catch {
      // Ignore
    }
  }

  // Base root defaults to current directory or workspace root
  const baseRoot = observedCwd ?? ".";

  return computeDiscoveryDecision({
    baseRoot,
    mode: "restricted",
    observedEnv,
    observedCwd,
  });
}
