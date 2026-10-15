// src/core/bundled-skills.ts
//
// ONE authored, deployment-controlled bundled-skill catalog
// (`unify-omp-skill-root-resolution` D2). It is daemon APPLICATION SOURCE, never
// discovered from an installed (agent-writable) tree, and it is the single list
// consumed by:
//
// - external-skill installation collision protection (a published external
//   skill may never take the name of a bundled skill or the reserved shared
//   `lib` content);
// - the authored source-parity fixture, which keeps this list aligned with the
//   repository `skills/` directories.
//
// It has no packaging role: the image installs the personal skill tree by a
// direct COPY (`collapse-skill-packaging-to-one-tree`), and no catalog filter
// selects what ships.
//
// Runtime-added/installed names NEVER amend this catalog. The catalog no
// longer bounds script auto-approval (`unify-skill-root-and-inventory`): BOTH
// agent types enumerate the one resolved skill root by observation, so a
// runtime-installed external skill is eligible for either of them.

/** The authored bundled skill names (excludes the reserved `lib` content). */
export const BUNDLED_SKILLS: readonly string[] = Object.freeze(
  [
    "agent-browser",
    "cancel-reminder",
    "chinese-content-writing-guideline",
    "chinese-traditional-conversion",
    "writing-style-guideline",
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
