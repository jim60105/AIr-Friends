// tests/core/skill-installer.test.ts

import { installExternalSkills } from "@core/skill-installer.ts";
import type { ExternalSkillConfig } from "../../src/types/config.ts";

Deno.test("installExternalSkills - should do nothing with empty array", async () => {
  // Should complete without errors
  await installExternalSkills([]);
});

Deno.test("installExternalSkills - should handle installation failure gracefully", async () => {
  const skills: ExternalSkillConfig[] = [
    { repo: "nonexistent/repo", skill: "nonexistent-skill" },
  ];

  // Should not throw even if the command fails
  await installExternalSkills(skills);
});
