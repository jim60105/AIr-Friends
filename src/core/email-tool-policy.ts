// src/core/email-tool-policy.ts
//
// Email tool availability (`email-tool-guidance`, row 28).
//
// `send-email` is a third-party delivery tool: it may only run when the host
// recorded at least one IMMUTABLE destination grant from the user's own current
// request. Reminders and spontaneous sessions can never grant a third-party
// destination, so they hide it even if a stale grant record somehow appeared.
// Every other platform hides nothing.
//
// The Skill API handlers remain the authoritative refusal boundary (a hidden
// tool that is invoked anyway is still denied). This policy feeds the ACP
// permission gate's per-session `hiddenSkills` set, so a restricted session
// cannot even auto-approve the invocation, in either agent backend.

/** The one bundled skill this policy hides. */
export const EMAIL_SEND_SKILL = "send-email";

/** The frozen hidden set for a session without third-party authorization. */
export const EMAIL_HIDDEN_SKILLS: readonly string[] = Object.freeze([EMAIL_SEND_SKILL]);

/**
 * The skills a session must not use, or `undefined` when it hides nothing.
 *
 * @param session The session's platform and host-bound origin markers.
 * @param destinationGrantCount The number of immutable grants the host
 *   recorded for this session (0 for a session without third-party input).
 */
export function hiddenEmailSkillsFor(
  session: {
    platform: string;
    emailReminder?: unknown;
    emailSpontaneous?: unknown;
  },
  destinationGrantCount: number,
): readonly string[] | undefined {
  if (session.platform !== "email") return undefined;
  if (session.emailReminder !== undefined || session.emailSpontaneous !== undefined) {
    return EMAIL_HIDDEN_SKILLS;
  }
  return destinationGrantCount > 0 ? undefined : EMAIL_HIDDEN_SKILLS;
}
