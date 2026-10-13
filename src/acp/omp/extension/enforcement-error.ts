/**
 * Enforcement Error-Shape Sibling (trusted-extension tree).
 *
 * Implements OpenSpec change `wire-omp-restricted-tool-enforcement` (row 16 /
 * P5c-ii): the bounded fail-closed error, the per-call observation shapes,
 * the live-observer seam interface, and the composition-order DATA the
 * handler body follows. Pure shapes only — this module performs no IO, reads
 * no registry, and decides nothing: its only imports are 14a's pure type
 * vocabulary, which reach it through the `_daemon/mod.ts` barrel so dev and
 * image loads consume byte-identical committed sources (row 20 D5 extension
 * dependency closure — the extension never imports `/app/src` at runtime).
 *
 * The error is bounded and static by construction: every field name appears
 * in `ENFORCEMENT_ERROR_FIELDS` and every value comes from a finite
 * enumeration or a static pinned table id. NO field can carry path content,
 * file/argument payload, model text, credential, token, secret, or raw tool
 * output (design §3/§13).
 */

import type {
  CompletingAuthority,
  EffectiveRecordEvaluation,
  InputShape,
  RestrictedDenialReason,
  RouteSurface,
} from "./_daemon/mod.ts";
import type {
  AuthorizeWriteParams,
  CanonicalTarget,
  DestructiveIntentInput,
  ProvenanceRecord,
  RootPathResult,
  ToolOrigin,
} from "./_daemon/mod.ts";
import type { SearchCredentialPresence } from "./_daemon/mod.ts";

// ---------------------------------------------------------------------------
// Wiring-level error codes added on top of 14a's finite deny vocabulary.
// ---------------------------------------------------------------------------

/**
 * Wiring-level codes:
 * - `rejected_enforcement_seam`: handler-internal failure at a seam (a
 *   composition throw, a non-restricted entry identity, or an incomplete
 *   native destructive shape at the wiring edge) — fail closed.
 * - `rejected_stale_observation`: a provenance re-observe denial (stale
 *   epoch or stale resource generation); admission possible only fresh.
 * - `rejected_pending_adapter`: 14a's `allow-gated-pending-adapter` clamped
 *   closed by the wiring whenever the completed controlled route or the
 *   registered owned replacement is absent (C5: a completed route proceeds
 *   to the NAMED replacement only — never native transport).
 * - `rejected_destructive_authorization`: the row-5 all-target
 *   authorization-stage denial. The row-4 per-target outcome must still
 *   surface on the ACP-mediated path, so the handler reproduces
 *   `firstDeniedIndex` plus row 4's finite per-target reason codes as
 *   enumerated audit data — never path content.
 */
export type WiringDenialReason =
  | "rejected_enforcement_seam"
  | "rejected_stale_observation"
  | "rejected_pending_adapter"
  | "rejected_destructive_authorization";

export const WIRING_DENIAL_VOCABULARY: readonly WiringDenialReason[] = Object.freeze(
  [
    "rejected_enforcement_seam",
    "rejected_stale_observation",
    "rejected_pending_adapter",
    "rejected_destructive_authorization",
  ] as const,
);

export type EnforcementDenialReason = RestrictedDenialReason | WiringDenialReason;

/** Which freshness element is stale on a re-observe denial. */
export type StaleElement = "registry-epoch" | "resource-generation";

/** Seam markers carried on blocks at inherited unresolved boundaries. */
export type EnforcementSeamMarker =
  | "mcp-admission-basis"
  | "record-reset"
  | "destructive-intent"
  | "pending-adapter"
  | "native-event-decode"
  | "seam-table";

/**
 * The bounded, static error a blocked restricted call surfaces through the
 * pinned tool-call error path (row 12's bounded ACP diagnostic posture).
 */
export interface EnforcementError {
  readonly code: EnforcementDenialReason;
  /** Capability id from 14a's enumerated capability set. */
  readonly capability?: string;
  readonly route?: RouteSurface;
  readonly originCategory?: ToolOrigin;
  /** Only on stale denials. */
  readonly staleElement?: StaleElement;
  /** Seam marker from the wiring seam table only. */
  readonly seam?: EnforcementSeamMarker;
  /** 14a inventory table row id — static data inside 14a. */
  readonly tableRowId?: string;
}

/** Every field name an `EnforcementError` may carry (finite, test-pinned). */
export const ENFORCEMENT_ERROR_FIELDS: readonly string[] = Object.freeze(
  ["code", "capability", "route", "originCategory", "staleElement", "seam", "tableRowId"] as const,
);

/** Format the bounded error string surfaced on the pinned tool-call error path. */
export function formatEnforcementError(error: EnforcementError): string {
  const parts = [`restricted tool call blocked: ${error.code}`];
  if (error.capability !== undefined) parts.push(`capability=${error.capability}`);
  if (error.route !== undefined) parts.push(`route=${error.route}`);
  if (error.originCategory !== undefined) parts.push(`origin=${error.originCategory}`);
  if (error.staleElement !== undefined) parts.push(`stale=${error.staleElement}`);
  if (error.seam !== undefined) parts.push(`seam=${error.seam}`);
  if (error.tableRowId !== undefined) parts.push(`row=${error.tableRowId}`);
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Per-call observation shapes (assembled fresh on EVERY call; never cached).
// ---------------------------------------------------------------------------

/**
 * One call's fresh registry observation: the tool's CURRENT recorded origin
 * (from the live tool-metadata surface), the CURRENT wiring-owned registry
 * epoch, and row 12's CURRENT resource generation.
 */
export interface ToolRegistryObservation {
  readonly recordedOrigin: ProvenanceRecord;
  /** Wiring-owned epoch read fresh from the live tool-metadata observation. */
  readonly registryEpoch: number;
  /** Row 12's current generation counter (row 16 read-only consumer). */
  readonly resourceGeneration: string;
}

/** Owned-module identity observed for the extension itself (row 12 evidence). */
export interface OwningModuleObservation {
  readonly modulePath: string;
  readonly baseRoot: string;
  readonly canonicalTarget?: CanonicalTarget;
  /** Row 12's generation observation for this session. */
  readonly resourceGeneration: string;
}

/** A decoded, destructive-shaped call payload consumed by the 14a entry. */
export interface DestructiveCallPayload {
  readonly intent: DestructiveIntentInput;
  readonly expandedTargets: readonly string[];
  readonly expandedLocations: readonly string[];
  /** Canonical observations the wiring collects; absent ⇒ normalization-only. */
  readonly observations?: readonly RootPathResult<CanonicalTarget>[];
  /** Row-4 write-authorization parameters for the all-target pass. */
  readonly authorizationParams?: Omit<AuthorizeWriteParams, "target">;
}

/**
 * Fresh per-call network-adapter completion input (C5
 * `admit-completed-omp-network-adapters`), assembled by the dispatcher from
 * wiring-owned observations ONLY — never supplied by a caller (the pinned
 * native event decoder structurally cannot produce it, mirroring
 * `registryObservation`). `registeredOwnedReplacement` is the registration
 * evidence for THIS call's exact name: the LIVE roster carries a replacement
 * under that name AND its recorded origin is this owned extension (the
 * provenance half rides `recordedOrigin`; an unregistered name reads
 * unowned-discovery, so this can never be a name-only claim).
 * `searchCredentialPresence` is the CURRENT trusted credential-presence read
 * (presence booleans only — never values, never logged, never cached).
 */
export interface NetworkAdmissionObservation {
  readonly registeredOwnedReplacement: boolean;
  readonly searchCredentialPresence: SearchCredentialPresence;
}

/**
 * One restricted `tool_call` observation, assembled fresh per call by the
 * dispatcher. The provenance record's freshness halves carry this call's
 * observation pair:
 *   - `native-builtin` records pair BOTH freshness elements with this call's
 *     live reads (the record's halves come from the same live roster read that
 *     produced the builtin identity — see `NativeBuiltinProvenance`);
 *   - `owned-extension` records pair `observedResourceGeneration` (what the
 *     metadata surface recorded) with `currentResourceGeneration` (row 12's
 *     live counter) — both or neither, never one-sided;
 *   - `operator-mcp` records pair `registryEpochObserved` (the recorded
 *     epoch) with `currentRegistryEpoch` (the wiring's live epoch read at
 *     this instant);
 *   - untrusted origins pass through unchanged.
 * Staleness enters only through the live read differing from the recorded
 * observation, which 14a's provenance decision consumes; the dispatcher
 * caches nothing across calls.
 */
export interface ToolCallObservation {
  /** Exact registered tool key (record lookup is exact-key only). */
  readonly toolKey: string;
  readonly toolName: string;
  readonly decodedInputShape: InputShape;
  /** Refines a non-ordinary surface only (14a rule; never downgrades). */
  readonly deviceSurface?: Exclude<RouteSurface, "ordinary-tool">;
  readonly decodedCapability?: string;
  /** Live registry observation for this call (fresh; never cached). */
  readonly registryObservation: ToolRegistryObservation;
  /**
   * Fresh network-adapter completion input for this call (C5). The
   * dispatcher assembles it from wiring-owned reads; like
   * `registryObservation`, callers cannot inject it. An absent field keeps
   * the pending-adapter clamp fail-closed.
   */
  readonly networkAdmission?: NetworkAdmissionObservation;
  /** Present only for destructive-shaped calls routed to the 14a consumer. */
  readonly destructive?: DestructiveCallPayload;
  /**
   * Row-8 folded-overlay record evaluation for the process. ADVISORY input
   * only (composition step 5); it can never admit or soften a denial.
   */
  readonly recordEvaluation: EffectiveRecordEvaluation;
}

/**
 * Live origin observation seam. The production adapter (user checklist — see
 * docs/OMP_ENFORCEMENT.md) reads the native `getAllTools`-class tool-metadata
 * surface and row 12's session generation; tests inject fresh-read fixtures.
 * The dispatcher MUST re-consult it on every call: caching a decision, an
 * origin, or a registry snapshot across calls is structurally absent from
 * the handler body.
 */
export interface LiveToolMetadataObserver {
  /** Fresh read of the CURRENT recorded origin for one tool. */
  observeOrigin(toolName: string): ProvenanceRecord;
  /** Fresh read of the epoch derived from the live tool-metadata surface. */
  observeRegistryEpoch(): number;
  /** Fresh read of row 12's current resource generation. */
  observeResourceGeneration(): string;
  /** The extension's own owned-module identity (row 12 frozen decision). */
  owningModule(): OwningModuleObservation;
}

// ---------------------------------------------------------------------------
// Handler result shapes.
// ---------------------------------------------------------------------------

/** Bounded, enumerated per-target authorization outcome (step 4 audit). */
export interface DestructiveTargetAudit {
  readonly index: number;
  readonly authorized: boolean;
  /** Row 4's finite reason code on denial (bounded enum, never path content). */
  readonly reason?: string;
  readonly role?: string;
}

export type EnforcementProven =
  | { readonly proceed: true; readonly completingAuthority: CompletingAuthority }
  | {
    readonly proceed: true;
    readonly completingAuthority: "mcp-client-ownership";
    readonly mcpAdmitted: true;
  }
  /**
   * C5 route-scoped adapter completion: the wiring's pending-adapter clamp
   * consumed a typed completion decision from the route owner AFTER 14a's
   * inventory + provenance admission. `proceed` still asserts no
   * authorization — it names the registered controlled replacement as the
   * completing boundary and records which completed routes admitted the
   * call. The composer itself never dispatches; execution continues in the
   * named replacement under its unchanged per-hop transport policy.
   */
  | {
    readonly proceed: true;
    readonly completingAuthority: "rows-17-19-transport-adapter";
    readonly adapterCompletion: {
      readonly tableRowId: "url-read" | "web-search";
      readonly routeIds: readonly string[];
      readonly mechanism: string;
    };
  };

export interface EnforcementBlocked {
  readonly block: true;
  readonly error: EnforcementError;
  /**
   * Step-4 audit for destructive-shaped calls: enumerated index/boolean/
   * finite-code data only — no path content.
   */
  readonly destructiveTargets?: readonly DestructiveTargetAudit[];
}

/**
 * `proceed` NEVER means "authorized": it only names the completing
 * predecessor authority (design D1 carried through 14a). The handler itself
 * asserts no authorization.
 */
export type EnforcementOutcome = EnforcementProven | EnforcementBlocked;

export function isBlocked(outcome: EnforcementOutcome): outcome is EnforcementBlocked {
  return (outcome as EnforcementBlocked).block === true;
}

// ---------------------------------------------------------------------------
// Wiring-owned composition-order data.
// ---------------------------------------------------------------------------

/**
 * The handler body's composition order is THIS data; the handler contains no
 * ordering logic of its own beyond executing the steps in this order. The
 * order is design §1's: inventory → provenance → alternate-route →
 * destructive → records. Steps 1-3 delegate to 14a's single entry decision
 * (`decideRestrictedTool`), whose internal stage order (pair screening →
 * default-deny by name → provenance admission → outcome) is a within-decision
 * ordering of the same three policy steps.
 */
export interface CompositionStep {
  readonly step: number;
  readonly id:
    | "inventory"
    | "provenance"
    | "alternate-route"
    | "destructive"
    | "approval-records-advisory";
  /** The 14a export consulted (the sole decision source). */
  readonly decisionSource: string;
  /** Whether a lower step's denial can be short-circuited by later data. */
  readonly shortCircuitableByLaterInput: false;
}

export const ENFORCEMENT_COMPOSITION: readonly CompositionStep[] = Object.freeze(
  [
    {
      step: 1,
      id: "inventory",
      decisionSource: "tool-inventory.ts:decideRestrictedTool",
      shortCircuitableByLaterInput: false,
    },
    {
      step: 2,
      id: "provenance",
      decisionSource: "tool-provenance.ts:evaluateToolProvenance",
      shortCircuitableByLaterInput: false,
    },
    {
      step: 3,
      id: "alternate-route",
      decisionSource: "tool-inventory.ts:ALTERNATE_ROUTE_BLOCKING_TABLE",
      shortCircuitableByLaterInput: false,
    },
    {
      step: 4,
      id: "destructive",
      decisionSource: "destructive-decision.ts:decideDestructiveIntent",
      shortCircuitableByLaterInput: false,
    },
    {
      step: 5,
      id: "approval-records-advisory",
      decisionSource: "approval-records.ts:interpretApprovalRecords",
      shortCircuitableByLaterInput: false,
    },
  ] as const satisfies readonly CompositionStep[],
);

/** Wiring clamp data: outcomes that must block rather than proceed. */
export const PENDING_ADAPTER_OUTCOME = "allow-gated-pending-adapter" as const;
