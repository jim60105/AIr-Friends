/**
 * OMP destructive permission-input normalization (`normalize-omp-destructive-acp-ingress`).
 *
 * Pinned native evidence: OMP's ACP permission gate exposes `getPermissionIntent()`
 * with `Delete <path>` / `Move <from> to <to>` titles and move alias precedence
 * `oldPath`, `path`, `from` / `newPath`, `to`, `destination`; the ACP bridge
 * preserves optional `kind` and `rawInput`. This module is PURE: it turns a native
 * single delete/move request into the shared `DestructiveIntentInput` vocabulary
 * owned by `src/acp/destructive-policy.ts`.
 *
 * Scope guard (design decision 4): ONLY the native single-operation field
 * vocabulary is canonicalized. Anything else — `edits`, `operations`, patch text,
 * unknown extra fields, a non-object payload, malformed JSON — is passed through
 * so the shared decoder produces its existing bounded denial. The operation is
 * identified from the native `kind` or a case-insensitive word-boundary
 * `Delete`/`Move` title and NEVER used to find a path.
 */

import type { DestructiveIntentInput } from "../destructive-policy.ts";

/** The subset of an ACP tool call this normalizer inspects. */
export interface OmpDestructiveToolCall {
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly rawInput?: unknown;
}

type NativeTool = "delete" | "move";

const SOURCE_ALIASES = ["oldPath", "path", "from"] as const;
const DESTINATION_ALIASES = ["newPath", "to", "destination"] as const;
const DELETE_FIELDS: Record<string, true> = { path: true };
const MOVE_FIELDS: Record<string, true> = Object.fromEntries(
  [...SOURCE_ALIASES, ...DESTINATION_ALIASES].map((key) => [key, true]),
) as Record<string, true>;

/** Native `kind` first, then a case-insensitive word-boundary title. */
function identifyOperation(kind: string, title: string): NativeTool | null {
  if (kind === "delete" || kind === "move") return kind;
  const match = /^(delete|move)(?:\s|$)/i.exec(title);
  if (!match) return null;
  return match[1].toLowerCase() as NativeTool;
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

/**
 * Decode one native single operation. Returns the canonical payload, or `null`
 * when the shape is not the accepted single-operation vocabulary (the shared
 * decoder then owns the fail-closed denial).
 */
function canonicalize(
  operation: NativeTool,
  parsed: unknown,
): { readonly path: string } | { readonly source: string; readonly destination: string } | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const fields = operation === "delete" ? DELETE_FIELDS : MOVE_FIELDS;
  // Never discard an unknown mutation-bearing field to force a single operation.
  if (Object.keys(record).some((key) => fields[key] !== true)) return null;
  if (operation === "delete") {
    return validPath(record.path) ? { path: record.path } : null;
  }
  // Nullish precedence BEFORE validation: a present higher-precedence value is
  // never skipped to grant a lower one.
  const source = record[SOURCE_ALIASES[0]] ?? record[SOURCE_ALIASES[1]] ??
    record[SOURCE_ALIASES[2]];
  const destination = record[DESTINATION_ALIASES[0]] ?? record[DESTINATION_ALIASES[1]] ??
    record[DESTINATION_ALIASES[2]];
  return validPath(source) && validPath(destination) ? { source, destination } : null;
}

/**
 * Normalize a configured-OMP destructive permission request.
 *
 * Returns `undefined` when the call carries no `rawInput` snapshot (the shared
 * `title_only_intent` outcome is retained). Otherwise it always returns a shared
 * intent: a canonical operation when the native single-operation shape is
 * complete, or a pass-through shape the shared decoder denies.
 */
export function normalizeOmpDestructivePermissionInput(
  toolCall: OmpDestructiveToolCall,
): DestructiveIntentInput | undefined {
  const raw = toolCall.rawInput;
  if (raw === undefined) return undefined;
  const rawString = typeof raw === "string" ? raw : JSON.stringify(raw);
  const operation = identifyOperation(toolCall.kind ?? "", toolCall.title ?? "");
  if (operation === null) {
    // No destructive operation is named: the shared decoder's unsupported path.
    return {
      nativeTool: "edit",
      rawInput: rawString,
      executionInputBinding: rawString,
      parserProvenance: "unknown",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch {
    // Malformed JSON keeps the shared unparseable result.
    return {
      nativeTool: operation,
      rawInput: rawString,
      executionInputBinding: rawString,
      parserProvenance: "supported_full_parser",
    };
  }
  const canonical = canonicalize(operation, parsed);
  if (canonical === null) {
    // Unsupported/incomplete shape: pass the original through for the shared denial.
    return {
      nativeTool: operation,
      rawInput: rawString,
      executionInputBinding: rawString,
      parserProvenance: "supported_full_parser",
    };
  }
  // Serialize once and use the identical string for both binding fields.
  const serialized = JSON.stringify(canonical);
  return {
    nativeTool: operation,
    rawInput: serialized,
    executionInputBinding: serialized,
    parserProvenance: "supported_full_parser",
  };
}
