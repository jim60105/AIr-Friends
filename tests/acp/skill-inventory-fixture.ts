// tests/acp/skill-inventory-fixture.ts
//
// Shared inventory fixtures for tests that construct `ChatbotClient`
// directly: the client now takes a MANDATORY root-exact auto-approve
// inventory (there is no implicit default anymore).

import { buildSkillAutoApproveList, type SkillAutoApproveList } from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";

/** Inventory over a fresh, empty (but canonical) temp root: no grants. */
export function emptySkillList(): SkillAutoApproveList {
  const root = Deno.makeTempDirSync({ prefix: "air-empty-skills-" });
  return buildSkillAutoApproveList({
    rootObservation: observeTrustedSkillsRoot("opencode", root),
  });
}

/**
 * Inventory materialized at a REQUIRED canonical absolute root with real
 * script skills (`<name>/scripts/<name>.ts`) and command skills (SKILL.md
 * only, no scripts dir).
 */
export function skillInventoryAt(
  root: string,
  scriptSkills: string[] = [],
  commandSkills: string[] = [],
): SkillAutoApproveList {
  const canonical = Deno.realPathSync(root);
  for (const name of scriptSkills) {
    Deno.mkdirSync(`${canonical}/${name}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${canonical}/${name}/SKILL.md`, `# ${name}`);
    Deno.writeTextFileSync(`${canonical}/${name}/scripts/${name}.ts`, "// real");
  }
  for (const name of commandSkills) {
    Deno.mkdirSync(`${canonical}/${name}`, { recursive: true });
    Deno.writeTextFileSync(`${canonical}/${name}/SKILL.md`, `# ${name}`);
  }
  return buildSkillAutoApproveList({
    rootObservation: observeTrustedSkillsRoot("opencode", canonical),
  });
}
