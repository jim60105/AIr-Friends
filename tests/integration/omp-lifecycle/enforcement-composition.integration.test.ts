// tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts
//
// 4.2 Registry-refresh re-admission composition (connection tier, per design
// D4): simulated live tool-metadata observations enter 14b's REAL handler
// body and 14a's REAL decision modules with REAL wiring-owned
// registryEpoch/resourceGeneration observations.
//
// EVIDENCE BOUNDARY (docs/OMP_EVIDENCE design §15): every observation here is
// a synthetic in-memory snapshot fed through the shipped composition. Nothing
// in this file demonstrates or claims that the native OMP binary invokes the
// attached handler, honors a denial natively, or refreshes a live registry —
// re-admission and denial claims are composition-evidence only. Allow-path
// fixtures are labeled synthetic positives on the shared ledger; the honesty
// guard in opencode-regression.integration.test.ts scans them at runtime.

import { assert, assertEquals } from "@std/assert";
import {
  composeRestrictedToolCall,
  createLiveObserver,
  createRestrictedToolCallHandler,
  type EnforcementDeps,
  type EnforcementOutcome,
  type RestrictedToolCallInput,
  type ToolCallObservation,
} from "@acp/omp/tool-enforcement-wiring.ts";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  RootPathResult,
} from "@acp/filesystem-roots.ts";
import type { AuthorizeWriteParams } from "@acp/filesystem-policy.ts";
import { DESTRUCTIVE_CONFORMANCE_FIXTURES } from "@acp/destructive-policy.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import {
  type EffectiveRecordEvaluation,
  evaluateApprovalRecordAuthority,
} from "@acp/omp/record-evaluator.ts";
import { SyntheticPositiveLedger } from "../../mocks/omp-mock-session.ts";
import { OMP_IMAGE_MODULE_DECLARATION } from "@acp/omp/deployment-module.ts";
import {
  fixtureImageObservation,
  fixtureOwnedExtensionRecord,
} from "../../acp/omp-owned-module-fixture.ts";
import { join } from "@std/path";
import { ChatbotClient } from "@acp/client.ts";
import { buildSkillAutoApproveList } from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";

function blockedOutcome(outcome: EnforcementOutcome): Extract<
  EnforcementOutcome,
  { block: true }
> {
  assert("block" in outcome && outcome.block, `expected block, got ${JSON.stringify(outcome)}`);
  return outcome;
}

// --- Synthetic provenance/observation fixtures (row-16 shapes) --------------

// Owned-extension provenance rides the DECLARED deployment artifact plus its
// physical observation, stamped from ONE live read in the fixture SURFACE's
// own epoch domain (no session identity): the record, its evidence and the
// wiring's live read must all agree, so the helper takes the epoch.
function ownedAt(epoch: number): ProvenanceRecord {
  return fixtureOwnedExtensionRecord({
    observation: fixtureImageObservation({ generation: "gen-0", epoch }),
  });
}

const approvalResetFixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../../fixtures/omp-compatibility/approval-reset-counterexample.json", import.meta.url),
  ),
) as {
  lowerLayer: { approval: Record<string, "allow" | "deny" | "ask"> };
  cliOverlays: Array<{ approval: Record<string, "allow" | "deny" | "ask"> | null }>;
};

const NO_RECORDS: EffectiveRecordEvaluation = evaluateApprovalRecordAuthority(
  { lowerLayer: { approval: {} } },
  "restricted",
  { read: "allow" },
);

const p0SurvivorRecords: EffectiveRecordEvaluation = evaluateApprovalRecordAuthority(
  {
    lowerLayer: approvalResetFixture.lowerLayer,
    cliOverlays: approvalResetFixture.cliOverlays,
  },
  "restricted",
  { read: "allow" },
);

// Pure-data canonical-observation adapter (row-5 classification shape; zero
// filesystem IO) for the destructive fixtures.
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

function syntheticObservations(
  paths: readonly string[],
): readonly RootPathResult<CanonicalTarget>[] {
  return paths.map((path) =>
    path.includes("..")
      ? { ok: false, reason: "outside_roots", message: `synthetic escape: ${path}` }
      : { ok: true, value: syntheticTarget(path) }
  );
}

const syntheticAuthParams: Omit<AuthorizeWriteParams, "target"> = {
  roots: syntheticRoots,
  yolo: false,
};

Deno.test({
  name:
    "OMP lifecycle 4.2: registry-refresh re-admission composition — refresh advances the live epoch and forces re-observation, an operator-MCP re-admission passes ONLY as a labeled synthetic positive, workspace-origin denies with the provenance family, a surviving lower-layer record NEVER grants, an undecodable destructive fixture yields the shared fail-closed verdict with zero side effect (composition evidence only; no native invocation claimed)",
  fn() {
    const ledger = new SyntheticPositiveLedger();
    // The live tool-metadata surface the observer reads on EVERY call: a
    // mutable registry the test refreshes (post-start MCP registration).
    const registryEntries: { toolName: string; origin: ProvenanceRecord }[] = [];
    const surface = { snapshot: () => [...registryEntries] };
    const { observer, registry } = createLiveObserver(
      surface,
      () => "gen-0",
      () => ({
        // This composition test drives origins through the SURFACE; the
        // owning-module seam is not consumed here, so it carries no evidence.
        modulePath: OMP_IMAGE_MODULE_DECLARATION.artifact,
        resourceGeneration: "gen-0",
      }),
    );
    const surfaced: string[] = [];
    const deps: EnforcementDeps = {
      selfIdentity: { mode: "restricted" },
      observer,
      surfaceError: (message) => surfaced.push(message),
    };
    // The REAL 14b handler body: it re-reads the live observation per call.
    const handler = createRestrictedToolCallHandler(deps);

    const epochInitial = registry.currentEpoch();

    // A workspace-origin tool presenting an allow-listed NAME appears in the
    // live registry: step 1 (inventory) passes on the name, and the
    // WORKSPACE origin is what the real composition denies at step 2 — the
    // bounded `rejected_tool_provenance`-family error shape (same
    // provenance/alternate-route pair screening row 16 pins for host origin).
    registryEntries.push({
      toolName: "bash",
      origin: { origin: "workspace", presentedName: "bash" },
    });
    const untrustedCall: RestrictedToolCallInput = {
      toolKey: "bash",
      toolName: "bash",
      decodedInputShape: "command",
      recordEvaluation: NO_RECORDS,
    };
    const untrusted = blockedOutcome(handler(untrustedCall));
    assert(
      untrusted.error.code === "rejected_tool_provenance" ||
        untrusted.error.code === "rejected_alternate_route",
      `unexpected code ${untrusted.error.code}`,
    );
    assertEquals(untrusted.error.originCategory, "workspace");

    // Registry refresh (post-start MCP registration): the observation carries
    // the epoch its registration moves the live observer TO (a key-moving
    // snapshot advances exactly one step). The event itself grants nothing.
    const epochPreRefresh = registry.currentEpoch();
    registryEntries.push({
      toolName: "mcp-operator",
      origin: {
        origin: "operator-mcp",
        clientMcpOwnership: true,
        registryEpochObserved: epochPreRefresh + 1,
        // Recorded-current field; the handler overwrites it with the live
        // epoch on every call (composeFreshProvenance), never trusts this.
        currentRegistryEpoch: epochPreRefresh + 1,
      },
    });
    const epochAfterRefresh = registry.noteRegistration();
    assertEquals(
      epochAfterRefresh > epochPreRefresh && epochAfterRefresh > epochInitial,
      true,
      "the refresh moved the epoch from the live observation",
    );

    // Re-admission on the FRESH epoch: the real handler routes operator-MCP
    // provenance through 14a's admission decision and proceeds ONLY to the
    // named completing authority. `proceed` is never an authorization claim —
    // the basis status carried by every admitted MCP outcome stays
    // `needs-mechanism-audit` (asserted by the honesty guard), so this is
    // registered as a labeled synthetic positive.
    ledger.register(
      "42-mcp-re-admission",
      "composition-boundary: operator-MCP re-admission on the advanced epoch is a synthetic positive (basis stays needs-mechanism-audit); no native invocation claimed",
      "fresh observation on post-refresh epoch through 14b handler body",
    );
    const admitted = handler({
      toolKey: "mcp-operator",
      toolName: "mcp-operator",
      decodedInputShape: "query",
      recordEvaluation: NO_RECORDS,
    });
    assertEquals(admitted, {
      proceed: true,
      completingAuthority: "mcp-client-ownership",
      mcpAdmitted: true,
    });

    // Stale-epoch record: an observation stamped before the refresh must deny
    // re-observe (never admit). The handler always reads fresh, so the stale
    // fixture is a record replayed at the composition seam carrying the
    // pre-refresh observation against the advanced current epoch (row-16
    // mcpStale shape, driven by the REAL epoch numbers observed here).
    const staleRecord: ToolCallObservation = {
      toolKey: "mcp-operator",
      toolName: "mcp-operator",
      decodedInputShape: "query",
      recordEvaluation: NO_RECORDS,
      registryObservation: {
        recordedOrigin: {
          origin: "operator-mcp",
          clientMcpOwnership: true,
          registryEpochObserved: epochPreRefresh,
          // The observation was taken pre-refresh; the live epoch advanced.
          currentRegistryEpoch: epochAfterRefresh,
        },
        registryEpoch: epochAfterRefresh,
        resourceGeneration: "gen-0",
      },
    };
    const stale = blockedOutcome(composeRestrictedToolCall(staleRecord));
    assertEquals(stale.error.code, "rejected_stale_observation");
    assertEquals(stale.error.staleElement, "registry-epoch");

    // A surviving lower-layer approval record NEVER grants: the same unknown
    // tool the inventory denies stays denied — the survivor only renames the
    // REPORT (step 5 advisory), the outcome never moves.
    const survivor = blockedOutcome(
      composeRestrictedToolCall({
        toolKey: "unknown_tool",
        toolName: "unknown_tool",
        decodedInputShape: "opaque",
        recordEvaluation: p0SurvivorRecords,
        registryObservation: {
          recordedOrigin: ownedAt(registry.currentEpoch()),
          registryEpoch: registry.currentEpoch(),
          resourceGeneration: "gen-0",
        },
      }),
    );
    assertEquals(survivor.error.code, "rejected_approval_record_survivor");
    assertEquals(survivor.error.seam, "record-reset");

    // Undecodable destructive-intent fixture (row-5 conformance `unparseable`
    // shape): the shared fail-closed verdict with zero side effect. The
    // outcome shape carries no mutation surface; no filesystem IO is even
    // reachable from this composition (observations are pure data).
    const undecodable = blockedOutcome(
      composeRestrictedToolCall({
        toolKey: "delete",
        toolName: "delete",
        decodedInputShape: "path-target",
        recordEvaluation: NO_RECORDS,
        registryObservation: {
          recordedOrigin: ownedAt(registry.currentEpoch()),
          registryEpoch: registry.currentEpoch(),
          resourceGeneration: "gen-0",
        },
        destructive: {
          intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[6].input, // unparseable "{"
          expandedTargets: ["a.md"],
          expandedLocations: ["a.md"],
          observations: syntheticObservations(["a.md"]),
          authorizationParams: syntheticAuthParams,
        },
      }),
    );
    assertEquals(undecodable.error.code, "rejected_destructive_incomplete");
    assertEquals(undecodable.error.seam, "destructive-intent");
    assertEquals(undecodable.error.capability, "destructive-mutation");

    // Only the handler-routed denial surfaces a diagnostic (compose-direct
    // denials return blocks without the pinned emit): one bounded message,
    // enumerated fields only — never a permission request, never a payload.
    assertEquals(surfaced.length, 1, "only the handler-routed denial emits");
    assert(
      surfaced[0].includes("rejected_tool_provenance") ||
        surfaced[0].includes("rejected_alternate_route"),
    );
    assert(
      !surfaced[0].includes("workspace/"),
      "bounded fields only: no origin path content rides",
    );

    // Local honesty check: the re-admission positive registered here must
    // carry its composition-boundary label inside THIS Deno process (the
    // 5.2 guard only scans its own file's process).
    assert(
      ledger.entries().some((entry) => entry.id === "42-mcp-re-admission"),
      "the MCP re-admission positive is registered",
    );
    for (const entry of SyntheticPositiveLedger.allEntries()) {
      assert(
        entry.label.startsWith("composition-boundary:"),
        `unlabeled synthetic positive in-process: ${entry.id}`,
      );
    }
  },
});

// --- ACP client destructive ingress (independent of the restricted extension) ---
//
// This case drives the REAL ACP client permission ingress — NOT the restricted
// `tool_call` handler above — to show that a connector-configured OMP client
// normalizes a native single move into the shared all-target authorization.
// Nothing here invokes the native OMP binary; the evidence is the client-side
// permission decision over real temporary files.

Deno.test("OMP lifecycle: configured-OMP ACP client ingress authorizes a native move", async () => {
  const workspace = Deno.makeTempDirSync({ prefix: "air-ingress-" });
  const staging = join(workspace, "tmp", "test-session");
  Deno.mkdirSync(staging, { recursive: true });
  const source = join(staging, "from.md");
  const destination = join(staging, "to.md");
  Deno.writeTextFileSync(source, "seed");
  try {
    const workspaceManager = new WorkspaceManager({
      repoPath: Deno.makeTempDirSync({ prefix: "air-ingress-repo-" }),
      workspacesDir: "workspaces",
    });
    const registry = new SkillRegistry(new MemoryStore(workspaceManager, {}));
    const allowList = buildSkillAutoApproveList({
      rootObservation: observeTrustedSkillsRoot(
        "omp",
        Deno.makeTempDirSync({ prefix: "air-ingress-skills-" }),
      ),
    });
    const client = new ChatbotClient(
      registry,
      new Logger("test", { level: LogLevel.FATAL }),
      {
        workingDir: workspace,
        platform: "discord",
        userId: "123",
        channelId: "456",
        isDM: false,
        sessionId: "test-session",
        agentType: "omp",
      },
      allowList,
    );
    client.setSessionContext("test-session", {
      cwd: workspace,
      shellSessionId: "test-session",
    });

    const response = await client.requestPermission({
      sessionId: "test-session",
      toolCall: {
        toolCallId: "tc-ingress",
        status: "pending",
        content: [],
        title: `Move ${source} to ${destination}`,
        rawInput: { from: source, to: destination },
        locations: [{ path: source }, { path: destination }],
      },
      options: [
        { kind: "allow_once", optionId: "allow", name: "Allow once" },
        { kind: "reject_once", optionId: "reject", name: "Reject once" },
      ],
    });

    assertEquals(response.outcome, { outcome: "selected", optionId: "allow" });
    assertEquals(Deno.statSync(source).isFile, true);
  } finally {
    Deno.removeSync(workspace, { recursive: true });
  }
});
