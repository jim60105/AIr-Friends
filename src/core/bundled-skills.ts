// src/core/bundled-skills.ts
//
// ONE authored, deployment-controlled bundled-skill catalog
// (`unify-omp-skill-root-resolution` D2). It is daemon APPLICATION SOURCE, never
// discovered from an installed (agent-writable) tree, and it is the single list
// consumed by:
//
// - OMP script-inventory selection (an OMP inventory never admits a name the
//   catalog does not carry, regardless of what is physically present under the
//   selected root — a shared development root cannot expand OMP eligibility);
// - external-skill installation collision protection (a published external
//   skill may never take the name of a bundled skill or the reserved shared
//   `lib` content);
// - owned-image packaging (`scripts/stage-owned-skills.ts` stages ONLY these
//   directories plus `lib` into the owned `/opt/air/skills` source, so a
//   development-installed external addition can never enter an owned image).
//
// Runtime-added/installed names NEVER amend this catalog; a source parity
// fixture (`tests/core/bundled-skills.test.ts`) keeps it aligned with the
// authored `skills/` directories.

/** The authored bundled skill names (excludes the reserved `lib` content). */
export const BUNDLED_SKILLS: readonly string[] = Object.freeze(
  [
    "agent-browser",
    "cancel-reminder",
    "chinese-content-writing-guideline",
    "edit-reply",
    "fetch-context",
    "get-message",
    "list-reminders",
    "memory-export",
    "memory-patch",
    "memory-save",
    "memory-search",
    "memory-stats",
    "react-message",
    "self-research",
    "send-file",
    "send-reply",
    "set-reminder",
  ] as const,
);

/** Reserved shared library entry: never an external skill name, never scannable as a skill. */
export const RESERVED_SKILL_ENTRIES: readonly string[] = Object.freeze(["lib"] as const);

/** Whether `name` is a cataloged bundled skill. */
export function isBundledSkillName(name: string): boolean {
  return BUNDLED_SKILLS.includes(name);
}

/**
 * Whether `name` collides with owned bundled content: a cataloged skill name or
 * a reserved shared entry. External publication must never overwrite these.
 */
export function collidesWithBundledContent(name: string): boolean {
  return isBundledSkillName(name) || RESERVED_SKILL_ENTRIES.includes(name);
}

/**
 * Strict single-component skill-name validation shared by every consumer that
 * selects a directory BY NAME under a root. Rejects empty strings, `.`/`..`,
 * any path separator, parent traversal, and absolute paths, so a configured or
 * configured-external name can never select a foreign directory outside the
 * resolved root.
 */
export function isValidSkillNameComponent(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.includes("..")) return false;
  return true;
}
