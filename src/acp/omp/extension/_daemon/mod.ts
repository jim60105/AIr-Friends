/**
 * Image-Mapped Re-Export Barrel for the Trusted Extension (row 20 D5).
 *
 * OpenSpec change `wire-omp-restricted-tool-enforcement` (row 16) owns this
 * barrel: every 14a pure-decision import the extension siblings take
 * (`enforcement.ts`, `enforcement-error.ts`) resolves THROUGH here, so the
 * extension tree's import surface stays inside the tree and the daemon-side
 * copies at `src/acp/omp/` remain the single authoring location (copy
 * direction: daemon tree → installed extension only, never reverse).
 *
 * Resolution: the specifiers below point at the committed sources in the
 * development checkout. Row 20's install-mapping (D5): the Containerfile
 * install step copies the declared pure-decision closure files verbatim from
 * these same committed sources into `/opt/air/omp/extension/_daemon/` under
 * their repo-relative basenames and installs the image-mode mapping of THIS
 * barrel beside them — the same export list with `./<basename>.ts`
 * specifiers, a pure re-export mapping and no logic duplication. Dev mode
 * therefore resolves the committed files through the specifiers below; the
 * image resolves byte-identical copies. Row 20 owns the closure-file list
 * and the digest recut; this change extends the declared list with the pure
 * modules the enforcement siblings consume (14a's four decision files plus
 * the type-only supporting modules below) — the manifest recut rides row
 * 20's install step, which has not landed yet.
 *
 * The re-exports below are the modules' OWN surfaces; this barrel contains
 * no logic, no policy, and no re-derivation.
 */

export {
  ALTERNATE_ROUTE_BLOCKING_TABLE,
  type AlternateRoutePair,
  type CompletingAuthority,
  decideMcpAdmission,
  decideRestrictedTool,
  INPUT_SHAPE_CAPABILITIES,
  type InputShape,
  type InventoryRow,
  type InventoryRowKind,
  type McpAdmissionDecision,
  type McpAdmissionRequest,
  RESTRICTED_DENIAL_VOCABULARY,
  RESTRICTED_TOOL_INVENTORY_TABLE,
  type RestrictedDenialReason,
  type RestrictedToolDecision,
  type RestrictedToolDecisionRequest,
  restrictedToolPolicyGates,
  type RouteSurface,
  SECURITY_RELEVANT_SETTING_KEYS,
} from "../../tool-inventory.ts";

export {
  evaluateToolProvenance,
  MCP_ADMISSION_MECHANISM_STATUS,
  type McpAdmissionBasis,
  type McpAdmissionMechanismRow,
  type OperatorMcpProvenance,
  type OwnedExtensionProvenance,
  type ProvenanceDecision,
  type ProvenanceEvaluationOptions,
  type ProvenanceRecord,
  type ToolOrigin,
  type UntrustedProvenance,
} from "../../tool-provenance.ts";

export {
  type ApprovalRecordInterpretation,
  type ApprovalRecordInterpretationRequest,
  interpretApprovalRecords,
  restrictedDenialWithRecordNaming,
} from "../../approval-records.ts";

export {
  type ConformanceObservationAdapter,
  decideDestructiveIntent,
  DESTRUCTIVE_CONFORMANCE_TABLE,
  type DestructiveConformanceReplay,
  type DestructiveDecision,
  type DestructiveDecisionRequest,
  replayConformanceFixtures,
} from "../../destructive-decision.ts";

// Supporting pure modules the enforcement siblings consume (type-only or
// pure-data). Row 20's closure list carries these basenames as well; the
// copy step preserves repo-relative basenames so the specifiers above and
// here resolve identically in dev and at the installed root.
export type { DestructiveIntentInput } from "../../compatibility-contracts.ts";
export type { EffectiveRecordEvaluation, SettingsLayerHierarchy } from "../../record-evaluator.ts";
export type { CanonicalTarget, RootPathResult } from "../../../filesystem-roots.ts";
export type {
  AuthorizeWriteParams,
  FilesystemAuthorizationResult,
  FilesystemDenialReason,
} from "../../../filesystem-policy.ts";
export type { ApprovalAction, ApprovalRecord } from "../../compatibility-contracts.ts";
