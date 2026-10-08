/**
 * Owned Module Ownership Composition.
 *
 * Re-exports the owned-module trust evaluation from discovery-guard.ts.
 */

export {
  type EvaluateOwnedModuleOptions,
  evaluateOwnedModuleOwnership,
  type OwnedModuleOwnershipDecision,
} from "../discovery-guard.ts";
