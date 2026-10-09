/**
 * Exact-Key Native Approval-Record Interpretation (pure).
 *
 * Implements OpenSpec change `define-omp-restricted-tool-decisions` (row 14a).
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Reality modeled (row 8, restated without softening): because
 * `Settings.#readConfigOverlays` folds CLI overlays into one mapping that
 * `#mergeOwnLayers` deep-merges over global/project layers, lower-layer
 * `tools.approval` grant/prompt/deny records can survive into an OMP process.
 * The authoritative record reset is pinned INCOMPATIBLE (see
 * `restrictedToolPolicyGates.verdicts`); NOTHING in this module asserts,
 * emulates, or depends on a working record reset.
 *
 * Interpretation rules (design D5):
 * - Lookup is by EXACT registered tool key only — never wildcard, prefix, or
 *   emulated default-deny (OMP approval lookup uses exact tool keys; OpenCode's
 *   wildcard default-deny does not exist here).
 * - A surviving lower-layer `allow` record is NEVER an execution-time grant.
 * - A surviving `prompt`/`ask` record NEVER converts a restricted deny into a
 *   generic elicitation (generic elicitation is unsupported by design).
 * - A surviving lower-layer `deny` is harmless but non-authoritative: the
 *   execution-time default-deny decision is what decides.
 * - The record map is consumed as the row-8 evaluator's faithful folded-merge
 *   output (`EffectiveRecordEvaluation`); no merge/comparison logic lives here.
 */

import type { ApprovalAction, ApprovalRecord } from "./compatibility-contracts.ts";
import type { EffectiveRecordEvaluation } from "./record-evaluator.ts";
import type { RestrictedToolDecision } from "./tool-inventory.ts";

/**
 * Interpretation of the native approval records for one restricted call.
 * The row-8 evaluation is REQUIRED input so the no-re-implementation property
 * is structural: this module reads the already-modeled effective map and the
 * already-computed record-authority verdict; it never re-merges layers.
 */
export interface ApprovalRecordInterpretationRequest {
  /** The exact registered tool key of the presented call. */
  readonly registeredToolKey: string;
  /** Row 8's folded-overlay evaluation (surviving lower entries included). */
  readonly recordEvaluation: EffectiveRecordEvaluation;
  /** The restricted execution-time decision this interpretation accompanies. */
  readonly restrictedDecision: RestrictedToolDecision;
}

export type ApprovalRecordInterpretation =
  | {
    readonly exactKeyRecord: "absent";
    /** No record can be consulted: lookup is exact-key only, never wildcard. */
    readonly wildcardConsulted: false;
    readonly grantsExecution: false;
    readonly elicits: false;
    readonly advisoryOnly: true;
    readonly operativeBoundary: "restricted-execution-time-default-deny";
    /** Record-authority verdict consumed verbatim from row 8. */
    readonly row8Authoritative: boolean;
  }
  | {
    readonly exactKeyRecord: "allow";
    readonly wildcardConsulted: false;
    /** A surviving `allow` NEVER grants: structurally false by type. */
    readonly grantsExecution: false;
    readonly elicits: false;
    readonly advisoryOnly: true;
    readonly operativeBoundary: "restricted-execution-time-default-deny";
    readonly row8Authoritative: boolean;
    /**
     * When the restricted decision denies, the denial is renamed to the
     * surviving-record reason: the lower-layer `allow` is reported as an input
     * that does not move the outcome.
     */
    readonly survivingAllowOverridesExecution: false;
  }
  | {
    readonly exactKeyRecord: "ask";
    readonly wildcardConsulted: false;
    readonly grantsExecution: false;
    /** A surviving `prompt`/`ask` NEVER elicits: generic elicitation absent. */
    readonly elicits: false;
    readonly genericElicitationRequested: false;
    readonly advisoryOnly: true;
    readonly operativeBoundary: "restricted-execution-time-default-deny";
    readonly row8Authoritative: boolean;
  }
  | {
    readonly exactKeyRecord: "deny";
    readonly wildcardConsulted: false;
    readonly grantsExecution: false;
    readonly elicits: false;
    readonly advisoryOnly: true;
    /** A surviving `deny` is harmless but non-authoritative. */
    readonly authoritative: false;
    readonly operativeBoundary: "restricted-execution-time-default-deny";
    readonly row8Authoritative: boolean;
  }
  | {
    readonly exactKeyRecord: "null";
    readonly wildcardConsulted: false;
    readonly grantsExecution: false;
    readonly elicits: false;
    readonly advisoryOnly: true;
    readonly operativeBoundary: "restricted-execution-time-default-deny";
    readonly row8Authoritative: boolean;
  };

/**
 * Interpret the effective native approval map for one restricted call by exact
 * registered key. Surviving records are reported as ADVISORY INPUTS only; the
 * restricted execution-time default-deny (tool-inventory / tool-provenance /
 * destructive-decision) remains the operative boundary.
 */
export function interpretApprovalRecords(
  request: ApprovalRecordInterpretationRequest,
): ApprovalRecordInterpretation {
  const { registeredToolKey, recordEvaluation } = request;
  const effective: ApprovalRecord = recordEvaluation.effectiveApproval;
  // Exact-key lookup only. No wildcard, no prefix, no default-deny emulation:
  // a record under any other key is simply not found for this call.
  const record: ApprovalAction | undefined = Object.prototype.hasOwnProperty.call(
      effective,
      registeredToolKey,
    )
    ? effective[registeredToolKey]
    : undefined;

  const base = {
    wildcardConsulted: false as const,
    grantsExecution: false as const,
    elicits: false as const,
    advisoryOnly: true as const,
    operativeBoundary: "restricted-execution-time-default-deny" as const,
    row8Authoritative: recordEvaluation.authoritative,
  };

  if (record === undefined) {
    return { exactKeyRecord: "absent", ...base };
  }
  if (record === "allow") {
    // P0 folded counterexample ({unknown_tool:"allow"} surviving): the
    // execution outcome is whatever the restricted decision says — never an
    // inherited grant.
    return {
      exactKeyRecord: "allow",
      ...base,
      survivingAllowOverridesExecution: false as const,
    };
  }
  if (record === "ask") {
    return {
      exactKeyRecord: "ask",
      ...base,
      genericElicitationRequested: false as const,
    };
  }
  if (record === "deny") {
    return { exactKeyRecord: "deny", ...base, authoritative: false as const };
  }
  return { exactKeyRecord: "null", ...base };
}

/**
 * Compose the final restricted deny reason for a call the restricted decision
 * already denied: if an exact-key surviving `allow` exists, the denial names
 * `rejected_approval_record_survivor` (the surviving record is reported, not
 * obeyed); otherwise the restricted decision's own bounded reason stands.
 */
export function restrictedDenialWithRecordNaming(
  interpretation: ApprovalRecordInterpretation,
  decision: Extract<RestrictedToolDecision, { outcome: "deny" }>,
): Extract<RestrictedToolDecision, { outcome: "deny" }> {
  if (interpretation.exactKeyRecord === "allow") {
    return { ...decision, reason: "rejected_approval_record_survivor" };
  }
  return decision;
}
