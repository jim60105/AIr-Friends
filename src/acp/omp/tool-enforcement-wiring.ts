/**
 * Restricted `tool_call` Enforcement Wiring — composition point and seam data.
 *
 * Implements OpenSpec change `wire-omp-restricted-tool-enforcement` (row 16 /
 * P5c-ii). The handler body, the synchronous slot registration/attachment,
 * the live `registryEpoch` observation, and the bounded error shapes live in
 * the contracted trusted-extension tree (`src/acp/omp/extension/`):
 * `enforcement.ts` (body + registration + epoch observation) and
 * `enforcement-error.ts` (shapes + composition-order data), reachable from
 * the daemon side only through this module. This module owns the wiring's
 * inherited-verdict data: the P0 ledger-quoted mechanism evidence, the seam
 * table with the DECIDED dispositions, and the `enforcementWiringGates`
 * honesty table. It contains NO policy, NO decision tables, and NO second
 * composition path — zero decision logic is forked from 14a.
 *
 * Mechanism evidence (task 1.2), each element recorded with its P0 ledger
 * tier (quoted from `AUDITED_PINNED_LEDGER`, never retyped):
 * - `extensions/runner.ts` `emitToolCall` blocks handler errors/timeouts —
 *   the fail-closed execution mechanism the attached body rides; ledger tier
 *   `policy_readiness` = `unresolved`.
 * - `extensions/types.ts` synchronous handler registration — ledger tier
 *   `policy_readiness` reachability: synchronous registration IS available,
 *   but with no client-side authenticated readiness control channel. Slot
 *   registration therefore establishes NO readiness claim, and no
 *   readiness/reset channel, handshake, or prompt gate exists anywhere in
 *   this wiring (row 13 gate-omp-policy-readiness REMOVED by user decision).
 * - `getAllTools`-class tool metadata carrying per-tool source identity —
 *   ledger tier: no dedicated P0 row exists (the ledger also has no MCP
 *   boundary row); the surface is `candidate-to-verify` and real-runtime
 *   observation of it remains on the user checklist (design §15; recorded in
 *   docs/OMP_ENFORCEMENT.md).
 */

import { AUDITED_PINNED_LEDGER } from "./compatibility-contracts.ts";
import { preImportExclusionGate } from "./discovery-guard.ts";
import {
  type CompositionStep,
  ENFORCEMENT_COMPOSITION,
  type EnforcementSeamMarker,
} from "./extension/enforcement-error.ts";
import { MCP_ADMISSION_MECHANISM_STATUS, type McpAdmissionBasis } from "./tool-provenance.ts";
import { restrictedToolPolicyGates } from "./tool-inventory.ts";

// ---------------------------------------------------------------------------
// Shapes and machinery defined in the extension tree (single source).
// ---------------------------------------------------------------------------

export {
  type CompositionStep,
  type DestructiveCallPayload,
  type DestructiveTargetAudit,
  ENFORCEMENT_COMPOSITION,
  ENFORCEMENT_ERROR_FIELDS,
  type EnforcementBlocked,
  type EnforcementDenialReason,
  type EnforcementError,
  type EnforcementOutcome,
  type EnforcementProven,
  type EnforcementSeamMarker,
  formatEnforcementError,
  isBlocked,
  type LiveToolMetadataObserver,
  type OwningModuleObservation,
  PENDING_ADAPTER_OUTCOME,
  type StaleElement,
  type ToolCallObservation,
  type ToolRegistryObservation,
  WIRING_DENIAL_VOCABULARY,
  type WiringDenialReason,
} from "./extension/enforcement-error.ts";

export {
  composeFreshProvenance,
  composeRestrictedToolCall,
  createLiveObserver,
  createRestrictedToolCallHandler,
  destructiveTargetAudit,
  type EnforcementDeps,
  type EnforcementLaunchMode,
  type EnforcementRegistrationResult,
  type LiveToolRegistrySurface,
  mcpAdmissionDenialBlock,
  observeCall,
  observeLaunchMode,
  ownedProvenanceFrom,
  registerNativeYoloNoop,
  registerRestrictedEnforcement,
  RegistryEpochObserver,
  type RestrictedToolCallHandler,
  type RestrictedToolCallInput,
  type ToolCallSlotRegistrar,
  type ToolMetadataSnapshot,
} from "./extension/enforcement.ts";

// ---------------------------------------------------------------------------
// Pinned mechanism evidence (ledger-quoted, never retyped).
// ---------------------------------------------------------------------------

const policyReadinessLedger = AUDITED_PINNED_LEDGER.find((entry) =>
  entry.boundary === "policy_readiness"
)!;
const transportLedgerEntries = AUDITED_PINNED_LEDGER.filter((entry) =>
  entry.boundary === "native_transport"
);

/** Pinned mechanism evidence quoted from the P0 ledger, never retyped. */
export const PINNED_MECHANISM_EVIDENCE = Object.freeze(
  {
    citation: policyReadinessLedger.sourceCitation,
    reachability: policyReadinessLedger.reachability,
    status: policyReadinessLedger.status,
    notes: policyReadinessLedger.notes ?? "",
    downstreamOwner: policyReadinessLedger.downstreamOwner,
    applicationNote:
      "Row 13 (gate-omp-policy-readiness) is REMOVED by user decision; the recorded ledger status above is the pinned verdict, and its downstream-owner label is reproduced verbatim from the ledger row without reviving any readiness consumer here.",
  } as const,
);

// ---------------------------------------------------------------------------
// Seam table (design §6): inherited verdicts + DECIDED dispositions.
// ---------------------------------------------------------------------------

/** One inherited seam with its verbatim source verdict and handler posture. */
export interface EnforcementSeam {
  readonly id:
    | "mcp-admission-basis"
    | "readiness-cancellation"
    | "approval-record-reset"
    | "destructive-intent-decoding"
    | "network-parity-adapters"
    | "discovery-side-gates";
  /** Source-attributed restatement of the inherited verdict. */
  readonly source: {
    readonly origin: string;
    readonly status: string;
    readonly citation: string;
    readonly notes: string;
  };
  readonly userDisposition: "DECIDED";
  readonly dispositionText: string;
  /** The handler's behavior at the seam (fail-closed posture). */
  readonly handlerBehavior: string;
  /** Marker an actual block carries at this seam. */
  readonly blockMarker: EnforcementSeamMarker;
}

const mcpBasisRow = MCP_ADMISSION_MECHANISM_STATUS[0];

/**
 * The seam table. `enforcement.ts` maps handler-internal failures to
 * `rejected_enforcement_seam` with the `seam: "seam-table"` marker; the
 * per-seam markers below ride the actual policy blocks (record survivor,
 * destructive, pending adapter, MCP basis). Every inherited status is
 * quoted from its source module — never relabeled.
 */
export const ENFORCEMENT_SEAMS: readonly EnforcementSeam[] = Object.freeze(
  [
    {
      id: "mcp-admission-basis",
      source: {
        origin: "tool-provenance.ts:MCP_ADMISSION_MECHANISM_STATUS",
        status: mcpBasisRow.status,
        citation: mcpBasisRow.citation,
        notes: `surface: ${mcpBasisRow.surface}`,
      },
      userDisposition: "DECIDED",
      dispositionText:
        "the operational stance stands: operator-MCP refresh admission runs the decision, provenance is revalidated after registration/reconnection, and the basis is never inflated to supported.",
      handlerBehavior:
        "Admission runs per call through 14a and can pass or fail on the fresh epoch; the mechanism BASIS never inflates — every admitted MCP outcome carries basisStatus needs-mechanism-audit from 14a and every code path/export keeps it.",
      blockMarker: "mcp-admission-basis",
    },
    {
      id: "readiness-cancellation",
      source: {
        origin: "compatibility-contracts.ts:AUDITED_PINNED_LEDGER (boundary policy_readiness)",
        status: policyReadinessLedger.status,
        citation: policyReadinessLedger.sourceCitation,
        notes: policyReadinessLedger.notes ?? "",
      },
      userDisposition: "DECIDED",
      dispositionText:
        "client-observable authenticated readiness is cancelled and gate-omp-policy-readiness is removed from the batch. Installed handler decisions remain; if handler installation fails, pinned non-YOLO native approval plus ACP client policy gate ACP-mediated operations fail-closed.",
      handlerBehavior:
        "No readiness signal, state, channel, prompt gate or handshake exists anywhere in the wiring; slot registration carries no readiness assertion. runner.emit only logs lifecycle-hook errors, so extension-load failure is an accepted residual risk.",
      blockMarker: "seam-table",
    },
    {
      id: "approval-record-reset",
      source: {
        origin: "restrictedToolPolicyGates.verdicts (record_authority; ledger via row 8/14a)",
        status: restrictedToolPolicyGates.row8RecordResetGate.status,
        citation: restrictedToolPolicyGates.verdicts[0].pinnedLedgerSourceCitation,
        notes: restrictedToolPolicyGates.row8RecordResetGate.reason,
      },
      userDisposition: "DECIDED",
      dispositionText: restrictedToolPolicyGates.verdicts[0].dispositionText,
      handlerBehavior:
        "Records are ADVISORY input at composition step 5 only; the composition order makes a surviving lower-layer allow unable to short-circuit steps 1-4, and the denial names rejected_approval_record_survivor when a survivor exists.",
      blockMarker: "record-reset",
    },
    {
      id: "destructive-intent-decoding",
      source: {
        origin: "restrictedToolPolicyGates.verdicts (destructive_intent; ledger via row 5/14a)",
        status: restrictedToolPolicyGates.verdicts[1].pinnedLedgerStatus,
        citation: restrictedToolPolicyGates.verdicts[1].pinnedLedgerSourceCitation,
        notes: restrictedToolPolicyGates.verdicts[1].pinnedLedgerNotes,
      },
      userDisposition: "DECIDED",
      dispositionText: restrictedToolPolicyGates.verdicts[1].dispositionText,
      handlerBehavior:
        "Destructive-shaped calls run through 14a's row-5 consumer verbatim: undecodable/incomplete native-shaped input yields the shared fail-closed verdict; no speculative decoder exists in the wiring; an observation-absent normalization-only verdict never proceeds.",
      blockMarker: "destructive-intent",
    },
    {
      id: "network-parity-adapters",
      source: {
        origin: "compatibility-contracts.ts:AUDITED_PINNED_LEDGER (boundary native_transport)",
        status: transportLedgerEntries.map((entry) => `${entry.subcase}:${entry.status}`).join(
          ", ",
        ),
        citation: transportLedgerEntries.map((entry) => entry.sourceCitation).join(" | "),
        notes:
          "Rows 17-19 adapters landed; the ledger statuses above are unchanged (static-audit verdicts), and the seam consumes typed completion without inflating any of them.",
      },
      userDisposition: "DECIDED",
      dispositionText:
        "the trusted-extension replacement tool covers the approved routes (URL read and web search) through the controlled transport; fetchBinary and scraper redirect-following bypass routes stay blocked permanently.",
      handlerBehavior:
        "14a's allow-gated-pending-adapter outcome consults the route owner's typed completion at the clamp: a completed controlled route plus the registered owned replacement proceeds to the NAMED replacement boundary (C5); every other case blocks at the call with rejected_pending_adapter (seam pending-adapter) — fail closed, never a silent native transport allow.",
      blockMarker: "pending-adapter",
    },
    {
      id: "discovery-side-gates",
      source: {
        origin: "discovery-guard.ts honesty gates (row 12)",
        status: preImportExclusionGate.status,
        citation: "guard-omp-executable-discovery honesty gates, consumed as shipped",
        notes: "Init failure fails session setup before any call reaches the handler.",
      },
      userDisposition: "DECIDED",
      dispositionText:
        "Consumed as-is: the wiring adds no second discovery claim and no second gate; the row-12 gates stand exactly as row 12 exported them.",
      handlerBehavior:
        "Gate data only: the wiring consumes the frozen row-12 decision and resourceGeneration read-only and re-observes neither discovery nor its decision.",
      blockMarker: "seam-table",
    },
  ] as const satisfies readonly EnforcementSeam[],
);

/**
 * The named enforcement-wiring gate. Passing wiring tests can never clear an
 * entry: each inherited verdict is quoted from its source module, the DECIDED
 * user dispositions govern application without relabeling anything, and no
 * synthetic allow-fixture here is citable as native support (P0 fixture
 * rule).
 */
export interface EnforcementWiringGates {
  readonly seams: readonly EnforcementSeam[];
  /** Composition-order data the handler body follows. */
  readonly composition: readonly CompositionStep[];
  readonly mcpBasis: {
    readonly basisStatus: McpAdmissionBasis;
    readonly hasMcpBoundaryRow: false;
  };
  readonly posture: {
    readonly restrictedOnly: true;
    readonly yoloRegistersNoHandler: true;
    readonly opencodeLoadsNoExtension: true;
    readonly elicitation: "explicitly-absent";
    readonly readinessChannel: "cancelled-not-consumed";
    readonly oneShotAcknowledgement: "not-representable";
    readonly evidenceScope: "wiring-decisions-only";
  };
  readonly residualRisk: {
    readonly runnerEmitBehavior: string;
    readonly handlerAbsentFallback: string;
    readonly equivalenceClaim: false;
  };
}

export const enforcementWiringGates: EnforcementWiringGates = Object.freeze(
  {
    seams: ENFORCEMENT_SEAMS,
    composition: ENFORCEMENT_COMPOSITION,
    mcpBasis: {
      basisStatus: mcpBasisRow.status,
      hasMcpBoundaryRow: false,
    },
    posture: {
      restrictedOnly: true,
      yoloRegistersNoHandler: true,
      opencodeLoadsNoExtension: true,
      elicitation: "explicitly-absent",
      readinessChannel: "cancelled-not-consumed",
      oneShotAcknowledgement: "not-representable",
      evidenceScope: "wiring-decisions-only",
    },
    residualRisk: {
      runnerEmitBehavior:
        "Pinned runner.emit only logs lifecycle-hook errors and does not fail session startup: an extension that fails to load leaves the session without the restricted capability set (accepted residual risk, no client-observable readiness assertion).",
      handlerAbsentFallback:
        "If the extension handler is not installed, the pinned non-YOLO native approval mode plus the client ACP policy remain the boundary for ACP-mediated operations; restricted sessions still fail closed on client policy denials.",
      equivalenceClaim: false,
    },
  } as const,
) satisfies EnforcementWiringGates;
