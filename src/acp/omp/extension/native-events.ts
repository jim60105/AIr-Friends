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
 * Root screening (task 2.2): before any native read/search call could reach
 * local dispatch, `screenNativeInput` decodes EVERY path/root constituent of
 * the real pinned parameter vocabulary (delimited `;`/`,`/whitespace lists,
 * inline selectors, archive members, collapsed and glued internal-scheme
 * spellings). An HTTP(S), SSH or internal/device root denies the WHOLE call
 * before native scanning or URL materialization — a valid local constituent
 * never authorizes a mixed unsafe root list — while literal pattern/query TEXT
 * is never a root and stays usable.
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
 *
 * `bind-omp-owned-module-evidence` removed the former `canonicalTarget`
 * member: module identity is independent physical deployment evidence and
 * NEVER session identity, so no session-role canonical observation can stand
 * in for it. Destructive/session-bound completion still requires THIS
 * acquired context, and its absence still denies.
 */
export interface NativeSessionContext {
  resolveCanonicalTargets(
    targets: readonly string[],
  ): readonly RootPathResult<CanonicalTarget>[];
  /** Row-4 write-authorization parameters (the per-target `target` field is the policy's own). */
  readonly authorizationParams?: Omit<AuthorizeWriteParams, "target">;
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

// ---------------------------------------------------------------------------
// Native local read/search root screening (task 2.2).
// ---------------------------------------------------------------------------

/**
 * The read/search-class names whose REAL path/root constituents are screened
 * before local dispatch (the inventory's read-class vocabulary: the pinned
 * builtin names plus the legacy `list`/`search` spellings).
 */
const SCREENED_NATIVE_SEARCH_TOOLS: readonly string[] = [
  "read",
  "list",
  "glob",
  "grep",
  "search",
  "find",
];

/**
 * Every root field the real pinned read/search tools accept (`read` declares
 * `path`; the search tools declare `path`, and the pinned host approval
 * wrapper also reads `paths`). Literal TEXT fields — `pattern`, `query`,
 * `grep_keywords` — are never roots and are never screened: a search pattern
 * that happens to contain URI-like text stays usable.
 */
const NATIVE_ROOT_FIELDS: readonly string[] = ["path", "paths"];

/**
 * The pinned internal-URL scheme vocabulary (`internal-urls/router.ts` at the
 * pin: every registered handler plus the MCP resource fallback). It bounds
 * OPAQUE `<scheme>:payload` recognition: a local file may legitimately be
 * named `report.pdf:2-4` or `archive.zip:member`, so only the pinned scheme
 * vocabulary classifies that form. Hierarchical `<scheme>:/…` spellings are
 * screened for EVERY scheme (fail closed).
 */
const PINNED_INTERNAL_URL_SCHEMES: readonly string[] = [
  "skill",
  "rule",
  "memory",
  "agent",
  "history",
  "artifact",
  "local",
  "proc",
  "cfg",
  "ssh",
  "security",
  "vault",
  "issue",
  "pr",
  "mcp",
  "omp",
  "xd",
  "attachment",
  "conflict",
];

const PINNED_INTERNAL_URL_SCHEME_LOOKUP: Readonly<Record<string, true>> = Object.fromEntries(
  PINNED_INTERNAL_URL_SCHEMES.map((scheme): [string, true] => [scheme, true]),
);

/**
 * `<scheme>:/…` or a bare `<scheme>:` — two characters minimum, so a Windows
 * drive letter (`C:\x`, `C:/x`) and a single-letter directory root stay local.
 */
const LEADING_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):(\/|$)/;
const OPAQUE_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):/;
/**
 * A filesystem path glued in front of an internal URL (`/repo/local://x`),
 * which the pinned router normalizes into that scheme's URL.
 */
const GLUED_SCHEME_RE = /[\\/]([a-zA-Z][a-zA-Z0-9+.-]{1,31}):\/\/(?=[^/]|$)/;
/**
 * Delimited root lists: the pinned search path resolver splits `;`, `,` and
 * whitespace lists (`path-utils.ts` `splitDelimitedPathEntry`), so screening
 * must see every constituent, never only the first.
 */
const ROOT_LIST_SEPARATOR_RE = /[\s;,]+/;

/** One constituent's route class; `local` is the only admissible class. */
type NativeRootConstituentClass = "local" | "url" | "ssh" | "internal";

/**
 * A screened-out root: the whole native read/search call must deny before any
 * native scan or URL materialization.
 */
export interface NativeRootScreening {
  readonly deviceSurface: "remote-url" | "internal-uri-scheme" | "ssh-device";
  readonly decodedCapability: string;
}

/**
 * Classify one root constituent. `allowSkillUri` mirrors the pinned `read`
 * branch parser: a `skill://` read is the owned skill-URI route (local to this
 * screen; its own authorization runs downstream), while every other
 * non-HTTP(S) scheme is an internal/device or SSH route. Fail-closed for
 * unrepresentable spellings: an unrecognized `<scheme>:/…` form is a route,
 * never a local path.
 */
function classifyNativeRootConstituent(
  token: string,
  allowSkillUri: boolean,
): NativeRootConstituentClass {
  const leading = LEADING_SCHEME_RE.exec(token);
  let scheme = leading?.[1]?.toLowerCase();
  if (scheme === undefined) {
    const glued = GLUED_SCHEME_RE.exec(token);
    const gluedScheme = glued?.[1]?.toLowerCase();
    if (
      gluedScheme !== undefined && Object.hasOwn(PINNED_INTERNAL_URL_SCHEME_LOOKUP, gluedScheme)
    ) {
      scheme = gluedScheme;
    } else {
      const opaque = OPAQUE_SCHEME_RE.exec(token);
      const opaqueScheme = opaque?.[1]?.toLowerCase();
      if (
        opaqueScheme === undefined ||
        !Object.hasOwn(PINNED_INTERNAL_URL_SCHEME_LOOKUP, opaqueScheme)
      ) {
        return "local";
      }
      scheme = opaqueScheme;
    }
  }
  if (scheme === "http" || scheme === "https") return "url";
  if (scheme === "skill" && allowSkillUri) return "local";
  if (scheme === "ssh") return "ssh";
  return "internal";
}

/** Every root constituent a real pinned read/search call positively names. */
function nativeRootConstituents(input: Record<string, unknown>): string[] {
  const constituents: string[] = [];
  for (const field of NATIVE_ROOT_FIELDS) {
    const value = input[field];
    const entries = typeof value === "string"
      ? [value]
      : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const entry of entries) {
      for (const token of entry.split(ROOT_LIST_SEPARATOR_RE)) {
        // A delimited list can leave empty tokens (trailing separators, a bare
        // `;`); an empty constituent is the native default (trusted cwd), not
        // a route.
        if (token !== "") constituents.push(token);
      }
    }
  }
  return constituents;
}

/**
 * Screen EVERY path/root constituent of a native read/search call against the
 * real pinned parameter vocabulary: local paths, globs and selectors stay
 * local; an HTTP(S) root is a remote route (owned-adapter work, never a native
 * search root); an SSH or internal/device scheme — including collapsed
 * (`local:/x`) and glued (`/repo/local://x`) spellings — is a route. ONE unsafe
 * constituent denies the WHOLE call; checking only the first root never
 * suffices. Returns `undefined` when every constituent is local.
 */
export function screenNativeLocalSearchRoots(
  toolName: string,
  input: Record<string, unknown>,
): NativeRootScreening | undefined {
  if (!SCREENED_NATIVE_SEARCH_TOOLS.includes(toolName)) return undefined;
  const allowSkillUri = toolName === "read";
  let unsafe: Exclude<NativeRootConstituentClass, "local"> | undefined;
  for (const token of nativeRootConstituents(input)) {
    const classification = classifyNativeRootConstituent(token, allowSkillUri);
    if (classification === "local") continue;
    // The one admitted URL route: the registered owned `read` replacement's
    // controlled per-hop transport, reached through the ordinary `url` shape
    // selection below.
    if (classification === "url" && allowSkillUri) continue;
    unsafe ??= classification;
  }
  switch (unsafe) {
    case undefined:
      return undefined;
    case "url":
      return { deviceSurface: "remote-url", decodedCapability: "network-read" };
    case "ssh":
      return { deviceSurface: "ssh-device", decodedCapability: "filesystem-read" };
    case "internal":
      return {
        deviceSurface: "internal-uri-scheme",
        decodedCapability: allowSkillUri ? "network-read" : "filesystem-read",
      };
  }
}

/** `isSafeUrlLike`-style URL branch detection (native fetch.ts posture, S6). */
export function isUrlLikeString(value: string): boolean {
  const repaired = value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/(?!\/)/, "$1://");
  return /^https?:\/\//i.test(repaired);
}

function firstStringField(
  input: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * The decoded input shape: argument structure only, never a policy claim.
 * `screenNativeInput` runs the root screening FIRST, so a screened-out native
 * read/search root never reaches this function's ordinary shape selection.
 */
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

/** One native call's screened shape + route data (the decoder's hand-off). */
export interface NativeInputScreening {
  readonly shape: InputShape;
  readonly deviceSurface?: "remote-url" | "internal-uri-scheme" | "ssh-device";
  readonly decodedCapability?: string;
}

/**
 * Screen then shape one native call. A screened-out root yields the
 * non-ordinary `device-route` shape plus the exact route/capability pair, so
 * stage-1 pair screening denies the WHOLE call before any native scan or URL
 * materialization; every other call keeps the shape selection
 * `selectNativeInputShape` already provided.
 */
export function screenNativeInput(
  toolName: string,
  input: Record<string, unknown>,
): NativeInputScreening {
  const roots = screenNativeLocalSearchRoots(toolName, input);
  if (roots !== undefined) return { shape: "device-route", ...roots };
  return { shape: selectNativeInputShape(toolName, input) };
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
 *
 * `null` is a distinct outcome: the arguments could not be serialized at
 * all, so the call is an unrepresentable event (decode-seam failure),
 * NEVER a silently "not destructive" shape claim.
 */
export function decodeNativeDestructivePayload(
  toolName: string,
  input: Record<string, unknown>,
  sessionContext: NativeSessionContext | undefined,
): DestructiveCallPayload | null | undefined {
  if (!isDestructiveNativeTool(toolName)) return undefined;
  const nativeTool = toolName as DestructiveIntentInput["nativeTool"];
  let rawInput: string;
  try {
    rawInput = JSON.stringify(input);
  } catch {
    // Unserializable arguments (BigInt, exotic objects): the event is
    // unrepresentable, so it decodes to the seam — it must never be
    // handed to the policy as a payload-less "non-destructive" call.
    return null;
  }
  const intentInput: DestructiveIntentInput = {
    nativeTool,
    rawInput,
    executionInputBinding: rawInput,
    // This decoder is exactly what that vocabulary names: a best-effort
    // adapter-side decode. `supported_full_parser` is NEVER claimed here —
    // the shared binding rule requires operations to travel INSIDE the
    // bound raw input, so only a call whose serialized arguments carry an
    // explicit operations list can ever reach the shared all-target stage;
    // every other native shape (bare delete/move JSON, edit/apply_patch
    // bodies) stays incomplete and the shared completeness denial fires
    // before dispatch. No operation is ever guessed or side-listed.
    parserProvenance: "synthetic_adapter_decoder",
    ...(Array.isArray(input["operations"])
      ? { operations: input["operations"] as NonNullable<DestructiveIntentInput["operations"]> }
      : {}),
  };
  // Shared stage-1 decode decides completeness over the bound input only.
  const decoded = decodeDestructiveIntent(intentInput);
  const expandedTargets = destructiveTargetsFromInput(toolName, input) ??
    (decoded.ok ? decoded.targets.map((target) => target.path) : []);
  // Trusted canonical observations ONLY: an UNREPRESENTABLE target
  // (outside the session roots, escaping) resolves to a failed result the
  // shared step-4 fails closed on, and this decoder never substitutes a
  // model-supplied observation. No trusted context ⇒ no observations.
  const observations = sessionContext?.resolveCanonicalTargets([...expandedTargets]);
  return {
    intent: intentInput,
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
  if (
    rawInput !== undefined && (rawInput === null || typeof rawInput !== "object" ||
      Array.isArray(rawInput))
  ) {
    return failure();
  }
  const input: Record<string, unknown> = rawInput ?? {};
  const destructive = decodeNativeDestructivePayload(toolName, input, sessionContext);
  if (destructive === null) return failure();
  const screening = screenNativeInput(toolName, input);
  return {
    ok: true,
    input: {
      toolKey,
      toolName,
      decodedInputShape: screening.shape,
      ...(screening.deviceSurface !== undefined ? { deviceSurface: screening.deviceSurface } : {}),
      ...(screening.decodedCapability !== undefined
        ? { decodedCapability: screening.decodedCapability }
        : {}),
      ...(destructive !== undefined ? { destructive } : {}),
      recordEvaluation: emptyRecordEvaluation(),
    },
  };
}
