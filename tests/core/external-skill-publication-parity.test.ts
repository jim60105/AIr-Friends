// tests/core/external-skill-publication-parity.test.ts
//
// Bootstrap publication parity (`unify-omp-skill-root-resolution` D5, task
// 3.3): the awaited external-skill installation and the first connector
// inventory consume the SAME resolver destination — a skill published at
// startup is present in an inventory built over the same observation, an OMP
// inventory never admits it, and the bootstrap sequence publishes strictly
// BEFORE the inventory is ever constructed (the `await` in bootstrap.ts makes
// the order static; this fixture proves the shared-authority semantics).

import { assertEquals } from "@std/assert";
import { installExternalSkills, type SkillInstallExecutor } from "@core/skill-installer.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { buildSkillAutoApproveList } from "@acp/skill-inventory.ts";

const executor: SkillInstallExecutor = {
  async run(_cmd, args, options) {
    const skill = args[args.indexOf("-s") + 1];
    const home = options?.env?.HOME!;
    const dir = `${home}/.agents/skills/${skill}`;
    await Deno.mkdir(`${dir}/scripts`, { recursive: true });
    await Deno.writeTextFile(`${dir}/SKILL.md`, `# ${skill}`);
    await Deno.writeTextFile(`${dir}/scripts/${skill}.ts`, "// published");
    return { code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
  },
};

Deno.test("parity - startup-installed external skill is visible to the OpenCode inventory over the same root", async () => {
  // A deployment root (configured, absolute) — bootstrap resolves it with the
  // same resolver the connector threads.
  const deploymentRoot = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-deploy-" }));
  try {
    // bootstrap.ts: resolveTrustedSkillsRoot("opencode", config.agent.skillsDir)
    const destination = deploymentRoot; // resolver-validated root for an existing dir
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo", skill: "create-blog-post" }],
      executor,
    );

    // agent-factory/agent-connector: observeTrustedSkillsRoot + inventory over
    // the SAME observation. The awaited install has completed, so the entry is
    // enumerated with root-exact canonical identity.
    const observation = observeTrustedSkillsRoot("opencode", destination);
    const opencode = buildSkillAutoApproveList({
      agentType: "opencode",
      rootObservation: observation,
    });
    assertEquals(
      opencode.scripts.map((s) => s.canonicalPath),
      [`${destination}/create-blog-post/scripts/create-blog-post.ts`],
    );

    // OMP sharing the SAME physical tree never admits the external addition:
    // its inventory is restricted to the authored catalog.
    const omp = buildSkillAutoApproveList({
      agentType: "omp",
      rootObservation: { root: destination, identity: observation.identity },
    });
    assertEquals(omp.scripts.length, 0);
    // The external skill has a scripts dir: no command-prefix promotion at all.
    assertEquals(opencode.commandPrefixes.size, 0);
  } finally {
    await Deno.remove(deploymentRoot, { recursive: true });
  }
});
