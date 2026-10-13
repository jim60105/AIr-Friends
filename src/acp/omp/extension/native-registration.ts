/**
 * Native `ExtensionAPI` Registration Adapter (C4,
 * `wire-omp-native-extension-api`).
 *
 * Replaces the row-16 factory-return/private-slot convention with the REAL
 * pinned native contract (v18.6.1, `extensibility/extensions/types.ts` +
 * `runner.ts` at the pin): the loader evaluates the default export as a
 * factory, AWAITS it, and DISCARDS its return value — the only enforcement
 * surface the binary honors is `api.on("tool_call", handler)` (every tool
 * call passes through `emitToolCall` BEFORE execution; a returned
 * `{block:true, reason}` blocks dispatch) and `api.registerTool(definition)`
 * (name replacement, last-extension-wins). Registration therefore happens
 * SYNCHRONOUSLY during factory evaluation here.
 *
 * Branch discipline is unchanged from row 16: the restricted/native-YOLO
 * split is keyed on the module's OWN observed launch identity (row 9's
 * mode-distinct launch cwd), and the YOLO/unidentified branch registers
 * NOTHING — the exemption stays structural at the registration site.
 *
 * Fresh-origin provenance (task 1.2): the production registry surface is
 * the pinned API's DIRECT `getAllTools()` method (the runtime's action
 * method, a throwing stub until initialization) — a fresh snapshot per
 * observation — and each entry's RECORDED `sourceInfo` is translated to the
 * canonical `ProvenanceRecord` here. The method is captured at factory
 * evaluation and invoked ONLY on live observations, so a load-time stub can
 * never be called and registration never needs the roster. Only
 * host-runtime metadata (never model input) is trusted: an
 * `extension`-sourced entry is owned ONLY when its file is positively
 * identified — it IS the exact declared deployment artifact this process
 * loaded AND that artifact's physical evidence re-verifies against the
 * accepted anchor right now (`bind-omp-owned-module-evidence`: the mutable
 * launch-state base root and any session-role canonical observation no longer
 * stand in for module identity) — and records owned-extension provenance with
 * its ACTUAL identity, never relabelled as a builtin;
 * `mcp__`-prefixed `mcp`-sourced entries record operator-MCP with the
 * admission basis 14a still re-decides per call; a `builtin`-sourced entry
 * admits as `native-builtin` ONLY when it presents the exact pinned runtime
 * tuple for that name (`<builtin:name>` / `temporary` / `top-level`, see
 * `NATIVE_BUILTIN_SOURCE_*`); `sdk` (RPC-host injection) records host, and
 * any builtin-looking entry that does not present the exact tuple records
 * unowned-discovery; a missing, ambiguous (duplicate same-name), or
 * unrecognized source records unowned-discovery too, which the
 * inventory/provenance steps deny before dispatch. An
 * unavailable/throwing roster yields an EMPTY snapshot — the surface itself
 * fails closed, so the removed empty-registry PRODUCTION default cannot be
 * reintroduced by omission: with no native roster, every call reads unowned
 * and denies.
 *
 * Honesty posture (design §15, unchanged): nothing here demonstrates the
 * official binary invokes, honors, or enforces anything — API-shaped
 * fixtures exercise the callbacks; native load-evidence stays user-owned
 * runtime verification, and no readiness handshake exists.
 */

import {
  type EnforcementError,
  type EnforcementOutcome,
  formatEnforcementError,
  type LiveToolMetadataObserver,
  type NetworkAdmissionObservation,
  type OwningModuleObservation,
} from "./enforcement-error.ts";
import {
  type EnforcementDeps,
  type EnforcementLaunchMode,
  observeLaunchMode,
  registerNativeYoloNoop,
  registerRestrictedEnforcement,
  type RestrictedToolCallHandler,
  type ToolCallSlotRegistrar,
  type ToolMetadataSnapshot,
} from "./enforcement.ts";
import {
  createOwnedModuleEvidenceSource,
  evaluateOwnedModuleOwnership,
  type OwnedModuleEvidenceSource,
  type OwnedModuleFreshness,
} from "./ownership.ts";
import {
  credentialPresenceFromEnv,
  evaluateToolProvenance,
  NATIVE_BUILTIN_SOURCE_ORIGIN,
  NATIVE_BUILTIN_SOURCE_SCOPE,
  nativeBuiltinSourcePath,
  type ProvenanceRecord,
  type SearchCredentialPresence,
} from "./_daemon/mod.ts";
import { moduleUrlToPath } from "../deployment-module.ts";
import {
  createOwnedSkillUriAuthorization,
  createReadReplacementToolDefinition,
} from "./read-replacement.ts";
import { OMP_IMAGE_SKILLS_ROOT } from "../../../utils/omp-paths.ts";
import { createSearchReplacementToolDefinition } from "./search-replacement.ts";
import {
  decodeNativeToolCallEvent,
  NATIVE_EVENT_DECODE_SEAM,
  type NativeSessionContext,
  type NativeToolCallEvent,
  type NativeToolCallEventResult,
} from "./native-events.ts";

// ---------------------------------------------------------------------------
// Pinned native API shapes (structural subset of types.ts at the pin).
// ---------------------------------------------------------------------------

/** The pinned tool-source classification (`sourceInfo` at the pin). */
export interface NativeToolSourceInfo {
  readonly path?: string;
  readonly source?: string;
  readonly scope?: string;
  readonly origin?: string;
}

/** One configured-tool entry from the pinned `getAllTools()` surface. */
export interface NativeToolInfo {
  readonly name?: string;
  readonly sourceInfo?: NativeToolSourceInfo | null;
}

/** The pinned `ToolDefinition`-shaped replacement record (execute signature per S7). */
export interface NativeToolDefinitionLike {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  /**
   * The pinned native skill-reading capability flag
   * (`repair-omp-owned-skill-handoff` D3): the host grants skill-URI reads
   * to a registered tool only when its definition declares it. The `read`
   * replacement declares it so the owned `skill://` branch it authorizes
   * reaches the same tool at all; other replacements stay undeclared.
   */
  readonly readsSkillUris?: boolean;
  /**
   * The pinned S7 execute signature. The host calls a registered tool's
   * `execute`; the `read` replacement reaches its authorized skill branch
   * through the same-tool `invokeTool` delegation context, so the contract
   * declares that much of the host `ctx` (extra fields are the host's).
   */
  execute?(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate?: unknown,
    ctx?: {
      invokeTool?(
        params: Record<string, unknown>,
        options?: { readonly signal?: AbortSignal },
      ): Promise<unknown>;
    },
  ): Promise<unknown>;
}

/**
 * The pinned `ExtensionAPI` structural subset this extension touches:
 * synchronous `tool_call` registration, `registerTool` name replacement,
 * and the DIRECT `getAllTools()` configured-tool registry method
 * (`extensibility/extensions/types.ts` at the pin). Extra host fields are
 * ignored; nothing here may assume more than these members exist, and no
 * nested `ctx` roster surface exists at the pin.
 */
export interface NativeExtensionApi {
  on(
    event: "tool_call",
    handler: (event: NativeToolCallEvent) => NativeToolCallEventResult | undefined | void,
  ): void;
  registerTool(tool: NativeToolDefinitionLike): void;
  /**
   * The pinned DIRECT runtime action method. It THROWS (runtime-not-
   * initialized) until the host initializes the action set, so it is
   * captured at factory evaluation and invoked only on live observations.
   */
  readonly getAllTools?: () => NativeToolInfo[];
}

/** The tool-call event/result shapes are owned by `native-events.ts`. */
export type { NativeToolCallEvent, NativeToolCallEventResult };

// ---------------------------------------------------------------------------
// Fresh native sourceInfo → canonical provenance adapter (task 1.2).
// ---------------------------------------------------------------------------

function normalizeNativeModulePath(value: string): string {
  const trimmed = value.trim();
  const source = /^file:\/\//.test(trimmed) ? moduleUrlToPath(trimmed) : trimmed;
  if (!source.startsWith("/")) return "";
  const segments: string[] = [];
  for (const part of source.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return "";
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return `/${segments.join("/")}`;
}

/** The pinned `mcp__` client-tool name prefix (tools/builtin-names.ts at the pin). */
export const MCP_TOOL_NAME_PREFIX = "mcp__";

/** Per-name first-observation capture the recorded freshness halves ride. */
interface NativeObservationCapture {
  /** JSON of the sourceInfo spelling this capture was taken for. */
  readonly key: string;
  readonly observedEpoch: number;
  readonly observedGeneration: string;
}

/**
 * One live roster read's observation stamp: the surface epoch and row 12's
 * resource generation as they were at the instant the roster was read.
 * `native-builtin` records are stamped from THIS (the read that produced
 * their identity), never from a first-sighting capture: the runtime derives
 * a builtin's identity from the session's own builtin membership on every
 * read, so the fresh read IS the authoritative observation and a later
 * unrelated roster movement must not stale a builtin whose tuple is
 * unchanged. Replacement invalidation is carried by the identity itself (a
 * same-name replacement loses builtin membership and therefore presents a
 * different source tuple, which denies).
 */
export interface NativeObservationStamp {
  readonly epoch: number;
  readonly generation: string;
}

/**
 * Translate one fresh configured-tool entry into the RECORDED provenance
 * side of the wiring observation. Fail-closed by construction: anything the
 * host metadata cannot positively classify records unowned-discovery, and
 * 14a's inventory/provenance steps deny before dispatch. The recorded
 * freshness halves ride the surface's first-observation CAPTURE for this
 * exact sourceInfo spelling — the composition recomputes the CURRENT half
 * live per call (`composeFreshProvenance`), so a resource-generation bump
 * or registry movement since the tool was first seen reads stale and
 * denies before dispatch. `native-builtin` is the one origin stamped from
 * the CURRENT observation (`current`) instead of the first-sighting capture,
 * per the boundary statement on `NativeBuiltinProvenance`. The stamp records
 * WHEN the surface saw the tool, never a durable admission.
 *
 * `owned-extension` (`bind-omp-owned-module-evidence`) is stamped from the
 * SAME live read: the entry is owned only when it IS the declared deployment
 * artifact this process loaded AND that artifact's physical evidence
 * re-verifies against the accepted anchor at this instant. Its recorded epoch
 * pair and generation pair therefore come from this one observation, and the
 * full module observation rides the record so the pure provenance decision can
 * re-decide ownership without any session identity.
 */
export function translateNativeSourceInfo(
  name: string,
  sourceInfo: NativeToolSourceInfo | null | undefined,
  moduleEvidence: OwnedModuleEvidenceSource,
  capture: NativeObservationCapture,
  current: NativeObservationStamp,
): ProvenanceRecord {
  const unowned: ProvenanceRecord = { origin: "unowned-discovery", presentedName: name };
  if (sourceInfo === null || sourceInfo === undefined || typeof sourceInfo !== "object") {
    return unowned;
  }
  switch (sourceInfo.source) {
    case "builtin": {
      // Authentic native builtin only (task 1.2). The pinned runtime produces
      // `source: "builtin"` from the session's OWN builtin name set and pairs
      // it with the synthetic `<builtin:name>` path, `temporary` scope and
      // `top-level` origin; that tuple is SELF-CONSISTENT WITH THE NAME, so a
      // builtin-labelled entry naming another tool's path/spelling is not an
      // authentic builtin and records unowned-discovery (denied). SDK/RPC-host
      // injection cannot reach this branch: it reports `source: "sdk"`.
      const builtinPath = String(sourceInfo.path ?? "");
      if (
        builtinPath !== nativeBuiltinSourcePath(name) ||
        sourceInfo.scope !== NATIVE_BUILTIN_SOURCE_SCOPE ||
        sourceInfo.origin !== NATIVE_BUILTIN_SOURCE_ORIGIN
      ) {
        return unowned;
      }
      return {
        origin: "native-builtin",
        sourcePath: builtinPath,
        sourceScope: NATIVE_BUILTIN_SOURCE_SCOPE,
        sourceOrigin: NATIVE_BUILTIN_SOURCE_ORIGIN,
        // Both halves are the CURRENT read: the roster entry above was read
        // live, and `composeFreshProvenance` re-reads the same live state for
        // the current half at decision time.
        registryEpochObserved: current.epoch,
        currentRegistryEpoch: current.epoch,
        observedResourceGeneration: current.generation,
        currentResourceGeneration: current.generation,
      };
    }
    case "sdk":
      // RPC-host injection is the `host` category — never admitted, and owned
      // replacements are NEVER relabelled into this category (C4 spec: owned
      // tools keep their actual extension origin).
      return { origin: "host", presentedName: name };
    case "mcp": {
      if (!name.startsWith(MCP_TOOL_NAME_PREFIX)) return unowned;
      // Operator-configured MCP client tool: recorded as operator-MCP on
      // the host-metadata basis only; 14a's admission basis
      // (needs-mechanism-audit) still re-decides every call on the fresh
      // wiring-owned epoch — the recorded stamp can never outrun it.
      return {
        origin: "operator-mcp",
        clientMcpOwnership: true,
        registryEpochObserved: capture.observedEpoch,
        currentRegistryEpoch: capture.observedEpoch,
      };
    }
    case "extension": {
      const extensionPath = normalizeNativeModulePath(String(sourceInfo.path ?? ""));
      if (extensionPath === "") return unowned;
      // The replacement must BE the declared deployment artifact this process
      // itself loaded, and that artifact's physical evidence must re-verify
      // against the accepted anchor RIGHT NOW. There is no lexical fallback:
      // the base-root-relative `.ts` source path and any arbitrary
      // module-parent directory confer nothing (design: never infer an owned
      // root from a loaded module's directory), and no session identity
      // substitutes for the physical observation.
      const observation = moduleEvidence.observe({
        resourceGeneration: current.generation,
        registryEpoch: current.epoch,
      });
      if (observation === undefined) return unowned;
      if (
        extensionPath !== observation.presentedArtifactPath &&
        extensionPath !== observation.canonicalArtifactPath
      ) {
        return unowned;
      }
      const ownership = evaluateOwnedModuleOwnership(observation.artifact.path, {
        declaration: observation.declaration,
        observation,
      });
      if (!ownership.trusted) return unowned;
      return {
        origin: "owned-extension",
        modulePath: extensionPath,
        moduleEvidence: observation,
        // BOTH halves come from the same live read that produced the physical
        // observation; `composeFreshProvenance` re-reads the current halves at
        // decision time, so a generation bump or roster movement since this
        // read reads stale and denies.
        registryEpochObserved: current.epoch,
        currentRegistryEpoch: current.epoch,
        observedResourceGeneration: observation.resourceGeneration,
        currentResourceGeneration: observation.resourceGeneration,
      };
    }
    default:
      return unowned;
  }
}

/**
 * The PRODUCTION live registry surface: every observation re-reads the
 * native configured-tool roster (`getAllTools()`-shaped, fresh per call)
 * and translates each RECORDED `sourceInfo` now. The surface carries its
 * OWN epoch domain — it advances exactly when the RAW roster moved
 * (names + sourceInfo), so stamped epochs and the wiring epoch advance in
 * lockstep and a stable registry never re-stamps. A throwing/unavailable
 * roster yields an empty snapshot: every tool reads unowned and denies —
 * there is no empty-registry admit anywhere. Duplicate same-name entries
 * are ambiguous registrations: recorded unowned, never first-wins or
 * last-wins guessing.
 *
 * Freshness capture: each distinct (name, sourceInfo spelling) records the
 * epoch/generation captured when the surface FIRST saw that spelling; the
 * composition recomputes both CURRENT halves live per call, so a
 * resource-generation bump or any roster movement after the entry was
 * first observed reads stale and denies before dispatch. Movement never
 * silently re-freshens an older observation — re-observation is the
 * next session's job, not a mid-session relabel.
 */
export function createNativeRegistrySurface(
  getAllTools: () => NativeToolInfo[] | undefined,
  moduleEvidence: OwnedModuleEvidenceSource,
  resourceGeneration: () => string,
): { snapshot(): readonly ToolMetadataSnapshot[]; epoch(): number } {
  let epoch = 0;
  let lastRosterKey: string | undefined;
  const captures = new Map<string, NativeObservationCapture>();
  const captureFor = (key: string, spellingKey: string): NativeObservationCapture => {
    const existing = captures.get(key);
    if (existing !== undefined && existing.key === spellingKey) return existing;
    const fresh: NativeObservationCapture = {
      key: spellingKey,
      observedEpoch: epoch,
      observedGeneration: resourceGeneration(),
    };
    captures.set(key, fresh);
    return fresh;
  };
  return {
    snapshot() {
      let tools: NativeToolInfo[] | undefined;
      try {
        tools = getAllTools();
      } catch {
        tools = undefined;
      }
      const roster = Array.isArray(tools) ? tools : [];
      const rosterKey = JSON.stringify(
        roster.map((tool) => [tool?.name ?? "", tool?.sourceInfo ?? null]),
      );
      if (lastRosterKey !== undefined && rosterKey !== lastRosterKey) epoch += 1;
      lastRosterKey = rosterKey;
      // One stamp for THIS read: the epoch after the movement check plus row
      // 12's current generation. `native-builtin` records carry it as both
      // freshness halves; every other origin keeps its first-sighting capture.
      const stamp: NativeObservationStamp = { epoch, generation: resourceGeneration() };
      // Map (never a plain object): a roster name like `constructor` or
      // `__proto__` must NOT read/write through Object.prototype — an
      // inherited member silently defeats the duplicate-name guard and
      // degrades ambiguity to first-wins guessing.
      const counts = new Map<string, number>();
      for (const tool of roster) {
        if (typeof tool?.name === "string") {
          counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
        }
      }
      const snapshots: ToolMetadataSnapshot[] = [];
      for (const tool of roster) {
        const name = tool?.name;
        if (typeof name !== "string" || name === "") continue;
        const spellingKey = JSON.stringify(tool.sourceInfo ?? null);
        const origin: ProvenanceRecord = (counts.get(name) ?? 0) > 1
          ? { origin: "unowned-discovery", presentedName: name }
          : translateNativeSourceInfo(
            name,
            tool.sourceInfo,
            moduleEvidence,
            captureFor(name, spellingKey),
            stamp,
          );
        snapshots.push({ toolName: name, origin });
      }
      return snapshots;
    },
    /** Fresh read of the surface's own roster-movement epoch. */
    epoch() {
      if (lastRosterKey === undefined) this.snapshot();
      return epoch;
    },
  };
}

/**
 * The handler-side live observer over the native surface: origin, epoch,
 * and generation all read the SAME live state on every consult, and the
 * operator-MCP stamp domain IS the surface epoch, so observed/current
 * freshness comparisons never desync into a stale-forever denial. The
 * row-16 `RegistryEpochObserver` remains the fixture-domain observer; the
 * production roster carries its own movement counter.
 */
export function createNativeLiveObserver(
  surface: { snapshot(): readonly ToolMetadataSnapshot[]; epoch(): number },
  generation: () => string,
  owning: () => OwningModuleObservation,
): LiveToolMetadataObserver {
  return {
    observeOrigin: (toolName) => {
      for (const entry of surface.snapshot()) {
        if (entry.toolName === toolName) return entry.origin;
      }
      return { origin: "unowned-discovery", presentedName: toolName };
    },
    observeRegistryEpoch: () => surface.epoch(),
    observeResourceGeneration: () => generation(),
    owningModule: () => owning(),
  };
}

// ---------------------------------------------------------------------------
// Enforcement outcome → native result mapping (spec scenario 1).
// ---------------------------------------------------------------------------

/** Seam block for an event the pinned decoder cannot represent. */
function nativeSeamBlock(): NativeToolCallEventResult {
  const error: EnforcementError = {
    code: "rejected_enforcement_seam",
    seam: NATIVE_EVENT_DECODE_SEAM,
  };
  return { block: true, reason: formatEnforcementError(error) };
}

/**
 * Map one enforcement outcome onto the pinned `ToolCallEventResult`:
 * every block carries the bounded `formatEnforcementError` reason (never
 * payload) and PREVENTS dispatch; a proceeding outcome returns `undefined`
 * so the native call continues toward its NAMED completing boundary. No
 * block ever returns `undefined` and no unrepresentable event is ever
 * allowed — there is no silently-allow path.
 */
export function mapOutcomeToNativeResult(
  outcome: EnforcementOutcome,
): NativeToolCallEventResult | undefined {
  if ("block" in outcome && outcome.block === true) {
    return { block: true, reason: formatEnforcementError(outcome.error) };
  }
  return undefined;
}

/**
 * The registered `tool_call` callback: decode the native event into the
 * existing restricted-input shape, run the SAME enforcement composer, and
 * convert the outcome to the pinned block/continue result. The composer's
 * own per-call freshness (fresh roster origin, wiring epoch, row 12
 * generation) is untouched here.
 */
export function createNativeToolCallCallback(
  handle: RestrictedToolCallHandler,
  surfaceError: (message: string) => void,
  sessionContext?: NativeSessionContext,
): (event: NativeToolCallEvent) => NativeToolCallEventResult | undefined {
  return (event: NativeToolCallEvent): NativeToolCallEventResult | undefined => {
    try {
      const decoded = decodeNativeToolCallEvent(event, sessionContext);
      if (!decoded.ok) {
        surfaceError(
          formatEnforcementError({ code: "rejected_enforcement_seam", seam: decoded.seam }),
        );
        return nativeSeamBlock();
      }
      return mapOutcomeToNativeResult(handle(decoded.input));
    } catch {
      // Fail closed at the seam (the pinned emitToolCall posture): a
      // decoding or composition throw BLOCKS, never continues.
      surfaceError(
        formatEnforcementError({
          code: "rejected_enforcement_seam",
          seam: NATIVE_EVENT_DECODE_SEAM,
        }),
      );
      return nativeSeamBlock();
    }
  };
}

// ---------------------------------------------------------------------------
// The native registration site (task 1.1).
// ---------------------------------------------------------------------------

/** Native registration outcome record (both branches). */
export interface NativeRegistrationResult {
  readonly registered: boolean;
  readonly mode: EnforcementLaunchMode;
  /** Restricted branch: the registered `tool_call` callback identity. */
  readonly callback?: (event: NativeToolCallEvent) => NativeToolCallEventResult | undefined;
  /** Restricted branch: the controlled replacement names handed to `registerTool`. */
  readonly replacementNames?: readonly string[];
}

/** Dependencies the factory freezes at evaluation time (every field injectable). */
export interface NativeRegistrationDeps {
  readonly observedCwd: string;
  readonly resourceGeneration: () => string;
  /** Trusted acquired-session context; absent in production today ⇒ destructive calls fail closed. */
  readonly sessionContext?: NativeSessionContext;
  /**
   * The module's own loaded file URL (production: the generated bundle). The
   * registration site selects the DECLARED deployment face from it; no cwd,
   * base root or session identity participates in module identity.
   */
  readonly moduleUrl: string;
  /** Controlled replacement definitions (C2 read + web_search); restricted branch only. */
  readonly replacementTools: readonly NativeToolDefinitionLike[];
  /**
   * C5 trusted credential-presence reader (presence booleans ONLY, never
   * values). Invoked per call through the enforcement deps seam — never
   * snapshotted at registration; production default reads the current env.
   */
  readonly searchCredentialPresence?: () => SearchCredentialPresence;
  /** Bounded diagnostic sink (row 12 posture). */
  readonly surfaceError?: (message: string) => void;
  /**
   * Physical deployment-module evidence source. ABSENT means the registration
   * site builds the PRODUCTION producer from `moduleUrl` and the runtime's own
   * metadata reader — the default factory path, which needs no session
   * context, cwd or fixture. API-shaped fixtures may inject their own source
   * and must name that evidence honestly (harness evidence is never native
   * executable evidence).
   */
  readonly moduleEvidence?: OwnedModuleEvidenceSource;
}

/**
 * The network-admission registration half: TRUE only when the LIVE roster
 * record for this exact name is a currently valid owned replacement — the
 * record must be this owned extension AND pass the full provenance decision
 * (allow-table name, physical module evidence against the accepted anchor,
 * and a coherent current epoch/generation pair) on this call's live values.
 * A name-only membership test is deliberately NOT enough: a foreign same-name
 * registration satisfies the name and nothing else, and must never complete a
 * controlled route.
 */
function ownedReplacementRegistrationEvidence(
  toolName: string,
  record: ProvenanceRecord,
  currentResourceGeneration: string,
  currentRegistryEpoch: number,
): boolean {
  if (record.origin !== "owned-extension") return false;
  return evaluateToolProvenance(
    toolName,
    { ...record, currentRegistryEpoch, currentResourceGeneration },
    { nameOnAllowTable: true },
  ).admit;
}

/**
 * The factory-evaluation registration site: SYNCHRONOUSLY registers the
 * restricted enforcement callback and the controlled replacement tools
 * through the pinned native API. The restricted/YOLO branch stays keyed on
 * the module's OWN observed launch identity; the YOLO/unidentified branch
 * registers NOTHING at all (structural exemption, row 8/9 posture, C4 spec
 * scenario 2). The pinned DIRECT `api.getAllTools()` method feeds the
 * fresh-registry observation: it is CAPTURED here (synchronously) and
 * invoked only from live observations, because the pinned runtime's action
 * methods throw until initialization. An absent method, or one that throws
 * when invoked before initialization completes, leaves the roster
 * unavailable, which reads every tool unowned — fail closed.
 */
export function registerNativeEnforcement(
  api: NativeExtensionApi,
  deps: NativeRegistrationDeps,
): NativeRegistrationResult {
  const mode = observeLaunchMode(deps.observedCwd);
  if (mode !== "restricted") {
    // Structural exemption: nothing registered, no restricted record load,
    // no replacement tools — identical posture to the row-16 noop branch.
    return registerNativeYoloNoop(mode ?? "native-yolo");
  }
  const surfaceError = deps.surfaceError ??
    ((message: string) => console.error(`[air-friends-trusted-extension] ${message}`));
  // Module identity: the DECLARED deployment face this process's own loaded
  // artifact belongs to, accepted physically HERE (registration time) and
  // re-observed per call. An unrecognized artifact or a failed acceptance
  // leaves `anchor === undefined`, and every owned name then reads
  // unowned-discovery — fail closed, never a manufactured session identity.
  const moduleEvidence = deps.moduleEvidence ??
    createOwnedModuleEvidenceSource({
      moduleUrl: deps.moduleUrl,
      resourceGeneration: deps.resourceGeneration,
    });
  // Capture the DIRECT runtime method at factory evaluation and defer every
  // invocation to a live observation: the pinned runtime's action methods
  // are throwing stubs until the host initializes them (the same runtime
  // object is mutated in place, so this capture reaches the initialized
  // implementation). Registration itself never reads the roster.
  const directGetAllTools = api.getAllTools;
  const readAllTools = (): NativeToolInfo[] | undefined =>
    typeof directGetAllTools === "function" ? directGetAllTools.call(api) : undefined;
  const surface = createNativeRegistrySurface(
    readAllTools,
    moduleEvidence,
    deps.resourceGeneration,
  );
  // The handler-side observer rides the SAME surface epoch the recorded
  // stamps were taken from: observed/current freshness can never desync
  // into a stale-forever denial on a stable roster, and a mid-session
  // foreign same-name replacement moves the roster (and every recorded
  // epoch stamp with it) exactly once — per the shared freshness rules.
  const observer = createNativeLiveObserver(surface, deps.resourceGeneration, () => {
    const observation = moduleEvidence.observe({
      resourceGeneration: deps.resourceGeneration(),
      registryEpoch: surface.epoch(),
    });
    return {
      modulePath: observation?.presentedArtifactPath ?? "",
      ...(observation !== undefined ? { moduleEvidence: observation } : {}),
      resourceGeneration: observation?.resourceGeneration ?? "",
    };
  });
  // The registrar seam is reused PURELY as the synchronous attach channel
  // for the identity-re-verifying handler factory; the "slot" here is a
  // local capture — the module-global registration record is gone.
  let handler: RestrictedToolCallHandler | undefined;
  const localCapture: ToolCallSlotRegistrar = {
    registerRestrictedToolCall: (attached) => {
      handler = attached;
    },
  };
  // C5: the network-admission seam, read FRESH on every call (no cache):
  //   - registration evidence = the ACTUAL fresh owned registration for THIS
  //     exact name, never the name alone: the live roster record must be this
  //     owned extension AND pass the full provenance admission (physical
  //     module evidence against the accepted anchor plus the current
  //     epoch/generation halves) at this instant, so a foreign same-name
  //     registration can never complete a controlled route by shadowing the
  //     name;
  //   - credential presence = the CURRENT trusted presence read (booleans
  //     only — values never enter the observation and are never logged).
  // Availability changing mid-session moves the next call's decision exactly
  // like a roster change moves the epoch: no freeze, no ack, no reset.
  const credentialPresence = deps.searchCredentialPresence ?? credentialPresenceFromEnv;
  const networkAdmission = (toolName: string): NetworkAdmissionObservation => {
    const entry = surface.snapshot().find((candidate) => candidate.toolName === toolName);
    const registeredOwnedReplacement = entry !== undefined &&
      ownedReplacementRegistrationEvidence(
        toolName,
        entry.origin,
        deps.resourceGeneration(),
        surface.epoch(),
      );
    return { registeredOwnedReplacement, searchCredentialPresence: credentialPresence() };
  };
  registerRestrictedEnforcement(
    localCapture,
    {
      selfIdentity: { mode: "restricted" },
      observer,
      networkAdmission,
      surfaceError,
    } satisfies EnforcementDeps,
  );
  if (handler === undefined) {
    throw new Error("native registration: restricted handler was not produced");
  }
  const callback = createNativeToolCallCallback(
    handler,
    surfaceError,
    deps.sessionContext,
  );
  // Native registration proper — these two calls ARE the enforcement
  // surface; no factory return value and no private slot exists anymore.
  api.on("tool_call", callback);
  const replacementNames: string[] = [];
  for (const tool of deps.replacementTools) {
    api.registerTool(tool);
    replacementNames.push(tool.name);
  }
  return { registered: true, mode: "restricted", callback, replacementNames };
}

/**
 * The C2 controlled replacement definitions, built for native registration.
 * `resourceGeneration` (C6): the read replacement's owned skill-URI
 * authorization is wired against the single DECLARED owned source constant
 * (`OMP_IMAGE_SKILLS_ROOT` — never a workspace/HOME/CWD candidate) and the
 * live discovery generation, so a `skill://` read authorizes only against
 * the current declared identity and an off-image host (root absent) simply
 * denies with no fallback root. The search replacement is unchanged.
 */
export function nativeReplacementTools(
  resourceGeneration?: () => string,
): readonly NativeToolDefinitionLike[] {
  return [
    createReadReplacementToolDefinition({
      skillUriAuthorization: createOwnedSkillUriAuthorization({
        ownedRoot: OMP_IMAGE_SKILLS_ROOT,
        resourceGeneration: resourceGeneration ?? (() => ""),
      }),
    }),
    createSearchReplacementToolDefinition(),
  ];
}

/**
 * The single default-factory implementation: the entrypoint's default
 * export and the API-shaped harness fixtures are the SAME function object
 * bound to different dependency sources (the real load-time decision vs.
 * a fixture decision), so fixtures exercise the actual registration path
 * the pinned loader would evaluate, not a lookalike. The entrypoint keeps
 * its fail-closed pre-import gate: the factory only exists behind the
 * module-load throw (row 12), and fixtures name their injected identity
 * honestly — harness evidence is not native executable evidence.
 */
export function createNativeExtensionFactory(
  deps: () => NativeRegistrationDeps,
): (api: NativeExtensionApi) => NativeRegistrationResult {
  return (api: NativeExtensionApi) => registerNativeEnforcement(api, deps());
}
