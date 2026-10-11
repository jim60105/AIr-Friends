// tests/acp/omp-lsp-coldstart-evidence.test.ts
//
// Restricted cold-start inventory evidence for `disable-restricted-agent-lsp`
// (batch row 17, decision 5). Pins the evidence honestly:
//
//  - The tasks-4.1 additive-row condition is NOT met on the consultable OMP
//    surface, so row 17 adds no new inventory rows. These named records
//    replace the (unnecessary) rows and state why.
//  - Every LSP surface the restricted decision can consult is already owned
//    by an existing named deny row (`deny-lsp`, `deny-lsp-config`) or by the
//    shape-keyed `lsp-adjacent` route pairs, and each composes deny for every
//    provenance origin (the row-14 "names deny for all origins" rule).
//  - The remaining native LSP carriers on the pinned OMP tree are
//    native-INTERNAL hardcoded `enableLsp: true` sessions — cleanse/agent.ts
//    :105/:140/:174 and security/coordinator.ts:268 — reachable only through
//    the cleanse/security-audit surfaces, which carry no consultable tool
//    name and so stay deny-by-absence. Natively, `--no-lsp` sets
//    `enableLsp: false` (main.ts:1626), consumed by tool construction
//    (sdk.ts:2111) and the shared LSP client switch (sdk.ts:4990), so the
//    consultable cold-start routes (edit/write writethrough, delete
//    diagnostics, the `lsp` tool itself) are also gated at the source.
//  - Boundary 5 evidence limits are preserved as recorded: OMP `unresolved`,
//    OpenCode `incompatible`; explicit denial proves neither native server
//    suppression nor implicit-startup suppression, and the four agent/mode
//    runtime observations remain user-owned UNVERIFIED.
//
// Nothing here certifies native runtime suppression of language servers.

import { assert, assertEquals } from "@std/assert";
import {
  ALTERNATE_ROUTE_BLOCKING_TABLE,
  decideRestrictedTool,
  RESTRICTED_TOOL_INVENTORY_TABLE,
} from "@acp/omp/tool-inventory.ts";
import { AUDITED_PINNED_LEDGER } from "@acp/omp/compatibility-contracts.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";

const origins = ["owned-extension", "workspace", "host", "unowned-discovery"] as const;

function originProvenance(origin: (typeof origins)[number], toolName: string): ProvenanceRecord {
  return { origin, presentedName: toolName } as ProvenanceRecord;
}

// -----------------------------------------------------------------------------
// 5a/5b: the pinned verdicts stay open despite the row-17 carriers. The
// carriers are launch/config/permission wiring, not disablement proof.
// -----------------------------------------------------------------------------

Deno.test("LSP boundary 5a (OMP): ledger stays unresolved with its cold-start reason", () => {
  const entry = AUDITED_PINNED_LEDGER.find((e) =>
    e.boundary === "restricted_lsp" &&
    e.subcase === "omp"
  );
  assert(entry, "restricted_lsp/omp ledger entry exists");
  assertEquals(entry.status, "unresolved");
  assertEquals(
    entry.notes,
    "--no-lsp stops background discovery, but lazy cold-start via edit/write requires live verification.",
  );
  assertEquals(entry.downstreamOwner, "disable-restricted-agent-lsp");
});

Deno.test("LSP boundary 5b (OpenCode): ledger stays incompatible, global-only scoping", () => {
  const entry = AUDITED_PINNED_LEDGER.find((e) =>
    e.boundary === "restricted_lsp" &&
    e.subcase === "opencode"
  );
  assert(entry, "restricted_lsp/opencode ledger entry exists");
  assertEquals(entry.status, "incompatible");
  assertEquals(
    entry.notes,
    "Per-agent denial stops explicit tool, but implicit server startup can only be disabled globally, which clamps YOLO.",
  );
  assertEquals(entry.downstreamOwner, "disable-restricted-agent-lsp");
});

// -----------------------------------------------------------------------------
// Existing named deny rows for the LSP surfaces: deny for every origin,
// attributed to their own rows (row 14 rule), plus the lsp-adjacent route
// pairs deny through shape-keyed screening independent of any name.
// -----------------------------------------------------------------------------

Deno.test("Cold-start inventory: named LSP deny rows deny for every provenance origin", () => {
  const lspNamedRows = RESTRICTED_TOOL_INVENTORY_TABLE.filter((row) =>
    row.kind === "default-deny" &&
    row.toolNames.some((name) => name === "lsp" || name.startsWith("lsp"))
  );
  assertEquals(lspNamedRows.map((row) => row.id), ["deny-lsp", "deny-lsp-config"]);
  for (const row of lspNamedRows) {
    for (const toolName of row.toolNames) {
      for (const origin of origins) {
        const decision = decideRestrictedTool({
          toolName,
          provenance: originProvenance(origin, toolName),
          inputShape: "opaque",
        });
        assertEquals(decision.outcome, "deny", `${toolName}/${origin}`);
        if (decision.outcome === "deny") {
          assertEquals(decision.reason, "rejected_tool_inventory", toolName);
          assertEquals(decision.tableRowId, row.id, toolName);
        }
      }
    }
  }
});

Deno.test("Cold-start inventory: lsp-adjacent route pairs deny by shape, rename-invariant", () => {
  // The two enumerated LSP-adjacent blocking pairs exist independently of
  // any tool name (design D4), so a renamed carrier of a filesystem-write or
  // destructive shape routed LSP-adjacent denies with the pair named, never
  // by name matching.
  const lspPairs = ALTERNATE_ROUTE_BLOCKING_TABLE.filter((pair) => pair.route === "lsp-adjacent");
  assertEquals(
    lspPairs.map((pair) => pair.capability).sort(),
    ["destructive-mutation", "filesystem-write"],
  );
  for (const capability of ["filesystem-write", "destructive-mutation"]) {
    const decision = decideRestrictedTool({
      toolName: "renamed-carrier-of-lsp-refactor",
      provenance: originProvenance("host", "renamed-carrier-of-lsp-refactor"),
      inputShape: "path-target",
      deviceSurface: "lsp-adjacent",
      decodedCapability: capability,
    });
    assertEquals(decision.outcome, "deny", capability);
    if (decision.outcome === "deny") {
      assertEquals(decision.reason, "rejected_alternate_route", capability);
      assertEquals(decision.blockedPair, { capability, route: "lsp-adjacent" });
    }
  }
});

Deno.test("Cold-start inventory: native-internal LSP carriers stay deny-by-absence; no additive row", () => {
  // The native-internal enableLsp:true sessions (cleanse/security-audit)
  // surface only under these names, which are absent from the consultable
  // table — so the structural default-deny covers them and the tasks-4.1
  // additive-row condition ("only if a distinct consultable tool name
  // retains a cold-start path") is not met. Row 17 therefore adds NO rows;
  // this pins the resulting table so a silent additive row (or a silent
  // removal of the LSP deny family) fails here.
  for (const absent of ["cleanse", "security-audit", "writethrough", "lsp-diagnostics"]) {
    const decision = decideRestrictedTool({
      toolName: absent,
      provenance: originProvenance("host", absent),
      inputShape: "opaque",
    });
    assertEquals(decision.outcome, "deny", absent);
    if (decision.outcome === "deny") {
      assertEquals(decision.denyByAbsence, true, absent);
      assertEquals(decision.tableRowId, `default-deny-by-absence:${absent}`, absent);
    }
  }
  // Table drift tripwires: 29 rows total, 18 default-deny rows, exactly two
  // LSP name rows — as row 14 landed them and as row 17 left them.
  assertEquals(RESTRICTED_TOOL_INVENTORY_TABLE.length, 29);
  assertEquals(
    RESTRICTED_TOOL_INVENTORY_TABLE.filter((row) => row.kind === "default-deny").length,
    18,
  );
});

// -----------------------------------------------------------------------------
// Carrier-file tripwires: factory carries the flag exactly once, the native-yolo
// overlay carries the row-25 decision-5 lsp.enabled:false settings pin (row 17
// never pre-empted it; row 25 landed it), and the orphaned decision-6 posture
// file is recorded, not silently deleted or re-adopted.
// -----------------------------------------------------------------------------

Deno.test("Carriers: factory carries --no-lsp exactly once; native-yolo carries the landed row-25 settings pin", async () => {
  const factory = await Deno.readTextFile("src/acp/agent-factory.ts");
  assertEquals(
    factory.split(`"--no-lsp"`).length - 1,
    1,
    "--no-lsp is a single shared-branch literal covering both modes",
  );
  const yoloSettings = await Deno.readTextFile("agent-config/omp/native-yolo.yml");
  assert(
    yoloSettings.includes("lsp:\n  enabled: false"),
    "row 25 landed the decision-5 shared lsp.enabled:false pin in native-yolo",
  );
  const restricted = await Deno.readTextFile("agent-config/omp/restricted.yml");
  assert(restricted.includes("lsp"), "restricted keeps its row-8 lsp pin");
});

Deno.test("Residual record: lsp-validator decision-6 posture remains orphaned and named", async () => {
  // src/acp/omp/lsp-validator.ts exposes validateRestrictedLspContract() —
  // the superseded decision-6 "restricted off / native-YOLO on" posture.
  // Decision 5 (all-off, both modes, both agents) replaced that posture;
  // row 17 intentionally does NOT wire the export (YOLO must never reach a
  // restricted handler) and does not delete it (the file ships as part of
  // row 1's contract surface, consumed only by row 1's own
  // omp-compatibility-contracts suite, never by a runtime path).
  // This test pins the orphaned state so a future change either retires the
  // file explicitly or re-adopts it deliberately with a decision update —
  // never by accident.
  const source = await Deno.readTextFile("src/acp/omp/lsp-validator.ts");
  assert(source.includes("export function validateRestrictedLspContract"));
  const factory = await Deno.readTextFile("src/acp/agent-factory.ts");
  const server = await Deno.readTextFile("src/main.ts");
  assertEquals(factory.includes("validateRestrictedLspContract"), false);
  assertEquals(server.includes("validateRestrictedLspContract"), false);
});

// -----------------------------------------------------------------------------
// Honest docs: the LSP disposition records both evidence limits distinctly and
// keeps all four agent/mode native observations unverified.
// -----------------------------------------------------------------------------

Deno.test("Docs: LSP disposition records evidence limits and UNVERIFIED observations", async () => {
  const permissions = await Deno.readTextFile("docs/AGENT_PERMISSIONS.md");
  const compatibility = await Deno.readTextFile("docs/OMP_COMPATIBILITY.md");
  assert(permissions.includes("--no-lsp"), "AGENT_PERMISSIONS names the OMP carriers");
  assert(
    permissions.includes("Explicit tool denial ≠ implicit-startup suppression"),
    "explicit-denial evidence limit recorded",
  );
  assert(
    permissions.includes("Carrier wiring ≠ native server suppression proof"),
    "native-suppression evidence limit recorded distinctly",
  );
  assert(compatibility.includes("UNVERIFIED (LSP disabled: all-off, row 17)"));
  assert(compatibility.includes("explicit denial therefore does not clear implicit startup"));
});

Deno.test("Docs: changelog entry carries the denial with no global-clamp or native-suppression claim", async () => {
  const changelog = await Deno.readTextFile("CHANGELOG.md");
  const entry = changelog.split("\n").find((line) =>
    line.includes("Disabled the LSP capability in every agent and mode")
  );
  assert(entry, "row-17 changelog entry exists");
  // The entry must state the no-global-clamp exclusion and both evidence
  // limits, and must never claim native suppression as achieved.
  assert(entry.includes("Deliberately absent"), "global-clamp exclusion recorded");
  assert(entry.includes("UNVERIFIED"), "runtime observations stay unverified");
  assert(
    entry.includes("proves no native language-server suppression"),
    "no native-suppression claim",
  );
});
