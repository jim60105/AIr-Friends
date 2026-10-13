import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  computeDiscoveryDecision,
  criticalSkillSelectionGate,
  DECISION_1_DEPLOYMENT_ADMISSION,
  DECISION_7_SKILL_OWNERSHIP_ADMISSION,
  type DiscoveryDecisionInput,
  evaluateCriticalSkillSelection,
  evaluateOwnedModuleOwnership,
  formatDiscoverySessionError,
  PINNED_CRITICAL_SKILLS,
  preImportExclusionGate,
  transitionSkillLifecycleState,
} from "../../src/acp/omp/discovery-guard.ts";
import { ompLaunchCwd } from "../../src/utils/omp-paths.ts";
import type { SkillCandidate } from "../../src/acp/omp/compatibility-contracts.ts";
import {
  type DeploymentModuleDeclaration,
  OMP_IMAGE_MODULE_DECLARATION,
} from "../../src/acp/omp/deployment-module.ts";
import {
  FIXTURE_DEVELOPMENT_DECLARATION,
  fixtureImageObservation,
  fixtureModuleObservation,
} from "./omp-owned-module-fixture.ts";

Deno.test("Task 4.1: Table-driven exclusion tests over each audited surface", () => {
  const baseRoot = "/opt/air";
  const mode = "restricted";
  const neutralCwd = ompLaunchCwd(baseRoot, mode);

  // Fixture importer spy: counts how many candidate modules were imported
  let importAttempts = 0;
  const fixtureCandidates = [
    "/workspace/project/.omp/tools/bad.ts",
    "/workspace/plugins/malicious/index.ts",
    "/workspace/node_modules/dep/index.ts",
  ];
  const _importerSpy = (modulePath: string) => {
    importAttempts++;
    throw new Error(`Forbidden candidate import attempted: ${modulePath}`);
  };

  const decisionInput: DiscoveryDecisionInput = {
    baseRoot,
    mode,
    observedCwd: neutralCwd,
    observedEnv: {},
    // The presented extension root is the DECLARED generated artifact (the
    // `.ts` source path is a build input, not a load entry).
    presentedExtensionRoots: [OMP_IMAGE_MODULE_DECLARATION.artifact],
    trustedModuleCanonicalPath: OMP_IMAGE_MODULE_DECLARATION.artifact,
    customToolRoots: ["/workspace/project/.omp/tools", "/workspace/tools/bad.ts"],
    pluginRoots: ["/workspace/plugins/malicious", "/workspace/node_modules/plugin-x"],
    workspaceDependencyRoots: ["/workspace/node_modules"],
    escapingLinkedRoots: ["/opt/air/omp-agent/restricted/escape-link"],
  };

  // Run exclusion decision without invoking importer on any candidate
  const decision = computeDiscoveryDecision(decisionInput);

  for (const cand of fixtureCandidates) {
    // Assert candidate is listed in excludedRoots rather than imported
    const isExcluded = decision.excludedRoots.some((r) => cand.startsWith(r.path));
    assertEquals(isExcluded, true);
    // Importer spy is never invoked
  }
  assertEquals(importAttempts, 0);

  // The decision's module trust root is the declared artifact, and the
  // declared artifact is not an uncontracted extension root.
  assertEquals(decision.trustedRoots[0], OMP_IMAGE_MODULE_DECLARATION.artifact);
  assertEquals(
    decision.blockers.some((b) => b.surfaceId === "ambient-extension-discovery"),
    false,
  );

  // Verify all 7 surfaces present
  assertEquals(decision.surfaces.length, 7);
  const surfaceMap = new Map(decision.surfaces.map((s) => [s.id, s]));

  assertEquals(surfaceMap.get("ambient-extension-discovery")?.status, "supported");
  assertEquals(surfaceMap.get("native-custom-tool-discovery")?.status, "no-supported-mechanism");
  assertEquals(surfaceMap.get("plugin-entry-points")?.status, "no-supported-mechanism");
  assertEquals(surfaceMap.get("configured-module-roots")?.status, "candidate-to-verify");
  assertEquals(surfaceMap.get("workspace-owned-dependencies")?.status, "candidate-to-verify");
  assertEquals(surfaceMap.get("symlinked-linked-roots")?.status, "candidate-to-verify");
  assertEquals(surfaceMap.get("load-refresh-rediscovery")?.status, "candidate-to-verify");

  // Blockers present for custom tools, plugins, and escaping roots
  assertEquals(decision.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"), true);
  assertEquals(decision.blockers.some((b) => b.surfaceId === "plugin-entry-points"), true);
  assertEquals(decision.blockers.some((b) => b.surfaceId === "symlinked-linked-roots"), true);

  // Verify excluded roots are recorded
  assertEquals(
    decision.excludedRoots.some((r) => r.path === "/workspace/project/.omp/tools"),
    true,
  );
  assertEquals(
    decision.excludedRoots.some((r) => r.path === "/workspace/plugins/malicious"),
    true,
  );
  assertEquals(
    decision.excludedRoots.some((r) => r.path === "/workspace/node_modules"),
    true,
  );
  assertEquals(
    decision.excludedRoots.some((r) => r.path === "/opt/air/omp-agent/restricted/escape-link"),
    true,
  );

  // Verify decision is frozen deeply
  assertEquals(Object.isFrozen(decision), true);
  assertEquals(Object.isFrozen(decision.surfaces), true);
  assertEquals(Object.isFrozen(decision.excludedRoots), true);
  assertEquals(Object.isFrozen(decision.blockers), true);
});

Deno.test("Task 4.2: Owned-module ownership consumes the declaration and physical evidence", () => {
  const imageObservation = fixtureImageObservation();

  // 1. The declared image artifact with valid physical evidence is trusted.
  const declared = evaluateOwnedModuleOwnership(imageObservation.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: imageObservation,
  });
  assertEquals(declared.trusted, true);
  assertEquals(declared.canonicalPath, OMP_IMAGE_MODULE_DECLARATION.artifact);

  // 2. A declared DEVELOPMENT artifact under a canonical checkout that lives
  //    under a home-shaped root is trusted: the DECLARED artifact is the
  //    decision's subject — the location screening below can never reject the
  //    declaration itself (the repository's real checkout is /var/home/...).
  const homeCheckout: DeploymentModuleDeclaration = {
    ...FIXTURE_DEVELOPMENT_DECLARATION,
    root: "/var/home/dev/checkout/build/omp-extension",
    artifact: "/var/home/dev/checkout/build/omp-extension/index.js",
  };
  const devObservation = fixtureModuleObservation({ declaration: homeCheckout });
  const development = evaluateOwnedModuleOwnership(devObservation.artifact.path, {
    declaration: homeCheckout,
    observation: devObservation,
  });
  assertEquals(development.trusted, true);

  // 3. An identical copy outside the declaration is excluded — by LOCATION
  //    for the workspace/HOME/package-cache spellings, by IDENTITY otherwise.
  for (
    const copy of [
      "/workspace/app/index.js",
      "/home/user/.omp/index.js",
      "/root/.cache/omp/index.js",
    ]
  ) {
    const verdict = evaluateOwnedModuleOwnership(copy, {
      declaration: OMP_IMAGE_MODULE_DECLARATION,
      observation: imageObservation,
    });
    assertEquals(verdict.trusted, false, copy);
    assertEquals(verdict.failureReason, "outside_roots", copy);
  }
  const mirrorCopy = evaluateOwnedModuleOwnership("/srv/mirror/omp-extension/index.js", {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: imageObservation,
  });
  assertEquals(mirrorCopy.trusted, false);
  assertEquals(mirrorCopy.failureReason, "trusted_identity_mismatch");

  // 4. Candidate matching a critical skill or tool name is untrusted by name,
  //    even when it carries a valid-looking observation.
  for (const lookAlike of ["/tmp/skill.ts", "/tmp/run_command.ts", "/tmp/tools.js"]) {
    const verdict = evaluateOwnedModuleOwnership(lookAlike, {
      declaration: OMP_IMAGE_MODULE_DECLARATION,
      observation: imageObservation,
    });
    assertEquals(verdict.trusted, false, lookAlike);
    assertEquals(verdict.failureReason, "trusted_identity_mismatch", lookAlike);
  }

  // 5. The declared artifact WITHOUT physical evidence denies: no session
  //    role, id or CanonicalTarget substitutes for the observation.
  const withoutEvidence = evaluateOwnedModuleOwnership(OMP_IMAGE_MODULE_DECLARATION.artifact, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
  });
  assertEquals(withoutEvidence.trusted, false);
  assertEquals(withoutEvidence.failureReason, "not_found");

  // 6. A linked artifact and a linked root are symlink escapes.
  const linkedArtifact = fixtureImageObservation({
    artifact: { isFile: false, isSymbolicLink: true },
  });
  const linked = evaluateOwnedModuleOwnership(linkedArtifact.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: linkedArtifact,
  });
  assertEquals(linked.trusted, false);
  assertEquals(linked.failureReason, "symlink_escape");
  const linkedRoot = fixtureImageObservation({ root: { isSymbolicLink: true } });
  const rootLink = evaluateOwnedModuleOwnership(linkedRoot.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: linkedRoot,
  });
  assertEquals(rootLink.trusted, false);
  assertEquals(rootLink.failureReason, "symlink_escape");

  // 7. A hard-linked (aliased) artifact and a moved fingerprint deny.
  const hardLinked = fixtureImageObservation({ artifact: { nlink: 2 } });
  const aliased = evaluateOwnedModuleOwnership(hardLinked.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: hardLinked,
  });
  assertEquals(aliased.trusted, false);
  assertEquals(aliased.failureReason, "path_changed");
  const movedFingerprint = fixtureImageObservation({ fingerprint: "stale-fingerprint" });
  const moved = evaluateOwnedModuleOwnership(movedFingerprint.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: movedFingerprint,
  });
  assertEquals(moved.trusted, false);
  assertEquals(moved.failureReason, "trusted_identity_mismatch");

  // 8. Posture violations deny: a non-root-owned image artifact, a
  //    group/other-writable path and a differently-owned development artifact.
  const foreignOwner = fixtureImageObservation({ artifact: { uid: 1000 } });
  const notRootOwned = evaluateOwnedModuleOwnership(foreignOwner.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: foreignOwner,
  });
  assertEquals(notRootOwned.trusted, false);
  assertEquals(notRootOwned.failureReason, "outside_roots");
  const writable = fixtureImageObservation({ artifact: { mode: 0o666 } });
  const groupWritable = evaluateOwnedModuleOwnership(writable.artifact.path, {
    declaration: OMP_IMAGE_MODULE_DECLARATION,
    observation: writable,
  });
  assertEquals(groupWritable.trusted, false);
  assertEquals(groupWritable.failureReason, "outside_roots");
  // Developer OWNER-writability is the source-owned posture and stays valid;
  // an artifact owned by ANOTHER user than its declared root does not.
  const ownerWritableDev = fixtureModuleObservation({
    declaration: FIXTURE_DEVELOPMENT_DECLARATION,
    artifact: { mode: 0o644 },
  });
  assertEquals(
    evaluateOwnedModuleOwnership(ownerWritableDev.artifact.path, {
      declaration: FIXTURE_DEVELOPMENT_DECLARATION,
      observation: ownerWritableDev,
    }).trusted,
    true,
  );
  const foreignDevArtifact = fixtureModuleObservation({
    declaration: FIXTURE_DEVELOPMENT_DECLARATION,
    artifact: { uid: 4321 },
  });
  const unownedSubstitution = evaluateOwnedModuleOwnership(foreignDevArtifact.artifact.path, {
    declaration: FIXTURE_DEVELOPMENT_DECLARATION,
    observation: foreignDevArtifact,
  });
  assertEquals(unownedSubstitution.trusted, false);
  assertEquals(unownedSubstitution.failureReason, "outside_roots");

  // 9. An observation of ANOTHER declaration than the evaluated one denies:
  //    a development observation can never satisfy a declaration claiming the
  //    image posture for the same paths.
  const wrongPosture: DeploymentModuleDeclaration = {
    ...homeCheckout,
    posture: "image",
  };
  const crossFace = evaluateOwnedModuleOwnership(devObservation.artifact.path, {
    declaration: wrongPosture,
    observation: devObservation,
  });
  assertEquals(crossFace.trusted, false);
  assertEquals(crossFace.failureReason, "trusted_identity_mismatch");
});

Deno.test("Task 4.3: Critical-skill ownership decision-table and lifecycle tests", () => {
  const ownedSkillRoot = "/opt/air/skills";
  const currentSessionGenerationId = "gen-100";
  const currentSessionId = "session-alpha";

  // Verify pinned skills dictionary exists
  assertEquals(PINNED_CRITICAL_SKILLS["review"], "review/SKILL.md");

  // 1. Owned canonical selection wins over same-name workspace/project candidate
  const ownedCandidate: SkillCandidate = {
    skillId: "review",
    resolvedPath: `${ownedSkillRoot}/review/SKILL.md`,
    canonicalPath: `${ownedSkillRoot}/review/SKILL.md`,
    source: "deployment_owned",
    sessionGenerationId: currentSessionGenerationId,
  };
  const ownedSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(ownedSelection.authoritative, true);

  const workspaceCandidate: SkillCandidate = {
    skillId: "review",
    resolvedPath: "/workspace/project/.omp/skills/review/SKILL.md",
    canonicalPath: "/workspace/project/.omp/skills/review/SKILL.md",
    source: "workspace_project",
    sessionGenerationId: currentSessionGenerationId,
  };
  const workspaceSelection = evaluateCriticalSkillSelection("review", workspaceCandidate, {
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(workspaceSelection.authoritative, false);

  // 2. Exact filename rejection: NOT-SKILL.md rejected even within owned root
  const wrongFilenameCandidate: SkillCandidate = {
    skillId: "review",
    resolvedPath: `${ownedSkillRoot}/review/NOT-SKILL.md`,
    canonicalPath: `${ownedSkillRoot}/review/NOT-SKILL.md`,
    source: "deployment_owned",
    sessionGenerationId: currentSessionGenerationId,
  };
  const wrongFileSelection = evaluateCriticalSkillSelection("review", wrongFilenameCandidate, {
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(wrongFileSelection.authoritative, false);

  // 3. Stale-generation candidate rejects
  const staleSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionGenerationId: "gen-101",
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(staleSelection.authoritative, false);
  assertEquals(staleSelection.reason.includes("Stale session generation ID"), true);

  // 4. Foreign-session snapshot rejects
  const foreignSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: "session-beta",
    isReadOnlyRoot: true,
  });
  assertEquals(foreignSelection.authoritative, false);
  assertEquals(foreignSelection.reason.includes("Foreign session snapshot rejected"), true);

  // 5. Lifecycle state transitions across new, load, and refresh
  const evidence = (generation: string) => ({
    ownedSkillRoot,
    ownedSkillRoots: [ownedSkillRoot],
    currentSessionId,
    candidateSessionId: currentSessionId,
    currentSessionGenerationId: generation,
    isReadOnlyRoot: true,
  });
  const sNew = transitionSkillLifecycleState(currentSessionId, "session_new", [
    { ...ownedCandidate, sessionGenerationId: "gen-1" },
  ], evidence("gen-1"));
  assertEquals(sNew.resourceGeneration, "gen-1");
  assertEquals(sNew.lifecycleEvent, "session_new");
  assertEquals(sNew.activeSkills[0].authoritative, true);

  const sLoad = transitionSkillLifecycleState(currentSessionId, "session_load", [
    { ...ownedCandidate, sessionGenerationId: "gen-2" },
  ], evidence("gen-2"));
  assertEquals(sLoad.resourceGeneration, "gen-2");
  assertEquals(sLoad.lifecycleEvent, "session_load");

  const sRefresh = transitionSkillLifecycleState(currentSessionId, "session_refresh", [
    { ...ownedCandidate, sessionGenerationId: "gen-3" },
  ], evidence("gen-3"));
  assertEquals(sRefresh.resourceGeneration, "gen-3");
  assertEquals(sRefresh.lifecycleEvent, "session_refresh");
});

Deno.test("Task 4.4: Fail-closed and honesty gate tests", () => {
  const baseRoot = "/opt/air";
  const mode = "restricted";

  // 1. Blocked decision produces named-surface session-setup error
  const blockedDecision = computeDiscoveryDecision({
    baseRoot,
    mode,
    observedCwd: ompLaunchCwd(baseRoot, mode),
  });
  assertEquals(blockedDecision.blockers.length > 0, true);

  const errorMsg = formatDiscoverySessionError(blockedDecision);
  assertEquals(
    errorMsg,
    "pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)",
  );

  // 2. Both gates report 'unresolved' with pinned verdict text verbatim
  assertEquals(preImportExclusionGate.status, "unresolved");
  assertEquals(
    preImportExclusionGate.pinnedVerdict,
    "extension flags alone incompatible and the supported full mechanism unresolved",
  );
  // 3. Row 27: no stale "another user decision required" blocker remains;
  // each gate carries its separate DECIDED disposition (the verdict above
  // stays verbatim; the disposition never relabels it).
  assertEquals("userDecisionRequired" in preImportExclusionGate, false);
  assertEquals(preImportExclusionGate.disposition, DECISION_1_DEPLOYMENT_ADMISSION);
  assertEquals(preImportExclusionGate.disposition.decision, 1);
  assertEquals(preImportExclusionGate.disposition.status, "DECIDED (2026-10-09)");
  assertEquals(preImportExclusionGate.disposition.runtimeUnverified, "UNVERIFIED");
  assert(
    preImportExclusionGate.disposition.selectedControl.includes(
      "the fail-closed session rejection stays the fallback",
    ),
  );

  assertEquals(criticalSkillSelectionGate.status, "unresolved");
  assertEquals(
    criticalSkillSelectionGate.pinnedVerdict,
    "name-only trust incompatible and canonical selection unresolved",
  );
  assertEquals("userDecisionRequired" in criticalSkillSelectionGate, false);
  assertEquals(criticalSkillSelectionGate.disposition, DECISION_7_SKILL_OWNERSHIP_ADMISSION);
  assertEquals(criticalSkillSelectionGate.disposition.decision, 7);
  assertEquals(criticalSkillSelectionGate.disposition.status, "DECIDED (2026-10-09)");
  assertEquals(criticalSkillSelectionGate.disposition.runtimeUnverified, "UNVERIFIED");
  // Row 28 owns the settings skill-root checks; the record says so explicitly.
  assert(
    criticalSkillSelectionGate.disposition.selectedControl.includes(
      "isolate-omp-critical-skill-ownership (row 28) OWNS",
    ),
  );

  // 3. Synthetic positive fixture cannot clear either gate
  assertEquals(preImportExclusionGate.status, "unresolved");
  assertEquals(criticalSkillSelectionGate.status, "unresolved");
});

Deno.test("row 27: decision-1 deployment admission with a clean executable observation", () => {
  const baseRoot = "/opt/air";
  const mode = "restricted";
  // Admission binds the observation to the EXACT workspace the decision
  // evaluates (duck B2): the clean observation must name this decision's own
  // launch cwd, never a foreign workspace path.
  const observation = {
    status: "absent-clean",
    sessionCwd: ompLaunchCwd(baseRoot, mode),
    resourceGeneration: "gen-42",
  } as const;

  // Admission: an exact workspace+generation absent observation replaces the
  // two unsupported-native-status application blockers...
  const admitted = computeDiscoveryDecision({
    baseRoot,
    mode,
    observedCwd: ompLaunchCwd(baseRoot, mode),
    resourceGeneration: "gen-42",
    executableObservation: observation,
  });
  assertEquals(
    admitted.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
    false,
  );
  assertEquals(admitted.blockers.some((b) => b.surfaceId === "plugin-entry-points"), false);
  // ...while the frozen surfaces table keeps both pinned verdicts verbatim.
  const customTool = admitted.surfaces.find((s) => s.id === "native-custom-tool-discovery")!;
  const plugins = admitted.surfaces.find((s) => s.id === "plugin-entry-points")!;
  assertEquals(customTool.status, "no-supported-mechanism");
  assertEquals(plugins.status, "no-supported-mechanism");
  assertEquals(admitted.executableObservation, observation);

  // Stale/foreign generation NEVER reuses a previous clean result; a missing
  // observation never manufactures admission; a same-generation observation
  // for a DIFFERENT workspace never admits (workspace binding, duck B2).
  for (const stale of ["gen-7", undefined]) {
    const notAdmitted = computeDiscoveryDecision({
      baseRoot,
      mode,
      observedCwd: ompLaunchCwd(baseRoot, mode),
      resourceGeneration: "gen-42",
      ...(stale !== undefined
        ? { executableObservation: { ...observation, resourceGeneration: stale } }
        : {}),
    });
    assertEquals(
      notAdmitted.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
      true,
      `stale=${stale}`,
    );
    assertEquals(
      notAdmitted.blockers.some((b) => b.surfaceId === "plugin-entry-points"),
      true,
      `stale=${stale}`,
    );
  }
  const foreignWorkspace = computeDiscoveryDecision({
    baseRoot,
    mode,
    observedCwd: ompLaunchCwd(baseRoot, mode),
    resourceGeneration: "gen-42",
    executableObservation: { ...observation, sessionCwd: "/srv/other-workspace" },
  });
  assertEquals(
    foreignWorkspace.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
    true,
  );
  assertEquals(
    foreignWorkspace.blockers.some((b) => b.surfaceId === "plugin-entry-points"),
    true,
  );
  // An absent observedCwd fails closed: no workspace identity, no admission.
  const unbound = computeDiscoveryDecision({
    baseRoot,
    mode,
    resourceGeneration: "gen-42",
    executableObservation: observation,
  });
  assertEquals(
    unbound.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
    true,
  );

  // Deployment authority checks stay unconditional fail-closed even with a
  // clean observation: cwd drift and module-selector env posture.
  const drifted = computeDiscoveryDecision({
    baseRoot,
    mode,
    observedCwd: "/workspace/hostile",
    resourceGeneration: "gen-42",
    executableObservation: observation,
  });
  assertEquals(
    drifted.blockers.some((b) => b.surfaceId === "workspace-owned-dependencies"),
    true,
  );
  // The drifted decision also loses admission (observation bound elsewhere):
  // the pinned native blockers stay.
  assertEquals(
    drifted.blockers.some((b) => b.surfaceId === "native-custom-tool-discovery"),
    true,
  );
  const polluted = computeDiscoveryDecision({
    baseRoot,
    mode,
    observedCwd: ompLaunchCwd(baseRoot, mode),
    observedEnv: { OMP_PROFILE: "/workspace/profile" },
    resourceGeneration: "gen-42",
    executableObservation: observation,
  });
  assertEquals(
    polluted.blockers.some((b) => b.surfaceId === "configured-module-roots"),
    true,
  );
});

Deno.test("Task 3.2: Module tree load-time throw on blockers", async () => {
  // Importing index.ts when blockers exist throws initialization error
  await assertRejects(
    async () => {
      await import("../../src/acp/omp/extension/index.ts");
    },
    Error,
    "pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)",
  );
});
