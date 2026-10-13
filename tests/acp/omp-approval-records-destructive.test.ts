/**
 * Consumer-visible tests for approval-record interpretation and destructive
 * conformance consumption (`define-omp-restricted-tool-decisions`, row 14a).
 *
 * Synthetic fixtures here validate decision logic only; they neither clear the
 * pinned record-reset/destructive-decoding verdicts nor demonstrate native
 * enforcement or a working record reset.
 */

import { assert, assertEquals } from "@std/assert";
import {
  interpretApprovalRecords,
  restrictedDenialWithRecordNaming,
} from "@acp/omp/approval-records.ts";
import {
  decideDestructiveIntent,
  replayConformanceFixtures,
} from "@acp/omp/destructive-decision.ts";
import { decideRestrictedTool } from "@acp/omp/tool-inventory.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import type {
  EffectiveRecordEvaluation,
  SettingsLayerHierarchy,
} from "@acp/omp/record-evaluator.ts";
import { evaluateApprovalRecordAuthority } from "@acp/omp/compatibility-contracts.ts";
import {
  DESTRUCTIVE_CONFORMANCE_FIXTURES,
  DESTRUCTIVE_CONFORMANCE_TABLE,
  destructiveDenialReason,
} from "@acp/destructive-policy.ts";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  RootPathResult,
} from "@acp/filesystem-roots.ts";
import type { AuthorizeWriteParams } from "@acp/filesystem-policy.ts";
import {
  fixtureImageObservation,
  fixtureOwnedExtensionRecord,
} from "./omp-owned-module-fixture.ts";

const approvalResetFixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../fixtures/omp-compatibility/approval-reset-counterexample.json", import.meta.url),
  ),
) as {
  lowerLayer: SettingsLayerHierarchy["lowerLayer"];
  cliOverlays: SettingsLayerHierarchy["cliOverlays"];
  yoloLowerLayer: SettingsLayerHierarchy["lowerLayer"];
  expectedEffectiveApproval: Record<string, string>;
};

// Owned-extension provenance rides the DECLARED deployment artifact plus its
// physical observation (no session id, role or CanonicalTarget).
const owned: ProvenanceRecord = fixtureOwnedExtensionRecord({
  observation: fixtureImageObservation({ generation: "gen-0", epoch: 7 }),
});

/** Row-8 folded-overlay evaluation of the P0 counterexample (restricted mode). */
function p0CounterexampleEvaluation(): EffectiveRecordEvaluation {
  return evaluateApprovalRecordAuthority(
    {
      lowerLayer: approvalResetFixture.lowerLayer,
      cliOverlays: approvalResetFixture.cliOverlays,
    },
    "restricted",
    { read: "allow" },
  );
}

// -----------------------------------------------------------------------------
// 4.1/5.3 Exact-key record interpretation; surviving records never grant/elicit.
// -----------------------------------------------------------------------------

Deno.test("Records: P0 folded-overlay counterexample reproduces the surviving hostile grant", () => {
  const evaluation = p0CounterexampleEvaluation();
  // The lower-layer unknown_tool:"allow" survives the folded merge (row 8
  // verdict consumed as-is; record authority is NOT authoritative).
  assertEquals(evaluation.effectiveApproval["unknown_tool"], "allow");
  assertEquals(evaluation.authoritative, false);
  assertEquals(evaluation.residualHostileGrants, ["unknown_tool"]);
});

Deno.test("Records: surviving lower-layer allow does NOT grant; denial names the survivor", () => {
  const evaluation = p0CounterexampleEvaluation();
  const denied = decideRestrictedTool({
    toolName: "unknown_tool",
    provenance: owned,
    inputShape: "opaque",
  });
  assertEquals(denied.outcome, "deny");
  if (denied.outcome !== "deny") return;
  const interpretation = interpretApprovalRecords({
    registeredToolKey: "unknown_tool",
    recordEvaluation: evaluation,
    restrictedDecision: denied,
  });
  assertEquals(interpretation.exactKeyRecord, "allow");
  // Structural never-grant/never-elicit properties.
  assertEquals(interpretation.grantsExecution, false);
  assertEquals(interpretation.elicits, false);
  assertEquals(interpretation.advisoryOnly, true);
  assertEquals(
    interpretation.operativeBoundary,
    "restricted-execution-time-default-deny",
  );
  assertEquals(interpretation.row8Authoritative, false);
  if ("survivingAllowOverridesExecution" in interpretation) {
    assertEquals(interpretation.survivingAllowOverridesExecution, false);
  }
  // The composed denial reports the surviving record without obeying it.
  const named = restrictedDenialWithRecordNaming(interpretation, denied);
  assertEquals(named.reason, "rejected_approval_record_survivor");
});

Deno.test("Records: surviving prompt/ask record does not elicit", () => {
  const evaluation = evaluateApprovalRecordAuthority(
    {
      lowerLayer: { approval: { special_tool: "ask" } },
      cliOverlays: [{ approval: null }, { approval: { read: "allow" } }],
    },
    "restricted",
    { read: "allow" },
  );
  const denied = decideRestrictedTool({
    toolName: "special_tool",
    provenance: owned,
    inputShape: "opaque",
  });
  assertEquals(denied.outcome, "deny");
  if (denied.outcome !== "deny") return;
  const interpretation = interpretApprovalRecords({
    registeredToolKey: "special_tool",
    recordEvaluation: evaluation,
    restrictedDecision: denied,
  });
  assertEquals(interpretation.exactKeyRecord, "ask");
  assertEquals(interpretation.elicits, false);
  if ("genericElicitationRequested" in interpretation) {
    assertEquals(interpretation.genericElicitationRequested, false);
  }
  // The outcome remains the restricted deny; nothing requests a form.
  assertEquals(restrictedDenialWithRecordNaming(interpretation, denied).reason, denied.reason);
});

Deno.test("Records: surviving deny is reported but non-authoritative", () => {
  const evaluation = evaluateApprovalRecordAuthority(
    {
      lowerLayer: { approval: { legacy_tool: "deny" } },
      runtimeEnvOverrides: { approval: { read: "allow" } },
    },
    "restricted",
    { read: "allow" },
  );
  const denied = decideRestrictedTool({
    toolName: "legacy_tool",
    provenance: owned,
    inputShape: "opaque",
  });
  assertEquals(denied.outcome, "deny");
  if (denied.outcome !== "deny") return;
  const interpretation = interpretApprovalRecords({
    registeredToolKey: "legacy_tool",
    recordEvaluation: evaluation,
    restrictedDecision: denied,
  });
  assertEquals(interpretation.exactKeyRecord, "deny");
  if ("authoritative" in interpretation) assertEquals(interpretation.authoritative, false);
  // Deny reason stays the inventory reason; the record is advisory naming only.
  assertEquals(restrictedDenialWithRecordNaming(interpretation, denied).reason, denied.reason);
});

Deno.test("Records: exact-key lookup only; wildcard/prefix never consulted", () => {
  const evaluation = p0CounterexampleEvaluation();
  const effectiveAllows = Object.entries(evaluation.effectiveApproval).filter(([, action]) =>
    action === "allow"
  ).map(([key]) => key);
  assert(effectiveAllows.length > 0);
  for (const allowKey of effectiveAllows) {
    for (const variant of [`${allowKey}_alias`, `${allowKey}x`, allowKey.slice(0, -1)]) {
      if (effectiveAllows.includes(variant)) continue;
      const decision = decideRestrictedTool({
        toolName: variant,
        provenance: owned,
        inputShape: "opaque",
      });
      assertEquals(decision.outcome, "deny", variant);
      if (decision.outcome !== "deny") continue;
      const interpretation = interpretApprovalRecords({
        registeredToolKey: variant,
        recordEvaluation: evaluation,
        restrictedDecision: decision,
      });
      // No wildcard/prefix match: a record under a different key is not found.
      assertEquals(interpretation.exactKeyRecord, "absent", variant);
      assertEquals(interpretation.wildcardConsulted, false);
      assertEquals(interpretation.grantsExecution, false);
    }
  }
});

Deno.test("Records: module structurally cannot assert a working reset or grant", () => {
  // Grep-equivalent structural check on the shipped source: the only truthy
  // authority/execution/elicitation values that may exist are the consumed
  // row-8 verdict (never `true` here) — no code path hard-codes success.
  const source = Deno.readTextFileSync(
    new URL("../../src/acp/omp/approval-records.ts", import.meta.url),
  );
  assertEquals(source.includes("grantsExecution: true"), false);
  assertEquals(source.includes("elicits: true"), false);
  assertEquals(source.includes("authoritative: true"), false);
  assertEquals(source.includes("wildcardConsulted: true"), false);
  assertEquals(/reset(?:Records|ToDefault|Succeeded)/.test(source), false);
  // The module performs no IO: no Deno/Deno.test usage in shipped source.
  assertEquals(/Deno\./.test(source), false);
});

Deno.test("Records: allow-outcome calls are never granted by the record map", () => {
  // The table property: an inventory allow-gated decision stands identically
  // whether or not an exact-key `allow` exists — records never move outcomes.
  const withRecord = evaluateApprovalRecordAuthority(
    { lowerLayer: { approval: { read: "allow" } } },
    "restricted",
    { read: "allow" },
  );
  const decision = decideRestrictedTool({
    toolName: "read",
    provenance: owned,
    inputShape: "path-target",
  });
  assertEquals(decision.outcome, "allow-gated");
  if (decision.outcome !== "allow-gated") return;
  const interpretation = interpretApprovalRecords({
    registeredToolKey: "read",
    recordEvaluation: withRecord,
    restrictedDecision: decision,
  });
  // Still advisory: the completing authority is the row-4 boundary, not the record.
  assertEquals(interpretation.advisoryOnly, true);
  assertEquals(interpretation.grantsExecution, false);
  assertEquals(
    interpretation.operativeBoundary,
    "restricted-execution-time-default-deny",
  );
});

// -----------------------------------------------------------------------------
// 4.2/5.3 Destructive decision replays the shared conformance table verbatim.
// -----------------------------------------------------------------------------

/** Synthetic staging roots for the pure observation adapter. */
const syntheticRoots: CanonicalSessionRoots = {
  acpSessionId: "s1",
  sessionContextGeneration: "g1",
  roots: [{
    role: "staging",
    configuredPath: "/session/staging",
    canonicalPath: "/session/staging",
    readOnly: false,
  }],
};

function syntheticTarget(path: string): CanonicalTarget {
  return {
    acpSessionId: "s1",
    sessionContextGeneration: "g1",
    roles: ["staging"],
    rootIdentities: syntheticRoots.roots,
    normalizedInput: path,
    canonicalTarget: `/session/staging/${path}`,
    rootRelativePath: path,
    targetType: "file",
    observedSymlinks: [],
  };
}

/**
 * Pure-data observation adapter: in-workspace fixture paths observe as staging
 * files; any escaping spelling (contains `..`) observes as an outside-roots
 * failure — the same bounded classification row 5's filesystem-backed tests
 * produce for real paths.
 */
const adapter = {
  observe(targetPath: string): RootPathResult<CanonicalTarget> {
    if (targetPath.includes("..")) {
      return {
        ok: false,
        reason: "outside_roots",
        message: `Synthetic escape observation for '${targetPath}'`,
      };
    }
    return { ok: true, value: syntheticTarget(targetPath) };
  },
  authorizationParams(): Omit<AuthorizeWriteParams, "target"> {
    return { roots: syntheticRoots, yolo: false };
  },
};

Deno.test("Destructive: EVERY row-5 conformance fixture replays with verdict equality", () => {
  const replays = replayConformanceFixtures(adapter);
  assertEquals(replays.length, DESTRUCTIVE_CONFORMANCE_FIXTURES.length);
  for (const fixture of DESTRUCTIVE_CONFORMANCE_FIXTURES) {
    const replay = replays.find((entry) => entry.id === fixture.id)!;
    const expected = DESTRUCTIVE_CONFORMANCE_TABLE.find((row) => row.id === fixture.id)!;
    assertEquals(replay.completeness, expected.completeness, fixture.id);
    assertEquals(replay.targets, expected.targets, fixture.id);
    assertEquals(replay.outcomeReason, expected.outcomeReason, fixture.id);
  }
});

Deno.test("Destructive: fixture families replay through the entry with shared verdicts", () => {
  // Complete multi-target authorization.
  const multi = replayConformanceFixtures(adapter).find((entry) => entry.id === "multi-delete")!;
  assertEquals(multi.completeness, "complete");
  assertEquals(multi.outcomeReason, "approved");
  // First-allowed-later-escaping denial (shared table reason).
  const escape = replayConformanceFixtures(adapter).find((entry) => entry.id === "later-escape")!;
  assertEquals(escape.completeness, "complete");
  assertEquals(escape.outcomeReason, "rejected_write_path_outside_workspace");
  // Incomplete fail-closed.
  const incomplete = replayConformanceFixtures(adapter).find((entry) =>
    entry.id === "missing-destination"
  )!;
  assertEquals(incomplete.completeness, "incomplete_operation");
  assertEquals(incomplete.outcomeReason, destructiveDenialReason("incomplete_operation"));
  assertEquals(incomplete.targets, []);
  // Binding-mismatch rejection.
  const binding = replayConformanceFixtures(adapter).find((entry) =>
    entry.id === "binding-mismatch"
  )!;
  assertEquals(binding.completeness, "binding_mismatch");
  assertEquals(binding.outcomeReason, "rejected_destructive_binding");
});

Deno.test("Destructive: entry denies incomplete intents with zero side effect", () => {
  const decision = decideDestructiveIntent({
    intent: { ...DESTRUCTIVE_CONFORMANCE_FIXTURES[6].input }, // unparseable
    expandedTargets: ["a.md"],
    expandedLocations: ["a.md"],
  });
  assertEquals(decision.outcome, "deny");
  if (decision.outcome === "deny" && decision.stage === "completeness") {
    assertEquals(decision.completeness, "unparseable_input");
    assertEquals(decision.sharedReason, "rejected_destructive_incomplete");
    assertEquals(decision.mutationAttempted, false);
  }
  // First-operation-only native shapes deny fail-closed (DECIDED disposition).
  const firstOnly = decideDestructiveIntent({
    intent: { ...DESTRUCTIVE_CONFORMANCE_FIXTURES[10].input },
    expandedTargets: ["a.md"],
    expandedLocations: ["a.md"],
  });
  assertEquals(firstOnly.outcome, "deny");
  if (firstOnly.outcome === "deny" && firstOnly.stage === "completeness") {
    assertEquals(firstOnly.completeness, "incomplete_operation");
  }
});

Deno.test("Destructive: normalization-complete intents without observations never claim completion", () => {
  const decision = decideDestructiveIntent({
    intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[0].input, // delete a.md
    expandedTargets: ["a.md"],
    expandedLocations: ["a.md"],
  });
  assertEquals(decision.outcome, "complete-awaiting-authorization");
  if (decision.outcome === "complete-awaiting-authorization") {
    assertEquals(decision.authorizationEvaluated, false);
    assertEquals(decision.targets, ["a.md"]);
    assertEquals(decision.mutationAttempted, false);
  }
});

Deno.test("Destructive: no speculative decoder — unknown syntax stays the shared fail-closed reason", () => {
  const source = Deno.readTextFileSync(
    new URL("../../src/acp/omp/destructive-decision.ts", import.meta.url),
  );
  // Consumption-only: the module delegates every decode/authorization call to
  // row 5 and contains no JSON parsing or path math of its own.
  assertEquals(source.includes("JSON.parse"), false);
  assertEquals(/function (decode|normalize|authorize)[A-Za-z]*\(/.test(source), false);
  const unknown = decideDestructiveIntent({
    intent: { ...DESTRUCTIVE_CONFORMANCE_FIXTURES[7].input }, // unknown-syntax
    expandedTargets: ["a.md"],
    expandedLocations: ["a.md"],
  });
  assertEquals(unknown.outcome, "deny");
  if (unknown.outcome === "deny" && unknown.stage === "completeness") {
    assertEquals(unknown.completeness, "unsupported_syntax");
    assertEquals(unknown.sharedReason, "rejected_destructive_incomplete");
  }
});
