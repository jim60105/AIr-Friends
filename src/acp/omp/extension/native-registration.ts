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
 * the pinned `getAllTools()`-shaped configured-tool roster — a fresh
 * snapshot per observation — and each entry's RECORDED `sourceInfo` is
 * translated to the canonical `ProvenanceRecord` here. Only host-runtime
 * metadata (never model input) is trusted: an `extension`-sourced entry is
 * owned ONLY when its file is positively identified — the contracted
 * deployment-tree path under the observed base root, or this module's OWN
 * loaded file (the C3 single generated bundle) inside the observed owned
 * base root — and records owned-extension provenance with its ACTUAL
 * identity, never relabelled as a builtin; `mcp__`-prefixed `mcp`-sourced
 * entries record operator-MCP with the admission basis 14a still re-decides
 * per call; `builtin`/`sdk` record host; a missing, ambiguous
 * (duplicate same-name), or unrecognized source records
 * unowned-discovery, which the inventory/provenance steps deny before
 * dispatch. An unavailable/throwing roster yields an EMPTY snapshot — the
 * surface itself fails closed, so the removed empty-registry PRODUCTION
 * default cannot be reintroduced by omission: with no native roster, every
 * call reads unowned and denies.
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
import { evaluateOwnedModuleOwnership } from "./ownership.ts";
import type { CanonicalTarget, ProvenanceRecord } from "./_daemon/mod.ts";
import { createReadReplacementToolDefinition } from "./read-replacement.ts";
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
}

/** The pinned `ctx` surface exposing the fresh configured-tool roster. */
export interface NativeToolContext {
  getAllTools?(): NativeToolInfo[] | undefined;
}

/**
 * The pinned `ExtensionAPI` structural subset this extension touches:
 * synchronous `tool_call` registration, `registerTool` name replacement,
 * and the fresh-configured-tools `ctx` surface. Extra host fields are
 * ignored; nothing here may assume more than these members exist.
 */
export interface NativeExtensionApi {
  on(
    event: "tool_call",
    handler: (event: NativeToolCallEvent) => NativeToolCallEventResult | undefined | void,
  ): void;
  registerTool(tool: NativeToolDefinitionLike): void;
  readonly ctx?: NativeToolContext;
}

/** The tool-call event/result shapes are owned by `native-events.ts`. */
export type { NativeToolCallEvent, NativeToolCallEventResult };

// ---------------------------------------------------------------------------
// Fresh native sourceInfo → canonical provenance adapter (task 1.2).
// ---------------------------------------------------------------------------

/** Owned-module identity the adapter verifies recorded `extension` sources against. */
export interface NativeOwnedIdentity {
  /** Observed deployment base root (row 9's `{baseRoot}`). */
  readonly baseRoot: string;
  /** The module's own loaded file URL (production: the single generated bundle). */
  readonly moduleUrl: string;
  /** Contracted development-tree path, relative to the base root. */
  readonly contractedRelative: string;
  /** Row 12's session resource generation getter. */
  readonly resourceGeneration: () => string;
  /** Trusted acquired-session canonical observation (absent ⇒ lexical identity only). */
  readonly canonicalTarget?: CanonicalTarget;
}

/** File URL → filesystem path (runtime-supported reader only; no Deno-only API at module scope). */
export function nativeFileUrlToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}

function normalizeNativeModulePath(value: string): string {
  const trimmed = value.trim();
  const source = /^file:\/\//.test(trimmed) ? nativeFileUrlToPath(trimmed) : trimmed;
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

function withinBaseRoot(path: string, baseRoot: string): boolean {
  const normalizedRoot = baseRoot.replace(/\/+$/, "");
  if (normalizedRoot === "") return false;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
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
 * Translate one fresh configured-tool entry into the RECORDED provenance
 * side of the wiring observation. Fail-closed by construction: anything the
 * host metadata cannot positively classify records unowned-discovery, and
 * 14a's inventory/provenance steps deny before dispatch. The recorded
 * freshness halves ride the surface's first-observation CAPTURE for this
 * exact sourceInfo spelling — the composition recomputes the CURRENT half
 * live per call (`composeFreshProvenance`), so a resource-generation bump
 * or registry movement since the tool was first seen reads stale and
 * denies before dispatch. The stamp records WHEN the surface saw the tool,
 * never a durable admission.
 */
export function translateNativeSourceInfo(
  name: string,
  sourceInfo: NativeToolSourceInfo | null | undefined,
  owned: NativeOwnedIdentity,
  capture: NativeObservationCapture,
): ProvenanceRecord {
  const unowned: ProvenanceRecord = { origin: "unowned-discovery", presentedName: name };
  if (sourceInfo === null || sourceInfo === undefined || typeof sourceInfo !== "object") {
    return unowned;
  }
  switch (sourceInfo.source) {
    case "builtin":
    case "sdk":
      // Host-owned surfaces are the `host` category — never admitted, and
      // owned replacements are NEVER relabelled into this category (C4
      // spec: owned tools keep their actual extension origin).
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
      const ownModulePath = normalizeNativeModulePath(owned.moduleUrl);
      const contractedPath = normalizeNativeModulePath(
        `${owned.baseRoot.replace(/\/+$/, "")}/${
          owned.contractedRelative.replace(/^\/+/, "")
        }`,
      );
      // Positive identity only: the contracted deployment-tree file, or
      // this module's OWN loaded file (the C3 single generated bundle —
      // `import.meta.url` is the module's own runtime identity, not a
      // claim) sitting inside the base root observed from this process's
      // own launch identity. A trusted canonical session observation, when
      // present, owns the final verdict through the row-2 verifier.
      const isContracted = contractedPath !== "" && extensionPath === contractedPath;
      const isOwnLoadedBundle = ownModulePath !== "" && extensionPath === ownModulePath &&
        withinBaseRoot(extensionPath, owned.baseRoot);
      if (!isContracted && !isOwnLoadedBundle) return unowned;
      if (owned.canonicalTarget !== undefined) {
        const ownership = evaluateOwnedModuleOwnership(extensionPath, {
          baseRoot: owned.baseRoot,
          mode: "restricted",
          canonicalTarget: owned.canonicalTarget,
          closureRoots: [owned.baseRoot],
        });
        if (!ownership.trusted) return unowned;
      }
      return {
        origin: "owned-extension",
        modulePath: extensionPath,
        baseRoot: owned.baseRoot,
        mode: "restricted",
        observedResourceGeneration: capture.observedGeneration,
        currentResourceGeneration: capture.observedGeneration,
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
  owned: NativeOwnedIdentity,
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
      observedGeneration: owned.resourceGeneration(),
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
      const counts: Record<string, number> = {};
      for (const tool of roster) {
        if (typeof tool?.name === "string") counts[tool.name] = (counts[tool.name] ?? 0) + 1;
      }
      const snapshots: ToolMetadataSnapshot[] = [];
      for (const tool of roster) {
        const name = tool?.name;
        if (typeof name !== "string" || name === "") continue;
        const spellingKey = JSON.stringify(tool.sourceInfo ?? null);
        const origin: ProvenanceRecord = (counts[name] ?? 0) > 1
          ? { origin: "unowned-discovery", presentedName: name }
          : translateNativeSourceInfo(name, tool.sourceInfo, owned, captureFor(name, spellingKey));
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
  /** The module's own loaded file URL (production: the generated bundle). */
  readonly moduleUrl: string;
  /** Contracted development-tree path (OMP_TRUSTED_EXTENSION_PATH value). */
  readonly contractedRelative: string;
  /** Controlled replacement definitions (C2 read + web_search); restricted branch only. */
  readonly replacementTools: readonly NativeToolDefinitionLike[];
  /** Bounded diagnostic sink (row 12 posture). */
  readonly surfaceError?: (message: string) => void;
}

/** Row 9's mode-distinct launch cwd is `{baseRoot}/omp-agent/{mode}/cwd`. */
export function baseRootFromLaunchCwd(observedCwd: string): string {
  if (!observedCwd.includes("/omp-agent/")) return observedCwd;
  return observedCwd.replace(/\/omp-agent\/[^/]+\/cwd\/?$/, "");
}

/**
 * The factory-evaluation registration site: SYNCHRONOUSLY registers the
 * restricted enforcement callback and the controlled replacement tools
 * through the pinned native API. The restricted/YOLO branch stays keyed on
 * the module's OWN observed launch identity; the YOLO/unidentified branch
 * registers NOTHING at all (structural exemption, row 8/9 posture, C4 spec
 * scenario 2). The native `ctx` roster surface feeds the fresh-registry
 * observation; an absent `ctx` leaves the roster unavailable, which reads
 * every tool unowned — fail closed.
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
  const baseRoot = baseRootFromLaunchCwd(deps.observedCwd);
  const owned: NativeOwnedIdentity = {
    baseRoot,
    moduleUrl: deps.moduleUrl,
    contractedRelative: deps.contractedRelative,
    resourceGeneration: deps.resourceGeneration,
    ...(deps.sessionContext?.canonicalTarget !== undefined
      ? { canonicalTarget: deps.sessionContext.canonicalTarget }
      : {}),
  };
  const readAllTools = (): NativeToolInfo[] | undefined => {
    const ctx = api.ctx;
    if (ctx && typeof ctx.getAllTools === "function") return ctx.getAllTools();
    return undefined;
  };
  const surface = createNativeRegistrySurface(readAllTools, owned);
  // The handler-side observer rides the SAME surface epoch the recorded
  // stamps were taken from: observed/current freshness can never desync
  // into a stale-forever denial on a stable roster, and a mid-session
  // foreign same-name replacement moves the roster (and every recorded
  // epoch stamp with it) exactly once — per the shared freshness rules.
  const observer = createNativeLiveObserver(surface, deps.resourceGeneration, () => ({
    modulePath: deps.moduleUrl,
    baseRoot,
    resourceGeneration: deps.resourceGeneration(),
    ...(deps.sessionContext?.canonicalTarget !== undefined
      ? { canonicalTarget: deps.sessionContext.canonicalTarget }
      : {}),
  }));
  // The registrar seam is reused PURELY as the synchronous attach channel
  // for the identity-re-verifying handler factory; the "slot" here is a
  // local capture — the module-global registration record is gone.
  let handler: RestrictedToolCallHandler | undefined;
  const localCapture: ToolCallSlotRegistrar = {
    registerRestrictedToolCall: (attached) => {
      handler = attached;
    },
  };
  registerRestrictedEnforcement(localCapture, {
    selfIdentity: { mode: "restricted" },
    observer,
    surfaceError,
  } satisfies EnforcementDeps);
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

/** The C2 controlled replacement definitions, built for native registration. */
export function nativeReplacementTools(): readonly NativeToolDefinitionLike[] {
  return [createReadReplacementToolDefinition(), createSearchReplacementToolDefinition()];
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
