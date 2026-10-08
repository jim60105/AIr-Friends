/**
 * Critical Skills Ownership Composition.
 *
 * Re-exports the critical skill ownership evaluation from discovery-guard.ts.
 */

export {
  type CriticalSkillSelectionRecord,
  type EvaluateCriticalSkillOptions,
  evaluateCriticalSkillSelection,
  PINNED_CRITICAL_SKILLS,
  type SessionSkillLifecycleState,
  transitionSkillLifecycleState,
} from "../discovery-guard.ts";
