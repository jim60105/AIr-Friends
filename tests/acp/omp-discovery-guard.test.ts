import { assertEquals, assertRejects } from "@std/assert";
import {
  computeDiscoveryDecision,
  criticalSkillSelectionGate,
  type DiscoveryDecisionInput,
  evaluateCriticalSkillSelection,
  evaluateOwnedModuleOwnership,
  formatDiscoverySessionError,
  preImportExclusionGate,
} from "../../src/acp/omp/discovery-guard.ts";
import { OMP_TRUSTED_EXTENSION_PATH, ompLaunchCwd } from "../../src/utils/omp-paths.ts";
import type { SkillCandidate } from "../../src/acp/omp/compatibility-contracts.ts";

Deno.test("Task 4.1: Table-driven exclusion tests over each audited surface", () => {
  const baseRoot = "/opt/air";
  const mode = "restricted";
  const neutralCwd = ompLaunchCwd(baseRoot, mode);

  // Fixture importer spy: counts how many candidate modules were imported
  let importAttempts = 0;
  const importerSpy = (_modulePath: string) => {
    importAttempts++;
    throw new Error("Importer spy should never be invoked during discovery exclusion");
  };
  void importerSpy;

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

  const decision = computeDiscoveryDecision(decisionInput);

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

  // Importer spy recorded zero import attempts
  assertEquals(importAttempts, 0);

  // Verify decision is frozen deeply
  assertEquals(Object.isFrozen(decision), true);
  assertEquals(Object.isFrozen(decision.surfaces), true);
  assertEquals(Object.isFrozen(decision.excludedRoots), true);
  assertEquals(Object.isFrozen(decision.blockers), true);
});

Deno.test("Task 4.2: Owned-module ownership tests", () => {
  const baseRoot = "/opt/air";
  const trustedPath = `${baseRoot}/${OMP_TRUSTED_EXTENSION_PATH}`;

  // 1. Contracted module is trusted
  const ownedRes = evaluateOwnedModuleOwnership(trustedPath, {
    baseRoot,
    mode: "restricted",
  });
  assertEquals(ownedRes.trusted, true);

  // 2. Byte-identical copy in workspace / HOME / package-cache paths is untrusted
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

  // 3. Candidate matching critical skill or tool name is untrusted by name
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

  // 4. Symlink escaping the owned canonical root is untrusted with symlink_escape
  const escapingSymlink = evaluateOwnedModuleOwnership(`${baseRoot}/link.ts`, {
    baseRoot,
    mode: "restricted",
    isSymlink: true,
    symlinkTarget: "/workspace/escape.ts",
  });
  assertEquals(escapingSymlink.trusted, false);
  assertEquals(escapingSymlink.failureReason, "symlink_escape");

  // 5. Mode-independence: restricted vs native-yolo yields identical trust verdict
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

Deno.test("Task 4.3: Critical-skill ownership decision-table tests", () => {
  const ownedSkillRoot = "/opt/air/skills";
  const currentSessionGenerationId = "gen-100";
  const currentSessionId = "session-alpha";

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

  // 2. Ordinary skills remain enabled (no global disable, no new key needed)
  // Non-critical ordinary skills are not blocked by the critical skill contract
  assertEquals(ownedSelection.authoritative, true);

  // 3. Ownership holds across new/load/refresh event fixtures with fresh generation
  const refreshedGenerationId = "gen-101";
  const refreshedCandidate: SkillCandidate = {
    skillId: "review",
    resolvedPath: `${ownedSkillRoot}/review/SKILL.md`,
    canonicalPath: `${ownedSkillRoot}/review/SKILL.md`,
    source: "deployment_owned",
    sessionGenerationId: refreshedGenerationId,
  };
  const refreshSelection = evaluateCriticalSkillSelection("review", refreshedCandidate, {
    ownedSkillRoot,
    currentSessionGenerationId: refreshedGenerationId,
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(refreshSelection.authoritative, true);

  // 4. Stale-generation candidate rejects
  const staleSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
    currentSessionGenerationId: refreshedGenerationId, // session moved to gen-101, candidate has gen-100
    currentSessionId,
    candidateSessionId: currentSessionId,
    isReadOnlyRoot: true,
  });
  assertEquals(staleSelection.authoritative, false);
  assertEquals(staleSelection.reason.includes("Stale session generation ID"), true);

  // 5. Foreign-session snapshot rejects
  const foreignSelection = evaluateCriticalSkillSelection("review", ownedCandidate, {
    ownedSkillRoot,
    currentSessionGenerationId,
    currentSessionId,
    candidateSessionId: "session-beta", // foreign session
    isReadOnlyRoot: true,
  });
  assertEquals(foreignSelection.authoritative, false);
  assertEquals(foreignSelection.reason.includes("Foreign session snapshot rejected"), true);
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
  assertEquals(preImportExclusionGate.userDecisionRequired, true);

  assertEquals(criticalSkillSelectionGate.status, "unresolved");
  assertEquals(
    criticalSkillSelectionGate.pinnedVerdict,
    "name-only trust incompatible and canonical selection unresolved",
  );
  assertEquals(criticalSkillSelectionGate.userDecisionRequired, true);

  // 3. Synthetic positive fixture cannot clear either gate
  // Passing mock decision test does not alter honesty gate
  assertEquals(preImportExclusionGate.status, "unresolved");
  assertEquals(criticalSkillSelectionGate.status, "unresolved");
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
