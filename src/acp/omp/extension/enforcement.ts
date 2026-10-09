/**
 * Restricted `tool_call` Enforcement: handler body + synchronous slot
 * registration/attachment (trusted-extension tree).
 *
 * Implements OpenSpec change `wire-omp-restricted-tool-enforcement` (row 16 /
 * P5c-ii). This sibling owns the SYNCHRONOUS handler-slot registration and
 * the attached policy body. The body composes ONLY 14a's pure decisions
 * (`tool-inventory`, `tool-provenance`, `destructive-decision`,
 * `approval-records`) against the fresh per-call observation; it holds zero
 * decision tables — ordering, freshness rules, and the error vocabulary are
 * the wiring data in `./enforcement-error.ts` (plus the seam table in
 * `../tool-enforcement-wiring.ts`).
 *
 * Fail-closed riding (pinned mechanism evidence, quoted with ledger tiers in
 * `PINNED_MECHANISM_EVIDENCE`): native `extensions/runner.ts` `emitToolCall`
 * blocks handler errors and timeouts, so a composition that throws is caught
 * at the handler boundary and converted to a bounded block — never retried,
 * never continued. The slot rides `extensions/types.ts` synchronous handler
 * registration, which carries NO readiness assertion (row 13 cancelled by
 * user decision), and the live origin surface is the `getAllTools`-class
 * tool-metadata seam (`candidate-to-verify`; real observation is user-owned,
 * design §15).
 *
 * Registration posture: the restricted-only exemption is STRUCTURAL at the
 * registration site — a `native-yolo` process routes to
 * `registerNativeYoloNoop`, which registers nothing and loads no restricted
 * approval records, so no mode check exists inside the decision path. The
 * handler entry still re-verifies its own observed process identity as its
 * first statement and fails closed on a non-restricted identity.
 *
 * Every fixture/observation reaching this module is synthetic wiring-test
 * data: nothing here demonstrates that the official binary invokes, honors,
 * or enforces anything (design §15 user checklist).
 */

// All 14a decision imports ride the barrel (row 20 D5 extension dependency
// closure): `./_daemon/mod.ts` re-exports the committed sources, so dev and
// image loads consume byte-identical files and the tree never imports
// `/app/src` across the boundary at runtime.
import {
  decideMcpAdmission,
  decideRestrictedTool,
  INPUT_SHAPE_CAPABILITIES,
  type ProvenanceRecord,
  type RestrictedToolDecision,
  type RestrictedToolDecisionRequest,
} from "./_daemon/mod.ts";
import { interpretApprovalRecords, restrictedDenialWithRecordNaming } from "./_daemon/mod.ts";
import {
  decideDestructiveIntent,
  type McpAdmissionDecision,
  RESTRICTED_DENIAL_VOCABULARY,
  type RestrictedDenialReason,
} from "./_daemon/mod.ts";
import type { CanonicalTarget, FilesystemAuthorizationResult } from "./_daemon/mod.ts";
import {
  type DestructiveTargetAudit,
  type EnforcementError,
  type EnforcementOutcome,
  formatEnforcementError,
  type LiveToolMetadataObserver,
  type OwningModuleObservation,
  type ToolCallObservation,
} from "./enforcement-error.ts";

// ---------------------------------------------------------------------------
// Registration surfaces (synchronous; no readiness assertion).
// ---------------------------------------------------------------------------

/** Row 9's launch-identity vocabulary: the module's OWN process mode. */
export type EnforcementLaunchMode = "restricted" | "native-yolo";

/** The pinned `getAllTools`-class tool-metadata surface seam. */
export interface LiveToolRegistrySurface {
  /** A fresh snapshot: every currently registered tool and its RECORDED origin. */
  snapshot(): readonly ToolMetadataSnapshot[];
}

/** One fresh snapshot entry (full recorded origin — never name-only data). */
export interface ToolMetadataSnapshot {
  readonly toolName: string;
  readonly origin: ProvenanceRecord;
}

/** Slot-registration seam mirroring the pinned synchronous registration surface. */
export interface ToolCallSlotRegistrar {
  /** Synchronous registration; the pinned surface accepts the handler inline. */
  registerRestrictedToolCall(handler: RestrictedToolCallHandler): void;
}

/**
 * What the pinned seam can hand the handler: everything decodable from the
 * call itself. The wiring-owned fresh registry observation is NOT accepted
 * as caller input — the handler re-reads it from the live observer on every
 * invocation, so no caller (native or test) can inject or replay one.
 */
export type RestrictedToolCallInput = Omit<ToolCallObservation, "registryObservation">;

/** The attached handler: decides one call, fresh, synchronously. */
export type RestrictedToolCallHandler = (
  input: RestrictedToolCallInput,
) => EnforcementOutcome;

/** Dependencies the registration site freezes at attach time. */
export interface EnforcementDeps {
  /** The module's own restricted-mode launch identity (row 9's mode). */
  readonly selfIdentity: { readonly mode: EnforcementLaunchMode };
  /** Live tool-metadata observation seam (fresh reads; never cached). */
  readonly observer: LiveToolMetadataObserver;
  /**
   * The bounded diagnostic sink mirroring the pinned tool-call error path
   * (row 12's bounded ACP error posture). The wiring calls it with
   * `formatEnforcementError` output only — enumerated fields, never payload.
   */
  readonly surfaceError: (message: string) => void;
}

/** Result of the load-time registration sequence (both branches). */
export interface EnforcementRegistrationResult {
  readonly registered: boolean;
  readonly mode: EnforcementLaunchMode;
  /** Present only in the restricted branch. */
  readonly handler?: RestrictedToolCallHandler;
}

/**
 * The restricted-process registration branch: synchronously registers the
 * handler slot and attaches the enforcement body. The exemption is
 * STRUCTURAL — the YOLO branch registers NOTHING at all. Registration
 * carries no readiness assertion: on the pinned surface, synchronous
 * registration establishes no client-observable readiness state.
 */
export function registerRestrictedEnforcement(
  registrar: ToolCallSlotRegistrar,
  deps: EnforcementDeps,
): EnforcementRegistrationResult {
  if (deps.selfIdentity.mode !== "restricted") {
    return registerNativeYoloNoop(deps.selfIdentity.mode);
  }
  const handler = createRestrictedToolCallHandler(deps);
  registrar.registerRestrictedToolCall(handler);
  return { registered: true, mode: "restricted", handler };
}

/**
 * The native-YOLO branch (row 8/9's yolo overlay, no `--trusted-extension`
 * restricted policy): registers NO restricted `tool_call` policy, loads no
 * restricted approval records, and adds no overlay content.
 */
export function registerNativeYoloNoop(
  mode: EnforcementLaunchMode = "native-yolo",
): EnforcementRegistrationResult {
  return { registered: false, mode };
}

// ---------------------------------------------------------------------------
// Load-time attach (called by the trusted-module entrypoint after its
// pre-import gate; lives in this sibling because the entrypoint itself is
// fail-closed and refuses to finish loading under the pinned unresolved
// pre-import-exclusion verdicts — the attach mechanics must remain
// inspectable and testable without loading the entrypoint).
// ---------------------------------------------------------------------------

/**
 * The module's OWN launch identity: row 9's mode-distinct launch cwd is
 * `{baseRoot}/omp-agent/{mode}/cwd`, so the mode segment IS the identity.
 * An unidentifiable mode yields `undefined` — the registration site treats
 * that as "restricted identity not observed" and registers nothing (the
 * accepted absence-of-handler residual risk), never as a guess.
 */
export function observeLaunchMode(cwd: string = ""): EnforcementLaunchMode | undefined {
  const match = /\/omp-agent\/(restricted|native-yolo)\/cwd\/?$/.exec(cwd);
  return match?.[1] as EnforcementLaunchMode | undefined;
}

/**
 * An empty live-metadata surface reads every tool unowned, so with no
 * native `getAllTools`-class surface attached every restricted call denies
 * fail-closed — startup/name-only snapshots never authorize, and an
 * unavailable surface cannot accidentally admit.
 */
export const EMPTY_METADATA_SURFACE: LiveToolRegistrySurface = Object.freeze({
  snapshot: () => [],
});

/** Load-time attach options (injection seam for verification; defaults are production). */
export interface EnforcementLoadOptions {
  /** The synchronous registration slot (default: the module's own attachment point). */
  readonly registrar?: ToolCallSlotRegistrar;
  /** The native `getAllTools`-class metadata surface (unattached ⇒ fail closed). */
  readonly metadataSurface?: LiveToolRegistrySurface;
  /** Observed launch cwd for the self-identity branch. */
  readonly observedCwd?: string;
  /** Row 12's session resource generation getter. */
  readonly resourceGeneration?: () => string;
  /** Bounded diagnostic sink (default: a host-side bounded error log). */
  readonly surfaceError?: (message: string) => void;
}

/**
 * The synchronous load-time enforcement registration: identity branch →
 * slot registration → body attach. Carries NO readiness signal — nothing
 * here may be read as a client-observable readiness assertion.
 */
export function attachEnforcementAtLoad(
  options: EnforcementLoadOptions = {},
): EnforcementRegistrationResult {
  const mode = observeLaunchMode(options.observedCwd);
  if (mode !== "restricted") {
    // Structural exemption: YOLO (and unidentified) processes register and
    // load NOTHING restricted.
    return registerNativeYoloNoop(mode ?? "native-yolo");
  }
  const surface = options.metadataSurface ?? EMPTY_METADATA_SURFACE;
  const generation = options.resourceGeneration ?? (() => "gen-0");
  const observedCwd = options.observedCwd ?? "";
  const { observer } = createLiveObserver(
    surface,
    generation,
    () => ({
      modulePath: new URL("./index.ts", import.meta.url).href,
      baseRoot: observedCwd.includes("/omp-agent/")
        ? observedCwd.replace(/\/omp-agent\/[^/]+\/cwd\/?$/, "")
        : observedCwd,
      resourceGeneration: generation(),
    }),
  );
  const deps: EnforcementDeps = {
    selfIdentity: { mode: "restricted" },
    observer,
    surfaceError: options.surfaceError ??
      // Bounded diagnostic posture (row 12's ACP error surface): the
      // handler only calls this with `formatEnforcementError` output —
      // enumerated fields, never payload, path content, model text,
      // secret, or token material.
      ((message: string) => console.error(`[air-friends-trusted-extension] ${message}`)),
  };
  return registerRestrictedEnforcement(options.registrar ?? loadSequenceRegistrar, deps);
}

/**
 * The module's own synchronous load-time attachment point: registering into
 * this record IS the synchronous slot registration of the load sequence.
 * The pinned host-side surface name remains candidate-to-verify (design
 * §15); the entrypoint exposes the handler synchronously so a host surface
 * receives the SAME registered instance, never a re-registration.
 */
let loadTimeEnforcementRegistration: EnforcementRegistrationResult = {
  registered: false,
  mode: "native-yolo",
};

const loadSequenceRegistrar = Object.freeze<ToolCallSlotRegistrar>({
  registerRestrictedToolCall: (handler: RestrictedToolCallHandler) => {
    loadTimeEnforcementRegistration = { registered: true, mode: "restricted", handler };
  },
});

/** The current load-time registration record (both branches). */
export function getLoadTimeEnforcementRegistration(): EnforcementRegistrationResult {
  // Frozen copy: consumers (entrypoint, row-21 regression checks) can never
  // observe or hold a mutated view of the module-global record.
  return Object.freeze({ ...loadTimeEnforcementRegistration });
}

// ---------------------------------------------------------------------------
// Wiring-owned live registryEpoch observation (task 3.1).
// ---------------------------------------------------------------------------

/**
 * The wiring-owned registry epoch. The epoch advances ONLY when a fresh
 * tool-metadata observation differs from the previous one in the FULL
 * recorded origin data (roster and origin fields) — never from chat content,
 * never from a name-only diff, and never from a refresh event carrying no
 * observation. No admitted set is ever frozen and there is no cache to
 * invalidate: per-call freshness lives in the fresh observation itself, so a
 * post-start MCP registration/refresh needs no ack, no reset, and no
 * readiness signal — the next call simply reads the advanced epoch.
 *
 * Stamping domain: recorded `registryEpochObserved` values reaching the
 * provenance decision MUST be stamped from THIS observation domain (the
 * production metadata-surface adapter in the docs checklist). The epoch
 * never retracts, so a record stamped from a different domain denies
 * re-observe fail-closed — never admit.
 */
export class RegistryEpochObserver {
  #epoch = 0;
  #lastKey: string;
  #current: Record<string, ProvenanceRecord>;

  constructor(private readonly surface: LiveToolRegistrySurface) {
    const initial = surface.snapshot();
    this.#lastKey = snapshotKey(initial);
    this.#current = snapshotRecord(initial);
  }

  /** Re-read the live surface; advance the epoch when the observation moved. */
  sync(): number {
    const snapshot = this.surface.snapshot();
    const key = snapshotKey(snapshot);
    if (key !== this.#lastKey) {
      this.#epoch += 1;
      this.#lastKey = key;
      this.#current = snapshotRecord(snapshot);
    }
    return this.#epoch;
  }

  /** Fresh origin read for one tool; an unregistered name reads unowned. */
  observeOrigin(toolName: string): ProvenanceRecord {
    this.sync();
    return this.#current[toolName] ?? { origin: "unowned-discovery", presentedName: toolName };
  }

  /** Fresh epoch read (the observation is re-taken, never remembered). */
  currentEpoch(): number {
    return this.sync();
  }

  /**
   * Post-start MCP registration/refresh event: advance the epoch FROM THE
   * LIVE OBSERVATION only. The event itself grants, softens, or
   * acknowledges nothing — admission is re-decided per call on the fresh
   * epoch.
   */
  noteRegistration(): number {
    return this.sync();
  }
}

function snapshotKey(snapshot: readonly ToolMetadataSnapshot[]): string {
  return JSON.stringify(
    [...snapshot]
      .sort((a, b) => a.toolName === b.toolName ? 0 : a.toolName < b.toolName ? -1 : 1)
      .map((entry) => [entry.toolName, JSON.stringify(entry.origin)]),
  );
}

function snapshotRecord(
  snapshot: readonly ToolMetadataSnapshot[],
): Record<string, ProvenanceRecord> {
  const record: Record<string, ProvenanceRecord> = {};
  for (const entry of snapshot) record[entry.toolName] = entry.origin;
  return record;
}

/**
 * Compose the handler's live-observer seam from the pinned metadata surface,
 * row 12's generation getter, and the extension's owned-module identity.
 */
export function createLiveObserver(
  surface: LiveToolRegistrySurface,
  generation: () => string,
  owning: () => OwningModuleObservation,
): { observer: LiveToolMetadataObserver; registry: RegistryEpochObserver } {
  const registry = new RegistryEpochObserver(surface);
  return {
    registry,
    observer: {
      observeOrigin: (toolName) => registry.observeOrigin(toolName),
      observeRegistryEpoch: () => registry.currentEpoch(),
      observeResourceGeneration: () => generation(),
      owningModule: () => owning(),
    },
  };
}

/**
 * Fresh per-call observation assembler: reads the live origin, the live
 * registry epoch, and row 12's live resource generation on EVERY call — no
 * cache of any kind, so a mid-session tool is in scope automatically and its
 * first consult reads current state.
 */
export function observeCall(
  deps: EnforcementDeps,
  input: Omit<ToolCallObservation, "registryObservation">,
): ToolCallObservation {
  return {
    ...input,
    registryObservation: {
      recordedOrigin: deps.observer.observeOrigin(input.toolName),
      registryEpoch: deps.observer.observeRegistryEpoch(),
      resourceGeneration: deps.observer.observeResourceGeneration(),
    },
  };
}

// ---------------------------------------------------------------------------
// Handler body: per-call composition of 14a decisions (zero local policy).
// ---------------------------------------------------------------------------

/**
 * Fresh, one-sided-free provenance record for this call (wiring observation,
 * not a decision): the RECORDED side comes from the live metadata surface;
 * the CURRENT side is the live read at this instant. The wiring persists
 * neither side across calls.
 */
export function composeFreshProvenance(
  observation: ToolCallObservation,
): ProvenanceRecord {
  const recorded = observation.registryObservation.recordedOrigin;
  switch (recorded.origin) {
    case "operator-mcp":
      // Current epoch = the live wiring-owned observation for THIS call.
      return { ...recorded, currentRegistryEpoch: observation.registryObservation.registryEpoch };
    case "owned-extension":
      // Current generation = row 12's live counter for THIS call; the
      // observed half stays whatever the surface recorded (BOTH-or-NEITHER
      // is enforced by the provenance decision itself).
      return {
        ...recorded,
        currentResourceGeneration: observation.registryObservation.resourceGeneration,
      };
    default:
      return recorded;
  }
}

/** Map row 4's authorization result to the bounded per-target audit record. */
export function destructiveTargetAudit(
  decisions: readonly FilesystemAuthorizationResult[],
): readonly DestructiveTargetAudit[] {
  return decisions.map((decision, index) =>
    decision.ok
      ? { index, authorized: true, ...(decision.role ? { role: decision.role } : {}) }
      : { index, authorized: false, reason: decision.reason }
  );
}

/** Assemble a fail-closed block outcome from a bounded error. */
function blocked(
  error: EnforcementError,
  destructiveTargets?: readonly DestructiveTargetAudit[],
): EnforcementOutcome {
  return destructiveTargets ? { block: true, error, destructiveTargets } : { block: true, error };
}

/**
 * Fail-closed narrowing of row 5's bounded destructive reason into the
 * finite vocabulary: an unrecognized future reason is NEVER cast into a
 * client-visible code — it throws, and the handler's seam catch converts it
 * to the `rejected_enforcement_seam` block.
 */
function destructiveSharedCode(sharedReason: string): RestrictedDenialReason {
  if ((RESTRICTED_DENIAL_VOCABULARY as readonly string[]).includes(sharedReason)) {
    return sharedReason as RestrictedDenialReason;
  }
  throw new Error("unrecognized shared destructive denial reason");
}

/** Step 4: destructive-shaped calls run 14a's row-5 consumer verbatim. */
function decideDestructive(observation: ToolCallObservation): EnforcementOutcome {
  const payload = observation.destructive;
  if (payload === undefined) {
    // A destructive-shaped call without a decoded payload is an incomplete
    // native shape at the seam: fail closed, never guess a decoder.
    return blocked({
      code: "rejected_enforcement_seam",
      seam: "destructive-intent",
      capability: "destructive-mutation",
    });
  }
  const decision = decideDestructiveIntent({
    intent: payload.intent,
    expandedTargets: payload.expandedTargets,
    expandedLocations: payload.expandedLocations,
    ...(payload.observations ? { observations: payload.observations } : {}),
    ...(payload.authorizationParams ? { authorizationParams: payload.authorizationParams } : {}),
  });
  switch (decision.outcome) {
    case "authorized-all-targets":
      return { proceed: true, completingAuthority: "row5-destructive-all-target-policy" };
    case "complete-awaiting-authorization":
      // Normalization-only verdict: the all-target pass has NOT run, so this
      // is never a completion claim — fail closed at the seam.
      return blocked({
        code: "rejected_enforcement_seam",
        seam: "destructive-intent",
        capability: "destructive-mutation",
      });
    case "deny":
      if (decision.stage === "completeness") {
        // Verbatim shared row-5 bounded reason (incomplete / binding).
        return blocked({
          code: destructiveSharedCode(decision.sharedReason),
          seam: "destructive-intent",
          capability: "destructive-mutation",
        });
      }
      return blocked(
        {
          code: "rejected_destructive_authorization",
          seam: "destructive-intent",
          capability: "destructive-mutation",
        },
        destructiveTargetAudit(decision.decisions),
      );
  }
}

/**
 * Step 5 for a denied call: advisory record interpretation runs AFTER the
 * policy denial exists, so no surviving lower-layer record can short-circuit
 * steps 1-4; a surviving `allow` only renames the report to the survivor
 * reason (with the record-reset seam marker) — reported, never obeyed.
 */
function finalizeDenialError(
  decision: Extract<RestrictedToolDecision, { outcome: "deny" }>,
  observation: ToolCallObservation,
  originCategory: ProvenanceRecord["origin"],
): EnforcementError {
  const interpretation = interpretApprovalRecords({
    registeredToolKey: observation.toolKey,
    recordEvaluation: observation.recordEvaluation,
    restrictedDecision: decision,
  });
  const named = restrictedDenialWithRecordNaming(interpretation, decision);
  const survivor = named.reason === "rejected_approval_record_survivor";
  return {
    code: named.reason,
    originCategory,
    ...(survivor ? { seam: "record-reset" as const } : {}),
    ...(named.blockedPair
      ? { capability: named.blockedPair.capability, route: named.blockedPair.route }
      : {}),
    ...(named.tableRowId !== undefined ? { tableRowId: named.tableRowId } : {}),
  };
}

/**
 * The composition proper (steps 1-5 in `ENFORCEMENT_COMPOSITION` order).
 * Steps 1-3 delegate to 14a's single entry decision; the wiring only
 * assembles the fresh observation, clamps pending-adapter outcomes, routes
 * destructive-shaped calls to step 4, and runs the advisory record
 * interpretation LAST (step 5) — records can rename a denial's report, never
 * move its outcome.
 */
export function composeRestrictedToolCall(
  observation: ToolCallObservation,
): EnforcementOutcome {
  const origin = observation.registryObservation.recordedOrigin;
  const provenance = composeFreshProvenance(observation);
  const request: RestrictedToolDecisionRequest = {
    toolName: observation.toolName,
    provenance,
    inputShape: observation.decodedInputShape,
    ...(observation.deviceSurface !== undefined
      ? { deviceSurface: observation.deviceSurface }
      : {}),
    ...(observation.decodedCapability !== undefined
      ? { decodedCapability: observation.decodedCapability }
      : {}),
  };

  // Steps 1-3: inventory (default-deny by absence + named surfaces), live
  // provenance, and alternate-route pair screening — all inside 14a's one
  // entry decision; this handler adds no table of its own.
  const decision = decideRestrictedTool(request);
  const originCategory = origin.origin;

  if (decision.outcome === "deny") {
    if (decision.pending === "re-observe") {
      // Stale epoch / generation: bounded re-observe denial naming WHICH
      // freshness element lags. Admission is possible only on fresh data,
      // and the advisory records cannot soften a freshness denial.
      return blocked({
        code: "rejected_stale_observation",
        staleElement: origin.origin === "operator-mcp" ? "registry-epoch" : "resource-generation",
        originCategory,
        ...(decision.tableRowId !== undefined ? { tableRowId: decision.tableRowId } : {}),
      });
    }
    return blocked(finalizeDenialError(decision, observation, originCategory));
  }

  if (decision.outcome === "allow-gated-pending-adapter") {
    // Wiring clamp: pending transport adapters NEVER reach native transport.
    return blocked({
      code: "rejected_pending_adapter",
      seam: "pending-adapter",
      capability: INPUT_SHAPE_CAPABILITIES[observation.decodedInputShape],
      tableRowId: decision.tableRowId,
    });
  }

  if (decision.outcome === "routed-destructive") {
    // Step 4.
    return decideDestructive(observation);
  }

  if (decision.outcome === "routed-provenance") {
    // Post-start MCP admission re-invoked for the fresh epoch (no
    // elicitation, no one-shot ack): 14a's admission view of the SAME entry
    // decision — no second admission path.
    const admission = decideMcpAdmission(request);
    if (admission.admit) {
      return { proceed: true, completingAuthority: "mcp-client-ownership", mcpAdmitted: true };
    }
    return blocked(mcpAdmissionDenialBlock(originCategory, admission));
  }

  // allow-gated / routed-filesystem-sink / in-session-state-only: proceed to
  // the NAMED completing authority only; the handler asserts no authorization.
  return { proceed: true, completingAuthority: decision.completingAuthority };
}

/**
 * The routed-provenance denial mapping (wiring shape over 14a's admission
 * verdict, `seam=mcp-admission-basis`). Exported so consumers/tests can pin
 * the block shape for every admission-denial variant — including the
 * defensive re-observe and fallthrough shapes that the live entry decision
 * cannot currently produce (14a replays the SAME decision, so compose only
 * reaches them as fail-closed defense in depth).
 */
export function mcpAdmissionDenialBlock(
  originCategory: ProvenanceRecord["origin"],
  admission: McpAdmissionDecision & { admit: false },
): EnforcementError {
  if (admission.pending === "re-observe") {
    return {
      code: "rejected_stale_observation",
      staleElement: "registry-epoch",
      originCategory,
      seam: "mcp-admission-basis",
    };
  }
  return {
    code: admission.reason,
    originCategory,
    seam: "mcp-admission-basis",
    ...(admission.blockedPair
      ? { capability: admission.blockedPair.capability, route: admission.blockedPair.route }
      : {}),
    ...(admission.tableRowId !== undefined ? { tableRowId: admission.tableRowId } : {}),
  };
}

/**
 * The handler entry. The first statement re-verifies the module's own
 * observed process identity and fails closed on a non-restricted identity —
 * no composition dispatches from a process that is not the restricted one.
 */
export function createRestrictedToolCallHandler(
  deps: EnforcementDeps,
): RestrictedToolCallHandler {
  return function handleRestrictedToolCall(
    input: RestrictedToolCallInput,
  ): EnforcementOutcome {
    if (deps.selfIdentity.mode !== "restricted") {
      const error: EnforcementError = { code: "rejected_enforcement_seam", seam: "seam-table" };
      deps.surfaceError(formatEnforcementError(error));
      return { block: true, error };
    }
    try {
      // Fresh per-call observation: live origin, live epoch, live resource
      // generation — read NOW, never remembered from any earlier call.
      const outcome = composeRestrictedToolCall(observeCall(deps, input));
      if ("block" in outcome && outcome.block) {
        // Ordinary bounded failed-tool-call error on the pinned surface;
        // NEVER a permission request, NEVER elicitation, and never fed to
        // the retry-permission-rejection buffer (which lives daemon-side in
        // ChatbotClient and is not reachable from this process).
        deps.surfaceError(formatEnforcementError(outcome.error));
      }
      return outcome;
    } catch {
      // Fail closed at the seam: a composition error surfaces the pinned
      // fail-closed block. There is NO catch-and-continue path — the call is
      // blocked, and the pinned emitToolCall contract carries the failure.
      const error: EnforcementError = { code: "rejected_enforcement_seam", seam: "seam-table" };
      deps.surfaceError(formatEnforcementError(error));
      return { block: true, error };
    }
  };
}

/** Fresh owned-extension provenance record from the observer seam. */
export function ownedProvenanceFrom(
  observer: LiveToolMetadataObserver,
  canonicalTarget: CanonicalTarget | undefined,
): ProvenanceRecord {
  const owning = observer.owningModule();
  return {
    origin: "owned-extension",
    modulePath: owning.modulePath,
    baseRoot: owning.baseRoot,
    ...(canonicalTarget !== undefined ? { canonicalTarget } : {}),
    mode: "restricted",
    observedResourceGeneration: owning.resourceGeneration,
    currentResourceGeneration: observer.observeResourceGeneration(),
  };
}
