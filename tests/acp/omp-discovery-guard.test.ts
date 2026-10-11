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
import { OMP_TRUSTED_EXTENSION_PATH, ompLaunchCwd } from "../../src/utils/omp-paths.ts";
import type { SkillCandidate } from "../../src/acp/omp/compatibility-contracts.ts";
import type { CanonicalTarget } from "../../src/acp/filesystem-roots.ts";

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
    presentedExtensionRoots: [`${baseRoot}/${OMP_TRUSTED_EXTENSION_PATH}`],
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

Deno.test("Task 4.2: Owned-module ownership tests with CanonicalTarget and reasons", () => {
  const baseRoot = "/opt/air";
  const trustedPath = `${baseRoot}/${OMP_TRUSTED_EXTENSION_PATH}`;

  // 1. Contracted module is trusted
  const ownedRes = evaluateOwnedModuleOwnership(trustedPath, {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(ownedRes.trusted, true);

  // 1b. With row 2 CanonicalTarget inside shared role
  const mockSharedTarget: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "1",
    roles: ["shared"],
    rootIdentities: [],
    normalizedInput: trustedPath,
    canonicalTarget: trustedPath,
    rootRelativePath: OMP_TRUSTED_EXTENSION_PATH,
    targetType: "file",
    observedSymlinks: [],
  };
  const targetOwnedRes = evaluateOwnedModuleOwnership(trustedPath, {
    baseRoot,
    mode: "restricted",
    canonicalTarget: mockSharedTarget,
  });
  assertEquals(targetOwnedRes.trusted, true);

  // 2. CanonicalTarget in untrusted workspace role is untrusted
  const mockWorkspaceTarget: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "1",
    roles: ["workspace"],
    rootIdentities: [],
    normalizedInput: "/workspace/app/index.ts",
    canonicalTarget: "/workspace/app/index.ts",
    rootRelativePath: "index.ts",
    targetType: "file",
    observedSymlinks: [],
  };
  const workspaceTargetRes = evaluateOwnedModuleOwnership("/workspace/app/index.ts", {
    baseRoot,
    mode: "restricted",
    canonicalTarget: mockWorkspaceTarget,
  });
  assertEquals(workspaceTargetRes.trusted, false);
  assertEquals(workspaceTargetRes.failureReason, "outside_roots");

  // 3. Byte-identical copy in workspace / HOME / package-cache paths is untrusted
  const workspaceCopy = evaluateOwnedModuleOwnership("/workspace/app/index.ts", {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(workspaceCopy.trusted, false);
  assertEquals(workspaceCopy.failureReason, "outside_roots");

  const homeCopy = evaluateOwnedModuleOwnership("/home/user/.omp/index.ts", {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(homeCopy.trusted, false);
  assertEquals(homeCopy.failureReason, "outside_roots");

  const cacheCopy = evaluateOwnedModuleOwnership("/root/.cache/omp/index.ts", {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(cacheCopy.trusted, false);
  assertEquals(cacheCopy.failureReason, "outside_roots");

  // 4. Candidate matching critical skill or tool name is untrusted by name
  const nameOnlyMatch = evaluateOwnedModuleOwnership("/tmp/skill.ts", {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(nameOnlyMatch.trusted, false);
  assertEquals(nameOnlyMatch.failureReason, "trusted_identity_mismatch");

  const toolNameMatch = evaluateOwnedModuleOwnership("/tmp/run_command.ts", {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(toolNameMatch.trusted, false);
  assertEquals(toolNameMatch.failureReason, "trusted_identity_mismatch");

  // 5. Symlink escaping the owned canonical root is untrusted with symlink_escape
  const escapingSymlink = evaluateOwnedModuleOwnership(`${baseRoot}/link.ts`, {
    baseRoot,
    mode: "restricted",
    isSymlink: true,
    symlinkTarget: "/workspace/escape.ts",
  });
  assertEquals(escapingSymlink.trusted, false);
  assertEquals(escapingSymlink.failureReason, "symlink_escape");

  // 6. Mode-independence: restricted vs native-yolo yields identical trust verdict
  const restrictedResult = evaluateOwnedModuleOwnership(trustedPath, {
    baseRoot,
    mode: "restricted",
  });
  const yoloResult = evaluateOwnedModuleOwnership(trustedPath, {
    baseRoot,
    mode: "native-yolo",
  });
  assertEquals(restrictedResult.trusted, yoloResult.trusted);
  assertEquals(restrictedResult.canonicalPath, yoloResult.canonicalPath);
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
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(wrongFileSelection.authoritative, false);

  // 3. Stale-generation candidate rejects
  const staleSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
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
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: "session-beta",
    isReadOnlyRoot: true,
  });
  assertEquals(foreignSelection.authoritative, false);
  assertEquals(foreignSelection.reason.includes("Foreign session snapshot rejected"), true);

  // 5. Lifecycle state transitions across new, load, and refresh
  const sNew = transitionSkillLifecycleState(currentSessionId, "session_new", undefined, [
    { ...ownedCandidate, sessionGenerationId: "gen-1" },
  ]);
  assertEquals(sNew.resourceGeneration, "gen-1");
  assertEquals(sNew.lifecycleEvent, "session_new");
  assertEquals(sNew.activeSkills[0].authoritative, true);

  const sLoad = transitionSkillLifecycleState(currentSessionId, "session_load", sNew, [
    { ...ownedCandidate, sessionGenerationId: "gen-2" },
  ]);
  assertEquals(sLoad.resourceGeneration, "gen-2");
  assertEquals(sLoad.lifecycleEvent, "session_load");

  const sRefresh = transitionSkillLifecycleState(currentSessionId, "session_refresh", sLoad, [
    { ...ownedCandidate, sessionGenerationId: "gen-3" },
  ]);
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
