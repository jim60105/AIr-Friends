// tests/acp/skill-inventory-fixture.ts
//
// Shared inventory fixtures for tests that construct `ChatbotClient`
// directly: the client now takes a MANDATORY root-exact auto-approve
// inventory (there is no implicit default anymore).

import { buildSkillAutoApproveList, type SkillAutoApproveList } from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import fs from "node:fs";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

/** Inventory over a fresh, empty (but canonical) temp root: no grants. */
export function emptySkillList(): SkillAutoApproveList {
  const root = makeTempDirSync({ prefix: "air-empty-skills-" });
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
  const canonical = fs.realpathSync(root);
  for (const name of scriptSkills) {
    fs.mkdirSync(`${canonical}/${name}/scripts`, { recursive: true });
    fs.writeFileSync(`${canonical}/${name}/SKILL.md`, `# ${name}`);
    fs.writeFileSync(`${canonical}/${name}/scripts/${name}.ts`, "// real");
  }
  for (const name of commandSkills) {
    fs.mkdirSync(`${canonical}/${name}`, { recursive: true });
    fs.writeFileSync(`${canonical}/${name}/SKILL.md`, `# ${name}`);
  }
  return buildSkillAutoApproveList({
    rootObservation: observeTrustedSkillsRoot("opencode", canonical),
  });
}
