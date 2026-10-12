/**
 * Native Tool-Call Event Decoder (C4, `wire-omp-native-extension-api`,
 * task 1.3).
 *
 * Decodes the pinned native `ToolCallEvent` (`extensions/runner.ts`
 * `emitToolCall` at the pin: `{type:"tool_call", toolCallId, toolName,
 * input}` where `input` is the RAW model-authored tool arguments) into the
 * existing restricted-input shape (`RestrictedToolCallInput`) the row-16
 * composer already consumes. The decoder adds NO policy: shape selection,
 * destructive routing, and every denial reason stay 14a's; this module only
 * represents what the event positively carries.
 *
 * Trusted-context discipline (spec: model input cannot forge admission):
 * `input` is model-authored, so ONLY arguments-derived fields are read from
 * it — the path/command/target strings a tool call necessarily contains.
 * Origin, ownership, shared-write permission, approval records, registry
 * epochs, resource generations, adapter-completion flags, and observations
 * are NEVER taken from the event: they come from the wiring's live
 * observers or are absent, and the absence of required completing context
 * is exactly what the shared policies deny fail-closed
 * (`destructive_targets_missing` / seam blocks). Fields a model may place
 * in `input` that mimic trusted context (e.g. `parserProvenance`,
 * `canonicalTarget`, `authoritative`, `acpApprovedArgs`) are ignored here
 * and cannot grant anything — the decoder names every intent it builds
 * `synthetic_adapter_decoder` and binds it to the verbatim serialized raw
 * input, the shared binding-integrity posture.
 */

import type { RestrictedToolCallInput } from "./enforcement.ts";
import type { DestructiveCallPayload } from "./enforcement-error.ts";
import type {
    AuthorizeWriteParams,
  CanonicalTarget,
  DestructiveIntentInput,
  EffectiveRecordEvaluation,
  InputShape,
  RootPathResult,
} from "./_daemon/mod.ts";
import { evaluateApprovalRecordAuthority } from "../record-evaluator.ts";
import { decodeDestructiveIntent } from "../../destructive-policy.ts";

/** The pinned native tool-call event shape (shared-events.ts at the pin). */
export interface NativeToolCallEvent {
  readonly type?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly input?: Record<string, unknown>;
}

/** The pinned native handler result (shared-events.ts at the pin). */
export interface NativeToolCallEventResult {
  readonly block?: boolean;
  readonly reason?: string;
  readonly input?: Record<string, unknown>;
  readonly additionalContext?: string;
}

/** Bounded seam failure marker (the caller converts it to the block). */
export const NATIVE_EVENT_DECODE_SEAM = "native-event-decode";

/** Decode result: a restricted input, or a bounded seam failure. */
export type NativeDecodeResult =
  | { readonly ok: true; readonly input: RestrictedToolCallInput }
  | { readonly ok: false; readonly seam: typeof NATIVE_EVENT_DECODE_SEAM };

/**
 * Approval-record evaluation consumed per call. The extension process
 * observes NO settings hierarchy of its own — the trusted acquisition of
 * lower/CLI/runtime layers into the child is not a thing the pinned host
 * offers — so the ONLY honest input is the empty-hierarchy evaluation
 * (no authoritative records, no residual grants). Model-supplied
 * "approval"-shaped fields inside `input` never reach this call.
 */
export function emptyRecordEvaluation(): EffectiveRecordEvaluation {
  return evaluateApprovalRecordAuthority({ lowerLayer: { approval: {} } }, "restricted", {});
}

// ---------------------------------------------------------------------------
// Trusted acquired-session context (host-side; never model data).
// ---------------------------------------------------------------------------

/**
 * The trusted acquired-session context the decoder may use: canonical
 * target resolution and the row-4 authorization parameters, both produced
 * daemon-side from the session's own filesystem context. The extension
 * child receives NONE of this from the pinned host today, so production
 * wiring passes `undefined` — destructive-shaped calls then deny
 * fail-closed on absent observations, the honest shipped behavior — and
 * only an explicitly attached context (deployment acquisition, or an
 * API-shaped test harness) enriches the decode. This parameter is NEVER
 * populated from event input.
 */
export interface NativeSessionContext {
  resolveCanonicalTargets(
    targets: readonly string[],
  ): readonly RootPathResult<CanonicalTarget>[];
  /** Row-4 write-authorization parameters (the per-target `target` field is the policy's own). */
  readonly authorizationParams?: Omit<AuthorizeWriteParams, "target">;
  /** Trusted canonical identity of the acquired session, when one exists. */
  readonly canonicalTarget?: CanonicalTarget;
}

// ---------------------------------------------------------------------------
// Shape selection from the tool name + arguments structure (data, no policy).
// ---------------------------------------------------------------------------

const PATH_TARGET_TOOLS: readonly string[] = [
  "read",
  "list",
  "glob",
  "grep",
  "search",
  "find",
  "write",
  "edit",
  "delete",
  "move",
  "apply_patch",
];

/** `isSafeUrlLike`-style URL branch detection (native fetch.ts posture, S6). */
export function isUrlLikeString(value: string): boolean {
  const repaired = value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/(?!\/)/, "$1://");
  return /^https?:\/\//i.test(repaired);
}

function firstStringField(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** The decoded input shape: argument structure only, never a policy claim. */
export function selectNativeInputShape(
  toolName: string,
  input: Record<string, unknown>,
): InputShape {
  if (
    toolName === "web_fetch" ||
    isUrlLikeString(firstStringField(input, ["path", "url"]) ?? "")
  ) {
    return "url";
  }
  if (toolName === "bash") return "command";
  if (toolName === "web_search" || toolName.startsWith("mcp__")) return "query";
  if (toolName === "todo") return "todo";
  if (toolName === "config_write") return "config-write";
  if (PATH_TARGET_TOOLS.includes(toolName)) return "path-target";
  // Unknown names: opaque keeps the row's default-deny-by-absence intact
  // while the alternate-route pair screening still runs on the shape.
  return "opaque";
}

// ---------------------------------------------------------------------------
// Destructive decoding (the delete/move/apply_patch routed-destructive row).
// ---------------------------------------------------------------------------

const DESTRUCTIVE_NATIVE_TOOLS: readonly DestructiveIntentInput["nativeTool"][] = [
  "delete",
  "move",
  "edit",
  "apply_patch",
];

function isDestructiveNativeTool(toolName: string): boolean {
  return (DESTRUCTIVE_NATIVE_TOOLS as readonly string[]).includes(toolName);
}

/** Every string a model argument positively names as a filesystem target. */
function collectTargetStrings(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectTargetStrings(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: string[] = [];
    for (const nested of Object.values(value as Record<string, unknown>)) {
      out.push(...collectTargetStrings(nested, depth + 1));
    }
    return out;
  }
  return [];
}

/**
 * Target keys the pinned native arguments name, in the order the shared
 * decoder lists targets (move: source before destination — the shared
 * normalization rebinds expanded targets to decoded operations BY INDEX,
 * so a swapped order would rebind the wrong spelling to the wrong role).
 */
function destructiveTargetsFromInput(
  toolName: string,
  input: Record<string, unknown>,
): readonly string[] | undefined {
  const named = toolName === "move"
    ? ["path", "source", "from", "paths", "files", "destination", "to"]
    : ["path", "paths", "file", "files", "target", "targets"];
  const explicit = named.flatMap((key) =>
    input[key] !== undefined ? collectTargetStrings(input[key]) : []
  );
  if (explicit.length > 0) return explicit;
  // apply_patch/edit raw bodies carry targets only inside the payload; the
  // shared stage-1 decode below owns parsing them from `rawInput` — no
  // targets are GUESSED here, so an incomplete target set stays incomplete
  // and the shared completeness stage denies before any mutation.
  return undefined;
}

/**
 * Build the destructive payload the row-5 policy consumes, from trusted
 * pieces only: the verbatim serialized arguments (`rawInput`, bound to
 * `executionInputBinding` per the shared binding-integrity rule), the
 * decoder's honest `synthetic_adapter_decoder` provenance, the positively
 * named target strings, and canonical observations ONLY when a trusted
 * acquired-session context exists. Without that context the observations
 * are ABSENT — exactly the fail-closed posture the composition already
 * implements — never model-supplied and never fabricated.
 */
export function decodeNativeDestructivePayload(
  toolName: string,
  input: Record<string, unknown>,
  sessionContext: NativeSessionContext | undefined,
): DestructiveCallPayload | undefined {
  if (!isDestructiveNativeTool(toolName)) return undefined;
  const nativeTool = toolName as DestructiveIntentInput["nativeTool"];
  let rawInput: string;
  try {
    rawInput = JSON.stringify(input);
  } catch {
    return undefined;
  }
  const intentInput: DestructiveIntentInput = {
    nativeTool,
    rawInput,
    executionInputBinding: rawInput,
    // This decoder is exactly what that vocabulary names: a best-effort
    // adapter-side decode. `supported_full_parser` is NEVER claimed here —
    // the shared stage-1 decode either confirms a complete operation set
    // (delete/move JSON shapes) or the shared completeness denial fires
    // before dispatch (edit/apply_patch bodies this decoder cannot parse).
    parserProvenance: "synthetic_adapter_decoder",
  };
  // Shared stage-1 decode: only positively decoded operations are attached;
  // an un-decodable body stays an incomplete payload the policy denies.
  const decoded = decodeDestructiveIntent(intentInput);
  const intent: DestructiveIntentInput = decoded.ok
    ? { ...intentInput, operations: decoded.operations }
    : intentInput;
  const expandedTargets = destructiveTargetsFromInput(toolName, input) ??
    (decoded.ok ? decoded.targets.map((target) => target.path) : []);
  // Trusted canonical observations ONLY: an UNREPRESENTABLE target
  // (outside the session roots, escaping) resolves to a failed result the
  // shared step-4 fails closed on, and this decoder never substitutes a
  // model-supplied observation. No trusted context ⇒ no observations.
  const observations = sessionContext?.resolveCanonicalTargets([...expandedTargets]);
  return {
    intent,
    expandedTargets,
    expandedLocations: [...expandedTargets],
    ...(observations !== undefined && observations.length > 0 ? { observations } : {}),
    ...(sessionContext?.authorizationParams !== undefined
      ? { authorizationParams: sessionContext.authorizationParams }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The decode proper.
// ---------------------------------------------------------------------------

/**
 * Decode one native tool-call event into the restricted input. Anything
 * unrepresentable (missing id/name, non-object input, wrong event type) is
 * a bounded seam failure — the caller blocks, never guesses. MCP-named
 * (`mcp__`) events decode as `query`-shaped: the client-ownership
 * admission basis lives in 14a's provenance step over the LIVE registry
 * observation, and nothing in the event can complete it.
 */
export function decodeNativeToolCallEvent(
  event: NativeToolCallEvent,
  sessionContext?: NativeSessionContext,
): NativeDecodeResult {
  const failure = (): NativeDecodeResult => ({
    ok: false,
    seam: NATIVE_EVENT_DECODE_SEAM,
  });
  if (event === null || typeof event !== "object") return failure();
  if (event.type !== undefined && event.type !== "tool_call") return failure();
  const { toolName, toolCallId: toolKey, input: rawInput } = event;
  if (typeof toolName !== "string" || toolName === "") return failure();
  if (typeof toolKey !== "string" || toolKey === "") return failure();
  if (rawInput !== undefined && (rawInput === null || typeof rawInput !== "object" ||
    Array.isArray(rawInput))) {
    return failure();
  }
  const input: Record<string, unknown> = rawInput ?? {};
  const destructive = decodeNativeDestructivePayload(toolName, input, sessionContext);
  return {
    ok: true,
    input: {
      toolKey,
      toolName,
      decodedInputShape: selectNativeInputShape(toolName, input),
      ...(destructive !== undefined ? { destructive } : {}),
      recordEvaluation: emptyRecordEvaluation(),
    },
  };
}
