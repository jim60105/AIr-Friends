import type { ApprovalAction, ApprovalRecord } from "./compatibility-contracts.ts";

export interface SettingsLayerHierarchy {
  readonly lowerLayer: {
    readonly approval: ApprovalRecord;
  };
  readonly cliOverlays?: ReadonlyArray<{
    readonly approval: ApprovalRecord | null;
  }>;
  readonly runtimeEnvOverrides?: {
    readonly approval?: ApprovalRecord;
  };
}

export interface EffectiveRecordEvaluation {
  readonly authoritative: boolean;
  readonly aggregatedCliOverlay: ApprovalRecord | null;
  readonly effectiveApproval: ApprovalRecord;
  readonly residualHostileGrants: readonly string[];
  readonly residualPromptDeny: readonly string[];
  readonly reason: string;
}

/**
 * Models OMP's actual settings layer precedence:
 * 1. CLI overlays aggregated in `#readConfigOverlays`.
 * 2. Merged over global/project lower layers in `#mergeOwnLayers` via `#deepMerge`.
 * 3. Runtime/env layers applied with highest precedence.
 * 4. Compares effective configuration against intended mode records.
 */
export function evaluateApprovalRecordAuthority(
  input: SettingsLayerHierarchy,
  expectedMode: "restricted" | "yolo",
  intendedModeRecords: ApprovalRecord,
): EffectiveRecordEvaluation {
  // If no CLI overlays provided and no env override, default fallback behavior
  const cliOverlays = input.cliOverlays ?? [];
  let aggregatedCli: ApprovalRecord | null = null;
  let hasCliOverlay = false;

  for (const overlay of cliOverlays) {
    hasCliOverlay = true;
    if (overlay.approval === null) {
      aggregatedCli = null;
    } else if (typeof overlay.approval === "object" && overlay.approval !== null) {
      if (aggregatedCli === null) {
        aggregatedCli = { ...overlay.approval };
      } else {
        const prev: ApprovalRecord = aggregatedCli;
        aggregatedCli = { ...prev, ...overlay.approval };
      }
    }
  }

  // Base is lower layer
  const effectiveApproval: Record<string, ApprovalAction> = { ...input.lowerLayer.approval };

  if (hasCliOverlay) {
    if (aggregatedCli === null) {
      // Explicit null unsets keys
      for (const k of Object.keys(effectiveApproval)) {
        delete effectiveApproval[k];
      }
    } else {
      // deepMerge retains lower keys not overwritten
      for (const [k, v] of Object.entries(aggregatedCli)) {
        if (v === null) {
          delete effectiveApproval[k];
        } else {
          effectiveApproval[k] = v;
        }
      }
    }
  }

  // Apply runtime/env overrides (highest precedence)
  if (input.runtimeEnvOverrides?.approval) {
    for (const [k, v] of Object.entries(input.runtimeEnvOverrides.approval)) {
      if (v === null) {
        delete effectiveApproval[k];
      } else {
        effectiveApproval[k] = v;
      }
    }
  }

  // Check against intended mode records:
  // 1. Every intended key must match exact intended value.
  // 2. No extraneous lower-layer keys may survive.
  const residualGrants: string[] = [];
  const residualPromptDeny: string[] = [];
  const mismatches: string[] = [];

  for (const [intendedKey, intendedVal] of Object.entries(intendedModeRecords)) {
    if (effectiveApproval[intendedKey] !== intendedVal) {
      mismatches.push(
        `${intendedKey} (expected ${intendedVal}, got ${effectiveApproval[intendedKey]})`,
      );
    }
  }

  for (const [k, v] of Object.entries(effectiveApproval)) {
    if (!(k in intendedModeRecords)) {
      if (v === "allow") {
        residualGrants.push(k);
      } else if (v === "deny" || v === "ask") {
        residualPromptDeny.push(k);
      }
    }
  }

  if (mismatches.length > 0) {
    return {
      authoritative: false,
      aggregatedCliOverlay: aggregatedCli,
      effectiveApproval,
      residualHostileGrants: residualGrants,
      residualPromptDeny,
      reason: `Effective approval mismatch with intended records: [${mismatches.join(", ")}]`,
    };
  }

  if (expectedMode === "restricted" && residualGrants.length > 0) {
    return {
      authoritative: false,
      aggregatedCliOverlay: aggregatedCli,
      effectiveApproval,
      residualHostileGrants: residualGrants,
      residualPromptDeny,
      reason: `Restricted mode retains unintended lower-layer grants: [${
        residualGrants.join(", ")
      }]`,
    };
  }

  if (expectedMode === "yolo" && residualPromptDeny.length > 0) {
    return {
      authoritative: false,
      aggregatedCliOverlay: aggregatedCli,
      effectiveApproval,
      residualHostileGrants: residualGrants,
      residualPromptDeny,
      reason: `YOLO mode retains unintended lower-layer prompt/deny entries: [${
        residualPromptDeny.join(", ")
      }]`,
    };
  }

  // Default fallback rejection: if no CLI overlays or env overrides were supplied, cannot claim authority
  if (!hasCliOverlay && !input.runtimeEnvOverrides?.approval) {
    return {
      authoritative: false,
      aggregatedCliOverlay: null,
      effectiveApproval,
      residualHostileGrants: residualGrants,
      residualPromptDeny,
      reason:
        `No authoritative overlays or runtime layers supplied; default/lower fallback is not authority`,
    };
  }

  return {
    authoritative: true,
    aggregatedCliOverlay: aggregatedCli,
    effectiveApproval,
    residualHostileGrants: residualGrants,
    residualPromptDeny,
    reason:
      `Approval records are authoritative with exact intended mode values and no unintended residue`,
  };
}
