// tests/acp/omp-tool-enforcement-wiring.test.ts
//
// Consumer-visible wiring tests for restricted `tool_call` enforcement
// (`wire-omp-restricted-tool-enforcement`, row 16).
//
// SYNTHETIC TOOL OBSERVATIONS THROUGHOUT: every fixture here is a pure
// in-memory observation fed directly to the composition/handler. Nothing in
// this suite demonstrates that the official binary invokes the attached
// handler, enforces a block natively, resets records, decodes real payloads,
// or establishes any client-observable readiness — those remain the
// user-owned runtime checklist (docs/OMP_ENFORCEMENT.md §Checklist). The
// 14a/4/5/12 suites remain the source of the decision tables consumed here.

import { assert, assertEquals } from "@std/assert";
import {
  composeRestrictedToolCall,
  createLiveObserver,
  createRestrictedToolCallHandler,
  ENFORCEMENT_COMPOSITION,
  ENFORCEMENT_ERROR_FIELDS,
  type EnforcementDeps,
  type EnforcementError,
  type EnforcementOutcome,
  enforcementWiringGates,
  mcpAdmissionDenialBlock,
  observeCall,
  observeLaunchMode,
  PINNED_MECHANISM_EVIDENCE,
  registerNativeYoloNoop,
  RegistryEpochObserver,
  type RestrictedToolCallInput,
  type ToolCallObservation,
  type ToolMetadataSnapshot,
} from "@acp/omp/tool-enforcement-wiring.ts";
import { ALTERNATE_ROUTE_BLOCKING_TABLE } from "@acp/omp/tool-inventory.ts";
import { DESTRUCTIVE_CONFORMANCE_FIXTURES } from "@acp/destructive-policy.ts";
import { AUDITED_PINNED_LEDGER } from "@acp/omp/compatibility-contracts.ts";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  RootPathResult,
} from "@acp/filesystem-roots.ts";
import type { AuthorizeWriteParams } from "@acp/filesystem-policy.ts";
import type { ProvenanceRecord } from "@acp/omp/tool-provenance.ts";
import { evaluateApprovalRecordAuthority } from "@acp/omp/record-evaluator.ts";
import { createAgentConfig } from "@acp/agent-factory.ts";
import type { EffectiveRecordEvaluation } from "@acp/omp/record-evaluator.ts";
import type { Config } from "../../src/types/config.ts";

const approvalResetFixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../fixtures/omp-compatibility/approval-reset-counterexample.json", import.meta.url),
  ),
) as {
  lowerLayer: { approval: Record<string, "allow" | "deny" | "ask"> };
  cliOverlays: Array<{ approval: Record<string, "allow" | "deny" | "ask"> | null }>;
};

// ---------------------------------------------------------------------------
// Synthetic fixtures (14a suite shapes reused unchanged; row 12 generation).
// ---------------------------------------------------------------------------

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
  observedResourceGeneration: "gen-0",
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

const hostBash: ProvenanceRecord = { origin: "host", presentedName: "bash" };

// Pure-data canonical-observation adapter at 14b's collection seam — the
// same bounded classification row 5's conformance tests use: in-workspace
// fixture paths observe as staging files; any escaping spelling observes as
// an outside-roots failure. Synthetic staging roots; zero filesystem IO.
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

function obs(
  toolName: string,
  inputShape: ToolCallObservation["decodedInputShape"],
  recordedOrigin: ProvenanceRecord,
  extra: Partial<Omit<ToolCallObservation, "toolName" | "decodedInputShape">> = {},
): ToolCallObservation {
  return {
    toolKey: toolName,
    toolName,
    decodedInputShape: inputShape,
    registryObservation: {
      recordedOrigin,
      registryEpoch: 7,
      resourceGeneration: "gen-0",
    },
    recordEvaluation: NO_RECORDS,
    ...extra,
  };
}

function blockedOutcome(outcome: EnforcementOutcome): Extract<
  EnforcementOutcome,
  { block: true }
> {
  assert("block" in outcome && outcome.block, `expected block, got ${JSON.stringify(outcome)}`);
  return outcome;
}

// ---------------------------------------------------------------------------
// 5.1 Denied fixtures reach fail-closed bounded errors; composition order.
// ---------------------------------------------------------------------------

Deno.test("Wiring: denied unlisted name reaches the fail-closed bounded inventory error", () => {
  const outcome = blockedOutcome(composeRestrictedToolCall(obs("unknown_tool", "opaque", owned)));
  assertEquals(outcome.error.code, "rejected_tool_inventory");
  assertEquals(outcome.error.tableRowId, "default-deny-by-absence:unknown_tool");
  // Advisory records (step 5) reported the survivor without obeying it:
  const survivor = blockedOutcome(
    composeRestrictedToolCall(
      obs("unknown_tool", "opaque", owned, { recordEvaluation: p0SurvivorRecords }),
    ),
  );
  assertEquals(survivor.error.code, "rejected_approval_record_survivor");
  assertEquals(survivor.error.seam, "record-reset");
});

Deno.test("Wiring: wrong-origin same-name fixture blocked while owning-origin proceeds", () => {
  // A host-origin `bash` is blocked by the alternate-route pair screening...
  const hostBashCall = blockedOutcome(
    composeRestrictedToolCall(obs("bash", "command", hostBash)),
  );
  assert(
    hostBashCall.error.code === "rejected_tool_provenance" ||
      hostBashCall.error.code === "rejected_alternate_route",
    `unexpected code ${hostBashCall.error.code}`,
  );
  // ...while the owning (owned-extension) origin proceeds ONLY to the named
  // completing authority — `proceed` is never an authorization claim.
  const ownedRead = composeRestrictedToolCall(obs("read", "path-target", owned));
  assertEquals(ownedRead, {
    proceed: true,
    completingAuthority: "native-local-read-approval",
  });
});

Deno.test("Wiring: EVERY alternate (capability, route) pair blocks beneath an allowed ordinary route", () => {
  for (const pair of ALTERNATE_ROUTE_BLOCKING_TABLE) {
    const outcome = blockedOutcome(
      composeRestrictedToolCall(
        obs("read", "path-target", owned, {
          deviceSurface: pair.route,
          decodedCapability: pair.capability,
        }),
      ),
    );
    assertEquals(
      outcome.error.code,
      "rejected_alternate_route",
      `${pair.capability}/${pair.route}`,
    );
    assertEquals(outcome.error.capability, pair.capability, pair.route);
    assertEquals(outcome.error.route, pair.route, pair.capability);
  }
  // Command-execution through the SSH device route (the `bash` name allowed
  // ordinarily; the device carrier is what blocks).
  const sshExec = blockedOutcome(
    composeRestrictedToolCall(
      obs("bash", "command", owned, {
        deviceSurface: "ssh-device",
        decodedCapability: "command-execution",
      }),
    ),
  );
  assertEquals(sshExec.error.code, "rejected_alternate_route");
});

Deno.test("Wiring: composition order is fixed data; lower-step denial cannot be short-circuited", () => {
  assertEquals(ENFORCEMENT_COMPOSITION.map((step) => step.id), [
    "inventory",
    "provenance",
    "alternate-route",
    "destructive",
    "approval-records-advisory",
  ]);
  for (const step of ENFORCEMENT_COMPOSITION) {
    assertEquals(step.shortCircuitableByLaterInput, false, step.id);
  }
  // The behavioral half: a surviving lower-layer `allow` renames the REPORT
  // of an inventory denial but never moves its outcome — denial stays denial.
  const denied = blockedOutcome(
    composeRestrictedToolCall(
      obs("unknown_tool", "opaque", owned, { recordEvaluation: p0SurvivorRecords }),
    ),
  );
  const plain = blockedOutcome(composeRestrictedToolCall(obs("unknown_tool", "opaque", owned)));
  assert(denied.error.code !== plain.error.code); // renamed...
  assert("block" in denied && denied.block === true); // ...never moved.
});

Deno.test("Wiring: stale-epoch and stale-generation fixtures deny re-observe naming the element", () => {
  const staleEpoch = blockedOutcome(
    composeRestrictedToolCall(obs("mcp-tool", "query", mcpStale)),
  );
  assertEquals(staleEpoch.error.code, "rejected_stale_observation");
  assertEquals(staleEpoch.error.staleElement, "registry-epoch");

  const staleGeneration = blockedOutcome(
    composeRestrictedToolCall(
      obs(
        "read",
        "path-target",
        owned,
        {
          registryObservation: {
            recordedOrigin: owned,
            registryEpoch: 7,
            // Row 12 rotated the generation; the record observed the old one.
            resourceGeneration: "gen-1",
          },
        },
      ),
    ),
  );
  assertEquals(staleGeneration.error.code, "rejected_stale_observation");
  assertEquals(staleGeneration.error.staleElement, "resource-generation");
});

Deno.test("Wiring: handler-throw fixture fails closed at the seam (no catch-and-continue)", () => {
  const surfaced: string[] = [];
  const deps: EnforcementDeps = {
    selfIdentity: { mode: "restricted" },
    observer: {
      observeOrigin: (name) => ({ origin: "unowned-discovery", presentedName: name }),
      observeRegistryEpoch: () => 0,
      observeResourceGeneration: () => "gen-0",
      owningModule: () => ({ modulePath: "m", baseRoot: "b", resourceGeneration: "gen-0" }),
    },
    surfaceError: (message) => surfaced.push(message),
  };
  const handler = createRestrictedToolCallHandler(deps);
  const exploding = {
    toolKey: "read",
    toolName: "read",
    get decodedInputShape(): never {
      throw new Error("synthetic decoder explosion");
    },
    recordEvaluation: NO_RECORDS,
  } as unknown as RestrictedToolCallInput;
  const outcome = blockedOutcome(handler(exploding));
  assertEquals(outcome.error.code, "rejected_enforcement_seam");
  assertEquals(outcome.error.seam, "seam-table");
  assertEquals(surfaced.length, 1);
});

Deno.test("Wiring: every bounded error carries ONLY finite enumerated fields (no payload/secret)", () => {
  const errors: EnforcementError[] = [
    blockedOutcome(composeRestrictedToolCall(obs("unknown_tool", "opaque", owned))).error,
    blockedOutcome(
      composeRestrictedToolCall(
        obs("read", "path-target", owned, {
          deviceSurface: "ssh-device",
          decodedCapability: "filesystem-read",
        }),
      ),
    ).error,
    blockedOutcome(composeRestrictedToolCall(obs("webfetch", "url", owned))).error,
    blockedOutcome(composeRestrictedToolCall(obs("mcp-tool", "query", mcpStale))).error,
    blockedOutcome(
      composeRestrictedToolCall(
        obs("delete", "path-target", owned, { destructive: undefined, toolKey: "delete" }),
      ),
    ).error,
    // Survivor-renamed denial (widest naming surface).
    blockedOutcome(
      composeRestrictedToolCall(
        obs("unknown_tool", "opaque", owned, { recordEvaluation: p0SurvivorRecords }),
      ),
    ).error,
    // MCP-admission-basis denial shapes (widest seam-marked surface): the
    // re-observe and fallthrough variants pinned through the wiring mapper
    // (the live entry decision replays the SAME 14a decision, so compose
    // reaches the fallthrough shape only as fail-closed defense in depth).
    mcpAdmissionDenialBlock("operator-mcp", {
      admit: false,
      reason: "rejected_tool_provenance",
      pending: "re-observe",
    }),
    mcpAdmissionDenialBlock("workspace", {
      admit: false,
      reason: "rejected_tool_provenance",
      tableRowId: "operator-mcp",
    }),
    // Destructive-authorization denial with the bounded per-target audit.
    blockedOutcome(
      composeRestrictedToolCall(
        obs("delete", "path-target", owned, {
          destructive: {
            intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[4].input, // later-escape
            expandedTargets: ["a.md", "../../../../external.md"],
            expandedLocations: ["a.md", "../../../../external.md"],
            observations: syntheticObservations(["a.md", "../../../../external.md"]),
            authorizationParams: syntheticAuthParams,
          },
        }),
      ),
    ).error,
  ];
  for (const error of errors) {
    for (const field of Object.keys(error)) {
      assert(ENFORCEMENT_ERROR_FIELDS.includes(field), `unbounded error field: ${field}`);
    }
    const rendered = JSON.stringify(error);
    // No payload text, path content, or secret material is representable:
    // the finite field set carries only enum tokens and table row ids.
    assert(!rendered.includes("a.md"));
    assert(!rendered.includes("secret"));
    assert(!rendered.includes("/opt/air"));
  }
  // Pending adapter clamps before native transport can run.
  const pending = blockedOutcome(composeRestrictedToolCall(obs("webfetch", "url", owned)));
  assertEquals(pending.error.code, "rejected_pending_adapter");
  assertEquals(pending.error.seam, "pending-adapter");
  assertEquals(pending.error.tableRowId, "web-fetch");
});

Deno.test("Wiring destructive step-4: authorization denial emits bounded code + confined per-target audit; all-authorized proceeds ONLY to the named authority", () => {
  // Later-escape fixture: first target staging-authorized, second escapes.
  const denied = blockedOutcome(
    composeRestrictedToolCall(
      obs("delete", "path-target", owned, {
        destructive: {
          intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[4].input,
          expandedTargets: ["a.md", "../../../../external.md"],
          expandedLocations: ["a.md", "../../../../external.md"],
          observations: syntheticObservations(["a.md", "../../../../external.md"]),
          authorizationParams: syntheticAuthParams,
        },
      }),
    ),
  );
  assertEquals(denied.error.code, "rejected_destructive_authorization");
  assertEquals(denied.error.seam, "destructive-intent");
  assert(denied.destructiveTargets !== undefined);
  assertEquals(denied.destructiveTargets.length, 2);
  for (const audit of denied.destructiveTargets) {
    // Audit confined to index/boolean/finite-reason/role — row 4's free-text
    // message never rides, no path content in the audit entries.
    for (const field of Object.keys(audit)) {
      assert(["index", "authorized", "reason", "role"].includes(field), `audit field: ${field}`);
    }
    const rendered = JSON.stringify(audit);
    assert(!rendered.includes("external.md"));
    assert(!rendered.includes("/session/staging"));
  }
  assertEquals(denied.destructiveTargets[0].authorized, true);
  assertEquals(denied.destructiveTargets[1].authorized, false);
  // Row 5's shared bounded reason for the escaping target (observation
  // outside_roots classified into the finite row-4 vocabulary).
  assertEquals(
    denied.destructiveTargets[1].reason,
    "rejected_write_path_outside_workspace",
  );

  // All-authorized multi-delete: proceed names the completing authority and
  // asserts no authorization; zero mutation is representable in the shape.
  const approved = composeRestrictedToolCall(
    obs("delete", "path-target", owned, {
      destructive: {
        intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[2].input, // multi-delete
        expandedTargets: ["a.md", "b.md"],
        expandedLocations: ["a.md", "b.md"],
        observations: syntheticObservations(["a.md", "b.md"]),
        authorizationParams: syntheticAuthParams,
      },
    }),
  );
  assertEquals(approved, {
    proceed: true,
    completingAuthority: "row5-destructive-all-target-policy",
  });

  // Completeness-stage denial carries the verbatim shared bounded reason.
  const binding = blockedOutcome(
    composeRestrictedToolCall(
      obs("delete", "path-target", owned, {
        destructive: {
          intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[8].input, // binding-mismatch
          expandedTargets: ["a.md"],
          expandedLocations: ["a.md"],
        },
      }),
    ),
  );
  assertEquals(binding.error.code, "rejected_destructive_binding");
  assertEquals(binding.error.seam, "destructive-intent");
});

// ---------------------------------------------------------------------------
// 5.2 Live-not-cached provenance; refresh; restricted-only registration.
// ---------------------------------------------------------------------------

function fixtureSurface(entries: () => readonly ToolMetadataSnapshot[]) {
  return { snapshot: () => entries() };
}

Deno.test("Wiring: decisions are consumed LIVE, never memoized across identical calls", () => {
  let allowOwned = true;
  const surface = fixtureSurface(() => [{
    toolName: "read",
    origin: allowOwned ? owned : { origin: "workspace", presentedName: "read" },
  }]);
  const generation = "gen-0";
  const { observer } = createLiveObserver(
    surface,
    () => generation,
    () => ({
      modulePath: owned.modulePath!,
      baseRoot: "/opt/air",
      resourceGeneration: generation,
    }),
  );
  const deps: EnforcementDeps = {
    selfIdentity: { mode: "restricted" },
    observer,
    surfaceError: () => {},
  };
  const handler = createRestrictedToolCallHandler(deps);
  const input: RestrictedToolCallInput = {
    toolKey: "read",
    toolName: "read",
    decodedInputShape: "path-target",
    recordEvaluation: NO_RECORDS,
  };
  const first = handler(input);
  assertEquals(first, { proceed: true, completingAuthority: "native-local-read-approval" });
  allowOwned = false;
  // BYTE-IDENTICAL second call: the live origin read flips the decision, so
  // any memoizing implementation fails this assertion.
  const second = handler(input);
  assert("block" in second && second.block);
  assertEquals(second.error.code, "rejected_tool_provenance");
});

Deno.test("Wiring refresh: post-start owned-MCP refresh re-admits on the fresh epoch, zero interaction", () => {
  const entries: ToolMetadataSnapshot[] = [{ toolName: "old-tool", origin: hostBash }];
  const surface = fixtureSurface(() => entries);
  const registry = new RegistryEpochObserver(surface);
  const before = registry.currentEpoch();
  // Post-start registration: client-owned MCP tool appears; epoch advances
  // from the LIVE observation only.
  entries.push({
    toolName: "fresh-mcp",
    origin: { ...mcpFresh, registryEpochObserved: before + 1 },
  });
  const epoch = registry.noteRegistration();
  assertEquals(epoch, before + 1);
  const deps: EnforcementDeps = {
    selfIdentity: { mode: "restricted" },
    observer: {
      observeOrigin: (name) => registry.observeOrigin(name),
      observeRegistryEpoch: () => registry.currentEpoch(),
      observeResourceGeneration: () => "gen-0",
      owningModule: () => ({ modulePath: "m", baseRoot: "b", resourceGeneration: "gen-0" }),
    },
    surfaceError: () => {},
  };
  const handler = createRestrictedToolCallHandler(deps);
  const admitted = handler({
    toolKey: "fresh-mcp",
    toolName: "fresh-mcp",
    decodedInputShape: "query",
    recordEvaluation: NO_RECORDS,
  });
  assertEquals(admitted, {
    proceed: true,
    completingAuthority: "mcp-client-ownership",
    mcpAdmitted: true,
  });
});

Deno.test("Wiring refresh: refreshed-untrusted and unowned refreshes stay denied; stale-after-admission re-denies", () => {
  // Untrusted origin refresh: the event grants nothing.
  const untrusted = blockedOutcome(
    composeRestrictedToolCall(
      // A table-listed name from the wrong origin reaches the provenance
      // stage (unlisted names deny earlier, by absence).
      obs("read", "path-target", { origin: "workspace", presentedName: "read" }),
    ),
  );
  assertEquals(untrusted.error.code, "rejected_tool_provenance");
  // Recorded-epoch observation left stale behind an advanced live epoch:
  // re-deny, no one-shot acknowledgement is representable anywhere in the
  // shapes (no ack field exists on ToolCallObservation or the outcome).
  const staleAfterAdmission = blockedOutcome(
    composeRestrictedToolCall(obs("mcp-tool", "query", mcpStale)),
  );
  assertEquals(staleAfterAdmission.error.code, "rejected_stale_observation");
  assertEquals(staleAfterAdmission.error.staleElement, "registry-epoch");
  // Unowned-discovery refresh: default-deny by absence persists.
  const unowned = blockedOutcome(
    composeRestrictedToolCall(
      obs("mcp-tool", "query", { origin: "unowned-discovery", presentedName: "mcp-tool" }),
    ),
  );
  assertEquals(unowned.error.code, "rejected_tool_inventory");
});

Deno.test("Wiring: observeCall re-reads origin/epoch/generation freshly on every call", () => {
  let reads = 0;
  const deps: EnforcementDeps = {
    selfIdentity: { mode: "restricted" },
    observer: {
      observeOrigin: (name) => {
        reads += 1;
        return { origin: "unowned-discovery", presentedName: name };
      },
      observeRegistryEpoch: () => 7,
      observeResourceGeneration: () => "gen-0",
      owningModule: () => ({ modulePath: "m", baseRoot: "b", resourceGeneration: "gen-0" }),
    },
    surfaceError: () => {},
  };
  const input: RestrictedToolCallInput = {
    toolKey: "x",
    toolName: "x",
    decodedInputShape: "opaque",
    recordEvaluation: NO_RECORDS,
  };
  observeCall(deps, input);
  observeCall(deps, input);
  assertEquals(reads, 2); // one live origin read per call — no cache.
});

Deno.test("Wiring registration: YOLO/unidentified identities register nothing; identity observation unchanged", () => {
  // C4 cutover: the load-time attach and its private slot are GONE (the
  // production registration site is the native-API adapter, covered by
  // tests/acp/omp-native-registration.test.ts). What stays pinned here is
  // the branch machinery the adapter keys on.
  // YOLO branch: nothing registered, no restricted decision/record load path.
  assertEquals(registerNativeYoloNoop(), { registered: false, mode: "native-yolo" });
  // The adapter maps a YOLO launch cwd and an unidentified cwd to the
  // SAME noop result — the structural exemption needs no attach function.
  for (const cwd of ["/opt/air/omp-agent/native-yolo/cwd", "/somewhere/else"]) {
    assertEquals(
      observeLaunchMode(cwd) === undefined || observeLaunchMode(cwd) === "native-yolo",
      true,
      cwd,
    );
    assertEquals(registerNativeYoloNoop(observeLaunchMode(cwd) ?? "native-yolo"), {
      registered: false,
      mode: observeLaunchMode(cwd) ?? "native-yolo",
    });
  }
  assertEquals(observeLaunchMode("/opt/air/omp-agent/restricted/cwd"), "restricted");
  // A handler built with a non-restricted identity fails closed at entry.
  const yoloHandler = createRestrictedToolCallHandler({
    selfIdentity: { mode: "native-yolo" },
    observer: {
      observeOrigin: (name) => ({ origin: "unowned-discovery", presentedName: name }),
      observeRegistryEpoch: () => 0,
      observeResourceGeneration: () => "gen-0",
      owningModule: () => ({ modulePath: "m", baseRoot: "b", resourceGeneration: "gen-0" }),
    },
    surfaceError: () => {},
  });
  const denied2 = blockedOutcome(
    yoloHandler({
      toolKey: "read",
      toolName: "read",
      decodedInputShape: "path-target",
      recordEvaluation: NO_RECORDS,
    }),
  );
  assertEquals(denied2.error.code, "rejected_enforcement_seam");
});

Deno.test("Wiring: OpenCode flows load no OMP extension or enforcement handler", () => {
  // The OpenCode branch of the factory assembles no --trusted-extension
  // argument and no omp-agent root: unchanged behavior, no extension loaded
  // in either permission mode.
  const config = {
    discord: { token: "", channelIds: [] },
    agent: {
      defaultAgentType: "opencode",
      model: "openrouter/auto",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: "gm_test_key",
      openRouterApiKey: "or_test_key",
    },
    workspace: { repoPath: "./test-repo" },
  } as unknown as Config;
  for (const yolo of [false, true]) {
    const built = createAgentConfig("opencode", "/tmp/wt-test", config, yolo);
    assert(!built.args.includes("--trusted-extension"));
    assert(!JSON.stringify(built).includes("omp-agent"));
  }
});

// ---------------------------------------------------------------------------
// 5.3 Record survival, incomplete destructive, pending adapter, seams.
// ---------------------------------------------------------------------------

Deno.test("Wiring destructive: incomplete/observation-absent inputs fail closed with seam marker", () => {
  // Routed-destructive call with NO decoded payload: incomplete native shape.
  const noPayload = blockedOutcome(
    composeRestrictedToolCall(obs("delete", "path-target", owned)),
  );
  assertEquals(noPayload.error.code, "rejected_enforcement_seam");
  assertEquals(noPayload.error.seam, "destructive-intent");
  // Normalization-complete but canonical observations absent: the all-target
  // pass has NOT run, so this is never a completion claim — block.
  const normalizationOnly = blockedOutcome(
    composeRestrictedToolCall(
      obs("delete", "path-target", owned, {
        destructive: {
          // Row-5's own complete `delete` conformance fixture, WITHOUT the
          // canonical observations: normalization-only, never completion.
          intent: DESTRUCTIVE_CONFORMANCE_FIXTURES[0].input,
          expandedTargets: ["a.md"],
          expandedLocations: DESTRUCTIVE_CONFORMANCE_FIXTURES[0].locations,
        },
      }),
    ),
  );
  assertEquals(normalizationOnly.error.code, "rejected_enforcement_seam");
  assertEquals(normalizationOnly.error.seam, "destructive-intent");
});

Deno.test("Wiring: provenance denial keeps its bounded reason and origin category", () => {
  const workspaceOrigin = blockedOutcome(
    composeRestrictedToolCall(
      obs("read", "path-target", { origin: "workspace", presentedName: "read" }),
    ),
  );
  assertEquals(workspaceOrigin.error.code, "rejected_tool_provenance");
  assertEquals(workspaceOrigin.error.originCategory, "workspace");
});

Deno.test("Wiring gates: inherited verdicts preserved with DECIDED dispositions; MCP basis never inflated", () => {
  assertEquals(enforcementWiringGates.mcpBasis.basisStatus, "needs-mechanism-audit");
  assertEquals(enforcementWiringGates.mcpBasis.hasMcpBoundaryRow, false);
  assertEquals(enforcementWiringGates.posture.restrictedOnly, true);
  assertEquals(enforcementWiringGates.posture.yoloRegistersNoHandler, true);
  assertEquals(enforcementWiringGates.posture.oneShotAcknowledgement, "not-representable");
  assertEquals(enforcementWiringGates.posture.readinessChannel, "cancelled-not-consumed");
  assertEquals(enforcementWiringGates.posture.elicitation, "explicitly-absent");
  // Quoted, never restated: the evidence row equals the ledger source.
  const ledgerPolicyRow = AUDITED_PINNED_LEDGER.find((entry) =>
    entry.boundary === "policy_readiness"
  )!;
  assertEquals(PINNED_MECHANISM_EVIDENCE.downstreamOwner, ledgerPolicyRow.downstreamOwner);
  assertEquals(PINNED_MECHANISM_EVIDENCE.status, ledgerPolicyRow.status);
  assertEquals(PINNED_MECHANISM_EVIDENCE.citation, ledgerPolicyRow.sourceCitation);
  for (const seam of enforcementWiringGates.seams) {
    assertEquals(seam.userDisposition, "DECIDED", seam.id);
    assert(seam.source.status.length > 0, seam.id);
  }
});
