/**
 * Owned Module Ownership Composition (`bind-omp-owned-module-evidence`).
 *
 * The extension tree's single import surface for deployment-module identity:
 * the declared artifact faces, the physical observation value and policy, and
 * the canonical ownership decision the provenance step consumes. Re-exported
 * (never re-implemented) so the bundled closure and the daemon tree share ONE
 * policy implementation.
 */

export {
  DEPLOYMENT_MODULE_DECLARATIONS,
  DEPLOYMENT_MODULE_DEPENDENCY_CLOSURE,
  type DeploymentModuleDeclaration,
  type DeploymentModulePosture,
  OMP_DEVELOPMENT_MODULE_ARTIFACT,
  OMP_DEVELOPMENT_MODULE_DECLARATION,
  OMP_DEVELOPMENT_MODULE_ROOT,
  OMP_IMAGE_MODULE_DECLARATION,
  type OwnedModuleAnchor,
  type OwnedModuleObservation,
  type OwnedModuleOwnershipVerdict,
  type OwnedModulePathEvidence,
  replacementFingerprintFor,
  selectLaunchDeploymentModule,
  verifyOwnedModuleAnchor,
  verifyOwnedModuleObservation,
} from "../deployment-module.ts";

export {
  type EvaluateOwnedModuleOptions,
  evaluateOwnedModuleOwnership,
  type OwnedModuleOwnershipDecision,
} from "../discovery-guard.ts";

export {
  createOwnedModuleEvidenceSource,
  type OwnedModuleEvidenceSource,
  type OwnedModuleFreshness,
  type OwnedModuleMetadataReader,
} from "../owned-module-evidence.ts";
