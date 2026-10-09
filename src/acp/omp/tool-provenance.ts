/**
 * Restricted Live-Provenance Admission & MCP Admission Decisions (pure).
 *
 * Implements OpenSpec change `define-omp-restricted-tool-decisions` (row 14a).
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Live provenance decides; names never do (design D3): an allow-table name from
 * the wrong origin is structurally denied, and a same-name tool from the owned
 * trusted extension admits only under its exact contracted module ownership
 * (row 12). Registry-epoch and resource-generation values are CONSUMED freshness
 * inputs — this module defines no counter and touches no registry plumbing; the
 * synchronous registration/slot attachment and live `registryEpoch` observation
 * are owned by 14b (`wire-omp-restricted-tool-enforcement`).
 *
 * An operator MCP tool registered or refreshed AFTER process startup ADMITS on
 * a fresh observation (no exclusion, no elicitation); §7's "must not bypass the
 * live-origin check" is satisfied by requiring the fresh observation itself.
 */

import { evaluateOwnedModuleOwnership } from "./discovery-guard.ts";
import type { CanonicalTarget } from "../filesystem-roots.ts";

/** Recorded origins; mirrors the inventory vocabulary (type-only consumer). */
export type ToolOrigin =
  | "owned-extension"
  | "operator-mcp"
  | "host"
  | "workspace"
  | "unowned-discovery";

/**
 * Owned trusted-extension provenance: exact contracted module ownership is only
 * established from canonical filesystem evidence (row 12 `CanonicalTarget`);
 * a lexically supplied path without canonical evidence is never trusted.
 */
export interface OwnedExtensionProvenance {
  readonly origin: "owned-extension";
  /** Candidate module path presented by the loader. */
  readonly modulePath: string;
  /** Deployment base root the trusted-extension path is contracted against. */
  readonly baseRoot: string;
  /** Canonical identity evidence from row 2 for the candidate module. */
  readonly canonicalTarget?: CanonicalTarget;
  /** Mode-scoped ownership evaluation (row 12 contract). */
  readonly mode?: "restricted" | "native-yolo";
  /**
   * Row 12 generation observation for this session. 14b's contract: BOTH
   * fields are supplied together from one observation pair, or both are
   * absent (the explicit untracked-generation case). Exactly one present is
   * an incomplete observation and denies re-observe; disagreement denies too.
   */
  readonly observedResourceGeneration?: string;
  readonly currentResourceGeneration?: string;
}

/** Operator MCP provenance: the ACP client's MCP ownership plus freshness. */
export interface OperatorMcpProvenance {
  readonly origin: "operator-mcp";
  /** True iff the tool's recorded origin is the ACP client's MCP ownership. */
  readonly clientMcpOwnership: boolean;
  /** Registry epoch observed for this tool by the live registry observer. */
  readonly registryEpochObserved: number;
  /** Current live registry epoch (consumed; 14b owns its observation). */
  readonly currentRegistryEpoch: number;
}

/** Non-authoritative origins: structurally denied even on allow-table names. */
export interface UntrustedProvenance {
  readonly origin: "host" | "workspace" | "unowned-discovery";
  /** Allow-table name the origin presents, for audit naming only. */
  readonly presentedName?: string;
}

export type ProvenanceRecord =
  | OwnedExtensionProvenance
  | OperatorMcpProvenance
  | UntrustedProvenance;

export type ProvenanceDecision =
  | { readonly admit: true }
  | {
    readonly admit: false;
    /** Bounded reason; the entry vocabulary is `rejected_tool_provenance`. */
    readonly reason:
      | "untrusted_origin"
      | "client_ownership_absent"
      | "canonical_ownership_evidence_missing"
      | "owned_module_ownership_denied"
      | "stale_observation"
      | "unknown_observation"
      | "name_not_on_allow_table";
    /** Fresh observation demanded; 14b surfaces the fail-closed shape. */
    readonly pending?: "re-observe";
  };

export interface ProvenanceEvaluationOptions {
  /**
   * True when the name is admitted by the inventory table for this call.
   * Owned-extension admission covers allow-table names only; default-deny
   * surface rows pass `false` so their denial stays an INVENTORY reason at the
   * entry decision, never a provenance relabel.
   */
  readonly nameOnAllowTable: boolean;
}

/**
 * The pure live-provenance admission decision. Denies structurally, without
 * consulting the name's allow status: host, workspace, and unowned-discovery
 * origins carrying an allow-table NAME deny — the name-match insufficiency made
 * executable. Stale (or future/incoherent) observations deny pending a fresh
 * observation rather than admitting on the stale record.
 */
export function evaluateToolProvenance(
  toolName: string,
  provenance: ProvenanceRecord,
  options: ProvenanceEvaluationOptions,
): ProvenanceDecision {
  switch (provenance.origin) {
    case "host":
    case "workspace":
    case "unowned-discovery":
      // Same name from the wrong origin denies even though the name is allowed.
      return { admit: false, reason: "untrusted_origin" };

    case "operator-mcp": {
      if (!provenance.clientMcpOwnership) {
        // MCP is never host-owned; a claim of MCP origin without client
        // ownership is an origin failure, not a freshness failure.
        return { admit: false, reason: "client_ownership_absent" };
      }
      if (
        provenance.registryEpochObserved < provenance.currentRegistryEpoch
      ) {
        // Post-start registration/refresh is admitted when the observation is
        // CURRENT; only observations predating the current epoch deny.
        return { admit: false, reason: "stale_observation", pending: "re-observe" };
      }
      if (
        provenance.registryEpochObserved > provenance.currentRegistryEpoch
      ) {
        // A future epoch is incoherent freshness: re-observe, never admit.
        return { admit: false, reason: "unknown_observation", pending: "re-observe" };
      }
      return { admit: true };
    }

    case "owned-extension": {
      // Row 12 generation freshness, consumed as pure input: disagreement or
      // an observation half missing both deny pending re-observation, so a
      // rotated resourceGeneration can never be admitted by omitting a field.
      const observed = provenance.observedResourceGeneration;
      const current = provenance.currentResourceGeneration;
      if ((observed === undefined) !== (current === undefined) || observed !== current) {
        return { admit: false, reason: "stale_observation", pending: "re-observe" };
      }
      if (!options.nameOnAllowTable) {
        // Allow-table membership is owned by the inventory decision; the entry
        // decision denies such names with the inventory reason before routing.
        return { admit: false, reason: "name_not_on_allow_table" };
      }
      if (!provenance.canonicalTarget) {
        // Canonical evidence is REQUIRED: an influenceable lexical path can
        // never carry the owned-extension trust tier.
        return {
          admit: false,
          reason: "canonical_ownership_evidence_missing",
          pending: "re-observe",
        };
      }
      const ownership = evaluateOwnedModuleOwnership(provenance.modulePath, {
        baseRoot: provenance.baseRoot,
        mode: provenance.mode,
        canonicalTarget: provenance.canonicalTarget,
      });
      if (!ownership.trusted) {
        return { admit: false, reason: "owned_module_ownership_denied" };
      }
      void toolName;
      return { admit: true };
    }
  }
}

/**
 * MCP admission mechanism status as exported data (design D7). The pinned
 * ledger has NO MCP boundary row — this table exists BECAUSE of that gap and
 * cites it explicitly so 14b's wiring and row 21's combined-regression
 * consumers inherit the honest labels. Nothing may relabel these tiers; no code
 * path can, and no fixture, test pass, or local suite may: statuses are frozen
 * constants tied to the ledger gap, not computed from evidence.
 */
export interface McpAdmissionMechanismRow {
  readonly surface: string;
  readonly status: "needs-mechanism-audit" | "candidate-to-verify";
  readonly citation: string;
}

export const MCP_ADMISSION_MECHANISM_STATUS: readonly McpAdmissionMechanismRow[] = Object.freeze(
  [
    {
      surface: "native-side MCP admission mechanism basis",
      status: "needs-mechanism-audit",
      citation:
        "Pinned AUDITED_PINNED_LEDGER (establish-omp-compatibility-contracts) has no MCP boundary row; the basis cannot be labeled supported.",
    },
    {
      surface: "candidate MCP identity paths",
      status: "candidate-to-verify",
      citation:
        "Candidate identity routes require source-backed verification at a future pin plus an explicit user decision before any status change.",
    },
  ] as const,
);

/** The MCP tier labels are constants, never derived from local evidence. */
export type McpAdmissionBasis = "needs-mechanism-audit" | "candidate-to-verify";
