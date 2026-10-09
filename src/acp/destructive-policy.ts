/**
 * Shared destructive completeness and authorization policy. Client and restricted-tool
 * adapter MUST import these exports rather than duplicate parsing or write rules.
 * No filesystem IO occurs here. Native patches remain unsupported under decision 4;
 * synthetic operation input is a trusted adapter contract, never ACP parser metadata.
 * Note: Adapter operation binding comparison uses exact JSON representation;
 * conforming adapters must serialize operations with consistent property order
 * to satisfy executionInputBinding integrity checks.
 */
import type {
  DestructiveIntentInput,
  DestructiveOperation,
} from "./omp/compatibility-contracts.ts";
import type { CanonicalTarget, RootPathResult } from "./filesystem-roots.ts";
import {
  authorizeFilesystemWrite,
  type AuthorizeWriteParams,
  type FilesystemAuthorizationResult,
  mapRootPathFailureToDenial,
} from "./filesystem-policy.ts";

export type DestructiveFailure =
  | "incomplete_operation"
  | "unsupported_syntax"
  | "unparseable_input"
  | "binding_mismatch"
  | "title_only_intent";
export interface DestructiveTarget {
  readonly path: string;
  readonly intent: "delete" | "write";
}
export type DestructiveNormalization =
  | {
    readonly ok: true;
    readonly operations: readonly DestructiveOperation[];
    readonly targets: readonly DestructiveTarget[];
  }
  | { readonly ok: false; readonly reason: DestructiveFailure; readonly targets: readonly [] };

/** Decode only established JSON delete/move shapes or explicitly trusted adapter operations. */
export function decodeDestructiveIntent(input: DestructiveIntentInput): DestructiveNormalization {
  const fail = (reason: DestructiveFailure): DestructiveNormalization => ({
    ok: false,
    reason,
    targets: [],
  });
  if (input.rawInput !== input.executionInputBinding) return fail("binding_mismatch");
  if (input.parserProvenance === "native_first_location_only") return fail("incomplete_operation");
  if (input.parserProvenance === "unknown") return fail("unsupported_syntax");
  let raw: unknown;
  try {
    raw = JSON.parse(input.rawInput);
  } catch {
    return fail("unparseable_input");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("unparseable_input");
  const record = raw as Record<string, unknown>;
  let operations: readonly DestructiveOperation[];
  if (input.parserProvenance === "synthetic_adapter_decoder") {
    // Adapter operations must be encoded in the bound input, not an independent side list.
    if (!Array.isArray(record.operations)) return fail("incomplete_operation");
    if (JSON.stringify(record.operations) !== JSON.stringify(input.operations)) {
      return fail("binding_mismatch");
    }
    operations = input.operations ?? [];
  } else if (input.nativeTool === "delete" || input.nativeTool === "move") {
    // Additional arguments might carry omitted operations. Never guess their meaning.
    const fields = input.nativeTool === "delete" ? ["path"] : ["source", "destination"];
    if (Object.keys(record).some((key) => !fields.includes(key))) return fail("unsupported_syntax");
    operations = input.nativeTool === "delete"
      ? [{ kind: "delete", path: record.path as string }]
      : [{
        kind: "move",
        source: record.source as string,
        destination: record.destination as string,
      }];
    if (input.operations && JSON.stringify(input.operations) !== JSON.stringify(operations)) {
      return fail("binding_mismatch");
    }
  } else return fail("unsupported_syntax");
  if (operations.length === 0) return fail("incomplete_operation");
  const targets: DestructiveTarget[] = [];
  const validPath = (path: unknown): path is string =>
    typeof path === "string" && path.length > 0 && !path.includes("\0");
  for (const op of operations) {
    if (!op || typeof op !== "object") return fail("incomplete_operation");
    if (op.kind === "delete") {
      if (!validPath(op.path)) return fail("incomplete_operation");
      targets.push({ path: op.path, intent: "delete" });
    } else if (op.kind === "move") {
      if (!validPath(op.source) || !validPath(op.destination)) return fail("incomplete_operation");
      targets.push({ path: op.source, intent: "delete" }, {
        path: op.destination,
        intent: "write",
      });
    } else if (op.kind === "patch_mutation") {
      if (!validPath(op.targetPath)) return fail("incomplete_operation");
      targets.push({ path: op.targetPath, intent: "write" });
    } else return fail("unsupported_syntax");
  }
  return { ok: true, operations, targets };
}

/** Compare already-expanded spellings; a location list never substitutes for the decode. */
export function normalizeDestructiveIntent(
  input: DestructiveIntentInput | undefined,
  expandedTargets: readonly string[],
  expandedLocations: readonly string[],
): DestructiveNormalization {
  if (!input) return { ok: false, reason: "title_only_intent", targets: [] };
  const decoded = decodeDestructiveIntent(input);
  if (!decoded.ok) return decoded;
  const fail = (reason: DestructiveFailure): DestructiveNormalization => ({
    ok: false,
    reason,
    targets: [],
  });
  if (expandedTargets.length !== decoded.targets.length) return fail("incomplete_operation");
  if (expandedTargets.some((path) => !expandedLocations.includes(path))) {
    return fail("incomplete_operation");
  }
  if (expandedLocations.some((path) => !expandedTargets.includes(path))) {
    return fail("binding_mismatch");
  }
  return {
    ...decoded,
    targets: decoded.targets.map((target, index) => ({ ...target, path: expandedTargets[index] })),
  };
}

/** Evaluate every observation and return the first denial index, without partial approval. */
export function authorizeDestructiveTargets(
  normalized: Extract<DestructiveNormalization, { ok: true }>,
  observations: readonly RootPathResult<CanonicalTarget>[],
  params: Omit<AuthorizeWriteParams, "target">,
): {
  readonly ok: boolean;
  readonly decisions: readonly FilesystemAuthorizationResult[];
  readonly firstDeniedIndex?: number;
} {
  const decisions = normalized.targets.map((target, index): FilesystemAuthorizationResult => {
    const observed = observations[index];
    if (!observed) {
      return {
        ok: false,
        reason: "rejected_filesystem_context",
        message: "Incomplete target observations",
      };
    }
    if (!observed.ok) {
      return {
        ok: false,
        reason: mapRootPathFailureToDenial(observed.reason, true),
        message: "Destructive target unavailable",
      };
    }
    if (target.intent === "delete" && observed.value.targetType === "prospective") {
      return {
        ok: false,
        reason: mapRootPathFailureToDenial("not_found", true),
        message: "Destructive source unavailable",
      };
    }
    return authorizeFilesystemWrite({ ...params, target: observed.value });
  });
  const firstDeniedIndex = decisions.findIndex((decision) => !decision.ok);
  return {
    ok: firstDeniedIndex < 0,
    decisions,
    ...(firstDeniedIndex < 0 ? {} : { firstDeniedIndex }),
  };
}

export function destructiveDenialReason(reason: DestructiveFailure): string {
  return reason === "binding_mismatch"
    ? "rejected_destructive_binding"
    : "rejected_destructive_incomplete";
}

const ORDINARY_EDIT_FIELDS = new Set([
  "path",
  "file_path",
  "filePath",
  "filepath",
  "file",
  "filename",
  "paths",
  "files",
  "content",
  "diff",
  "old_string",
  "new_string",
  "oldString",
  "newString",
  "replaceAll",
]);

/** Presentation can trigger denial routing, but cannot supply operation targets. */
export function isDestructiveRequest(title: string, kind: string, raw: unknown): boolean {
  if (kind === "delete" || kind === "move" || /^(delete|move)(?:\s|$)/i.test(title)) return true;
  if (title === "apply_patch" || title === "patch") return true;
  if (!raw) return false;
  if (typeof raw !== "object" || Array.isArray(raw)) return kind === "edit";
  const input = raw as Record<string, unknown>;
  if (kind === "edit") {
    if (Object.keys(input).some((key) => !ORDINARY_EDIT_FIELDS.has(key))) return true;
  }
  return [
    "operations",
    "edits",
    "patch",
    "patchText",
    "patch_text",
    "oldPath",
    "newPath",
    "source",
    "destination",
    "from",
    "to",
  ].some((key) => key in input) ||
    Object.values(input).some((value) =>
      typeof value === "string" &&
      (/\*\*\* (?:Begin Patch|Delete File|Move to:)/.test(value) ||
        (value.match(/^diff --git /gm)?.length ?? 0) > 1 ||
        (value.match(/^--- .+\n\+\+\+ /gm)?.length ?? 0) > 1 ||
        /^deleted file mode |^rename (?:from|to) /m.test(value))
    );
}

export interface DestructiveConformanceFixture {
  readonly id: string;
  readonly input: DestructiveIntentInput;
  readonly locations: readonly string[];
  readonly completeness: "complete" | DestructiveFailure;
  readonly targets: readonly string[];
}
const synthetic = (operations: readonly DestructiveOperation[]): DestructiveIntentInput => {
  const rawInput = JSON.stringify({ operations });
  return {
    nativeTool: "edit",
    rawInput,
    executionInputBinding: rawInput,
    parserProvenance: "synthetic_adapter_decoder",
    operations,
  };
};
const json = (nativeTool: "delete" | "move", rawInput: string): DestructiveIntentInput => ({
  nativeTool,
  rawInput,
  executionInputBinding: rawInput,
  parserProvenance: "supported_full_parser",
});
/** One fixture set consumed by the client and mock adapter conformance tests. */
export const DESTRUCTIVE_CONFORMANCE_FIXTURES: readonly DestructiveConformanceFixture[] = [
  {
    id: "delete",
    input: json("delete", '{"path":"a.md"}'),
    locations: ["a.md"],
    completeness: "complete",
    targets: ["a.md"],
  },
  {
    id: "move",
    input: json("move", '{"source":"a.md","destination":"b.md"}'),
    locations: ["a.md", "b.md"],
    completeness: "complete",
    targets: ["a.md", "b.md"],
  },
  {
    id: "multi-delete",
    input: synthetic([{ kind: "delete", path: "a.md" }, { kind: "delete", path: "b.md" }]),
    locations: ["a.md", "b.md"],
    completeness: "complete",
    targets: ["a.md", "b.md"],
  },
  {
    id: "patch-mutation",
    input: synthetic([{ kind: "patch_mutation", targetPath: "b.md" }]),
    locations: ["b.md"],
    completeness: "complete",
    targets: ["b.md"],
  },
  {
    id: "later-escape",
    input: synthetic([{ kind: "delete", path: "a.md" }, {
      kind: "delete",
      path: "../../../../external.md",
    }]),
    locations: ["a.md", "../../../../external.md"],
    completeness: "complete",
    targets: ["a.md", "../../../../external.md"],
  },
  {
    id: "missing-destination",
    input: json("move", '{"source":"a.md"}'),
    locations: ["a.md"],
    completeness: "incomplete_operation",
    targets: [],
  },
  {
    id: "unparseable",
    input: json("delete", "{"),
    locations: ["a.md"],
    completeness: "unparseable_input",
    targets: [],
  },
  {
    id: "unknown-syntax",
    input: { ...synthetic([]), parserProvenance: "unknown" },
    locations: ["a.md"],
    completeness: "unsupported_syntax",
    targets: [],
  },
  {
    id: "binding-mismatch",
    input: { ...json("delete", '{"path":"a.md"}'), executionInputBinding: "{}" },
    locations: ["a.md"],
    completeness: "binding_mismatch",
    targets: [],
  },
  {
    id: "location-disagreement",
    input: json("delete", '{"path":"a.md"}'),
    locations: ["a.md", "b.md"],
    completeness: "binding_mismatch",
    targets: [],
  },
  {
    id: "incomplete-native-location-list",
    input: {
      ...synthetic([{ kind: "delete", path: "a.md" }, { kind: "delete", path: "b.md" }]),
      parserProvenance: "native_first_location_only",
    },
    locations: ["a.md"],
    completeness: "incomplete_operation",
    targets: [],
  },
];
/** Machine-readable expected completeness/targets/reason, derived from the same fixtures. */
export const DESTRUCTIVE_CONFORMANCE_TABLE = DESTRUCTIVE_CONFORMANCE_FIXTURES.map((fixture) => ({
  id: fixture.id,
  completeness: fixture.completeness,
  targets: fixture.targets,
  outcomeReason: fixture.completeness === "complete"
    ? (fixture.id === "later-escape" ? "rejected_write_path_outside_workspace" : "approved")
    : destructiveDenialReason(fixture.completeness),
}));
