import { assertEquals } from "@std/assert";
import type {
  AgentLspProfile,
  DiscoveryModuleCandidate,
  LedgerEntry,
  ReadinessAssertion,
  ReadinessContext,
  SettingsLayerHierarchy,
  SkillCandidate,
  TransportHopRequest,
} from "../../src/acp/omp/compatibility-contracts.ts";
import {
  assessCompatibility,
  AUDITED_PINNED_LEDGER,
  evaluateApprovalRecordAuthority,
  PINNED_ACP_SDK_VERSION,
  PINNED_ACP_TERMINAL_CAPABILITY,
  PINNED_OMP_COMMIT,
  PINNED_OMP_VERSION,
  PINNED_OPENCODE_TREE,
  PINNED_OPENCODE_VERSION,
  validateCriticalSkillContract,
  validateDestructiveIntentContract,
  validateDiscoveryContract,
  validateReadinessContract,
  validateRestrictedLspContract,
  validateTransportContract,
} from "../../src/acp/omp/compatibility-contracts.ts";
import { REQUIRED_INVENTORY } from "../../src/acp/omp/inventory-validator.ts";

import approvalResetFixture from "../fixtures/omp-compatibility/approval-reset-counterexample.json" with {
  type: "json",
};
import destructiveFixture from "../fixtures/omp-compatibility/destructive-operations.json" with {
  type: "json",
};
import readinessFixture from "../fixtures/omp-compatibility/readiness-fixtures.json" with {
  type: "json",
};
import routeDiscoverySkillsLspFixture from "../fixtures/omp-compatibility/route-discovery-skills-lsp.json" with {
  type: "json",
};

// -----------------------------------------------------------------------------
// Group 1: Ledger Admission & Pinned Assessment Tests
// -----------------------------------------------------------------------------

Deno.test("Compatibility Assessment: audited pinned ledger is BLOCKED with honest blockers", () => {
  const result = assessCompatibility(AUDITED_PINNED_LEDGER);

  assertEquals(result.permitted, false);
  assertEquals(result.blockers.length > 0, true);
  assertEquals(result.ledgerSummary.total, 11);
  assertEquals(result.ledgerSummary.supported, 1);
  assertEquals(result.ledgerSummary.incompatible >= 7, true);
  assertEquals(result.ledgerSummary.unresolved >= 3, true);

  // Verify all required inventory subcases are evaluated
  const evaluatedSubcases = new Set(
    AUDITED_PINNED_LEDGER.map((e) => (e.subcase ? `${e.boundary}:${e.subcase}` : e.boundary)),
  );
  for (const item of REQUIRED_INVENTORY) {
    const key = item.subcase ? `${item.boundary}:${item.subcase}` : item.boundary;
    assertEquals(evaluatedSubcases.has(key), true, `Required subcase ${key} must be evaluated`);
  }
});

Deno.test("Compatibility Assessment: synthetic complete positive ledger exercises structural admission without mutating pinned ledger", () => {
  const syntheticPositiveLedger: readonly LedgerEntry[] = REQUIRED_INVENTORY.map((item) => ({
    boundary: item.boundary,
    subcase: item.subcase,
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation: `synthetic/evidence/${item.boundary}.ts`,
    reachability: `official-cli-flag-and-extension-for-${item.boundary}`,
    newLoadRefreshScope: "all-sessions",
    downstreamOwner: `test-owner-${item.boundary}`,
    selectedMechanism: `supported-${item.boundary}-mechanism`,
    status: "supported",
    evidenceClassification: "synthetic_fixture",
    notes: "explicitly hypothetical positive admission test fixture",
  }));

  const syntheticResult = assessCompatibility(syntheticPositiveLedger);
  assertEquals(syntheticResult.permitted, true);
  assertEquals(syntheticResult.isSyntheticAdmissionOnly, true);
  assertEquals(syntheticResult.blockers.length, 0);

  // Verify the real pinned ledger is unchanged and still blocked
  const realResult = assessCompatibility(AUDITED_PINNED_LEDGER);
  assertEquals(realResult.permitted, false);
  assertEquals(realResult.isSyntheticAdmissionOnly, false);
});

Deno.test("Compatibility Assessment: rejects missing subcases, pin mismatches, duplicate entries, and SDK-only claims", () => {
  // 1. Missing subcase (native_transport:web_search; `remove-omp-public-code-search`
  // migrated this coverage from the former public_code_search subcase to a
  // retained capability).
  const incompleteLedger = AUDITED_PINNED_LEDGER.filter((e) => e.subcase !== "web_search");
  const missingResult = assessCompatibility(incompleteLedger);
  assertEquals(missingResult.permitted, false);
  assertEquals(
    missingResult.blockers.some((b) => b.subcase === "web_search" && b.reason.includes("Missing")),
    true,
  );

  // 2. Pin mismatch (OMP version, OpenCode version, ACP SDK, terminal capability)
  const versionMismatchResult = assessCompatibility(AUDITED_PINNED_LEDGER, {
    ompVersion: "v18.7.0",
  });
  assertEquals(versionMismatchResult.permitted, false);
  assertEquals(
    versionMismatchResult.blockers.some((b) => b.reason.includes("pin mismatch")),
    true,
  );

  const opencodeMismatchResult = assessCompatibility(AUDITED_PINNED_LEDGER, {
    opencodeVersion: "1.18.22",
  });
  assertEquals(opencodeMismatchResult.permitted, false);
  assertEquals(
    opencodeMismatchResult.blockers.some((b) => b.reason.includes("OpenCode version mismatch")),
    true,
  );

  const sdkMismatchResult = assessCompatibility(AUDITED_PINNED_LEDGER, { acpSdkVersion: "0.15.0" });
  assertEquals(sdkMismatchResult.permitted, false);
  assertEquals(
    sdkMismatchResult.blockers.some((b) => b.reason.includes("ACP SDK version mismatch")),
    true,
  );

  const terminalMismatchResult = assessCompatibility(AUDITED_PINNED_LEDGER, {
    acpTerminalCapability: true,
  });
  assertEquals(terminalMismatchResult.permitted, false);
  assertEquals(
    terminalMismatchResult.blockers.some((b) =>
      b.reason.includes("ACP terminal capability mismatch")
    ),
    true,
  );

  // 3. Duplicate entries
  const duplicateLedger: LedgerEntry[] = [
    ...AUDITED_PINNED_LEDGER,
    AUDITED_PINNED_LEDGER[0],
  ];
  const duplicateResult = assessCompatibility(duplicateLedger);
  assertEquals(duplicateResult.permitted, false);
  assertEquals(
    duplicateResult.blockers.some((b) => b.reason.includes("Duplicate")),
    true,
  );

  // 4. Supported claim solely via SDK-internal method
  const sdkOnlyLedger: LedgerEntry[] = [
    {
      boundary: "policy_readiness",
      ompVersion: PINNED_OMP_VERSION,
      ompCommit: PINNED_OMP_COMMIT,
      sourceCitation: "sdk.ts privateMethod",
      reachability: "sdk-internal only method without public CLI flag",
      newLoadRefreshScope: "new",
      downstreamOwner: "gate-omp-policy-readiness",
      selectedMechanism: "fake",
      status: "supported",
      evidenceClassification: "mock_adapter",
    },
  ];
  const sdkOnlyResult = assessCompatibility(sdkOnlyLedger);
  assertEquals(sdkOnlyResult.permitted, false);
  assertEquals(
    sdkOnlyResult.blockers.some((b) => b.reason.includes("solely via internal SDK method")),
    true,
  );
});

// -----------------------------------------------------------------------------
// Group 2: Boundary 1 - Pre-Import Discovery Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 1 (Discovery): excludes unowned modules before importer/factory invocation", () => {
  const trustedRoots = routeDiscoverySkillsLspFixture.discovery.trustedRoots;
  let importerInvocationCount = 0;
  let factoryInvocationCount = 0;

  const runWithSpies = (candidate: DiscoveryModuleCandidate) => {
    const decision = validateDiscoveryContract(candidate, trustedRoots);
    if (decision.eligible) {
      importerInvocationCount++;
      factoryInvocationCount++;
    }
    return decision;
  };

  // 1. Unowned custom tool rejected before import
  const customTool = routeDiscoverySkillsLspFixture.discovery
    .unownedCustomTool as DiscoveryModuleCandidate;
  const d1 = runWithSpies(customTool);
  assertEquals(d1.eligible, false);
  assertEquals(d1.blockedBeforeImport, true);
  assertEquals(importerInvocationCount, 0);
  assertEquals(factoryInvocationCount, 0);

  // 2. Unowned plugin rejected before import
  const plugin = routeDiscoverySkillsLspFixture.discovery.unownedPlugin as DiscoveryModuleCandidate;
  const d2 = runWithSpies(plugin);
  assertEquals(d2.eligible, false);
  assertEquals(d2.blockedBeforeImport, true);
  assertEquals(importerInvocationCount, 0);
  assertEquals(factoryInvocationCount, 0);

  // 3. Configured root escape rejected before import
  const configured = routeDiscoverySkillsLspFixture.discovery
    .configuredModuleEscape as DiscoveryModuleCandidate;
  const d3 = runWithSpies(configured);
  assertEquals(d3.eligible, false);
  assertEquals(d3.blockedBeforeImport, true);
  assertEquals(importerInvocationCount, 0);
  assertEquals(factoryInvocationCount, 0);

  // 4. Escaping symlink rejected before import
  const symlink = routeDiscoverySkillsLspFixture.discovery
    .escapingSymlink as DiscoveryModuleCandidate;
  const d4 = runWithSpies(symlink);
  assertEquals(d4.eligible, false);
  assertEquals(d4.blockedBeforeImport, true);
  assertEquals(importerInvocationCount, 0);
  assertEquals(factoryInvocationCount, 0);

  // 5. Owned trusted module permitted
  const trusted = routeDiscoverySkillsLspFixture.discovery
    .ownedTrustedModule as DiscoveryModuleCandidate;
  const d5 = runWithSpies(trusted);
  assertEquals(d5.eligible, true);
  assertEquals(d5.blockedBeforeImport, false);
  assertEquals(importerInvocationCount, 1);
  assertEquals(factoryInvocationCount, 1);
});

// -----------------------------------------------------------------------------
// Group 3: Boundary 2 - Authenticated Policy Readiness Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 2 (Readiness): accepts valid current readiness; rejects mismatch, forged, stale, and lifecycle failures", () => {
  const currentContext = readinessFixture.currentContext as ReadinessContext;

  // 1. Valid current tuple
  const rValid = validateReadinessContract(
    currentContext,
    readinessFixture.validAssertion as ReadinessAssertion,
  );
  assertEquals(rValid.ready, true);
  assertEquals(rValid.isAdapterEvidenceOnly, true);

  // 2. Process mismatch
  const rProcessMismatch = validateReadinessContract(
    currentContext,
    readinessFixture.processMismatchAssertion as ReadinessAssertion,
  );
  assertEquals(rProcessMismatch.ready, false);
  assertEquals(rProcessMismatch.reason.includes("Process instance mismatch"), true);

  // 3. Session mismatch
  const rSessionMismatch = validateReadinessContract(
    currentContext,
    readinessFixture.sessionMismatchAssertion as ReadinessAssertion,
  );
  assertEquals(rSessionMismatch.ready, false);
  assertEquals(rSessionMismatch.reason.includes("session ID mismatch"), true);

  // 4. Challenge mismatch
  const rChallengeMismatch = validateReadinessContract(currentContext, {
    ...(readinessFixture.validAssertion as ReadinessAssertion),
    challenge: "stale-challenge",
  });
  assertEquals(rChallengeMismatch.ready, false);
  assertEquals(rChallengeMismatch.reason.includes("Challenge mismatch"), true);

  // 5. Policy revision mismatch
  const rRevisionMismatch = validateReadinessContract(currentContext, {
    ...(readinessFixture.validAssertion as ReadinessAssertion),
    policyRevision: 99,
  });
  assertEquals(rRevisionMismatch.ready, false);
  assertEquals(rRevisionMismatch.reason.includes("Policy revision mismatch"), true);

  // 6. Stale registry epoch
  const rStaleEpoch = validateReadinessContract(
    currentContext,
    readinessFixture.staleEpochAssertion as ReadinessAssertion,
  );
  assertEquals(rStaleEpoch.ready, false);
  assertEquals(rStaleEpoch.reason.includes("Registry epoch mismatch"), true);

  // 7. Mode mismatch
  const rModeMismatch = validateReadinessContract(currentContext, {
    ...(readinessFixture.validAssertion as ReadinessAssertion),
    restrictedMode: false,
  });
  assertEquals(rModeMismatch.ready, false);
  assertEquals(rModeMismatch.reason.includes("Restricted mode mismatch"), true);

  // 8. Forged chat provenance
  const rChat = validateReadinessContract(
    currentContext,
    readinessFixture.chatContextProvenanceAssertion as ReadinessAssertion,
  );
  assertEquals(rChat.ready, false);
  assertEquals(rChat.reason.includes("unsupported channel origin"), true);

  // 9. Prohibited platform secret credential
  const rSecret = validateReadinessContract(
    currentContext,
    readinessFixture.platformSecretCredentialAssertion as ReadinessAssertion,
  );
  assertEquals(rSecret.ready, false);
  assertEquals(rSecret.reason.includes("Invalid credential origin"), true);

  // 10. Timed-out initialization
  const rTimeout = validateReadinessContract(
    currentContext,
    readinessFixture.timedOutInitializationAssertion as ReadinessAssertion,
  );
  assertEquals(rTimeout.ready, false);
  assertEquals(rTimeout.reason.includes("Initialization not completed"), true);

  // 11. Lifecycle transition states (new / load / recovery) unready until established
  const rTransition = validateReadinessContract(
    currentContext,
    readinessFixture.newTransitionStateAssertion as ReadinessAssertion,
  );
  assertEquals(rTransition.ready, false);
  assertEquals(
    rTransition.reason.includes("Lifecycle state 'new' requires fresh establishment"),
    true,
  );

  const rLoadTransition = validateReadinessContract(currentContext, {
    ...(readinessFixture.validAssertion as ReadinessAssertion),
    lifecycleState: "load",
  });
  assertEquals(rLoadTransition.ready, false);
  assertEquals(
    rLoadTransition.reason.includes("Lifecycle state 'load' requires fresh establishment"),
    true,
  );
});

// -----------------------------------------------------------------------------
// Group 4: Boundary 3 - Authoritative Approval-Record Reset Counterexample Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 3 (Record Authority): models layer precedence, retains reset counterexample, and rejects fallback/mismatches", () => {
  const restrictedInput: SettingsLayerHierarchy = {
    lowerLayer: approvalResetFixture.lowerLayer as SettingsLayerHierarchy["lowerLayer"],
    cliOverlays: approvalResetFixture.cliOverlays as SettingsLayerHierarchy["cliOverlays"],
  };

  // Evaluate restricted mode expecting only read: allow
  const evaluation = evaluateApprovalRecordAuthority(restrictedInput, "restricted", {
    read: "allow",
  });

  // Intermediate aggregated CLI overlay has read: allow, null reset is overwritten
  assertEquals(evaluation.aggregatedCliOverlay, { read: "allow" });

  // Effective approval retains lower-layer unknown_tool: allow!
  assertEquals(evaluation.effectiveApproval["unknown_tool"], "allow");
  assertEquals(evaluation.effectiveApproval["read"], "allow");

  // Record authority fails due to residual hostile grants
  assertEquals(evaluation.authoritative, false);
  assertEquals(evaluation.residualHostileGrants, ["unknown_tool"]);

  // YOLO mode retaining lower prompt/deny records also fails
  const yoloInput: SettingsLayerHierarchy = {
    lowerLayer: approvalResetFixture.yoloLowerLayer as SettingsLayerHierarchy["lowerLayer"],
    cliOverlays: approvalResetFixture.yoloCliOverlays as SettingsLayerHierarchy["cliOverlays"],
  };
  const yoloEval = evaluateApprovalRecordAuthority(yoloInput, "yolo", { read: "allow" });
  assertEquals(yoloEval.authoritative, false);
  assertEquals(yoloEval.residualPromptDeny.includes("legacy_tool"), true);
  assertEquals(yoloEval.residualPromptDeny.includes("special_tool"), true);

  // No overlays supplied fails closed (default/lower fallback is not authority)
  const noOverlayEval = evaluateApprovalRecordAuthority(
    { lowerLayer: { approval: { read: "allow" } } },
    "restricted",
    { read: "allow" },
  );
  assertEquals(noOverlayEval.authoritative, false);
  assertEquals(noOverlayEval.reason.includes("No authoritative overlays"), true);

  // Owned key value mismatch fails closed
  const mismatchEval = evaluateApprovalRecordAuthority(
    {
      lowerLayer: { approval: {} },
      cliOverlays: [{ approval: { read: "deny" } }],
    },
    "restricted",
    { read: "allow" },
  );
  assertEquals(mismatchEval.authoritative, false);
  assertEquals(mismatchEval.reason.includes("mismatch with intended records"), true);

  // Runtime/env override layer takes highest precedence
  const envOverrideEval = evaluateApprovalRecordAuthority(
    {
      lowerLayer: { approval: { read: "deny" } },
      cliOverlays: [{ approval: { read: "deny" } }],
      runtimeEnvOverrides: { approval: { read: "allow" } },
    },
    "restricted",
    { read: "allow" },
  );
  assertEquals(envOverrideEval.authoritative, true);
  assertEquals(envOverrideEval.effectiveApproval["read"], "allow");
});

// -----------------------------------------------------------------------------
// Group 5: Boundary 4 - Complete Destructive Intent Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 4 (Destructive Intent): verifies full operations, move endpoints, patch targets; rejects escapes and traversal with 0 mutations", () => {
  const allowedRoots = ["/workspace/src", "/workspace/temp"];
  let executedMutations = 0;

  const evaluateWithMutationSpy = (
    input: Parameters<typeof validateDestructiveIntentContract>[0],
  ) => {
    const decision = validateDestructiveIntentContract(input, allowedRoots);
    if (decision.mutationPermitted) {
      executedMutations++;
    }
    return decision;
  };

  // 1. Valid delete
  const dValid = evaluateWithMutationSpy(
    destructiveFixture.validDelete as Parameters<typeof validateDestructiveIntentContract>[0],
  );
  assertEquals(dValid.valid, true);
  assertEquals(dValid.mutationPermitted, true);
  assertEquals(dValid.targets, ["/workspace/temp/scratch.txt"]);
  assertEquals(executedMutations, 1);

  // 2. Valid move covers both source and destination endpoints
  const mValid = evaluateWithMutationSpy(
    destructiveFixture.validMove as Parameters<typeof validateDestructiveIntentContract>[0],
  );
  assertEquals(mValid.valid, true);
  assertEquals(mValid.mutationPermitted, true);
  assertEquals(mValid.targets, ["/workspace/temp/a.txt", "/workspace/temp/b.txt"]);
  assertEquals(executedMutations, 2);

  // 3. Move missing destination fails closed
  const mMissing = evaluateWithMutationSpy(
    destructiveFixture.missingMoveDestination as Parameters<
      typeof validateDestructiveIntentContract
    >[0],
  );
  assertEquals(mMissing.mutationPermitted, false);
  assertEquals(executedMutations, 2);

  // 4. Synthetic valid multi-target patch
  const pValid = evaluateWithMutationSpy(
    destructiveFixture.validMultiPatchSynthetic as Parameters<
      typeof validateDestructiveIntentContract
    >[0],
  );
  assertEquals(pValid.valid, true);
  assertEquals(pValid.mutationPermitted, true);
  assertEquals(pValid.targets, ["/workspace/src/a.ts", "/workspace/src/b.ts"]);
  assertEquals(executedMutations, 3);

  // 5. Escaping patch: first target allowed, second escapes -> fails closed with ZERO new mutations!
  const pEscaping = evaluateWithMutationSpy(
    destructiveFixture.escapingMultiPatchSynthetic as Parameters<
      typeof validateDestructiveIntentContract
    >[0],
  );
  assertEquals(pEscaping.valid, true);
  assertEquals(pEscaping.mutationPermitted, false);
  assertEquals(pEscaping.targets, ["/workspace/src/a.ts", "/etc/shadow"]);
  assertEquals(pEscaping.reason.includes("outside allowed boundaries"), true);
  assertEquals(executedMutations, 3);

  // 6. Path traversal escape (/workspace/src/../../etc/passwd) normalized and rejected
  const pTraversal = evaluateWithMutationSpy({
    nativeTool: "delete",
    rawInput: JSON.stringify({ path: "/workspace/src/../../etc/passwd" }),
    executionInputBinding: JSON.stringify({ path: "/workspace/src/../../etc/passwd" }),
    parserProvenance: "supported_full_parser",
  });
  assertEquals(pTraversal.mutationPermitted, false);
  assertEquals(pTraversal.reason.includes("outside allowed boundaries"), true);
  assertEquals(executedMutations, 3);

  // 7. Native first-location-only parsing rejected as incomplete
  const pNativeFirstOnly = evaluateWithMutationSpy(
    destructiveFixture.nativeFirstLocationOnlyCounterexample as Parameters<
      typeof validateDestructiveIntentContract
    >[0],
  );
  assertEquals(pNativeFirstOnly.mutationPermitted, false);
  assertEquals(pNativeFirstOnly.reason.includes("first-location-only"), true);
  assertEquals(executedMutations, 3);

  // 8. Input / execution binding mismatch rejected
  const pMismatch = evaluateWithMutationSpy(
    destructiveFixture.inputMismatch as Parameters<typeof validateDestructiveIntentContract>[0],
  );
  assertEquals(pMismatch.mutationPermitted, false);
  assertEquals(pMismatch.reason.includes("does not match"), true);
  assertEquals(executedMutations, 3);

  // 9. Unknown syntax fails closed
  const pUnknown = evaluateWithMutationSpy(
    destructiveFixture.unknownSyntax as Parameters<typeof validateDestructiveIntentContract>[0],
  );
  assertEquals(pUnknown.mutationPermitted, false);
  assertEquals(pUnknown.reason.includes("Unknown or unparseable"), true);
  assertEquals(executedMutations, 3);
});

// -----------------------------------------------------------------------------
// Group 6: Boundary 5 - Restricted-Only LSP Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 5 (Restricted LSP): verifies separate mode profiles for both agents; rejects leaks and implicit clamps", () => {
  const ompRestrictedValid = routeDiscoverySkillsLspFixture.lspProfiles
    .ompRestrictedValid as AgentLspProfile;
  const ompYoloValid = routeDiscoverySkillsLspFixture.lspProfiles.ompYoloValid as AgentLspProfile;

  // 1. Valid OMP configuration
  const validDecision = validateRestrictedLspContract(ompRestrictedValid, ompYoloValid);
  assertEquals(validDecision.valid, true);

  // 2. OMP restricted leaking lazy cold-start on edit/write rejected
  const ompLeak = routeDiscoverySkillsLspFixture.lspProfiles
    .ompRestrictedWithColdStartLeak as AgentLspProfile;
  const leakDecision = validateRestrictedLspContract(ompLeak, ompYoloValid);
  assertEquals(leakDecision.valid, false);
  assertEquals(leakDecision.reason.includes("diagnostics on edit/write"), true);

  // 3. Agent identity mismatch rejected
  const mismatchedAgentDecision = validateRestrictedLspContract(
    ompRestrictedValid,
    routeDiscoverySkillsLspFixture.lspProfiles.opencodeYoloClamped as AgentLspProfile,
  );
  assertEquals(mismatchedAgentDecision.valid, false);
  assertEquals(mismatchedAgentDecision.reason.includes("Agent identity mismatch"), true);

  // 4. Valid OpenCode profiles
  const opencodeRestricted: AgentLspProfile = {
    agent: "opencode",
    mode: "restricted",
    explicitToolAvailable: false,
    implicitStartupOnRead: false,
    implicitStartupOnEditWrite: false,
    backgroundWarmupEnabled: false,
  };
  const opencodeYolo: AgentLspProfile = {
    agent: "opencode",
    mode: "yolo",
    explicitToolAvailable: true,
    implicitStartupOnRead: true,
    implicitStartupOnEditWrite: true,
    backgroundWarmupEnabled: true,
  };
  const opencodeValidDecision = validateRestrictedLspContract(opencodeRestricted, opencodeYolo);
  assertEquals(opencodeValidDecision.valid, true);

  // 5. OpenCode implicit YOLO clamp rejected
  const opencodeImplicitClampedYolo: AgentLspProfile = {
    ...opencodeYolo,
    implicitStartupOnEditWrite: false,
  };
  const implicitClampedDecision = validateRestrictedLspContract(
    opencodeRestricted,
    opencodeImplicitClampedYolo,
  );
  assertEquals(implicitClampedDecision.valid, false);
  assertEquals(implicitClampedDecision.reason.includes("implicit LSP startup clamped"), true);
});

// -----------------------------------------------------------------------------
// Group 7: Boundary 6 - Native Transport Adaptation Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 6 (Native Transport): validates per-hop routes under enforcing egress, rejects private targets and metadata, preserves unrestricted", () => {
  const allowlist = routeDiscoverySkillsLspFixture.transport.operatorAllowlist;
  let dispatchedHops = 0;

  const mockDispatch = (
    hop: TransportHopRequest,
    egressMode: "enforcing" | "unrestricted",
    proxyConfigured: boolean,
  ) => {
    const decision = validateTransportContract(egressMode, hop, proxyConfigured, allowlist);
    if (decision.permitted) {
      dispatchedHops++;
    }
    return decision;
  };

  // 1. Public text hop permitted via proxy under enforcing
  const dPublicText = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.publicTextHop as TransportHopRequest,
    "enforcing",
    true,
  );
  assertEquals(dPublicText.permitted, true);
  assertEquals(dPublicText.proxyRouted, true);
  assertEquals(dispatchedHops, 1);

  // 2. Public binary hop permitted via proxy under enforcing
  const dPublicBinary = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.publicBinaryHop as TransportHopRequest,
    "enforcing",
    true,
  );
  assertEquals(dPublicBinary.permitted, true);
  assertEquals(dPublicBinary.proxyRouted, true);
  assertEquals(dispatchedHops, 2);

  // 3. Search provider hop permitted via proxy under enforcing
  const dSearch = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.searchProviderHop as TransportHopRequest,
    "enforcing",
    true,
  );
  assertEquals(dSearch.permitted, true);
  assertEquals(dSearch.proxyRouted, true);
  assertEquals(dispatchedHops, 3);

  // 4. Metadata endpoint (169.254.169.254) strictly rejected before dispatch even if in allowlist
  const dMetadata = validateTransportContract(
    "enforcing",
    routeDiscoverySkillsLspFixture.transport.privateRedirectHop as TransportHopRequest,
    true,
    ["169.254.169.254"], // Attempt to allowlist metadata
  );
  assertEquals(dMetadata.permitted, false);
  assertEquals(dMetadata.error, "metadata_prohibited");
  assertEquals(dispatchedHops, 3);

  // 5. Private secondary scraper hop rejected before mocked dispatch
  const dSecondary = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.privateSecondaryScraperHop as TransportHopRequest,
    "enforcing",
    true,
  );
  assertEquals(dSecondary.permitted, false);
  assertEquals(dSecondary.error, "ssrf_prohibited_private_target");
  assertEquals(dispatchedHops, 3);

  // 6. Unsupported protocol scheme rejected
  const dFtp = validateTransportContract(
    "enforcing",
    { url: "ftp://ftp.example.com/file.bin", hopType: "initial_binary" },
    true,
  );
  assertEquals(dFtp.permitted, false);
  assertEquals(dFtp.error, "unsupported_scheme");

  // 7. Enforcing egress without configured proxy fails
  const dNoProxy = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.publicTextHop as TransportHopRequest,
    "enforcing",
    false,
  );
  assertEquals(dNoProxy.permitted, false);
  assertEquals(dNoProxy.error, "unconfigured_proxy");
  assertEquals(dispatchedHops, 3);

  // 8. Unrestricted egress preserves access without artificial YOLO clamps
  const dUnrestricted = mockDispatch(
    routeDiscoverySkillsLspFixture.transport.privateRedirectHop as TransportHopRequest,
    "unrestricted",
    false,
  );
  assertEquals(dUnrestricted.permitted, true);
  assertEquals(dUnrestricted.proxyRouted, false);
  assertEquals(dispatchedHops, 4);
});

// -----------------------------------------------------------------------------
// Group 8: Boundary 7 - Critical Skill Canonical Ownership Tests
// -----------------------------------------------------------------------------

Deno.test("Boundary 7 (Critical Skills): selects canonical owned skill; rejects workspace collision, symlink escapes, and stale generations", () => {
  const ownedRoot = routeDiscoverySkillsLspFixture.criticalSkills.ownedRoot;
  const currentGen = routeDiscoverySkillsLspFixture.criticalSkills.currentSessionGeneration;

  // 1. Canonical owned candidate selected safely
  const sCanonical = validateCriticalSkillContract(
    "memory-save",
    routeDiscoverySkillsLspFixture.criticalSkills.canonicalOwnedCandidate as SkillCandidate,
    ownedRoot,
    currentGen,
  );
  assertEquals(sCanonical.authoritative, true);
  assertEquals(sCanonical.canonicalPath, "/app/skills/memory-save/SKILL.md");

  // 2. Colliding workspace project candidate rejected
  const sWorkspace = validateCriticalSkillContract(
    "memory-save",
    routeDiscoverySkillsLspFixture.criticalSkills.collidingWorkspaceCandidate as SkillCandidate,
    ownedRoot,
    currentGen,
  );
  assertEquals(sWorkspace.authoritative, false);
  assertEquals(sWorkspace.reason.includes("cannot override deployment-owned"), true);

  // 3. Symlink escape candidate rejected
  const sSymlink = validateCriticalSkillContract(
    "memory-save",
    routeDiscoverySkillsLspFixture.criticalSkills.symlinkEscapeCandidate as SkillCandidate,
    ownedRoot,
    currentGen,
  );
  assertEquals(sSymlink.authoritative, false);
  assertEquals(sSymlink.reason.includes("escapes owned skill root"), true);

  // 4. Stale session generation candidate rejected
  const sStale = validateCriticalSkillContract(
    "memory-save",
    routeDiscoverySkillsLspFixture.criticalSkills.staleGenerationCandidate as SkillCandidate,
    ownedRoot,
    currentGen,
  );
  assertEquals(sStale.authoritative, false);
  assertEquals(sStale.reason.includes("Stale session generation ID"), true);
});
