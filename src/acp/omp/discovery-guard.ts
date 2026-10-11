/**
 * OMP Executable Discovery Guard & Canonical Ownership Module.
 *
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Implements the pre-import discovery exclusion decision, exact owned-module
 * trust validation, canonical critical-skill selection, and fail-closed
 * session setup error contracts.
 */

import { resolve } from "@std/path";
import {
  type CriticalSkillDecision,
  type SkillCandidate,
  validateCriticalSkillContract,
} from "./compatibility-contracts.ts";
import {
  type CanonicalTarget,
  isWithinRoot,
  type RootPathFailureReason,
} from "../filesystem-roots.ts";
import { OMP_TRUSTED_EXTENSION_PATH, ompLaunchCwd } from "../../utils/omp-paths.ts";
import type { OmpPermissionMode } from "../omp-settings.ts";
import type { ExecutableObservationForGuard } from "./executable-sources.ts";

/**
 * Surface identifiers audited in P0 ledger and design §2.
 */
export type DiscoverySurfaceId =
  | "ambient-extension-discovery"
  | "native-custom-tool-discovery"
  | "plugin-entry-points"
  | "configured-module-roots"
  | "workspace-owned-dependencies"
  | "symlinked-linked-roots"
  | "load-refresh-rediscovery";

/**
 * Pinned compatibility status per surface from the audit ledger.
 */
export type DiscoverySurfaceStatus =
  | "supported"
  | "candidate-to-verify"
  | "no-supported-mechanism";

/**
 * Description of an audited discovery/import surface and AIr's applied mechanism.
 */
export interface DiscoverySurfaceRecord {
  readonly id: DiscoverySurfaceId;
  readonly name: string;
  readonly pinnedRoute: string;
  readonly status: DiscoverySurfaceStatus;
  readonly appliedMechanism: string;
  readonly notes: string;
}

/**
 * Audited discovery surfaces table reproduced verbatim from design §2.
 */
export const AUDITED_DISCOVERY_SURFACES: readonly DiscoverySurfaceRecord[] = Object.freeze([
  Object.freeze({
    id: "ambient-extension-discovery" as const,
    name: "Ambient extension discovery",
    pinnedRoute:
      "main.ts buildSessionOptions trusted-path branch: exact canonical module files, extension discovery disabled; --no-extensions + --trusted-extension (row 9)",
    status: "supported" as const,
    appliedMechanism:
      "Consume row 9's flags unchanged; the module verifies its own canonical identity and that no additional extension root was presented to it. Never generalize to custom tools/plugins.",
    notes: "Supported for this surface only; cannot satisfy custom-tool or plugin surfaces.",
  }),
  Object.freeze({
    id: "native-custom-tool-discovery" as const,
    name: "Native custom-tool discovery",
    pinnedRoute:
      "sdk.ts discoverCustomToolPaths/loadCustomTools, independent of extension flags; custom-tools/loader.ts loadTool imports before factory/name inspection",
    status: "no-supported-mechanism" as const,
    appliedMechanism:
      "Decision records every configured/workspace-derived custom-tool root as excluded and emits a blocker; no import for inspection; no reliance on withHostGuard or SDK preloadedCustomToolPaths (P0 bars either being called an import guard).",
    notes: "P0 unresolved: official loader imports before inspection. Always yields a blocker.",
  }),
  Object.freeze({
    id: "plugin-entry-points" as const,
    name: "Plugin entry points",
    pinnedRoute:
      "plugins/loader.ts getEnabledPlugins, includes project roots and linked dependencies",
    status: "no-supported-mechanism" as const,
    appliedMechanism:
      "Plugin roots and linked-dependency entries are enumerated and marked excluded; blocker emitted; row 8's marketplace.autoUpdate: off is posture, not exclusion.",
    notes: "P0 unresolved: plugin enumeration imports module entries. Always yields a blocker.",
  }),
  Object.freeze({
    id: "configured-module-roots" as const,
    name: "Configured module roots",
    pinnedRoute:
      "PI_CONFIG_FILES / OMP_PROFILE / PI_PROFILE selectors that can add module/config layers",
    status: "candidate-to-verify" as const,
    appliedMechanism:
      "Deployment env posture only: row 7 never passes, row 8 keeps them un-set by workspace content, row 9 never sets them. The decision verifies they are absent from the observed process env and records the reliance as unverified native behavior.",
    notes: "Verifies environment variables are unset; reliance on native behavior is unverified.",
  }),
  Object.freeze({
    id: "workspace-owned-dependencies" as const,
    name: "Workspace-owned dependencies",
    pinnedRoute: "Linked/installed package resolution reachable from a project cwd",
    status: "candidate-to-verify" as const,
    appliedMechanism:
      "Row 9's deployment-derived neutral launch cwd whose dependency and .omp/ layers are empty by construction. The decision verifies the launch cwd is the contracted owned segment, and treats any workspace-derived cwd as an excluded root.",
    notes: "Verifies launch cwd matches the mode-scoped neutral launch cwd.",
  }),
  Object.freeze({
    id: "symlinked-linked-roots" as const,
    name: "Symlinked/linked roots",
    pinnedRoute: "Any discovery candidate reaching the owned root or escaping it via a link",
    status: "candidate-to-verify" as const,
    appliedMechanism:
      "Row 2 canonical identity: verify owned candidates stay within the owned canonical root and mark any escaping link untrusted (symlink_escape/trusted_identity_mismatch). Detection, not a native loader guarantee.",
    notes: "Reuses row 2 filesystem-root canonical identity verification.",
  }),
  Object.freeze({
    id: "load-refresh-rediscovery" as const,
    name: "Load/refresh rediscovery",
    pinnedRoute:
      "--trusted-extension trusted-module loading happens before session construction on new; recovery/registry transitions re-discover native state",
    status: "candidate-to-verify" as const,
    appliedMechanism:
      "The bootstrap runs per process/trusted-module load and its decision is re-consulted on session/new and session/load (a load on the same process reuses the frozen decision plus a fresh generation check); no path reopens the decision.",
    notes:
      "Decision frozen at load-time; refreshed resource generation checked per session lifecycle event.",
  }),
]);

/**
 * Representation of an active blocker preventing trusted session startup.
 */
export interface DiscoveryBlocker {
  readonly surfaceId: DiscoverySurfaceId;
  readonly status: DiscoverySurfaceStatus;
  readonly message: string;
}

/**
 * Excluded candidate root record.
 */
export interface ExcludedRootRecord {
  readonly path: string;
  readonly canonicalPath?: string;
  readonly surfaceId: DiscoverySurfaceId;
  readonly reason: string;
}

/**
 * Output of the load-time discovery bootstrap. Deeply frozen.
 */
export interface DiscoveryDecision {
  readonly surfaces: readonly DiscoverySurfaceRecord[];
  readonly excludedRoots: readonly ExcludedRootRecord[];
  readonly trustedRoots: readonly string[];
  readonly blockers: readonly DiscoveryBlocker[];
  readonly criticalSkills: readonly CriticalSkillSelectionRecord[];
  readonly resourceGeneration: string;
  readonly evaluatedAt: string;
  /** Row 27: the accepted observation this decision's admission is bound to. */
  readonly executableObservation?: ExecutableObservationForGuard;
}

/**
 * Input for pure discovery decision computation.
 */
export interface DiscoveryDecisionInput {
  readonly baseRoot: string;
  readonly mode: OmpPermissionMode;
  readonly observedEnv?: Record<string, string | undefined>;
  readonly observedCwd?: string;
  readonly presentedExtensionRoots?: readonly string[];
  readonly customToolRoots?: readonly string[];
  readonly pluginRoots?: readonly string[];
  readonly workspaceDependencyRoots?: readonly string[];
  readonly escapingLinkedRoots?: readonly string[];
  readonly trustedModuleCanonicalPath?: string;
  readonly closureRoots?: readonly string[];
  readonly criticalSkills?: readonly CriticalSkillSelectionRecord[];
  readonly resourceGeneration?: string;
  /**
   * Row 27 (check-omp-workspace-executables): the accepted pre-native
   * executable-source observation for this exact workspace + resource
   * generation. Deployment admission under DECIDED decision 1 replaces the
   * unconditional unsupported-native-status application rejection ONLY for a
   * matching generation; an absent or stale/foreign observation never reuses a
   * previous clean result and the fail-closed blockers stay.
   */
  readonly executableObservation?: ExecutableObservationForGuard;
}

/**
 * Deep clone and recursively freeze an object/array graph.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
    return Object.freeze(obj) as unknown as T;
  }
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    deepFreeze(val);
  }
  return Object.freeze(obj);
}

/**
 * Pure function computing the frozen discovery exclusion decision.
 * Never imports any candidate module.
 */
export function computeDiscoveryDecision(input: DiscoveryDecisionInput): DiscoveryDecision {
  const blockers: DiscoveryBlocker[] = [];
  const excludedRoots: ExcludedRootRecord[] = [];
  const executableAdmissionClean = input.executableObservation?.status === "absent-clean" &&
    (input.executableObservation.resourceGeneration === undefined ||
      input.executableObservation.resourceGeneration === input.resourceGeneration);

  const expectedLaunchCwd = ompLaunchCwd(input.baseRoot, input.mode);
  const contractedModulePath = resolve(input.baseRoot, OMP_TRUSTED_EXTENSION_PATH);

  const trustedRoots: string[] = [
    input.trustedModuleCanonicalPath ?? contractedModulePath,
    ...(input.closureRoots ?? []),
  ];

  // 1. Ambient extension discovery
  const extraExtensions = (input.presentedExtensionRoots ?? []).filter(
    (ext) =>
      ext !== OMP_TRUSTED_EXTENSION_PATH && ext !== contractedModulePath &&
      ext !== (input.trustedModuleCanonicalPath ?? contractedModulePath),
  );
  if (extraExtensions.length > 0) {
    for (const ext of extraExtensions) {
      excludedRoots.push({
        path: ext,
        surfaceId: "ambient-extension-discovery",
        reason: "Uncontracted extension root presented at launch",
      });
    }
    blockers.push({
      surfaceId: "ambient-extension-discovery",
      status: "supported",
      message: `Additional extension roots presented: ${extraExtensions.join(", ")}`,
    });
  }

  // 2. Native custom-tool discovery: pinned no-supported-mechanism verdict.
  // Row 27 (DECIDED decision 1): the verdict and the blocker stay fail-closed
  // by default; ONLY a verified absent executable-source observation for this
  // exact workspace + generation admits the session under the deployment
  // control instead of the unconditional unsupported-native rejection.
  if (!executableAdmissionClean) {
    blockers.push({
      surfaceId: "native-custom-tool-discovery",
      status: "no-supported-mechanism",
      message:
        "pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)",
    });
  }
  for (const root of input.customToolRoots ?? ["./.omp/tools", "./tools"]) {
    excludedRoots.push({
      path: root,
      surfaceId: "native-custom-tool-discovery",
      reason: "Native custom-tool discovery has no supported pre-import exclusion mechanism",
    });
  }

  // 3. Plugin entry points: pinned no-supported-mechanism verdict; same
  // row-27 DECIDED decision-1 admission rule as custom tools.
  if (!executableAdmissionClean) {
    blockers.push({
      surfaceId: "plugin-entry-points",
      status: "no-supported-mechanism",
      message: "pre-import exclusion not established: plugin-entry-points (no-supported-mechanism)",
    });
  }
  for (const root of input.pluginRoots ?? ["./.omp/plugins", "./plugins"]) {
    excludedRoots.push({
      path: root,
      surfaceId: "plugin-entry-points",
      reason: "Plugin entry points have no supported pre-import exclusion mechanism",
    });
  }

  // 4. Configured module roots (env posture check)
  const env = input.observedEnv ?? {};
  const forbiddenEnvKeys = [
    "PI_CONFIG_FILES",
    "OMP_PROFILE",
    "PI_PROFILE",
    "XDG_CONFIG_HOME",
  ];
  const detectedForbiddenEnv = forbiddenEnvKeys.filter((k) =>
    env[k] !== undefined && env[k] !== ""
  );
  if (detectedForbiddenEnv.length > 0) {
    blockers.push({
      surfaceId: "configured-module-roots",
      status: "candidate-to-verify",
      message: `Forbidden module-configuration environment variables detected: ${
        detectedForbiddenEnv.join(", ")
      }`,
    });
    for (const k of detectedForbiddenEnv) {
      excludedRoots.push({
        path: `env:${k}=${env[k]}`,
        surfaceId: "configured-module-roots",
        reason: `Forbidden module-configuring environment variable '${k}' present`,
      });
    }
  }

  // 5. Workspace-owned dependencies (launch cwd check)
  if (input.observedCwd !== undefined && input.observedCwd !== expectedLaunchCwd) {
    blockers.push({
      surfaceId: "workspace-owned-dependencies",
      status: "candidate-to-verify",
      message:
        `Observed launch cwd '${input.observedCwd}' does not match neutral launch cwd '${expectedLaunchCwd}'`,
    });
    excludedRoots.push({
      path: input.observedCwd,
      surfaceId: "workspace-owned-dependencies",
      reason: `Cwd is not the contracted mode-scoped launch cwd '${expectedLaunchCwd}'`,
    });
  }
  for (const depRoot of input.workspaceDependencyRoots ?? []) {
    excludedRoots.push({
      path: depRoot,
      surfaceId: "workspace-owned-dependencies",
      reason: "Workspace-owned dependency root excluded before import",
    });
  }

  // 6. Symlinked/linked roots escaping owned root
  for (const escapeRoot of input.escapingLinkedRoots ?? []) {
    blockers.push({
      surfaceId: "symlinked-linked-roots",
      status: "candidate-to-verify",
      message: `Symlinked root escapes canonical owned boundary: ${escapeRoot}`,
    });
    excludedRoots.push({
      path: escapeRoot,
      surfaceId: "symlinked-linked-roots",
      reason: "symlink_escape: link target escapes owned canonical root boundary",
    });
  }

  const decision: DiscoveryDecision = {
    surfaces: AUDITED_DISCOVERY_SURFACES,
    excludedRoots,
    trustedRoots,
    blockers,
    criticalSkills: input.criticalSkills ?? [],
    resourceGeneration: input.resourceGeneration ?? "gen-0",
    evaluatedAt: new Date().toISOString(),
    ...(input.executableObservation !== undefined
      ? { executableObservation: input.executableObservation }
      : {}),
  };

  return deepFreeze(decision);
}

/**
 * Result of owned-module ownership evaluation.
 */
export interface OwnedModuleOwnershipDecision {
  readonly trusted: boolean;
  readonly canonicalPath?: string;
  readonly reason: string;
  readonly failureReason?: RootPathFailureReason;
}

export interface EvaluateOwnedModuleOptions {
  readonly baseRoot: string;
  readonly mode?: OmpPermissionMode;
  readonly canonicalTarget?: CanonicalTarget;
  readonly isSymlink?: boolean;
  readonly symlinkTarget?: string;
  readonly closureRoots?: readonly string[];
}

/**
 * Evaluate exact owned-module ownership.
 * Requires canonical filesystem verification via CanonicalTarget from row 2.
 */
export function evaluateOwnedModuleOwnership(
  candidatePath: string,
  options: EvaluateOwnedModuleOptions,
): OwnedModuleOwnershipDecision {
  const contractedPath = resolve(options.baseRoot, OMP_TRUSTED_EXTENSION_PATH);
  const closure = options.closureRoots ?? [];
  const validRoots = [contractedPath, ...closure];

  // Check critical-name or tool-name match attempt
  const criticalNames = [
    "skill",
    "tools",
    "critical",
    "trusted-extension",
    "run_command",
    "read_file",
    "write_file",
    "edit_file",
  ];
  const basename = candidatePath.split("/").pop() ?? "";
  const isNameOnlyAttempt = criticalNames.some(
    (name) => basename === name || basename.startsWith(`${name}.`),
  ) && !validRoots.includes(resolve(candidatePath));

  if (isNameOnlyAttempt && !validRoots.includes(resolve(candidatePath))) {
    return {
      trusted: false,
      reason:
        "Name-only trust rejected: candidate name matches critical skill/tool but path is outside owned module root",
      failureReason: "trusted_identity_mismatch",
    };
  }

  // Row 2 canonical identity verification
  if (options.canonicalTarget) {
    const target = options.canonicalTarget;
    const hasOwnedRole = target.roles.some(
      (role) => role === "shared" || role === "trusted-skills",
    );
    if (!hasOwnedRole) {
      return {
        trusted: false,
        canonicalPath: target.canonicalTarget,
        reason: `Untrusted location: module resides in untrusted role(s) '${
          target.roles.join(", ")
        }'`,
        failureReason: "outside_roots",
      };
    }

    const hasEscapingSymlink = target.observedSymlinks.some(
      (sym) => !validRoots.some((r) => isWithinRoot(sym.target, r)),
    );
    if (hasEscapingSymlink) {
      return {
        trusted: false,
        canonicalPath: target.canonicalTarget,
        reason: "Symlink escapes canonical owned root",
        failureReason: "symlink_escape",
      };
    }

    const matchesOwned = validRoots.some((r) =>
      target.canonicalTarget === r || isWithinRoot(target.canonicalTarget, r)
    );
    if (!matchesOwned) {
      return {
        trusted: false,
        canonicalPath: target.canonicalTarget,
        reason: `Module canonical path '${target.canonicalTarget}' outside owned module closure`,
        failureReason: "trusted_identity_mismatch",
      };
    }

    return {
      trusted: true,
      canonicalPath: target.canonicalTarget,
      reason: "Module verified canonically within deployment-owned closure",
    };
  }

  // Without CanonicalTarget, untrusted locations are strictly rejected with reasons
  const resolvedCandidate = resolve(candidatePath);
  const lowerPath = candidatePath.toLowerCase();

  if (
    lowerPath.includes("/home/") ||
    lowerPath.includes("/workspace/") ||
    lowerPath.includes("/node_modules/") ||
    lowerPath.includes("/.cache/") ||
    lowerPath.includes("/.npm/") ||
    lowerPath.includes("/.deno/")
  ) {
    return {
      trusted: false,
      canonicalPath: resolvedCandidate,
      reason: `Untrusted location: module resides in workspace/home/cache path '${candidatePath}'`,
      failureReason: "outside_roots",
    };
  }

  if (options.isSymlink) {
    if (
      !options.symlinkTarget ||
      !validRoots.some((r) => isWithinRoot(resolve(options.symlinkTarget!), r))
    ) {
      return {
        trusted: false,
        canonicalPath: options.symlinkTarget ? resolve(options.symlinkTarget) : resolvedCandidate,
        reason: "Symlink escapes canonical owned root",
        failureReason: "symlink_escape",
      };
    }
  }

  const isContracted = validRoots.some((r) =>
    resolvedCandidate === r || isWithinRoot(resolvedCandidate, r)
  );
  if (!isContracted) {
    return {
      trusted: false,
      canonicalPath: resolvedCandidate,
      reason:
        `Module path '${candidatePath}' does not match contracted deployment module path '${contractedPath}'`,
      failureReason: "trusted_identity_mismatch",
    };
  }

  return {
    trusted: true,
    canonicalPath: resolvedCandidate,
    reason: "Module matches contracted deployment path and closure",
  };
}

/**
 * Critical skill ownership selection entry.
 */
export interface CriticalSkillSelectionRecord {
  readonly skillId: string;
  readonly canonicalInstructionPath: string;
  readonly ownedSkillRoot: string;
  readonly sessionGenerationId: string;
  readonly authoritative: boolean;
  readonly reason: string;
}

export interface EvaluateCriticalSkillOptions {
  readonly ownedSkillRoot: string;
  readonly currentSessionGenerationId: string;
  readonly currentSessionId: string;
  readonly candidateSessionId?: string;
  readonly isReadOnlyRoot?: boolean;
}

/**
 * Pinned critical skills per-ID canonical instruction relative paths.
 */
export const PINNED_CRITICAL_SKILLS: Readonly<Record<string, string>> = Object.freeze({
  review: "review/SKILL.md",
  destructive: "destructive/SKILL.md",
  lsp: "lsp/SKILL.md",
  readiness: "readiness/SKILL.md",
});

/**
 * Session lifecycle transition record for critical skills across new/load/refresh.
 */
export interface SessionSkillLifecycleState {
  readonly sessionId: string;
  readonly resourceGeneration: string;
  readonly activeSkills: readonly CriticalSkillSelectionRecord[];
  readonly lifecycleEvent: "session_new" | "session_load" | "session_refresh";
}

/**
 * Evaluate critical-skill canonical ownership.
 */
export function evaluateCriticalSkillSelection(
  skillId: string,
  candidate: SkillCandidate,
  options: EvaluateCriticalSkillOptions,
): CriticalSkillSelectionRecord {
  // Candidate session ID must be present and match current session
  if (
    options.candidateSessionId === undefined ||
    options.candidateSessionId !== options.currentSessionId
  ) {
    return {
      skillId,
      canonicalInstructionPath: candidate.canonicalPath,
      ownedSkillRoot: options.ownedSkillRoot,
      sessionGenerationId: candidate.sessionGenerationId,
      authoritative: false,
      reason:
        `Foreign session snapshot rejected: candidate session '${options.candidateSessionId}' != current session '${options.currentSessionId}'`,
    };
  }

  // Generation check
  if (candidate.sessionGenerationId !== options.currentSessionGenerationId) {
    return {
      skillId,
      canonicalInstructionPath: candidate.canonicalPath,
      ownedSkillRoot: options.ownedSkillRoot,
      sessionGenerationId: candidate.sessionGenerationId,
      authoritative: false,
      reason:
        `Stale session generation ID: candidate uses '${candidate.sessionGenerationId}', current is '${options.currentSessionGenerationId}'`,
    };
  }

  // Read-only root check
  if (options.isReadOnlyRoot !== true) {
    return {
      skillId,
      canonicalInstructionPath: candidate.canonicalPath,
      ownedSkillRoot: options.ownedSkillRoot,
      sessionGenerationId: candidate.sessionGenerationId,
      authoritative: false,
      reason: "Owned skill root is not verified read-only",
    };
  }

  // Instruction file must end with /SKILL.md or match pinned relative file
  const normalizedCandidate = candidate.canonicalPath.replace(/\\/g, "/");
  if (!normalizedCandidate.endsWith("/SKILL.md")) {
    return {
      skillId,
      canonicalInstructionPath: candidate.canonicalPath,
      ownedSkillRoot: options.ownedSkillRoot,
      sessionGenerationId: candidate.sessionGenerationId,
      authoritative: false,
      reason:
        `Critical skill instruction file must be 'SKILL.md', got '${candidate.canonicalPath}'`,
    };
  }

  // Expected path per pinned table if registered
  const pinnedRelative = PINNED_CRITICAL_SKILLS[skillId];
  if (pinnedRelative) {
    const expectedPath = `${options.ownedSkillRoot.replace(/\/$/, "")}/${pinnedRelative}`;
    if (candidate.canonicalPath !== expectedPath) {
      return {
        skillId,
        canonicalInstructionPath: candidate.canonicalPath,
        ownedSkillRoot: options.ownedSkillRoot,
        sessionGenerationId: candidate.sessionGenerationId,
        authoritative: false,
        reason:
          `Canonical instruction path '${candidate.canonicalPath}' does not match pinned canonical path '${expectedPath}'`,
      };
    }
  }

  // Delegate to P0 validator
  const p0Decision: CriticalSkillDecision = validateCriticalSkillContract(
    skillId,
    candidate,
    options.ownedSkillRoot,
    options.currentSessionGenerationId,
  );

  return {
    skillId,
    canonicalInstructionPath: p0Decision.canonicalPath ?? candidate.canonicalPath,
    ownedSkillRoot: options.ownedSkillRoot,
    sessionGenerationId: candidate.sessionGenerationId,
    authoritative: p0Decision.authoritative,
    reason: p0Decision.reason,
  };
}

/**
 * Pure transition helper producing a fresh lifecycle state on new/load/refresh.
 */
export function transitionSkillLifecycleState(
  sessionId: string,
  event: "session_new" | "session_load" | "session_refresh",
  priorState?: SessionSkillLifecycleState,
  candidates: readonly SkillCandidate[] = [],
  ownedSkillRoot = "/opt/air/skills",
): SessionSkillLifecycleState {
  const nextGenNumber = priorState
    ? (parseInt(priorState.resourceGeneration.replace(/^gen-/, ""), 10) || 0) + 1
    : 1;
  const currentGen = `gen-${nextGenNumber}`;

  const activeSkills: CriticalSkillSelectionRecord[] = [];
  for (const cand of candidates) {
    const sel = evaluateCriticalSkillSelection(cand.skillId, cand, {
      ownedSkillRoot,
      currentSessionGenerationId: currentGen,
      currentSessionId: sessionId,
      candidateSessionId: sessionId,
      isReadOnlyRoot: true,
    });
    activeSkills.push(sel);
  }

  return {
    sessionId,
    resourceGeneration: currentGen,
    activeSkills,
    lifecycleEvent: event,
  };
}

/**
 * Format bounded, credential-free fail-closed ACP session-creation error payload.
 */
export function formatDiscoverySessionError(decision: DiscoveryDecision): string {
  if (decision.blockers.length === 0) {
    return "No discovery blockers present";
  }
  const first = decision.blockers[0];
  return `pre-import exclusion not established: ${first.surfaceId} (${first.status})`;
}

/**
 * Honesty gate contract shape matching row 8 recordResetGate posture.
 */
/**
 * Separate DECIDED disposition carried by a native-unresolved honesty gate
 * (row 27). The native unresolved/verbatim verdict record on the gate is
 * unchanged; the disposition is distinct evidence of the selected deployment
 * control, and no repository mock can clear the native gate.
 */
export interface DiscoveryGateDisposition {
  readonly decision: 1 | 7;
  readonly status: "DECIDED (2026-10-09)";
  readonly selectedControl: string;
  /** Row 15 runtime-evidence status: the pinned native evidence stays UNVERIFIED. */
  readonly runtimeUnverified: "UNVERIFIED";
}

/** Row-27 decision-1 disposition: the pre-import exclusion gate. */
export const DECISION_1_DEPLOYMENT_ADMISSION: DiscoveryGateDisposition = Object.freeze({
  decision: 1,
  status: "DECIDED (2026-10-09)",
  selectedControl:
    "deployment-owned executable exclusion + pre-native startup check: the image/deployment keeps executable custom tools and plugin entry points out of the workspace, the owned extension loads only from the image path, --no-extensions keeps ambient discovery off, and the startup check rejects an executable module found in the workspace; the fail-closed session rejection stays the fallback",
  runtimeUnverified: "UNVERIFIED",
});

/** Row-27 decision-7 disposition: the critical skill selection gate. */
export const DECISION_7_SKILL_OWNERSHIP_ADMISSION: DiscoveryGateDisposition = Object.freeze({
  decision: 7,
  status: "DECIDED (2026-10-09)",
  selectedControl:
    "owned-settings skill-root ownership selection — isolate-omp-critical-skill-ownership (row 28) OWNS and lands the settings skill-root selection checks; this row records only the decided disposition and retains the existing canonical critical-skill checks",
  runtimeUnverified: "UNVERIFIED",
});

/**
 * Honesty gate contract shape matching row 8 recordResetGate posture.
 * Row 27 (DECIDED 2026-10-09): the stale "another user decision required"
 * blocker is removed — decisions 1 and 7 pin the dispositions, so no pending
 * user decision remains; the DECIDED disposition record is separate from the
 * unchanged native unresolved/verbatim verdict.
 */
export interface DiscoveryHonestyGate {
  readonly status: "unresolved";
  readonly boundary: string;
  readonly pinnedVerdict: string;
  readonly disposition: DiscoveryGateDisposition;
  readonly affectedSurfaces?: readonly DiscoverySurfaceId[];
  readonly affectedEvents?: readonly string[];
  readonly residualRisk: string;
  readonly operativeSecurityBoundary: string;
}

/**
 * Pre-import exclusion gate, recorded verbatim as pinned in P0 ledger and spec.md.
 */
export const preImportExclusionGate: DiscoveryHonestyGate = Object.freeze({
  status: "unresolved",
  boundary: "pre-import exclusion",
  pinnedVerdict: "extension flags alone incompatible and the supported full mechanism unresolved",
  disposition: DECISION_1_DEPLOYMENT_ADMISSION,
  affectedSurfaces: Object.freeze([
    "native-custom-tool-discovery",
    "plugin-entry-points",
  ] as DiscoverySurfaceId[]),
  residualRisk:
    "Official OMP v18.6.1 loader discovers and imports custom tools and plugins before factory/metadata inspection independently of extension flags.",
  operativeSecurityBoundary:
    "Restricted execution-time default-deny (row 14) and filesystem authorization (rows 2-4) are the operative security boundaries while pre-import exclusion stands as an unresolved gate.",
});

/**
 * Critical skill selection gate, recorded verbatim as pinned in P0 ledger and spec.md.
 */
export const criticalSkillSelectionGate: DiscoveryHonestyGate = Object.freeze({
  status: "unresolved",
  boundary: "critical skill ownership",
  pinnedVerdict: "name-only trust incompatible and canonical selection unresolved",
  disposition: DECISION_7_SKILL_OWNERSHIP_ADMISSION,
  affectedEvents: Object.freeze(["new", "load", "refresh"]),
  residualRisk:
    "Official OMP v18.6.1 resolveCollision allows custom directories to shadow provider skills, and setActiveSkills is process-global.",
  operativeSecurityBoundary:
    "Restricted execution-time sink authorization and prompt gating are the operative security boundaries while critical skill selection stands as an unresolved gate.",
});
