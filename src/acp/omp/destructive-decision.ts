/**
 * Restricted Destructive-Intent Decision — thin consumer of the shared row-5
 * destructive policy (pure).
 *
 * Implements OpenSpec change `define-omp-restricted-tool-decisions` (row 14a).
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Zero re-derivation: normalization, per-target authorization, and the
 * completeness verdict are DELEGATED verbatim to `src/acp/destructive-policy.ts`
 * (row 5) — this module contains no second normalizer, no independent
 * path-authorization logic, and no speculative decoder. The pinned
 * destructive-intent verdict (UNRESOLVED in the decision register) means the
 * honest outcome for native shapes the P0 fixtures mark undecodable is the
 * shared fail-closed reason; the DECIDED disposition keeps the complete
 * ACP-mediated path (complete location lists) as the boundary and denies native
 * multi-file patches and first-operation-only lists fail-closed.
 *
 * Canonical-root observation (path resolution IO) is 14b's handler job: the
 * caller supplies already-collected `RootPathResult` observations (pure data),
 * exactly like row 5's own conformance tests do. With observations supplied the
 * all-target verdict is returned verbatim; without them the decision stops at
 * normalization and reports `authorizationEvaluated: false` — never a silent
 * completion claim. Every path denies with zero side effect; this module cannot
 * mutate anything.
 */

import type { DestructiveIntentInput } from "./compatibility-contracts.ts";
import {
  authorizeDestructiveTargets,
  decodeDestructiveIntent,
  DESTRUCTIVE_CONFORMANCE_FIXTURES,
  DESTRUCTIVE_CONFORMANCE_TABLE,
  destructiveDenialReason,
  type DestructiveFailure,
  type DestructiveNormalization,
  normalizeDestructiveIntent,
} from "../destructive-policy.ts";
import type { AuthorizeWriteParams, FilesystemAuthorizationResult } from "../filesystem-policy.ts";
import type { CanonicalTarget, RootPathResult } from "../filesystem-roots.ts";

export type DestructiveDecision =
  | {
    readonly outcome: "authorized-all-targets";
    /** Verbatim row-5 all-target pass evaluated and passed. */
    readonly authorizationEvaluated: true;
    readonly mutationAttempted: false;
  }
  | {
    readonly outcome: "complete-awaiting-authorization";
    /**
     * Normalization passed but no canonical observations were supplied; the
     * all-target authorization has NOT been evaluated. 14b must run the shared
     * all-target pass before any mutation — this is never a completion claim.
     */
    readonly authorizationEvaluated: false;
    readonly targets: readonly string[];
    readonly mutationAttempted: false;
  }
  | {
    readonly outcome: "deny";
    /** Completeness-stage failure: shared bounded reason (incomplete/binding). */
    readonly stage: "completeness";
    readonly completeness: DestructiveFailure;
    /** Verbatim row-5 bounded reason (`destructiveDenialReason`). */
    readonly sharedReason: string;
    readonly mutationAttempted: false;
  }
  | {
    readonly outcome: "deny";
    /**
     * Authorization-stage denial: verbatim row-5 all-target evaluation. The
     * per-target row-4 filesystem reasons belong to the handler audit, so they
     * pass through unchanged instead of being re-mapped here.
     */
    readonly stage: "authorization";
    readonly authorizationEvaluated: true;
    readonly firstDeniedIndex: number;
    readonly decisions: readonly FilesystemAuthorizationResult[];
    readonly mutationAttempted: false;
  };

/** Request to the restricted destructive decision. */
export interface DestructiveDecisionRequest {
  /** Decoded intent in the P0 `DestructiveIntentContract` shape. */
  readonly intent: DestructiveIntentInput;
  /** Expanded target spellings from the complete ACP-mediated location list. */
  readonly expandedTargets: readonly string[];
  /** Expanded location spellings from the complete ACP-mediated location list. */
  readonly expandedLocations: readonly string[];
  /**
   * Canonical observations for each normalized target (14b collects them;
   * pure data here). Absent ⇒ normalization-only decision, honestly flagged.
   */
  readonly observations?: readonly RootPathResult<CanonicalTarget>[];
  /** Row-4 write-authorization parameters for the all-target pass. */
  readonly authorizationParams?: Omit<AuthorizeWriteParams, "target">;
}

/**
 * The pure destructive-intent decision entry: normalize through row 5, and
 * when canonical observations are supplied, return row 5's all-target verdict
 * verbatim. An incomplete/unparseable intent yields the shared fail-closed
 * verdict with zero side effect; a binding mismatch yields the shared binding
 * reason. No decoder of its own ever guesses omitted operations.
 */
export function decideDestructiveIntent(
  request: DestructiveDecisionRequest,
): DestructiveDecision {
  const normalized = normalizeDestructiveIntent(
    request.intent,
    request.expandedTargets,
    request.expandedLocations,
  );
  if (!normalized.ok) {
    return {
      outcome: "deny",
      stage: "completeness",
      completeness: normalized.reason,
      sharedReason: destructiveDenialReason(normalized.reason),
      mutationAttempted: false,
    };
  }
  if (request.observations === undefined || request.authorizationParams === undefined) {
    return {
      outcome: "complete-awaiting-authorization",
      authorizationEvaluated: false,
      targets: normalized.targets.map((target) => target.path),
      mutationAttempted: false,
    };
  }
  const authorization = authorizeDestructiveTargets(
    normalized,
    request.observations,
    request.authorizationParams,
  );
  if (!authorization.ok) {
    return {
      outcome: "deny",
      stage: "authorization",
      authorizationEvaluated: true,
      firstDeniedIndex: authorization.firstDeniedIndex!,
      decisions: authorization.decisions,
      mutationAttempted: false,
    };
  }
  return {
    outcome: "authorized-all-targets",
    authorizationEvaluated: true,
    mutationAttempted: false,
  };
}

/** One conformance replay result expressed in the shared table's vocabulary. */
export interface DestructiveConformanceReplay {
  readonly id: string;
  readonly completeness: "complete" | DestructiveFailure;
  readonly targets: readonly string[];
  readonly outcomeReason: string;
}

/**
 * Observation adapter shape for replaying row-5 conformance fixtures through
 * the restricted entry: supplies the canonical observations and write-authorization
 * parameters 14b's handler would wire. Pure-data seam; row 5's fixtures and
 * expected table remain single-sourced.
 */
export interface ConformanceObservationAdapter {
  observe(targetPath: string, intent: "delete" | "write"): RootPathResult<CanonicalTarget>;
  authorizationParams(): Omit<AuthorizeWriteParams, "target">;
}

/**
 * Replay every row-5 conformance fixture through the restricted destructive
 * decision and report the shared table's verdict vocabulary, proving
 * consumption rather than duplication: completeness and reasons come from row 5
 * (`normalizeDestructiveIntent` + `destructiveDenialReason` +
 * `authorizeDestructiveTargets` via `decideDestructiveIntent`), never re-derived
 * here. Consumers (this change's tests, row 21 regression) assert equality
 * against `DESTRUCTIVE_CONFORMANCE_TABLE` themselves.
 */
export function replayConformanceFixtures(
  adapter: ConformanceObservationAdapter,
): readonly DestructiveConformanceReplay[] {
  return DESTRUCTIVE_CONFORMANCE_FIXTURES.map((fixture): DestructiveConformanceReplay => {
    const decoded: DestructiveNormalization = decodeDestructiveIntent(fixture.input);
    const observations = decoded.ok
      ? decoded.targets.map((target) => adapter.observe(target.path, target.intent))
      : undefined;
    const decision = decideDestructiveIntent({
      intent: fixture.input,
      // Same client-surface inputs as row 5's own conformance tests: expanded
      // targets come from the decode, locations from the wire presentation.
      expandedTargets: decoded.ok ? decoded.targets.map((target) => target.path) : fixture.locations,
      expandedLocations: fixture.locations,
      ...(observations ? { observations } : {}),
      ...(observations ? { authorizationParams: adapter.authorizationParams() } : {}),
    });
    if (decision.outcome === "deny" && decision.stage === "completeness") {
      return {
        id: fixture.id,
        completeness: decision.completeness,
        targets: [],
        outcomeReason: decision.sharedReason,
      };
    }
    if (decision.outcome === "deny" && decision.stage === "authorization") {
      const denial = decision.decisions[decision.firstDeniedIndex];
      return {
        id: fixture.id,
        completeness: "complete",
        targets: fixture.locations,
        outcomeReason: denial && !denial.ok ? denial.reason : "authorization_denied",
      };
    }
    return {
      id: fixture.id,
      completeness: "complete",
      targets: fixture.locations,
      outcomeReason: "approved",
    };
  });
}

/** Re-exported so consumers pin table identity without a second import path. */
export { DESTRUCTIVE_CONFORMANCE_TABLE };
