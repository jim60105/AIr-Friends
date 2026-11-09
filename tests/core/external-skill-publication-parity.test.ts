// tests/core/external-skill-publication-parity.test.ts
//
// Bootstrap publication parity (`unify-skill-root-and-inventory` D3 / task 4.1,
// generalizing `unify-omp-skill-root-resolution` D5): the awaited external-skill
// installation publishes into the ONE deployment-resolved skill root, the first
// connector inventory of EITHER agent type enumerates that same root and admits
// the published external script, and the collision/failure-isolation posture is
// unchanged. The `await` in `bootstrap.ts` makes the publish-then-inventory
// order static; this fixture proves the shared-authority semantics, not the
// scheduling.

import { assert, assertEquals } from "@std/assert";
import { installExternalSkills, type SkillInstallExecutor } from "@core/skill-installer.ts";
import { observeTrustedSkillsRoot, resolveTrustedSkillsRoot } from "@core/skills-root.ts";
import { buildSkillAutoApproveList } from "@acp/skill-inventory.ts";
import { getDefaultAgentType } from "@acp/agent-factory.ts";
import type { Config } from "../../src/types/config.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

/** Materializes one skill under the private installer HOME, as the CLI does. */
const executor: SkillInstallExecutor = {
  async run(_cmd, args, options) {
    const skill = args[args.indexOf("-s") + 1];
    // oxlint-disable-next-line typescript/no-non-null-asserted-optional-chain
    const home = options?.env?.HOME!;
    const dir = `${home}/.agents/skills/${skill}`;
    await fsp.mkdir(`${dir}/scripts`, { recursive: true });
    await fsp.writeFile(`${dir}/SKILL.md`, `# ${skill}`);
    await fsp.writeFile(`${dir}/scripts/${skill}.ts`, "// published");
    return { code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
  },
};

/** Fails the CLI run for `broken-skill`, succeeds for every other entry. */
const partlyFailingExecutor: SkillInstallExecutor = {
  async run(cmd, args, options) {
    const skill = args[args.indexOf("-s") + 1];
    if (skill === "broken-skill") {
      return {
        code: 1,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode("installer failed"),
      };
    }
    return await executor.run(cmd, args, options);
  },
};

/** Minimal deployment config: only the fields the destination resolution reads. */
function makeConfig(agentOverrides: Partial<Config["agent"]>): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      ...agentOverrides,
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: "/tmp/test", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  };
}

test("parity - the publication destination is the SAME root for both default agent types", () => {
  const deploymentRoot = fs.realpathSync(makeTempDirSync({ prefix: "air-deploy-" }));
  try {
    const opencodeDefault = makeConfig({
      defaultAgentType: "opencode",
      skillsDir: deploymentRoot,
    });
    const ompDefault = makeConfig({ defaultAgentType: "omp", skillsDir: deploymentRoot });
    // The exact expression `bootstrap.ts` publishes with, for each default:
    // `resolveTrustedSkillsRoot(getDefaultAgentType(config), config.agent.skillsDir)`.
    assertEquals(
      resolveTrustedSkillsRoot(
        getDefaultAgentType(opencodeDefault),
        opencodeDefault.agent.skillsDir,
      ),
      deploymentRoot,
    );
    assertEquals(
      resolveTrustedSkillsRoot(getDefaultAgentType(ompDefault), ompDefault.agent.skillsDir),
      deploymentRoot,
    );
  } finally {
    fs.rmSync(deploymentRoot, { recursive: true });
  }
});

test("parity - a startup-installed external skill is eligible for BOTH agent types", async () => {
  // The external name is NOT in the authored catalog: after this change neither
  // agent type requires a catalog entry for a skill published into the root.
  const deploymentRoot = fs.realpathSync(makeTempDirSync({ prefix: "air-deploy-" }));
  try {
    await installExternalSkills(
      deploymentRoot,
      [{ repo: "owner/repo", skill: "create-blog-post" }],
      executor,
    );
    const scriptPath = `${deploymentRoot}/create-blog-post/scripts/create-blog-post.ts`;
    for (const agentType of ["opencode", "omp"] as const) {
      const observation = observeTrustedSkillsRoot(agentType, deploymentRoot);
      for (const configured of [undefined, ["create-blog-post"]]) {
        const inventory = buildSkillAutoApproveList({
          rootObservation: observation,
          configuredSkills: configured,
        });
        assertEquals(
          inventory.scripts.map((s) => s.canonicalPath),
          [scriptPath],
          `${agentType}: ${String(configured)}`,
        );
        // The external skill has a scripts directory: no command-prefix promotion.
        assertEquals(inventory.commandPrefixes.size, 0, agentType);
      }
    }
  } finally {
    await fsp.rm(deploymentRoot, { recursive: true });
  }
});

test("parity - collision refusals and per-entry failure isolation are unchanged", async () => {
  // A bundled-catalog name, the reserved `lib` entry and a traversing name are
  // each refused WITHOUT touching the destination or any path outside it, while
  // one failing install never blocks the remaining entries (the link/escape
  // refusals themselves stay pinned by tests/core/skill-installer.test.ts).
  const deploymentRoot = fs.realpathSync(makeTempDirSync({ prefix: "air-deploy-" }));
  try {
    await installExternalSkills(
      deploymentRoot,
      [
        { repo: "owner/repo", skill: "memory-save" },
        { repo: "owner/repo", skill: "lib" },
        { repo: "owner/repo", skill: "../escape" },
        { repo: "owner/repo", skill: "broken-skill" },
        { repo: "owner/repo", skill: "create-blog-post" },
      ],
      partlyFailingExecutor,
    );

    // Only the one valid entry was published; every refusal/failure left the
    // root (and its parent) untouched.
    assertEquals(
      [...fs.readdirSync(deploymentRoot, { withFileTypes: true })].map((entry) => entry.name),
      ["create-blog-post"],
    );
    assert(
      ![...fs.readdirSync(`${deploymentRoot}/..`, { withFileTypes: true })].some((entry) =>
        entry.name === "escape"
      ),
      "a traversing skill name must not create anything outside the resolved root",
    );
    // The surviving publication is still granted to both agent types.
    for (const agentType of ["opencode", "omp"] as const) {
      const inventory = buildSkillAutoApproveList({
        rootObservation: observeTrustedSkillsRoot(agentType, deploymentRoot),
      });
      assertEquals(
        inventory.scripts.map((s) => s.canonicalPath),
        [`${deploymentRoot}/create-blog-post/scripts/create-blog-post.ts`],
        agentType,
      );
    }
  } finally {
    await fsp.rm(deploymentRoot, { recursive: true });
  }
});
