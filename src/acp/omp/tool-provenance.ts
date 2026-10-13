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
import type { OwnedModuleObservation } from "./deployment-module.ts";

/** Recorded origins; mirrors the inventory vocabulary (type-only consumer). */
export type ToolOrigin =
  | "native-builtin"
  | "owned-extension"
  | "operator-mcp"
  | "host"
  | "workspace"
  | "unowned-discovery";

/**
 * Pinned runtime-produced builtin source tuple (v18.6.1,
 * `session/session-tools.ts#getAllToolInfos`): the session's OWN builtin
 * membership produces `source: "builtin"` with the synthetic
 * `<builtin:name>` path, `scope: "temporary"` and `origin: "top-level"`.
 * These three helpers are the ONE definition of that tuple: the native
 * registration adapter authenticates against them and this decision
 * re-checks them, so neither side can drift into a second spelling.
 * `source: "sdk"` (RPC-host injection) is NOT part of this tuple and stays
 * host-denied.
 */
export const NATIVE_BUILTIN_SOURCE_SCOPE = "temporary";
export const NATIVE_BUILTIN_SOURCE_ORIGIN = "top-level";

/** The pinned synthetic path of an authentic builtin (`<builtin:read>`). */
export function nativeBuiltinSourcePath(name: string): string {
  return `<builtin:${name}>`;
}

/**
 * Authenticated native-builtin provenance. The record carries the FULL
 * runtime-produced source identity plus one live observation's epoch and
 * resource generation.
 *
 * Boundary statement (honest, post-review): admission rests on the
 * host-produced tuple being exact for THIS name (the runtime derives
 * `builtin` from the session's own builtin name set, so the tuple is not
 * model- or extension-authorable), on per-name roster uniqueness, and on the
 * surface re-reading the live roster on every observation. The freshness
 * halves below are stamped from the SAME live observation that produced the
 * identity, so their comparison is a wiring-coherence assertion — it denies a
 * record stamped by another domain (fixtures, a foreign observer, a
 * hand-built record) rather than guarding a mid-call race. Do not read it as
 * an additional attack surface.
 */
export interface NativeBuiltinProvenance {
  readonly origin: "native-builtin";
  /** Verbatim runtime-produced path the live roster presented. */
  readonly sourcePath: string;
  readonly sourceScope: string;
  readonly sourceOrigin: string;
  /** Registry epoch observed when the surface read this builtin identity. */
  readonly registryEpochObserved: number;
  /** Current live registry epoch (consumed; 14b owns its observation). */
  readonly currentRegistryEpoch: number;
  /** Row 12 resource generation observed with the same live read. */
  readonly observedResourceGeneration: string;
  readonly currentResourceGeneration: string;
}

/**
 * Owned trusted-extension provenance (`bind-omp-owned-module-evidence`): exact
 * deployment-module ownership rests on the DECLARED generated artifact plus
 * its PHYSICAL observation — the declaration's artifact/root, complete
 * metadata, the posture-specific ownership requirement and identity stability
 * against the accepted anchor. No session role, session id, cwd or invented
 * `CanonicalTarget` participates: a lexically supplied path, a name, or a
 * session-role claim without this evidence is never trusted.
 *
 * The epoch and generation pairs are the observation stamps of the same live
 * roster read that produced the record (`registryEpochObserved` /
 * `observedResourceGeneration`) paired with the wiring's CURRENT reads
 * (`currentRegistryEpoch` / `currentResourceGeneration`): a movement since
 * that read denies pending a fresh observation.
 */
export interface OwnedExtensionProvenance {
  readonly origin: "owned-extension";
  /** Artifact path the fresh native sourceInfo presented. */
  readonly modulePath: string;
  /**
   * The full physical deployment-module observation. ABSENT is an incomplete
   * observation and denies pending a fresh one — never an admit-by-name.
   */
  readonly moduleEvidence?: OwnedModuleObservation;
  /** Registry epoch observed when the roster read produced this record. */
  readonly registryEpochObserved: number;
  /** Current live registry epoch (consumed; the wiring owns its observation). */
  readonly currentRegistryEpoch: number;
  /**
   * Row-12 generation observation for this session. BOTH fields are supplied
   * together from one observation pair, or both are absent (the explicit
   * untracked-generation case). Exactly one present is an incomplete
   * observation and denies re-observe; disagreement denies too.
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
  | NativeBuiltinProvenance
  | OwnedExtensionProvenance
  | OperatorMcpProvenance
  | UntrustedProvenance;

/**
 * Which freshness element a stale/no-current observation denial names, so the
 * wiring's bounded error reports the element that actually mismatched instead
 * of guessing from the origin class.
 */
export type ProvenanceStaleElement = "registry-epoch" | "resource-generation";

export type ProvenanceDecision =
  | { readonly admit: true }
  | {
    readonly admit: false;
    /** Bounded reason; the entry vocabulary is `rejected_tool_provenance`. */
    readonly reason:
      | "untrusted_origin"
      | "client_ownership_absent"
      | "module_ownership_evidence_missing"
      | "owned_module_ownership_denied"
      | "stale_observation"
      | "unknown_observation"
      | "name_not_on_allow_table";
    /** Fresh observation demanded; 14b surfaces the fail-closed shape. */
    readonly pending?: "re-observe";
    /** Freshness element that failed the current-observation comparison. */
    readonly staleElement?: ProvenanceStaleElement;
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

    case "native-builtin": {
      // Full source identity first: the record must carry the exact pinned
      // tuple FOR THIS NAME. A record naming another tool's tuple, or one
      // built outside the pinned runtime producer, is an unknown observation
      // — never admitted on a cached or claimed name.
      if (
        provenance.sourcePath !== nativeBuiltinSourcePath(toolName) ||
        provenance.sourceScope !== NATIVE_BUILTIN_SOURCE_SCOPE ||
        provenance.sourceOrigin !== NATIVE_BUILTIN_SOURCE_ORIGIN
      ) {
        return { admit: false, reason: "unknown_observation" };
      }
      // Live-observation coherence (see NativeBuiltinProvenance: the surface
      // stamps both halves from one live read, so this denies a foreign-domain
      // or hand-built stamp, not a mid-call race).
      if (provenance.registryEpochObserved !== provenance.currentRegistryEpoch) {
        return {
          admit: false,
          reason: "stale_observation",
          pending: "re-observe",
          staleElement: "registry-epoch",
        };
      }
      if (provenance.observedResourceGeneration !== provenance.currentResourceGeneration) {
        return {
          admit: false,
          reason: "stale_observation",
          pending: "re-observe",
          staleElement: "resource-generation",
        };
      }
      if (!options.nameOnAllowTable) {
        return { admit: false, reason: "name_not_on_allow_table" };
      }
      return { admit: true };
    }

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
        return {
          admit: false,
          reason: "stale_observation",
          pending: "re-observe",
          staleElement: "registry-epoch",
        };
      }
      if (
        provenance.registryEpochObserved > provenance.currentRegistryEpoch
      ) {
        // A future epoch is incoherent freshness: re-observe, never admit.
        return {
          admit: false,
          reason: "unknown_observation",
          pending: "re-observe",
          staleElement: "registry-epoch",
        };
      }
      return { admit: true };
    }

    case "owned-extension": {
      // One live read's coherence first, exactly as for `native-builtin`: the
      // observed current-call epoch and generation halves must agree, so a
      // record stamped by another domain (fixtures, a foreign observer, a
      // hand-built record) or one predating a movement reads stale and denies
      // pending a fresh observation rather than admitting.
      if (provenance.registryEpochObserved !== provenance.currentRegistryEpoch) {
        return {
          admit: false,
          reason: "stale_observation",
          pending: "re-observe",
          staleElement: "registry-epoch",
        };
      }
      const observed = provenance.observedResourceGeneration;
      const current = provenance.currentResourceGeneration;
      if ((observed === undefined) !== (current === undefined) || observed !== current) {
        return {
          admit: false,
          reason: "stale_observation",
          pending: "re-observe",
          staleElement: "resource-generation",
        };
      }
      if (!options.nameOnAllowTable) {
        // Allow-table membership is owned by the inventory decision; the entry
        // decision denies such names with the inventory reason before routing.
        return { admit: false, reason: "name_not_on_allow_table" };
      }
      const evidence = provenance.moduleEvidence;
      if (evidence === undefined) {
        // Physical deployment-module evidence is REQUIRED: a lexical path, a
        // tool name or a session-role claim can never carry the owned tier.
        return {
          admit: false,
          reason: "module_ownership_evidence_missing",
          pending: "re-observe",
        };
      }
      // Evidence coherence: the observation must be the SAME live read that
      // produced this record's stamps and must describe the recorded artifact.
      if (
        evidence.artifact.path !== provenance.modulePath ||
        evidence.declaration.artifact !== provenance.modulePath ||
        evidence.registryEpoch !== provenance.registryEpochObserved ||
        evidence.resourceGeneration !== provenance.observedResourceGeneration
      ) {
        return {
          admit: false,
          reason: "unknown_observation",
          pending: "re-observe",
        };
      }
      const ownership = evaluateOwnedModuleOwnership(provenance.modulePath, {
        declaration: evidence.declaration,
        observation: evidence,
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
