/**
 * Trusted Extension Module Entrypoint.
 *
 * Pinned development-tree location: src/acp/omp/extension/index.ts
 * Contracted by OMP_TRUSTED_EXTENSION_PATH in src/utils/omp-paths.ts.
 *
 * Implements the official OMP trusted extension factory.
 * Executes the pre-import discovery bootstrap sequence at module load time.
 * Throws a fatal initialization error if pre-import exclusion blockers exist.
 *
 * Row 16 (`wire-omp-restricted-tool-enforcement`) extends the synchronous
 * load sequence: after the pre-import gate, the restricted handler slot is
 * registered and the enforcement body attached — SYNCHRONOUSLY, at module
 * load, with no readiness assertion (row 13 cancelled). The registration
 * branch is gated on the module's OWN observed launch identity (row 9's
 * mode-distinct launch cwd `{baseRoot}/omp-agent/{mode}/cwd`): a
 * native-YOLO or otherwise unidentified process takes the noop branch and
 * registers nothing at all, so the exemption is structural at the
 * registration site and no mode check exists inside the decision path.
 * Because the pinned pre-import-exclusion verdicts are unresolved (row 12),
 * this entrypoint fail-closes BEFORE the attach under the shipped guard:
 * the load-time registration completes only when the gate passes, and the
 * accepted absence-of-handler residual risk is recorded (design §15) —
 * whether the official binary ever invokes the attached handler remains
 * user-owned runtime verification, never something this module claims.
 */

import { bootstrapDiscoveryGuard } from "./bootstrap.ts";
import { formatDiscoverySessionError } from "../discovery-guard.ts";
import { attachEnforcementAtLoad, getLoadTimeEnforcementRegistration } from "./enforcement.ts";
import {
  attachReadReplacementAtLoad,
  registerLoadTimeReadReplacement,
  type ReadToolRegistrar,
} from "./read-replacement.ts";

// Execute load-time pre-import discovery bootstrap sequence immediately upon import
export const loadTimeDiscoveryDecision = bootstrapDiscoveryGuard();

// If any blocker is present at module load, fail initialization closed
if (loadTimeDiscoveryDecision.blockers.length > 0) {
  throw new Error(formatDiscoverySessionError(loadTimeDiscoveryDecision));
}

// Row 16 load sequence: synchronous slot registration + body attach, AFTER
// the pre-import gate, gated on the observed restricted launch identity.
// No readiness signal is established here or observable from it.
export const loadTimeEnforcementRegistration = attachEnforcementAtLoad({
  observedCwd: safeCwd(),
  resourceGeneration: () => loadTimeDiscoveryDecision.resourceGeneration,
});

// Row 19 load sequence: the URL-fetch transport adapter's `read` name
// replacement attaches AFTER the enforcement sibling, SYNCHRONOUSLY, under
// the same restricted-launch-identity gate (native YOLO registers no
// replacement — 14b posture). The replacement adds no second decision
// path: the 14b handler still gates every call before it executes, and the
// observed binary invoking the replacement at all stays design §15
// user-owned verification — nothing claimed here.
export const loadTimeReadReplacementRegistration = attachReadReplacementAtLoad({
  observedCwd: safeCwd(),
});

function safeCwd(): string {
  try {
    if (typeof Deno !== "undefined" && Deno.cwd) return Deno.cwd();
    if (typeof process !== "undefined" && process.cwd) return process.cwd();
  } catch {
    // Permission restricted: the launch identity simply stays unobserved.
  }
  return "";
}

/**
 * Default extension factory complying with OMP extension contract.
 */
export default function trustedExtensionFactory() {
  const registration = getLoadTimeEnforcementRegistration();
  return {
    name: "air-friends-trusted-extension",
    version: "1.0.0",
    decision: loadTimeDiscoveryDecision,
    // Attached only in the restricted branch; the factory field is the
    // synchronous attachment point, not an invocation claim.
    ...(registration.handler ? { restrictedToolCallHandler: registration.handler } : {}),
    // Row 19: the synchronous `registerTool` attachment point for the
    // restricted `read` replacement (S7/S8 last-extension-wins). Same
    // honesty posture as the handler slot: a host surface receiving this
    // function gets the SAME registered definition, and no field here
    // claims the official binary ever calls it.
    registerTools: (registrar: ReadToolRegistrar) =>
      registerLoadTimeReadReplacement(registrar),
  };
}
