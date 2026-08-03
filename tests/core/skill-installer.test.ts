// tests/core/skill-installer.test.ts

import { assertEquals } from "@std/assert";
import {
  buildSkillInstallCommand,
  installExternalSkills,
  type SkillInstallExecutor,
} from "@core/skill-installer.ts";
import type { ExternalSkillConfig } from "../../src/types/config.ts";

function mockExecutor(
  results: Array<{ code: number; stdout?: string; stderr?: string }>,
): { executor: SkillInstallExecutor; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const executor: SkillInstallExecutor = {
    run(cmd, args) {
      calls.push({ cmd, args });
      const result = results.shift() ?? { code: 0 };
      return Promise.resolve({
        code: result.code,
        stdout: new TextEncoder().encode(result.stdout ?? ""),
        stderr: new TextEncoder().encode(result.stderr ?? ""),
      });
    },
  };
  return { executor, calls };
}

Deno.test("buildSkillInstallCommand - should build an npx command with the expected args", () => {
  const skill: ExternalSkillConfig = {
    repo: "jim60105/copilot-prompt",
    skill: "create-blog-post",
  };

  const { cmd, args } = buildSkillInstallCommand(skill);

  assertEquals(cmd, "npx");
  assertEquals(args, [
    "--yes",
    "--package=skills",
    "skills",
    "add",
    "jim60105/copilot-prompt",
    "-a",
    "universal",
    "-s",
    "create-blog-post",
    "-g",
    "-y",
  ]);
});

Deno.test("installExternalSkills - should do nothing with empty array", async () => {
  const { executor, calls } = mockExecutor([]);
  await installExternalSkills([], executor);
  assertEquals(calls.length, 0);
});

Deno.test("installExternalSkills - should invoke the command for each configured skill", async () => {
  const { executor, calls } = mockExecutor([{ code: 0 }, { code: 0 }]);
  const skills: ExternalSkillConfig[] = [
    { repo: "owner/repo-a", skill: "skill-a" },
    { repo: "owner/repo-b", skill: "skill-b" },
  ];

  await installExternalSkills(skills, executor);

  assertEquals(calls.length, 2);
  assertEquals(calls[0].cmd, "npx");
  assertEquals(calls[1].cmd, "npx");
  assertEquals(
    calls[0].args.join(" "),
    "--yes --package=skills skills add owner/repo-a -a universal -s skill-a -g -y",
  );
  assertEquals(
    calls[1].args.join(" "),
    "--yes --package=skills skills add owner/repo-b -a universal -s skill-b -g -y",
  );
});

Deno.test("installExternalSkills - should continue with remaining skills after a failure", async () => {
  const { executor, calls } = mockExecutor([
    { code: 1, stderr: "boom" },
    { code: 0 },
  ]);
  const skills: ExternalSkillConfig[] = [
    { repo: "owner/repo-a", skill: "skill-a" },
    { repo: "owner/repo-b", skill: "skill-b" },
  ];

  // Should not throw even if one skill fails
  await installExternalSkills(skills, executor);

  assertEquals(calls.length, 2);
});

Deno.test("installExternalSkills - should not throw when the command cannot be spawned", async () => {
  const executor: SkillInstallExecutor = {
    run() {
      return Promise.reject(new Error("spawn failed"));
    },
  };

  await installExternalSkills(
    [{ repo: "owner/repo-a", skill: "skill-a" }],
    executor,
  );
});
