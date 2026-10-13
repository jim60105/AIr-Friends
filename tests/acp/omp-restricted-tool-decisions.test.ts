/**
 * Consumer-visible table tests for the restricted tool-inventory and
 * live-provenance decisions (`define-omp-restricted-tool-decisions`, row 14a).
 *
 * Pure decision logic only: nothing here demonstrates that the official binary
 * enforces, resets records, or decodes complete destructive intent.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  ALTERNATE_ROUTE_BLOCKING_TABLE,
  decideMcpAdmission,
  decideRestrictedTool,
  INPUT_SHAPE_CAPABILITIES,
  type InputShape,
  RESTRICTED_DENIAL_VOCABULARY,
  RESTRICTED_TOOL_INVENTORY_TABLE,
  type RestrictedToolDecisionRequest,
  restrictedToolPolicyGates,
  type RouteSurface,
  SECURITY_RELEVANT_SETTING_KEYS,
} from "@acp/omp/tool-inventory.ts";
import {
  evaluateToolProvenance,
  MCP_ADMISSION_MECHANISM_STATUS,
  type ProvenanceRecord,
} from "@acp/omp/tool-provenance.ts";
import { AUDITED_PINNED_LEDGER, REQUIRED_BOUNDARIES } from "@acp/omp/compatibility-contracts.ts";
import { ompSettingsForMode } from "@acp/omp-settings.ts";

const owned: ProvenanceRecord = {
  origin: "owned-extension",
  modulePath: "/opt/air/src/acp/omp/extension/index.ts",
  baseRoot: "/opt/air",
  canonicalTarget: {
    acpSessionId: "s1",
    sessionContextGeneration: "g1",
    roles: ["trusted-skills"],
    rootIdentities: [{
      role: "trusted-skills",
      configuredPath: "/opt/air/src/acp/omp/extension",
      canonicalPath: "/opt/air/src/acp/omp/extension",
      readOnly: true,
    }],
    normalizedInput: "/opt/air/src/acp/omp/extension/index.ts",
    canonicalTarget: "/opt/air/src/acp/omp/extension/index.ts",
    rootRelativePath: "index.ts",
    targetType: "file",
    observedSymlinks: [],
  },
};

const mcpFresh: ProvenanceRecord = {
  origin: "operator-mcp",
  clientMcpOwnership: true,
  registryEpochObserved: 7,
  currentRegistryEpoch: 7,
};

const mcpStale: ProvenanceRecord = {
  origin: "operator-mcp",
  clientMcpOwnership: true,
  registryEpochObserved: 6,
  currentRegistryEpoch: 7,
};

const workspaceOrigin: ProvenanceRecord = { origin: "workspace", presentedName: "read" };
const hostOrigin: ProvenanceRecord = { origin: "host", presentedName: "bash" };
const unownedOrigin: ProvenanceRecord = { origin: "unowned-discovery", presentedName: "edit" };

function req(
  toolName: string,
  provenance: ProvenanceRecord,
  inputShape: InputShape,
  extra: Partial<RestrictedToolDecisionRequest> = {},
): RestrictedToolDecisionRequest {
  return { toolName, provenance, inputShape, ...extra };
}

// -----------------------------------------------------------------------------
// 5.1 Table-driven inventory tests: every row through decideRestrictedTool.
// -----------------------------------------------------------------------------

Deno.test("Inventory: every allow-gated/routed row yields its delegating outcome", () => {
  const expectations: ReadonlyArray<
    [string, RestrictedToolDecisionRequest["inputShape"], string, string]
  > = [
    // [toolName, shape, expected outcome, expected tableRowId]
    ["read", "path-target", "allow-gated", "read-class"],
    ["list", "path-target", "allow-gated", "read-class"],
    ["glob", "path-target", "allow-gated", "read-class"],
    ["grep", "query", "allow-gated", "read-class"],
    ["search", "query", "allow-gated", "read-class"],
    ["skill", "path-target", "allow-gated", "trusted-skills"],
    ["bash", "command", "allow-gated", "bash"],
    ["write", "path-target", "allow-gated", "write-edit-ordinary"],
    ["edit", "path-target", "allow-gated", "write-edit-ordinary"],
    ["todoread", "todo", "in-session-state-only", "todo-state"],
    ["todowrite", "todo", "in-session-state-only", "todo-state"],
    ["delete", "path-target", "routed-destructive", "delete-move-patch"],
    ["move", "path-target", "routed-destructive", "delete-move-patch"],
    ["apply_patch", "opaque", "routed-destructive", "delete-move-patch"],
    ["webfetch", "url", "allow-gated-pending-adapter", "web-fetch"],
    ["websearch", "query", "allow-gated-pending-adapter", "web-search"],
  ];
  for (const [toolName, shape, outcome, tableRowId] of expectations) {
    const decision = decideRestrictedTool(req(toolName, owned, shape));
    assertEquals(decision.outcome, outcome, `${toolName}/${shape}`);
    if ("tableRowId" in decision) assertEquals(decision.tableRowId, tableRowId, toolName);
  }
});

Deno.test("Inventory: native read URL branch lands on the pending-adapter row", () => {
  const decision = decideRestrictedTool(req("read", owned, "url"));
  assertEquals(decision.outcome, "allow-gated-pending-adapter");
  if (decision.outcome === "allow-gated-pending-adapter") {
    assertEquals(decision.tableRowId, "url-read");
    assertEquals(decision.completingAuthority, "rows-17-19-transport-adapter");
  }
});

Deno.test("Inventory: pending-adapter outcome is distinct from plain allow", () => {
  const pending = decideRestrictedTool(req("webfetch", owned, "url"));
  const allowed = decideRestrictedTool(req("read", owned, "path-target"));
  assertNotEquals(pending.outcome, allowed.outcome);
  assertEquals(pending.outcome, "allow-gated-pending-adapter");
  // The parity capability is never denied either (parity preserved).
  assertNotEquals(pending.outcome, "deny");
});

Deno.test("Inventory: every named OMP-only execution surface denies", () => {
  const namedDenyRows = RESTRICTED_TOOL_INVENTORY_TABLE.filter((row) =>
    row.kind === "default-deny"
  );
  assertEquals(
    namedDenyRows.map((row) => row.id).sort(),
    [
      "deny-ast",
      "deny-async-job",
      "deny-browser",
      "deny-computer",
      "deny-config-write",
      "deny-debug",
      "deny-doom-loop",
      "deny-eval",
      "deny-external-directory",
      "deny-internal-devices",
      "deny-irc",
      "deny-launch",
      "deny-lsp",
      "deny-lsp-config",
      "deny-question",
      "deny-recipe",
      "deny-ssh",
      "deny-task",
    ],
  );
  for (const row of namedDenyRows) {
    for (const name of row.toolNames) {
      // Deny under every provenance, including owned-extension.
      for (const provenance of [owned, mcpFresh, workspaceOrigin, hostOrigin, unownedOrigin]) {
        const decision = decideRestrictedTool(req(name, provenance, "opaque"));
        assertEquals(decision.outcome, "deny", `${name}/${provenance.origin}`);
        if (decision.outcome === "deny") {
          assertEquals(decision.reason, "rejected_tool_inventory", name);
          assertEquals(decision.tableRowId, row.id, name);
        }
      }
      // Every row cites the approved capability matrix, not a handoff list.
      assertEquals(row.designCitation.includes("design §6"), true, row.id);
    }
  }
});

Deno.test("Inventory: unknown/unlisted tool denies under every provenance and shape", () => {
  const shapes: InputShape[] = [
    "path-target",
    "command",
    "url",
    "query",
    "todo",
    "config-write",
    "device-route",
    "opaque",
  ];
  for (const provenance of [owned, mcpFresh, workspaceOrigin, hostOrigin, unownedOrigin]) {
    for (const shape of shapes) {
      const ordinary = shape !== "config-write" && shape !== "device-route";
      const decision = decideRestrictedTool(req("mystery_surface", provenance, shape));
      if (provenance.origin === "operator-mcp") {
        // MCP tools are origin-keyed table members; alternate routes screen
        // first, so blocked shapes deny on the pair for MCP too.
        if (ordinary) {
          assertEquals(decision.outcome, "routed-provenance", shape);
        } else {
          assertEquals(decision.outcome, "deny", shape);
          if (decision.outcome === "deny") {
            assertEquals(decision.reason, "rejected_alternate_route", shape);
          }
        }
        continue;
      }
      if (ordinary) {
        assertEquals(decision.outcome, "deny", `${provenance.origin}/${shape}`);
        if (decision.outcome === "deny") {
          assertEquals(decision.reason, "rejected_tool_inventory", shape);
          assertEquals(decision.denyByAbsence, true, shape);
        }
      } else {
        // Alternate-route screening precedes name lookup: rename-invariant pair.
        assertEquals(decision.outcome, "deny", shape);
        if (decision.outcome === "deny") {
          assertEquals(decision.reason, "rejected_alternate_route", shape);
        }
      }
    }
  }
});

Deno.test("Inventory: a surface omitted from the table lands in default-deny structurally", () => {
  // Deliberately not table rows: any surface the audit cannot enumerate
  // denies by absence, not by audit completeness. `codesearch` migrated here
  // from the pending-adapter row that `remove-omp-public-code-search` cut —
  // dedicated public code search is outside the pinned OpenCode parity
  // target, so an unlisted dedicated search name must deny by absence.
  for (const name of ["some_future_omp_tool", "codesearch"]) {
    const decision = decideRestrictedTool(req(name, owned, "opaque"));
    assertEquals(decision.outcome, "deny", name);
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_tool_inventory", name);
      assertEquals(decision.denyByAbsence, true, name);
      assertEquals(decision.tableRowId, `default-deny-by-absence:${name}`, name);
    }
  }
});

Deno.test("Inventory: todo-shaped write/edit never opens a filesystem mutation route", () => {
  for (const name of ["write", "edit"]) {
    const decision = decideRestrictedTool(req(name, owned, "todo"));
    assertEquals(decision.outcome, "in-session-state-only", name);
    if (decision.outcome === "in-session-state-only") {
      assertEquals(decision.filesystemMutationRoute, false);
      assertEquals(decision.completingAuthority, "in-session-todo-state-only");
    }
  }
  // A destructive-named tool never downgrades to session state.
  const del = decideRestrictedTool(req("delete", owned, "todo"));
  assertEquals(del.outcome, "routed-destructive");
});

Deno.test("Inventory: read/search-class and ordinary write/edit name the native-local authorities (task 2.1)", () => {
  for (const name of ["read", "glob", "grep", "find"]) {
    const decision = decideRestrictedTool(req(name, owned, "path-target"));
    assertEquals(decision.outcome, "allow-gated", name);
    if (decision.outcome === "allow-gated") {
      assertEquals(decision.completingAuthority, "native-local-read-approval", name);
      assertEquals(decision.tableRowId, "read-class", name);
    }
  }
  for (const name of ["write", "edit"]) {
    const decision = decideRestrictedTool(req(name, owned, "path-target"));
    assertEquals(decision.outcome, "allow-gated", name);
    if (decision.outcome === "allow-gated") {
      assertEquals(decision.completingAuthority, "native-local-write-approval", name);
    }
  }
  // The former row-4 write-sink naming is gone; the ACP PROTECTED callback
  // read route keeps its own row-4 authority unchanged.
  const authorities = RESTRICTED_TOOL_INVENTORY_TABLE.map((row) => row.completingAuthority);
  assertEquals(
    (authorities as readonly (string | undefined)[]).includes(
      "row4-filesystem-write-sink",
    ),
    false,
  );
  assertEquals(decideRestrictedTool(req("skill", owned, "path-target")), {
    outcome: "allow-gated",
    completingAuthority: "row4-filesystem-read-boundary",
    tableRowId: "trusted-skills",
  });
  // Truthful posture: the read-class wording claims the ambient OS posture,
  // not daemon descriptor-bound confinement.
  const readRow = RESTRICTED_TOOL_INVENTORY_TABLE.find((row) => row.id === "read-class")!;
  assertEquals(readRow.notes.includes("ambient OS permissions"), true);
  assertEquals(readRow.notes.includes("not daemon descriptor-bound"), true);
});

// -----------------------------------------------------------------------------
// 2.2 / 5.1 Alternate-route pair blocking.
// -----------------------------------------------------------------------------

Deno.test("Alternate routes: every blocked pair denies by shape-derived capability+route", () => {
  const shapeOf: Partial<Record<string, InputShape>> = {
    "internal-uri-scheme": "device-route",
    "config-device": "config-write",
  };
  for (const pair of ALTERNATE_ROUTE_BLOCKING_TABLE) {
    const shape = shapeOf[pair.route] ?? "device-route";
    const decision = decideRestrictedTool(
      req("read", owned, shape, {
        ...(shapeOf[pair.route] ? {} : { deviceSurface: pair.route }),
        decodedCapability: pair.capability,
      }),
    );
    assertEquals(decision.outcome, "deny", `${pair.capability}/${pair.route}`);
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_alternate_route", pair.capability);
      assertEquals(decision.blockedPair?.capability, pair.capability);
      assertEquals(decision.blockedPair?.route, pair.route);
    }
  }
});

Deno.test("Alternate routes: a remote URL search root denies as a remote route, never as a local read", () => {
  for (const capability of ["network-read", "filesystem-read"]) {
    const decision = decideRestrictedTool(
      req("grep", owned, "device-route", {
        deviceSurface: "remote-url",
        decodedCapability: capability,
      }),
    );
    assertEquals(decision.outcome, "deny", capability);
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_alternate_route");
      assertEquals(decision.blockedPair?.route, "remote-url");
      assertEquals(decision.blockedPair?.capability, capability);
    }
  }
  // The owned read adapter answers HTTP(S) through its own ordinary url
  // branch: that route is not relabeled by the remote-url pair.
  const readUrl = decideRestrictedTool(req("read", owned, "url"));
  assertEquals(readUrl.outcome, "allow-gated-pending-adapter");
  if (readUrl.outcome === "allow-gated-pending-adapter") {
    assertEquals(readUrl.tableRowId, "url-read");
  }
});

Deno.test("Alternate routes: execution via internal scheme denies while bash is gated", () => {
  const bash = decideRestrictedTool(req("bash", owned, "command"));
  assertEquals(bash.outcome, "allow-gated");
  const viaScheme = decideRestrictedTool(
    req("bash", owned, "device-route", { decodedCapability: "execution" }),
  );
  assertEquals(viaScheme.outcome, "deny");
  if (viaScheme.outcome === "deny") {
    assertEquals(viaScheme.reason, "rejected_alternate_route");
    assertEquals(viaScheme.blockedPair?.capability, "execution");
    assertEquals(viaScheme.blockedPair?.route, "internal-uri-scheme");
  }
});

Deno.test("Alternate routes: config-write posture flip denies while writes are sink-routed", () => {
  const ordinaryWrite = decideRestrictedTool(req("write", owned, "path-target"));
  assertEquals(ordinaryWrite.outcome, "allow-gated");
  if (ordinaryWrite.outcome === "allow-gated") {
    assertEquals(ordinaryWrite.completingAuthority, "native-local-write-approval");
  }
  // A config write targeting approval posture, presented by the ordinary
  // `write` tool, denies regardless of the sink route's status.
  const postureFlip = decideRestrictedTool(
    req("write", owned, "config-write", { decodedCapability: "approval-posture" }),
  );
  assertEquals(postureFlip.outcome, "deny");
  if (postureFlip.outcome === "deny") {
    assertEquals(postureFlip.reason, "rejected_alternate_route");
    assertEquals(postureFlip.blockedPair?.capability, "approval-posture");
    assertEquals(postureFlip.blockedPair?.route, "config-device");
  }
  // The posture/security key list names the protected keys; config-write
  // shapes deny on the route itself, so the list can never under-detect.
  assertEquals(SECURITY_RELEVANT_SETTING_KEYS.includes("tools.approval"), true);
  const unknownKey = decideRestrictedTool(
    req("write", owned, "config-write", { decodedCapability: "filesystem-write" }),
  );
  assertEquals(unknownKey.outcome, "deny");
  if (unknownKey.outcome === "deny") {
    assertEquals(unknownKey.reason, "rejected_alternate_route");
  }
});

Deno.test("Alternate routes: hidden mutation/debug/device routes deny while read/write allowed", () => {
  for (
    const [name, surface, capability] of [
      ["read", "internal-uri-scheme", "filesystem-read"],
      ["write", "debug-device", "filesystem-write"],
      ["edit", "ast-device", "filesystem-write"],
      ["edit", "lsp-adjacent", "filesystem-write"],
      ["read", "ssh-device", "filesystem-read"],
    ] as const
  ) {
    const decision = decideRestrictedTool(
      req(name, owned, "device-route", {
        deviceSurface: surface,
        decodedCapability: capability,
      }),
    );
    assertEquals(decision.outcome, "deny", `${name}/${surface}`);
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_alternate_route", surface);
      assertEquals(decision.blockedPair?.route, surface);
    }
  }
});

Deno.test("Alternate routes: denial survives tool rename and gate/sink status", () => {
  // Same (capability, route) pair presented under one on-table name, another
  // on-table name, and an off-table alias: identical pair-named denial.
  const pair = { decodedCapability: "filesystem-write", deviceSurface: "ast-device" } as const;
  const decisions = ["edit", "write", "renamed_ast_carrier"].map((name) =>
    decideRestrictedTool(req(name, owned, "device-route", pair))
  );
  for (const decision of decisions) {
    assertEquals(decision.outcome, "deny");
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_alternate_route");
      assertEquals(decision.blockedPair?.capability, "filesystem-write");
      assertEquals(decision.blockedPair?.route, "ast-device");
    }
  }
});

Deno.test("Alternate routes: an unenumerated non-ordinary pair still denies fail-closed", () => {
  const decision = decideRestrictedTool(
    req("read", owned, "device-route", {
      deviceSurface: "debug-device",
      decodedCapability: "time-travel",
    }),
  );
  assertEquals(decision.outcome, "deny");
  if (decision.outcome === "deny") {
    assertEquals(decision.reason, "rejected_alternate_route");
    assertEquals(decision.blockedPair?.capability, "time-travel");
    assertEquals(decision.blockedPair?.route, "debug-device");
  }
});

Deno.test("Alternate routes: decoder metadata can never downgrade a non-ordinary shape to the ordinary route", () => {
  // Post-review clamp: `deviceSurface` refines, never downgrades. A mislabeled
  // `ordinary-tool` surface on a config-write or device-route shape still
  // denies on the shape-derived route (type-level Exclude plus runtime clamp).
  const postureFlip = decideRestrictedTool(
    req("write", owned, "config-write", {
      deviceSurface: "ordinary-tool" as unknown as Exclude<RouteSurface, "ordinary-tool">,
      decodedCapability: "approval-posture",
    }),
  );
  assertEquals(postureFlip.outcome, "deny");
  if (postureFlip.outcome === "deny") {
    assertEquals(postureFlip.reason, "rejected_alternate_route");
    assertEquals(postureFlip.blockedPair?.route, "config-device");
  }
  const deviceSmuggle = decideRestrictedTool(
    req("bash", owned, "device-route", {
      deviceSurface: "ordinary-tool" as unknown as Exclude<RouteSurface, "ordinary-tool">,
      decodedCapability: "execution",
    }),
  );
  assertEquals(deviceSmuggle.outcome, "deny");
  if (deviceSmuggle.outcome === "deny") {
    assertEquals(deviceSmuggle.reason, "rejected_alternate_route");
    assertEquals(deviceSmuggle.blockedPair?.route, "internal-uri-scheme");
  }
});

Deno.test("Inventory: deny reasons always lie in the bounded vocabulary", () => {
  const probes: RestrictedToolDecisionRequest[] = [
    req("mystery", owned, "opaque"),
    req("eval", owned, "opaque"),
    req("read", workspaceOrigin, "path-target"),
    req("bash", owned, "device-route", { decodedCapability: "execution" }),
    req("weird", mcpStale, "query"),
    req("webfetch", owned, "url"),
  ];
  for (const probe of probes) {
    const decision = decideRestrictedTool(probe);
    if (decision.outcome === "deny") {
      assertEquals(
        RESTRICTED_DENIAL_VOCABULARY.includes(decision.reason),
        true,
        JSON.stringify(decision),
      );
    }
  }
});

Deno.test("Inventory: decisions are deterministic pure functions of (name, provenance, shape)", () => {
  const request = req("write", owned, "path-target");
  const first = decideRestrictedTool(request);
  const second = decideRestrictedTool({ ...request });
  assertEquals(first, second);
  assertEquals(
    decideRestrictedTool(req("read", owned, "path-target")),
    decideRestrictedTool(req("read", owned, "path-target")),
  );
});

Deno.test("Inventory: shape capabilities are named for every input shape", () => {
  const shapes: InputShape[] = [
    "path-target",
    "command",
    "url",
    "query",
    "todo",
    "config-write",
    "device-route",
    "opaque",
  ];
  for (const shape of shapes) {
    assertEquals(typeof INPUT_SHAPE_CAPABILITIES[shape], "string", shape);
  }
});

// -----------------------------------------------------------------------------
// 3.1/5.2 Live-provenance admission and MCP admission decisions.
// -----------------------------------------------------------------------------

Deno.test("Provenance: same allow-table name from wrong origin denies; owned admits", () => {
  for (const wrong of [workspaceOrigin, hostOrigin, unownedOrigin]) {
    const admitted = evaluateToolProvenance("read", owned, { nameOnAllowTable: true });
    const denied = evaluateToolProvenance("read", wrong, { nameOnAllowTable: true });
    assertEquals(admitted.admit, true, wrong.origin);
    assertEquals(denied.admit, false, wrong.origin);
    if (!denied.admit) assertEquals(denied.reason, "untrusted_origin");
    // Same at the entry decision: deny with the bounded provenance reason.
    const entry = decideRestrictedTool(req("read", wrong, "path-target"));
    assertEquals(entry.outcome, "deny", wrong.origin);
    if (entry.outcome === "deny") assertEquals(entry.reason, "rejected_tool_provenance");
  }
  assertEquals(decideRestrictedTool(req("read", owned, "path-target")).outcome, "allow-gated");
});

Deno.test("Provenance: native-builtin admits the exact pinned tuple; wrong tuple and stale stamps deny (tasks 1.2/1.3)", () => {
  const nativeBuiltin: ProvenanceRecord = {
    origin: "native-builtin",
    sourcePath: "<builtin:grep>",
    sourceScope: "temporary",
    sourceOrigin: "top-level",
    registryEpochObserved: 3,
    currentRegistryEpoch: 3,
    observedResourceGeneration: "gen-0",
    currentResourceGeneration: "gen-0",
  };
  assertEquals(
    evaluateToolProvenance("grep", nativeBuiltin, { nameOnAllowTable: true }).admit,
    true,
  );
  // Entry decision: the authentic builtin reaches its native-local authority.
  assertEquals(decideRestrictedTool(req("grep", nativeBuiltin, "query")), {
    outcome: "allow-gated",
    completingAuthority: "native-local-read-approval",
    tableRowId: "read-class",
  });
  // The record must carry THIS name's tuple: a foreign/claimed tuple, or one
  // outside the pinned scope/origin, is an unknown observation — never
  // admitted on a cached or claimed name.
  for (
    const forged of [
      { ...nativeBuiltin, sourcePath: "<builtin:read>" },
      { ...nativeBuiltin, sourceScope: "project" },
      { ...nativeBuiltin, sourceOrigin: "package" },
    ]
  ) {
    const denied = evaluateToolProvenance("grep", forged, { nameOnAllowTable: true });
    assertEquals(denied.admit, false);
    if (!denied.admit) assertEquals(denied.reason, "unknown_observation");
  }
  // Stale/cross-domain stamps deny re-observe and NAME the element that
  // mismatched.
  const staleEpoch = evaluateToolProvenance(
    "grep",
    { ...nativeBuiltin, registryEpochObserved: 2 },
    { nameOnAllowTable: true },
  );
  assertEquals(staleEpoch.admit, false);
  if (!staleEpoch.admit) {
    assertEquals(staleEpoch.reason, "stale_observation");
    assertEquals(staleEpoch.pending, "re-observe");
    assertEquals(staleEpoch.staleElement, "registry-epoch");
  }
  const staleGeneration = evaluateToolProvenance(
    "grep",
    { ...nativeBuiltin, observedResourceGeneration: "gen-1" },
    { nameOnAllowTable: true },
  );
  assertEquals(staleGeneration.admit, false);
  if (!staleGeneration.admit) {
    assertEquals(staleGeneration.reason, "stale_observation");
    assertEquals(staleGeneration.staleElement, "resource-generation");
  }
  // The entry decision surfaces the same element so the wiring names it.
  const entry = decideRestrictedTool(
    req("grep", { ...nativeBuiltin, observedResourceGeneration: "gen-1" }, "query"),
  );
  assertEquals(entry.outcome, "deny");
  if (entry.outcome === "deny") {
    assertEquals(entry.reason, "rejected_tool_provenance");
    assertEquals(entry.pending, "re-observe");
    assertEquals(entry.staleElement, "resource-generation");
  }
  // A builtin name outside the allow table is a name denial, not an origin
  // admission.
  const offTable = evaluateToolProvenance(
    "eval",
    { ...nativeBuiltin, sourcePath: "<builtin:eval>" },
    { nameOnAllowTable: false },
  );
  assertEquals(offTable.admit, false);
  if (!offTable.admit) assertEquals(offTable.reason, "name_not_on_allow_table");
});

Deno.test("Provenance: owned-extension admission requires canonical ownership evidence", () => {
  const bare: ProvenanceRecord = {
    origin: "owned-extension",
    modulePath: owned.modulePath,
    baseRoot: owned.baseRoot,
  };
  const denied = evaluateToolProvenance("read", bare, { nameOnAllowTable: true });
  assertEquals(denied.admit, false);
  if (!denied.admit) {
    assertEquals(denied.reason, "canonical_ownership_evidence_missing");
    assertEquals(denied.pending, "re-observe");
  }
});

Deno.test("Provenance: post-start operator MCP refresh admits on fresh epoch without elicitation", () => {
  // Registered or refreshed after startup: observed epoch catches up to current.
  const admitted = evaluateToolProvenance("mcp_tools/list_rows", mcpFresh, {
    nameOnAllowTable: true,
  });
  assertEquals(admitted.admit, true);
  const entry = decideRestrictedTool(req("mcp_server_any_tool", mcpFresh, "query"));
  assertEquals(entry.outcome, "routed-provenance");
  if (entry.outcome === "routed-provenance") {
    assertEquals(entry.completingAuthority, "mcp-client-ownership");
    assertEquals(entry.provenance.admit, true);
  }
  // No elicitation field or code path exists in the decision shape.
  assertEquals("elicitation" in entry, false);
});

Deno.test("Provenance: stale registry observation denies pending re-observation", () => {
  const stale = evaluateToolProvenance("mcp_tool", mcpStale, { nameOnAllowTable: true });
  assertEquals(stale.admit, false);
  if (!stale.admit) {
    assertEquals(stale.reason, "stale_observation");
    assertEquals(stale.pending, "re-observe");
  }
  const future = evaluateToolProvenance("mcp_tool", {
    origin: "operator-mcp",
    clientMcpOwnership: true,
    registryEpochObserved: 9,
    currentRegistryEpoch: 7,
  }, { nameOnAllowTable: true });
  assertEquals(future.admit, false);
  if (!future.admit) {
    assertEquals(future.reason, "unknown_observation");
    assertEquals(future.pending, "re-observe");
  }
  // Entry decision keeps the bounded vocabulary: provenance reason + pending.
  const entry = decideRestrictedTool(req("mcp_tool", mcpStale, "query"));
  assertEquals(entry.outcome, "deny");
  if (entry.outcome === "deny") {
    assertEquals(entry.reason, "rejected_tool_provenance");
    assertEquals(entry.pending, "re-observe");
  }
});

Deno.test("Provenance: MCP origin claim without client ownership is an origin failure", () => {
  const denied = evaluateToolProvenance("mcp_tool", {
    origin: "operator-mcp",
    clientMcpOwnership: false,
    registryEpochObserved: 7,
    currentRegistryEpoch: 7,
  }, { nameOnAllowTable: true });
  assertEquals(denied.admit, false);
  if (!denied.admit) assertEquals(denied.reason, "client_ownership_absent");
});

Deno.test("Provenance: stale generation observation denies re-observe for owned extension", () => {
  const staleGen: ProvenanceRecord = {
    ...owned,
    observedResourceGeneration: "gen-1",
    currentResourceGeneration: "gen-2",
  };
  const denied = evaluateToolProvenance("read", staleGen, { nameOnAllowTable: true });
  assertEquals(denied.admit, false);
  if (!denied.admit) {
    assertEquals(denied.reason, "stale_observation");
    assertEquals(denied.pending, "re-observe");
  }
});

Deno.test("Provenance: a half-supplied generation observation denies re-observe", () => {
  // Post-review clamp: 14b supplies BOTH generations or NEITHER. Only one
  // present is an incomplete observation, never a freshness-check bypass.
  const halfObserved: ProvenanceRecord = { ...owned, observedResourceGeneration: "gen-1" };
  const deniedObservedOnly = evaluateToolProvenance("read", halfObserved, {
    nameOnAllowTable: true,
  });
  assertEquals(deniedObservedOnly.admit, false);
  if (!deniedObservedOnly.admit) {
    assertEquals(deniedObservedOnly.reason, "stale_observation");
    assertEquals(deniedObservedOnly.pending, "re-observe");
  }
  const halfCurrent: ProvenanceRecord = { ...owned, currentResourceGeneration: "gen-1" };
  assertEquals(
    evaluateToolProvenance("read", halfCurrent, { nameOnAllowTable: true }).admit,
    false,
  );
  // Both supplied and agreeing admits.
  assertEquals(
    evaluateToolProvenance(
      "read",
      { ...owned, observedResourceGeneration: "gen-3", currentResourceGeneration: "gen-3" },
      { nameOnAllowTable: true },
    ).admit,
    true,
  );
});

Deno.test("MCP admission: client-owned fresh tool admitted without human interaction", () => {
  const decision = decideMcpAdmission({
    toolName: "operator_server/tool",
    provenance: mcpFresh,
    inputShape: "query",
  });
  assertEquals(decision.admit, true);
  if (decision.admit) {
    assertEquals(decision.gatedBy, "mcp-client-ownership");
    // The view is tied to the single inventory table as decision source.
    assertEquals(decision.tableRowId, "operator-mcp");
    // Honest basis: never `supported`.
    assertEquals(decision.basisStatus, "needs-mechanism-audit");
  }
  const routeScreened = decideMcpAdmission({
    toolName: "operator_server/tool",
    provenance: mcpFresh,
    inputShape: "device-route",
    decodedCapability: "execution",
  });
  assertEquals(routeScreened.admit, false);
  if (!routeScreened.admit) {
    assertEquals(routeScreened.reason, "rejected_alternate_route");
    assertEquals(routeScreened.blockedPair?.capability, "execution");
  }
});

Deno.test("MCP admission view is a re-expression of the entry decision, not a second allow path", () => {
  // Non-MCP provenance through the admission view must fail closed with the
  // entry decision's own bounded reason (no parallel ownership bypass).
  const ownedCall = decideMcpAdmission({
    toolName: "read",
    provenance: owned,
    inputShape: "path-target",
  });
  assertEquals(ownedCall.admit, false);
  if (!ownedCall.admit) {
    // owned-extension origin does not produce a routed-provenance outcome.
    assertEquals(ownedCall.reason, "rejected_tool_provenance");
  }
  const staleCall = decideMcpAdmission({
    toolName: "operator_server/tool",
    provenance: mcpStale,
    inputShape: "query",
  });
  assertEquals(staleCall.admit, false);
  if (!staleCall.admit) {
    assertEquals(staleCall.reason, "rejected_tool_provenance");
    assertEquals(staleCall.pending, "re-observe");
    assertEquals(staleCall.tableRowId, "operator-mcp");
  }
});

Deno.test("MCP mechanism table: ledger gap cited, tiers honest, never relabelable", () => {
  assertEquals(
    MCP_ADMISSION_MECHANISM_STATUS.map((row) => row.status).sort(),
    ["candidate-to-verify", "needs-mechanism-audit"],
  );
  for (const row of MCP_ADMISSION_MECHANISM_STATUS) {
    // The tier vocabulary itself excludes `supported`.
    assertEquals(["needs-mechanism-audit", "candidate-to-verify"].includes(row.status), true);
  }
  // The basis row cites the ledger gap explicitly.
  assertEquals(
    MCP_ADMISSION_MECHANISM_STATUS.find((row) => row.status === "needs-mechanism-audit")!
      .citation
      .includes("no MCP boundary row"),
    true,
  );
  // The pinned ledger itself indeed has no MCP boundary row: the closed
  // boundary vocabulary contains no MCP member at all.
  assertEquals(
    AUDITED_PINNED_LEDGER.map((entry) => entry.boundary).some((boundary) =>
      boundary.toLowerCase().includes("mcp")
    ),
    false,
  );
  assertEquals(
    REQUIRED_BOUNDARIES.some((boundary) => boundary.toLowerCase().includes("mcp")),
    false,
  );
  assertEquals(restrictedToolPolicyGates.mcpLedgerGap.hasMcpBoundaryRow, false);
  assertEquals(restrictedToolPolicyGates.mcpLedgerGap.basisStatus, "needs-mechanism-audit");
});

// -----------------------------------------------------------------------------
// 5.4 Restricted-only consultation posture and preserved pinned verdicts.
// -----------------------------------------------------------------------------

Deno.test("Posture: modules are restricted-only; YOLO exempt; OpenCode unchanged", () => {
  const posture = restrictedToolPolicyGates.consultationPosture;
  assertEquals(posture.restrictedOnly, true);
  assertEquals(posture.yoloExempt, true);
  assertEquals(posture.opencodeUnchanged, true);
  assertEquals(posture.elicitation, "explicitly-absent");
  assertEquals(posture.pendingUserDecisionRequired, false);
  // Structural: no decision request accepts a YOLO/session-mode flag — the
  // vocabulary itself cannot express a YOLO consultation.
  const requestKeys: readonly string[] = Object.keys(req("read", owned, "path-target"));
  assertEquals(requestKeys.includes("yolo"), false);
  assertEquals(requestKeys.includes("sessionMode"), false);
});

Deno.test("Gates: pinned verdicts restated as sourced data; tests cannot clear them", () => {
  const ledgerReset = AUDITED_PINNED_LEDGER.find((e) => e.boundary === "record_authority")!;
  const ledgerDestructive = AUDITED_PINNED_LEDGER.find((e) => e.boundary === "destructive_intent")!;
  const row8 = ompSettingsForMode("restricted").recordResetGate;
  const verdicts = restrictedToolPolicyGates.verdicts;
  const recordReset = verdicts.find((v) => v.boundary === "record_authority")!;
  const destructive = verdicts.find((v) => v.boundary === "destructive_intent")!;
  // Ledger status/notes/evidence are quoted from the source module, not retyped.
  assertEquals(recordReset.pinnedLedgerStatus, ledgerReset.status);
  assertEquals(recordReset.pinnedLedgerNotes, ledgerReset.notes);
  assertEquals(recordReset.pinnedLedgerSourceCitation, ledgerReset.sourceCitation);
  assertEquals(destructive.pinnedLedgerStatus, ledgerDestructive.status);
  assertEquals(destructive.pinnedLedgerNotes, ledgerDestructive.notes);
  // Register labels are kept distinct from ledger statuses (no relabeling).
  assertEquals(recordReset.registerVerdict, "INCOMPATIBLE");
  assertEquals(destructive.registerVerdict, "UNRESOLVED");
  assertEquals(ledgerDestructive.status, "incompatible");
  // Both DECIDED dispositions stand independently of the verdicts.
  assertEquals(recordReset.userDisposition, "DECIDED");
  assertEquals(destructive.userDisposition, "DECIDED");
  // Row-8 gate consumed verbatim; no reset claim.
  assertEquals(restrictedToolPolicyGates.row8RecordResetGate.reason, row8.reason);
  assertEquals(
    restrictedToolPolicyGates.row8RecordResetGate.operativeSecurityBoundary,
    row8.operativeSecurityBoundary,
  );
  assertEquals(restrictedToolPolicyGates.row8RecordResetGate.status, "unresolved");
  // The synthetic allow fixtures above changed nothing: gates still report the
  // pinned records (asserted against the same sourced constants every run).
  assertEquals(restrictedToolPolicyGates.verdicts.length, 2);
});
