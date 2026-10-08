import type { AgentLspProfile, RestrictedLspDecision } from "./compatibility-contracts.ts";

/**
 * Validates restricted LSP scoping for both OMP and OpenCode.
 * Requires:
 * 1. Matching agent identity between restricted and YOLO profiles.
 * 2. In restricted mode: explicit LSP tool disabled AND implicit startup / diagnostics on edit/write / warmup disabled.
 * 3. In YOLO mode: native posture preserved without added clamps (both explicit tool AND implicit paths).
 */
export function validateRestrictedLspContract(
  restrictedProfile: AgentLspProfile,
  yoloProfile: AgentLspProfile,
): RestrictedLspDecision {
  if (restrictedProfile.agent !== yoloProfile.agent) {
    return {
      valid: false,
      reason:
        `Agent identity mismatch: restricted profile is '${restrictedProfile.agent}' but YOLO profile is '${yoloProfile.agent}'`,
    };
  }

  if (restrictedProfile.mode !== "restricted" || yoloProfile.mode !== "yolo") {
    return {
      valid: false,
      reason: `Profile mode mismatch: expected restricted vs yolo`,
    };
  }

  // Restricted mode checks
  if (restrictedProfile.explicitToolAvailable) {
    return {
      valid: false,
      reason: `Restricted mode must not have explicit LSP tool available`,
    };
  }

  if (
    restrictedProfile.implicitStartupOnEditWrite ||
    restrictedProfile.implicitStartupOnRead ||
    restrictedProfile.backgroundWarmupEnabled
  ) {
    return {
      valid: false,
      reason:
        `Restricted mode must suppress implicit LSP startup, diagnostics on edit/write, and warmup`,
    };
  }

  // YOLO mode checks
  if (!yoloProfile.explicitToolAvailable) {
    return {
      valid: false,
      reason: `YOLO mode must not have explicit LSP clamped`,
    };
  }

  if (
    !yoloProfile.implicitStartupOnEditWrite ||
    !yoloProfile.implicitStartupOnRead
  ) {
    return {
      valid: false,
      reason: `YOLO mode must not have implicit LSP startup clamped`,
    };
  }

  return {
    valid: true,
    reason:
      `Restricted mode correctly suppresses explicit and implicit LSP while YOLO remains unclamped for agent '${restrictedProfile.agent}'`,
  };
}
