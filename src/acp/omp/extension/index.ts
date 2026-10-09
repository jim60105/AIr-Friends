/**
 * Trusted Extension Module Entrypoint.
 *
 * Pinned development-tree location: src/acp/omp/extension/index.ts
 * Contracted by OMP_TRUSTED_EXTENSION_PATH in src/utils/omp-paths.ts.
 *
 * Implements the official OMP trusted extension factory.
 * Executes the pre-import discovery bootstrap sequence at module load time.
 * Throws a fatal initialization error if pre-import exclusion blockers exist.
 */

import { bootstrapDiscoveryGuard } from "./bootstrap.ts";
import { formatDiscoverySessionError } from "../discovery-guard.ts";

// Execute load-time pre-import discovery bootstrap sequence immediately upon import
export const loadTimeDiscoveryDecision = bootstrapDiscoveryGuard();

// If any blocker is present at module load, fail initialization closed
if (loadTimeDiscoveryDecision.blockers.length > 0) {
  throw new Error(formatDiscoverySessionError(loadTimeDiscoveryDecision));
}

/**
 * Default extension factory complying with OMP extension contract.
 */
export default function trustedExtensionFactory() {
  return {
    name: "air-friends-trusted-extension",
    version: "1.0.0",
    decision: loadTimeDiscoveryDecision,
  };
}
