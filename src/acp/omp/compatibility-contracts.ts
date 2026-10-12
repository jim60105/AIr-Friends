/**
 * OMP Compatibility Contracts & Assessment Module
 *
 * Implements pure completeness/admission checks, typed seven-boundary ledger definitions,
 * and pure contract validators for OpenSpec change `establish-omp-compatibility-contracts` (P0).
 *
 * This module is pure data evaluation and decision logic: it does not perform live
 * process startup, filesystem mutation, or network requests.
 */

import { validateRequiredInventory } from "./inventory-validator.ts";
export { evaluateApprovalRecordAuthority } from "./record-evaluator.ts";
export type { SettingsLayerHierarchy } from "./record-evaluator.ts";
export { validateDestructiveIntentContract } from "./destructive-validator.ts";
export { validateTransportContract } from "./transport-validator.ts";
export { validateRestrictedLspContract } from "./lsp-validator.ts";

// Pinned Upstream Versions
export const PINNED_OMP_VERSION = "v18.6.1";
export const PINNED_OMP_COMMIT = "2a2c6dcbbb558c0f8145f67f28b3370984f2bf60";
export const PINNED_OPENCODE_VERSION = "1.18.21";
export const PINNED_OPENCODE_TREE = "826d9ad46a22bef0294998e08daa3c4904fea28f";
export const PINNED_ACP_SDK_VERSION = "0.14.1";
export const PINNED_ACP_TERMINAL_CAPABILITY = false;

export type CompatibilityStatus = "supported" | "incompatible" | "unresolved";

export type BoundaryId =
  | "pre_import_discovery"
  | "policy_readiness"
  | "record_authority"
  | "destructive_intent"
  | "restricted_lsp"
  | "native_transport"
  | "critical_skills";

export const REQUIRED_BOUNDARIES: readonly BoundaryId[] = [
  "pre_import_discovery",
  "policy_readiness",
  "record_authority",
  "destructive_intent",
  "restricted_lsp",
  "native_transport",
  "critical_skills",
] as const;

export interface LedgerEntry {
  readonly boundary: BoundaryId;
  readonly subcase?: string;
  readonly ompVersion: string;
  readonly ompCommit: string;
  readonly opencodeVersion?: string;
  readonly opencodeTree?: string;
  readonly acpSdkVersion?: string;
  readonly acpTerminalCapability?: boolean;
  readonly sourceCitation: string;
  readonly reachability: string;
  readonly newLoadRefreshScope: string;
  readonly downstreamOwner: string;
  readonly selectedMechanism: string;
  readonly status: CompatibilityStatus;
  readonly evidenceClassification: "static_audit" | "synthetic_fixture" | "mock_adapter";
  readonly notes?: string;
}

export interface CompatibilityBlocker {
  readonly boundary: BoundaryId;
  readonly subcase?: string;
  readonly status: CompatibilityStatus;
  readonly reason: string;
  readonly evidence: string;
}

export interface AssessmentResult {
  readonly permitted: boolean;
  readonly isSyntheticAdmissionOnly: boolean;
  readonly blockers: readonly CompatibilityBlocker[];
  readonly ledgerSummary: {
    readonly total: number;
    readonly supported: number;
    readonly incompatible: number;
    readonly unresolved: number;
  };
}

/**
 * Pinned source evidence ledger representing the audited OMP v18.6.1 / OpenCode 1.18.21 state.
 */
export const AUDITED_PINNED_LEDGER: readonly LedgerEntry[] = [
  {
    boundary: "pre_import_discovery",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/sdk.ts discoverCustomToolPaths; loader.ts loadTool import(url)",
    reachability:
      "--no-extensions CLI flag only guards ambient extensions; custom tools independently discovered and imported",
    newLoadRefreshScope: "Executed on every createAcpSessionFactory call for new/load sessions",
    downstreamOwner: "guard-omp-executable-discovery",
    selectedMechanism:
      "Pre-import exclusion of untrusted custom tool, plugin, configured-root, and dependency modules",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes:
      "Official loader imports module before factory or metadata check; no pre-import exclusion mechanism in official code.",
  },
  {
    boundary: "policy_readiness",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/extensibility/extensions/types.ts; runner.ts emit/emitToolCall",
    reachability:
      "Synchronous handler registration available, but no client-side authenticated readiness control channel",
    newLoadRefreshScope: "Session new/load/recovery lifecycle",
    downstreamOwner: "gate-omp-policy-readiness",
    selectedMechanism:
      "Authenticated control channel binding ACP session identity, process, challenge, and epoch",
    status: "unresolved",
    evidenceClassification: "static_audit",
    notes:
      "No official supported control channel exists for out-of-band authenticated readiness handshake.",
  },
  {
    boundary: "record_authority",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/config/settings.ts #readConfigOverlays, #mergeOwnLayers, #deepMerge",
    reachability: "--config CLI overlays aggregated first, then merged over lower layers",
    newLoadRefreshScope: "Startup and settings reload",
    downstreamOwner: "translate-omp-owned-settings",
    selectedMechanism: "Reset overlay with approval: null followed by mode overlay",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes:
      "#readConfigOverlays folds null reset into subsequent mode mapping, retaining lower hostile grants in #deepMerge.",
  },
  {
    boundary: "destructive_intent",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/session/acp-permission-gate.ts getEditDestructiveIntent, extractPermissionLocations",
    reachability: "Evaluated during edit tool call authorization",
    newLoadRefreshScope: "Per-operation",
    downstreamOwner: "normalize-acp-destructive-targets",
    selectedMechanism:
      "Complete target extraction of all deletions, move endpoints, and patch mutations bound to execution input",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes:
      "Native getEditDestructiveIntent returns only first operation; extractPermissionLocations omits subsequent destructive patch mutations.",
  },
  {
    boundary: "restricted_lsp",
    subcase: "omp",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/main.ts --no-lsp; packages/coding-agent/src/lsp/tool.ts",
    reachability: "--no-lsp flag and lsp.enabled setting",
    newLoadRefreshScope: "Startup and edit/write cold start",
    downstreamOwner: "disable-restricted-agent-lsp",
    selectedMechanism: "Mode-scoped --no-lsp without clamping YOLO",
    status: "unresolved",
    evidenceClassification: "static_audit",
    notes:
      "--no-lsp stops background discovery, but lazy cold-start via edit/write requires live verification.",
  },
  {
    boundary: "restricted_lsp",
    subcase: "opencode",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "sst/opencode tree 826d9ad46a22bef0294998e08daa3c4904fea28f; packages/opencode/src/agent/agent.ts",
    reachability: "agent-config/opencode.json per-agent permissions vs global lsp setting",
    newLoadRefreshScope: "Session creation",
    downstreamOwner: "disable-restricted-agent-lsp",
    selectedMechanism: "Per-agent build permission denial of explicit and implicit LSP",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes:
      "Per-agent denial stops explicit tool, but implicit server startup can only be disabled globally, which clamps YOLO.",
  },
  {
    boundary: "native_transport",
    subcase: "text_fetch",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation: "packages/coding-agent/src/tools/fetch.ts fetchOverride hook",
    reachability: "Available in high-level text enrichment tool flows",
    newLoadRefreshScope: "Per-request",
    downstreamOwner: "control-omp-url-fetch-transport",
    selectedMechanism: "Text fetch transport adapter using validating proxy",
    status: "supported",
    evidenceClassification: "static_audit",
    notes: "fetchOverride hook provides text fetch adaptation seam.",
  },
  {
    boundary: "native_transport",
    subcase: "binary_fetch",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation: "packages/coding-agent/src/web/scrapers/utils.ts fetchBinary",
    reachability: "Binary download paths",
    newLoadRefreshScope: "Per-request",
    downstreamOwner: "control-omp-url-fetch-transport",
    selectedMechanism: "Binary fetch transport adapter using validating proxy",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes: "fetchBinary calls global fetch with redirect: follow directly without fetchOverride.",
  },
  {
    boundary: "native_transport",
    subcase: "web_search",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation: "packages/coding-agent/src/tools/search.ts provider integrations",
    reachability: "Web search tool",
    newLoadRefreshScope: "Per-request",
    downstreamOwner: "adapt-omp-web-search",
    selectedMechanism: "Configured provider route through validating proxy",
    status: "unresolved",
    evidenceClassification: "static_audit",
    notes: "Supported provider credentials and proxy transport require live adapter verification.",
  },
  {
    boundary: "critical_skills",
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
    sourceCitation:
      "packages/coding-agent/src/extensibility/skills.ts resolveCollision, setActiveSkills",
    reachability: "Skill loading paths",
    newLoadRefreshScope: "Startup and skill refresh",
    downstreamOwner: "guard-omp-executable-discovery",
    selectedMechanism:
      "Canonical deployment-owned path in read-only root with collision protection",
    status: "incompatible",
    evidenceClassification: "static_audit",
    notes:
      "resolveCollision allows custom directories to shadow provider skills; setActiveSkills is process-global.",
  },
];

/**
 * Pure assessment function: evaluates a ledger for completeness and admission.
 * Rejects missing boundaries/subcases, duplicate entries, pin mismatches, and unbacked supported claims.
 */
export function assessCompatibility(
  ledger: readonly LedgerEntry[],
  expectedPin: {
    ompVersion?: string;
    ompCommit?: string;
    opencodeVersion?: string;
    opencodeTree?: string;
    acpSdkVersion?: string;
    acpTerminalCapability?: boolean;
  } = {
    ompVersion: PINNED_OMP_VERSION,
    ompCommit: PINNED_OMP_COMMIT,
    opencodeVersion: PINNED_OPENCODE_VERSION,
    opencodeTree: PINNED_OPENCODE_TREE,
    acpSdkVersion: PINNED_ACP_SDK_VERSION,
    acpTerminalCapability: PINNED_ACP_TERMINAL_CAPABILITY,
  },
): AssessmentResult {
  const blockers: CompatibilityBlocker[] = [];
  const boundariesFound = new Set<string>();

  let supportedCount = 0;
  let incompatibleCount = 0;
  let unresolvedCount = 0;
  let hasSyntheticFixture = false;

  for (const entry of ledger) {
    const key = entry.subcase ? `${entry.boundary}:${entry.subcase}` : entry.boundary;

    if (entry.evidenceClassification === "synthetic_fixture") {
      hasSyntheticFixture = true;
    }

    // Check duplicate rows for the same boundary/subcase
    if (boundariesFound.has(key)) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason: `Duplicate ledger entry for ${key}`,
        evidence: `Duplicate entry found in ledger with status ${entry.status}`,
      });
    }
    boundariesFound.add(key);

    // Verify all fixed pins
    if (expectedPin.ompVersion && entry.ompVersion !== expectedPin.ompVersion) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason:
          `OMP release version pin mismatch: expected ${expectedPin.ompVersion}, got ${entry.ompVersion}`,
        evidence: `Ledger entry specifies ompVersion: ${entry.ompVersion}`,
      });
    }
    if (expectedPin.ompCommit && entry.ompCommit !== expectedPin.ompCommit) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason:
          `OMP commit hash pin mismatch: expected ${expectedPin.ompCommit}, got ${entry.ompCommit}`,
        evidence: `Ledger entry specifies ompCommit: ${entry.ompCommit}`,
      });
    }
    if (
      expectedPin.opencodeVersion && entry.opencodeVersion &&
      entry.opencodeVersion !== expectedPin.opencodeVersion
    ) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason:
          `OpenCode version mismatch: expected ${expectedPin.opencodeVersion}, got ${entry.opencodeVersion}`,
        evidence: `Ledger entry specifies opencodeVersion: ${entry.opencodeVersion}`,
      });
    }
    if (
      expectedPin.acpSdkVersion && entry.acpSdkVersion &&
      entry.acpSdkVersion !== expectedPin.acpSdkVersion
    ) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason:
          `ACP SDK version mismatch: expected ${expectedPin.acpSdkVersion}, got ${entry.acpSdkVersion}`,
        evidence: `Ledger entry specifies acpSdkVersion: ${entry.acpSdkVersion}`,
      });
    }
    if (
      expectedPin.acpTerminalCapability !== undefined &&
      entry.acpTerminalCapability !== undefined &&
      entry.acpTerminalCapability !== expectedPin.acpTerminalCapability
    ) {
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: entry.status,
        reason:
          `ACP terminal capability mismatch: expected ${expectedPin.acpTerminalCapability}, got ${entry.acpTerminalCapability}`,
        evidence: `Ledger entry specifies acpTerminalCapability: ${entry.acpTerminalCapability}`,
      });
    }

    // Supported claims require documented reachable mechanism and non-empty citation
    if (entry.status === "supported") {
      supportedCount++;
      if (!entry.sourceCitation || entry.sourceCitation.trim() === "") {
        blockers.push({
          boundary: entry.boundary,
          subcase: entry.subcase,
          status: "supported",
          reason: `Supported status claimed without source citation`,
          evidence: `Entry lacks valid sourceCitation`,
        });
      }
      if (!entry.reachability || entry.reachability.trim() === "") {
        blockers.push({
          boundary: entry.boundary,
          subcase: entry.subcase,
          status: "supported",
          reason: `Supported status claimed without reachable mechanism description`,
          evidence: `Entry lacks valid reachability definition`,
        });
      }
      // Supported claims based on mock or internal SDK-only without official reachable entry point fail
      if (
        entry.reachability.toLowerCase().includes("sdk-internal only") ||
        entry.reachability.toLowerCase().includes("mock-defined")
      ) {
        blockers.push({
          boundary: entry.boundary,
          subcase: entry.subcase,
          status: "supported",
          reason: `Supported status claimed solely via internal SDK method or mock API`,
          evidence: `Reachability is '${entry.reachability}'`,
        });
      }
    } else if (entry.status === "incompatible") {
      incompatibleCount++;
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: "incompatible",
        reason: `Selected mechanism is incompatible with official source behavior`,
        evidence: `${entry.sourceCitation}: ${entry.notes ?? entry.reachability}`,
      });
    } else if (entry.status === "unresolved") {
      unresolvedCount++;
      blockers.push({
        boundary: entry.boundary,
        subcase: entry.subcase,
        status: "unresolved",
        reason: `Mechanism reachability or evidence is incomplete/unresolved`,
        evidence: `${entry.sourceCitation}: ${entry.notes ?? entry.reachability}`,
      });
    }
  }

  // Validate the full required subcase inventory
  validateRequiredInventory(ledger, blockers);

  // Permitted ONLY if zero blockers
  const permitted = blockers.length === 0;

  return {
    permitted,
    isSyntheticAdmissionOnly: hasSyntheticFixture,
    blockers,
    ledgerSummary: {
      total: ledger.length,
      supported: supportedCount,
      incompatible: incompatibleCount,
      unresolved: unresolvedCount,
    },
  };
}

// -----------------------------------------------------------------------------
// Boundary 1: Pre-Import Discovery Contract
// -----------------------------------------------------------------------------

export interface DiscoveryModuleCandidate {
  readonly path: string;
  readonly canonicalPath: string;
  readonly source:
    | "owned_trusted"
    | "custom_tool"
    | "plugin"
    | "configured_root"
    | "workspace_dependency";
  readonly isSymlink: boolean;
  readonly symlinkTarget?: string;
}

export interface DiscoveryDecision {
  readonly eligible: boolean;
  readonly reason: string;
  readonly blockedBeforeImport: boolean;
}

export function validateDiscoveryContract(
  candidate: DiscoveryModuleCandidate,
  trustedRoots: readonly string[],
): DiscoveryDecision {
  const isInsideTrustedRoot = trustedRoots.some((root) =>
    candidate.canonicalPath === root ||
    candidate.canonicalPath.startsWith(`${root.replace(/\/$/, "")}/`)
  );

  if (candidate.source !== "owned_trusted") {
    return {
      eligible: false,
      reason: `Unowned module source '${candidate.source}' excluded before import`,
      blockedBeforeImport: true,
    };
  }

  if (
    candidate.isSymlink &&
    (!candidate.symlinkTarget || !trustedRoots.some((r) =>
      candidate.symlinkTarget === r ||
      candidate.symlinkTarget?.startsWith(`${r.replace(/\/$/, "")}/`)
    ))
  ) {
    return {
      eligible: false,
      reason: `Symlink escapes trusted root boundary`,
      blockedBeforeImport: true,
    };
  }

  if (!isInsideTrustedRoot) {
    return {
      eligible: false,
      reason: `Module canonical path '${candidate.canonicalPath}' outside trusted roots`,
      blockedBeforeImport: true,
    };
  }

  return {
    eligible: true,
    reason: `Module is owned and canonically within trusted roots`,
    blockedBeforeImport: false,
  };
}

// -----------------------------------------------------------------------------
// Boundary 2: Authenticated Policy Readiness Contract
// -----------------------------------------------------------------------------

export interface ReadinessContext {
  readonly processInstanceId: string;
  readonly acpSessionId: string;
  readonly restrictedMode: boolean;
  readonly challenge: string;
  readonly policyRevision: number;
  readonly registryEpoch: number;
}

export interface ReadinessAssertion {
  readonly processInstanceId: string;
  readonly acpSessionId: string;
  readonly restrictedMode: boolean;
  readonly challenge: string;
  readonly policyRevision: number;
  readonly registryEpoch: number;
  readonly channelOrigin:
    | "supported_control_channel"
    | "chat_context"
    | "workspace_file"
    | "unverified_mock";
  readonly credentialOrigin:
    | "process_scoped_token"
    | "platform_secret"
    | "skill_server_secret"
    | "none";
  readonly initializationStatus: "completed" | "timed_out" | "failed" | "in_progress";
  readonly lifecycleState:
    | "ready"
    | "initial"
    | "new"
    | "load"
    | "restarted"
    | "registry_transition";
}

export interface ReadinessDecision {
  readonly ready: boolean;
  readonly reason: string;
  readonly isAdapterEvidenceOnly: boolean;
}

export function validateReadinessContract(
  current: ReadinessContext,
  assertion: ReadinessAssertion,
): ReadinessDecision {
  if (assertion.initializationStatus !== "completed") {
    return {
      ready: false,
      reason: `Initialization not completed: status is '${assertion.initializationStatus}'`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.lifecycleState !== "ready") {
    return {
      ready: false,
      reason: `Lifecycle state '${assertion.lifecycleState}' requires fresh establishment`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.channelOrigin !== "supported_control_channel") {
    return {
      ready: false,
      reason: `Readiness asserted through unsupported channel origin: '${assertion.channelOrigin}'`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.credentialOrigin !== "process_scoped_token") {
    return {
      ready: false,
      reason:
        `Invalid credential origin '${assertion.credentialOrigin}': platform or skill secrets prohibited`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.processInstanceId !== current.processInstanceId) {
    return {
      ready: false,
      reason:
        `Process instance mismatch: expected ${current.processInstanceId}, got ${assertion.processInstanceId}`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.acpSessionId !== current.acpSessionId) {
    return {
      ready: false,
      reason:
        `ACP session ID mismatch: expected ${current.acpSessionId}, got ${assertion.acpSessionId}`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.challenge !== current.challenge) {
    return {
      ready: false,
      reason: `Challenge mismatch or stale challenge`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.policyRevision !== current.policyRevision) {
    return {
      ready: false,
      reason:
        `Policy revision mismatch: expected ${current.policyRevision}, got ${assertion.policyRevision}`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.registryEpoch !== current.registryEpoch) {
    return {
      ready: false,
      reason:
        `Registry epoch mismatch: expected ${current.registryEpoch}, got ${assertion.registryEpoch}`,
      isAdapterEvidenceOnly: true,
    };
  }

  if (assertion.restrictedMode !== current.restrictedMode) {
    return {
      ready: false,
      reason:
        `Restricted mode mismatch: expected ${current.restrictedMode}, got ${assertion.restrictedMode}`,
      isAdapterEvidenceOnly: true,
    };
  }

  return {
    ready: true,
    reason: `Authenticated readiness established for current process and session`,
    isAdapterEvidenceOnly: true,
  };
}

// -----------------------------------------------------------------------------
// Boundary 3: Authoritative Record Reset Contract Types
// -----------------------------------------------------------------------------

export type ApprovalAction = "allow" | "deny" | "ask" | null;

export interface ApprovalRecord {
  readonly [toolKey: string]: ApprovalAction;
}

// -----------------------------------------------------------------------------
// Boundary 4: Complete Destructive Intent Contract Types
// -----------------------------------------------------------------------------

export type DestructiveOperation =
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "move"; readonly source: string; readonly destination: string }
  | { readonly kind: "patch_mutation"; readonly targetPath: string };

export interface DestructiveIntentInput {
  readonly nativeTool: "delete" | "move" | "edit" | "apply_patch";
  readonly rawInput: string;
  readonly executionInputBinding: string;
  readonly parserProvenance:
    | "supported_full_parser"
    | "native_first_location_only"
    | "synthetic_adapter_decoder"
    | "unknown";
  readonly operations?: readonly DestructiveOperation[];
}

export interface DestructiveIntentDecision {
  readonly valid: boolean;
  readonly decoded: boolean;
  readonly mutationPermitted: boolean;
  readonly targets: readonly string[];
  readonly reason: string;
}

// -----------------------------------------------------------------------------
// Boundary 5: Restricted-Only LSP Contract Types
// -----------------------------------------------------------------------------

export interface AgentLspProfile {
  readonly agent: "omp" | "opencode";
  readonly mode: "restricted" | "yolo";
  readonly explicitToolAvailable: boolean;
  readonly implicitStartupOnRead: boolean;
  readonly implicitStartupOnEditWrite: boolean;
  readonly backgroundWarmupEnabled: boolean;
}

export interface RestrictedLspDecision {
  readonly valid: boolean;
  readonly reason: string;
}

// -----------------------------------------------------------------------------
// Boundary 6: Native Transport Adaptation Contract Types
// -----------------------------------------------------------------------------

export type EgressMode = "enforcing" | "unrestricted";

export interface TransportHopRequest {
  readonly url: string;
  readonly hopType:
    | "initial_text"
    | "initial_binary"
    | "redirect"
    | "secondary_scraper"
    | "search_provider";
  readonly resolvedAddress?: string;
  readonly isPrivateAddress?: boolean;
}

export interface TransportRouteDecision {
  readonly permitted: boolean;
  readonly proxyRouted: boolean;
  readonly error?: string;
  readonly reason: string;
}

// -----------------------------------------------------------------------------
// Boundary 7: Critical Skill Canonical Ownership Contract Types
// -----------------------------------------------------------------------------

export interface SkillCandidate {
  readonly skillId: string;
  readonly resolvedPath: string;
  readonly canonicalPath: string;
  readonly source: "deployment_owned" | "workspace_project" | "symlink_escape";
  readonly sessionGenerationId: string;
}

export interface CriticalSkillDecision {
  readonly authoritative: boolean;
  readonly canonicalPath?: string;
  readonly reason: string;
}

export function validateCriticalSkillContract(
  skillId: string,
  candidate: SkillCandidate,
  ownedSkillRoot: string,
  currentSessionGenerationId: string,
): CriticalSkillDecision {
  if (candidate.skillId !== skillId) {
    return {
      authoritative: false,
      reason: `Skill ID mismatch: expected ${skillId}, got ${candidate.skillId}`,
    };
  }

  if (candidate.sessionGenerationId !== currentSessionGenerationId) {
    return {
      authoritative: false,
      reason:
        `Stale session generation ID: candidate uses '${candidate.sessionGenerationId}', current is '${currentSessionGenerationId}'`,
    };
  }

  if (candidate.source !== "deployment_owned") {
    return {
      authoritative: false,
      reason: `Skill source '${candidate.source}' cannot override deployment-owned critical skill`,
    };
  }

  const normalizedRoot = ownedSkillRoot.replace(/\/$/, "");
  const isInsideOwnedRoot = candidate.canonicalPath === normalizedRoot ||
    candidate.canonicalPath.startsWith(`${normalizedRoot}/`);

  if (!isInsideOwnedRoot) {
    return {
      authoritative: false,
      reason:
        `Canonical path '${candidate.canonicalPath}' escapes owned skill root '${ownedSkillRoot}'`,
    };
  }

  return {
    authoritative: true,
    canonicalPath: candidate.canonicalPath,
    reason: `Canonical owned skill selected safely`,
  };
}
