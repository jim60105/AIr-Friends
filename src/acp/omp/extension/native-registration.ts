/**
 * Official native `ExtensionAPI` registration for the pre-dispatch capability
 * callback.
 *
 * Pinned native contract (OMP v18.6.1 /
 * 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60, `extensibility/extensions/types.ts`):
 * `api.on("tool_call", handler)` registers a SYNCHRONOUS pre-dispatch handler
 * that receives `event.toolName` and may return `{block: true, reason}` to stop
 * the call before it executes. Nothing else is needed: the factory's return
 * value registers nothing, and no registry surface (`getAllTools`,
 * `registerTool`), session acquisition, replacement tool or schema facade is
 * consumed.
 *
 * TWO launches load this ONE generated module, and the launch decides which
 * callback is attached:
 *
 *   - EVERY ordinary launch (restricted mode): the restricted capability
 *     callback, unchanged — mapped native names continue to native dispatch and
 *     unmatched names are blocked with the bounded `rejected_unknown_tool`
 *     reason. Native-YOLO loads no extension at all: its single LSP denial is
 *     native exact-name YAML policy and never reaches this code.
 *   - The INTERNAL email-intent profile (`email-omp-intent-profile`): the
 *     deny-all callback, which blocks EVERY name unconditionally through the
 *     same pinned hook, so known, unknown, deployment-extension and
 *     prototype-shaped names are all stopped before dispatch even without an
 *     ACP permission callback.
 *
 * The launch is distinguished by exactly one host-only marker: the child
 * environment variable {@link OMP_INTENT_PROFILE_FLAG}, which the intent-profile
 * factory sets (`src/acp/agent-factory.ts`) and nothing else in the deployment
 * ever sets — it is not a configuration field, not an `ENV_MAPPINGS` entry and
 * not reachable from a prompt or a tool request (a tool cannot mutate its own
 * engine process's environment), and every ordinary launch builds its child
 * environment from scratch, so no inherited `Deno.env` can leak it in.
 *
 * The classification FAILS CLOSED ({@link observeOmpLaunchMarker}): only a
 * POSITIVELY OBSERVED absent marker is the ordinary launch. When the runtime
 * exposes no readable `process.env` — an environment this module cannot inspect
 * at all — the deny-all callback is attached, because that is the only
 * direction that cannot lose the profile's second enforcement layer: a mistaken
 * deny-all can turn a would-be dispatch into a bounded denial, while a mistaken
 * restricted callback would let `read`/`bash`/`edit` return `continue` on an
 * intent launch. The native exact-name denials of the profile's OWN authored
 * settings document (`agent-config/omp/email-intent.yml`) remain in force
 * either way.
 */

import { decideOmpToolCapability } from "../tool-inventory.ts";

/** The pinned `tool_call` event shape this extension consumes. */
export interface NativeToolCallEvent {
  readonly toolName: string;
}

/** The pinned `tool_call` result shape: `{block: true, reason}` blocks dispatch. */
export interface NativeToolCallEventResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export type NativeToolCallHandler = (
  event: NativeToolCallEvent,
) => NativeToolCallEventResult | undefined;

/** The pinned `ExtensionAPI` structural subset this extension touches. */
export interface NativeExtensionApi {
  on(event: "tool_call", handler: NativeToolCallHandler): void;
}

/**
 * Host-only marker of an email-intent profile launch. Set to
 * {@link OMP_INTENT_PROFILE_FLAG_VALUE} by the profile factory alone; every
 * ordinary launch omits it.
 */
export const OMP_INTENT_PROFILE_FLAG = "OMP_INTENT_PROFILE";

/** The only value that marks an intent-profile launch. */
export const OMP_INTENT_PROFILE_FLAG_VALUE = "1";

/**
 * Bounded, stable reason every intent-profile denial carries. It is a fixed
 * safe code — never tool text, an argument echo or a filesystem path — so the
 * model-facing result cannot leak profile internals.
 */
export const OMP_INTENT_BLOCKED_REASON = "rejected_email_intent_profile";

/**
 * The three observations of the host-only intent marker. `indeterminate` is a
 * launch whose environment cannot be read at all — a state this module treats
 * as an intent launch (see the module header).
 */
export type OmpLaunchMarkerObservation = "intent" | "ordinary" | "indeterminate";

/**
 * Classify one host object (`process`, or an injected stand-in). The shape is
 * narrowed at runtime, never asserted: anything that is not an object carrying
 * an object `env` — including `undefined`, i.e. a runtime with no `process`
 * global — is `indeterminate`, and so is a host whose `env` READ itself throws
 * (an embedded runtime may gate its own environment access). A classification
 * that cannot be observed must never crash the launch, and it must never widen
 * admission: see `createOmpToolCallHandler`.
 */
export function observeOmpLaunchMarker(host: unknown): OmpLaunchMarkerObservation {
  try {
    if (typeof host !== "object" || host === null || !("env" in host)) return "indeterminate";
    const env: unknown = Reflect.get(host, "env");
    if (typeof env !== "object" || env === null) return "indeterminate";
    const marker: unknown = Reflect.get(env, OMP_INTENT_PROFILE_FLAG);
    if (typeof marker !== "string") return "ordinary";
    return marker === OMP_INTENT_PROFILE_FLAG_VALUE ? "intent" : "ordinary";
  } catch {
    return "indeterminate";
  }
}

/**
 * The capability callback: mapped names continue to native dispatch (no
 * repeated native or ACP authorization), every unmatched name is blocked before
 * execution with the bounded unknown-tool reason.
 */
export function createOmpCapabilityToolCallHandler(): NativeToolCallHandler {
  return (event) => {
    const decision = decideOmpToolCapability(event.toolName);
    if (decision.decision === "continue") return undefined;
    return { block: true, reason: decision.reason };
  };
}

/**
 * The intent-profile callback: EVERY name is blocked before dispatch with the
 * bounded reason, including names the restricted capability map would have
 * allowed. The decision ignores the name entirely, so no tool surface — shipped,
 * deployment-registered or unknown — can reach dispatch on this launch.
 */
export function createOmpIntentToolCallHandler(): NativeToolCallHandler {
  return () => ({ block: true, reason: OMP_INTENT_BLOCKED_REASON });
}

/**
 * The launch-appropriate callback: the restricted capability one ONLY on a
 * positively observed ordinary launch; the deny-all one on an intent launch and
 * on a launch whose marker state is indeterminate. `host` defaults to the
 * native runtime's own `process` global and is injectable for the contract
 * tests.
 */
export function createOmpToolCallHandler(
  options: { host?: unknown } = {},
): NativeToolCallHandler {
  const host = "host" in options ? options.host : Reflect.get(globalThis, "process");
  if (observeOmpLaunchMarker(host) === "ordinary") return createOmpCapabilityToolCallHandler();
  return createOmpIntentToolCallHandler();
}

/**
 * Attach the launch-appropriate callback through the official pre-dispatch API.
 * The pinned native loader evaluates this default export once per process, so
 * the marker is read exactly once per launch.
 */
export function registerOmpCapabilityCallback(api: NativeExtensionApi): void {
  api.on("tool_call", createOmpToolCallHandler());
}
