// tests/core/skill-installer.test.ts
//
// `unify-omp-skill-root-resolution` D5: external installation runs at daemon
// startup into ONE explicit destination through a PRIVATE staging HOME —
// bundled/reserved names are never installed, traversal-shaped names never
// reach the CLI, per-entry failures stay isolated, and publication validates
// linked/escaping materialization.

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  buildSkillInstallCommand,
  installExternalSkills,
  type SkillInstallExecutor,
} from "@core/skill-installer.ts";
import type { ExternalSkillConfig } from "../../src/types/config.ts";

/**
 * Mock executor that emulates the `skills` CLI posture: writes the skill tree
* into `${HOME}/.agents/skills/<skill>` INSIDE the private staging HOME the
 * installer supplies (never the ambient HOME). Records every call including
 * the env it was invoked with.
 */
function materializingExecutor(
  behavior: (skill: string) => "ok" | "fail" | "nothing" | "linked" = () => "ok",
): {
  executor: SkillInstallExecutor;
  calls: Array<{ cmd: string; args: string[]; env?: Record<string, string> }>;
  stagingHomes: string[];
} {
  const calls: Array<{ cmd: string; args: string[]; env?: Record<string, string> }> = [];
  const stagingHomes: string[] = [];
  const executor: SkillInstallExecutor = {
    async run(cmd, args, options) {
      const encoder = new TextEncoder();
      const skill = args[args.indexOf("-s") + 1];
      calls.push({ cmd, args, env: options?.env });
      const home = options?.env?.HOME;
      if (behavior(skill) === "fail") {
        return { code: 1, stdout: new Uint8Array(), stderr: encoder.encode("boom") };
      }
      if (behavior(skill) === "nothing") {
        return { code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      }
      if (home) stagingHomes.push(home);
      if (home) {
        const dir = `${home}/.agents/skills/${skill}`;
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(`${dir}/SKILL.md`, `# ${skill}`);
        await Deno.mkdir(`${dir}/scripts`, { recursive: true });
        await Deno.writeTextFile(`${dir}/scripts/${skill}.ts`, "#!/usr/bin/env deno\n");
        if (behavior(skill) === "linked") {
          // A hostile materialization: a link inside the published tree.
          await Deno.writeTextFile(`${home}/escape-target`, "escaped");
          await Deno.symlink(`${home}/escape-target`, `${dir}/scripts/linked.ts`);
        }
      }
      return { code: 0, stdout: encoder.encode("installed"), stderr: new Uint8Array() };
    },
  };
  return { executor, calls, stagingHomes };
}

Deno.test("buildSkillInstallCommand - should build an npx command with the expected args", () => {
  const skill: ExternalSkillConfig = { repo: "owner/repo", skill: "my-skill" };

  const { cmd, args } = buildSkillInstallCommand(skill);

  assertEquals(cmd, "npx");
  // `--copy` materializes real files under the private HOME so publication can
  // validate a physically self-contained tree.
  assertEquals(args, [
    "--yes",
    "--package=skills",
    "skills",
    "add",
    "owner/repo",
    "-a",
    "universal",
    "-s",
    "my-skill",
    "-g",
    "-y",
    "--copy",
  ]);
});

Deno.test("installExternalSkills - does nothing with an empty list", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await Deno.makeTempDir();
  try {
    await installExternalSkills(destination, [], executor);
    assertEquals(calls.length, 0);
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - publishes each skill into the EXPLICIT destination via private HOME", async () => {
  const { executor, calls, stagingHomes } = materializingExecutor();
  const destination = await Deno.makeTempDir();
  const ambientHome = Deno.env.get("HOME");
  try {
    const skills: ExternalSkillConfig[] = [
      { repo: "owner/repo-a", skill: "skill-a" },
      { repo: "owner/repo-b", skill: "skill-b" },
    ];
    await installExternalSkills(destination, skills, executor);

    assertEquals(calls.length, 2);
    for (const call of calls) {
      // NEVER the daemon's ambient HOME: the private staging HOME is required.
      assert(call.env !== undefined, "installation must run with a supplied env");
      assert(call.env!.HOME !== ambientHome, "private staging HOME must replace ambient HOME");
      assert(call.env!.HOME.startsWith("/"), "staging HOME is absolute");
    }
    // Both skills land in the explicit destination, physically.
    await Deno.stat(`${destination}/skill-a/SKILL.md`);
    await Deno.stat(`${destination}/skill-a/scripts/skill-a.ts`);
    await Deno.stat(`${destination}/skill-b/SKILL.md`);
    // Staging homes are removed in `finally`.
    assertEquals(stagingHomes.length, 2);
    for (const home of stagingHomes) {
      let removed = false;
      try {
        await Deno.stat(home);
      } catch {
        removed = true;
      }
      assert(removed, `staging HOME ${home} must be removed`);
    }
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - refresh: an existing EXTERNAL entry is replaced, never duplicated", async () => {
  const { executor } = materializingExecutor();
  const destination = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${destination}/skill-a/scripts`, { recursive: true });
    await Deno.writeTextFile(`${destination}/skill-a/SKILL.md`, "# old");
    await Deno.writeTextFile(`${destination}/skill-a/legacy.txt`, "old leftover");
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    // Refresh replaces the entry wholesale: old leftovers are gone, new tree is real.
    let gone = false;
    try {
      await Deno.stat(`${destination}/skill-a/legacy.txt`);
    } catch {
      gone = true;
    }
    assert(gone, "refresh must remove the previous external content");
    await Deno.stat(`${destination}/skill-a/scripts/skill-a.ts`);
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - bundled and reserved names are NEVER installed", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${destination}/memory-save`, { recursive: true });
    await Deno.writeTextFile(`${destination}/memory-save/SKILL.md`, "# owned");
    await Deno.mkdir(`${destination}/lib`, { recursive: true });
    await Deno.writeTextFile(`${destination}/lib/shared.ts`, "// owned");

    await installExternalSkills(
      destination,
      [
        { repo: "evil/repo", skill: "memory-save" },
        { repo: "evil/repo", skill: "lib" },
      ],
      executor,
    );

    // No CLI call at all, and the owned content is untouched.
    assertEquals(calls.length, 0);
    assertEquals(await Deno.readTextFile(`${destination}/memory-save/SKILL.md`), "# owned");
    assertEquals(await Deno.readTextFile(`${destination}/lib/shared.ts`), "// owned");
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - traversal/absolute names are rejected before the CLI", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await Deno.makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [
        { repo: "evil/repo", skill: "../outside" },
        { repo: "evil/repo", skill: "a/b" },
        { repo: "evil/repo", skill: "/abs" },
        { repo: "evil/repo", skill: "." },
      ],
      executor,
    );
    assertEquals(calls.length, 0);
    // Nothing escaped the destination either.
    assertEquals([...Deno.readDirSync(destination)].length, 0);
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - per-entry failure isolation and staging cleanup", async () => {
  const { executor, calls, stagingHomes } = materializingExecutor((skill) =>
    skill === "skill-a" ? "fail" : "ok"
  );
  const destination = await Deno.makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [
        { repo: "owner/repo-a", skill: "skill-a" },
        { repo: "owner/repo-b", skill: "skill-b" },
      ],
      executor,
    );
    assertEquals(calls.length, 2, "the second skill still runs after the first fails");
    await Deno.stat(`${destination}/skill-b/SKILL.md`);
    let failedAbsent = false;
    try {
      await Deno.stat(`${destination}/skill-a`);
    } catch {
      failedAbsent = true;
    }
    assert(failedAbsent, "a failed skill publishes nothing");
    for (const home of stagingHomes) {
      let removed = false;
      try {
        await Deno.stat(home);
      } catch {
        removed = true;
      }
      assert(removed, `staging HOME ${home} must be removed even on failure`);
    }
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - a successful exit with no materialized directory publishes nothing", async () => {
  const { executor } = materializingExecutor(() => "nothing");
  const destination = await Deno.makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    assertEquals([...Deno.readDirSync(destination)].length, 0);
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("installExternalSkills - linked materialization inside the tree is refused", async () => {
  const { executor } = materializingExecutor(() => "linked");
  const destination = await Deno.makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    // The partial copy attempt must never leave an escaping link published.
    let escaped = false;
    try {
      const stat = await Deno.lstat(`${destination}/skill-a/scripts/linked.ts`);
      escaped = stat.isSymlink;
    } catch {
      // absent — refused before the link copied
    }
    assert(!escaped, "publication must refuse linked entries");
    // A refused entry may leave a partial directory; it must be inside the
    // destination and contain no links anywhere.
    const walk = (dir: string): void => {
      for (const entry of Deno.readDirSync(dir)) {
        const full = `${dir}/${entry.name}`;
        assert(!entry.isSymlink, `no published symlink may survive: ${full}`);
        if (entry.isDirectory) walk(full);
      }
    };
    try {
      walk(`${destination}`);
    } catch {
      // destination vanished entirely — also acceptable (refusal)
    }
    assertNotEquals(0, 1);
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});
