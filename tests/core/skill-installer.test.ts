// tests/core/skill-installer.test.ts
//
// `unify-omp-skill-root-resolution` D5: external installation runs at daemon
// startup into ONE explicit destination through a PRIVATE staging HOME —
// bundled/reserved names are never installed, traversal-shaped names never
// reach the CLI, per-entry failures stay isolated, and publication validates
// linked/escaping materialization.

import { assert, assertEquals } from "@std/assert";
import {
  buildSkillInstallCommand,
  installExternalSkills,
  type SkillInstallExecutor,
} from "@core/skill-installer.ts";
import type { ExternalSkillConfig } from "../../src/types/config.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

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
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(`${dir}/SKILL.md`, `# ${skill}`);
        await fsp.mkdir(`${dir}/scripts`, { recursive: true });
        await fsp.writeFile(`${dir}/scripts/${skill}.ts`, "#!/usr/bin/env deno\n");
        if (behavior(skill) === "linked") {
          // A hostile materialization: a link inside the published tree.
          await fsp.writeFile(`${home}/escape-target`, "escaped");
          await fsp.symlink(`${home}/escape-target`, `${dir}/scripts/linked.ts`);
        }
      }
      return { code: 0, stdout: encoder.encode("installed"), stderr: new Uint8Array() };
    },
  };
  return { executor, calls, stagingHomes };
}

test("buildSkillInstallCommand - should build an npx command with the expected args", () => {
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

test("installExternalSkills - does nothing with an empty list", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await makeTempDir();
  try {
    await installExternalSkills(destination, [], executor);
    assertEquals(calls.length, 0);
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - publishes each skill into the EXPLICIT destination via private HOME", async () => {
  const { executor, calls, stagingHomes } = materializingExecutor();
  const destination = await makeTempDir();
  const ambientHome = process.env["HOME"];
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
    await fsp.stat(`${destination}/skill-a/SKILL.md`);
    await fsp.stat(`${destination}/skill-a/scripts/skill-a.ts`);
    await fsp.stat(`${destination}/skill-b/SKILL.md`);
    // Staging homes are removed in `finally`.
    assertEquals(stagingHomes.length, 2);
    for (const home of stagingHomes) {
      let removed = false;
      try {
        await fsp.stat(home);
      } catch {
        removed = true;
      }
      assert(removed, `staging HOME ${home} must be removed`);
    }
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - refresh: an existing EXTERNAL entry is replaced, never duplicated", async () => {
  const { executor } = materializingExecutor();
  const destination = await makeTempDir();
  try {
    await fsp.mkdir(`${destination}/skill-a/scripts`, { recursive: true });
    await fsp.writeFile(`${destination}/skill-a/SKILL.md`, "# old");
    await fsp.writeFile(`${destination}/skill-a/legacy.txt`, "old leftover");
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    // Refresh replaces the entry wholesale: old leftovers are gone, new tree is real.
    let gone = false;
    try {
      await fsp.stat(`${destination}/skill-a/legacy.txt`);
    } catch {
      gone = true;
    }
    assert(gone, "refresh must remove the previous external content");
    await fsp.stat(`${destination}/skill-a/scripts/skill-a.ts`);
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - bundled and reserved names are NEVER installed", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await makeTempDir();
  try {
    await fsp.mkdir(`${destination}/memory-save`, { recursive: true });
    await fsp.writeFile(`${destination}/memory-save/SKILL.md`, "# owned");
    await fsp.mkdir(`${destination}/lib`, { recursive: true });
    await fsp.writeFile(`${destination}/lib/shared.ts`, "// owned");

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
    assertEquals(await fsp.readFile(`${destination}/memory-save/SKILL.md`, "utf8"), "# owned");
    assertEquals(await fsp.readFile(`${destination}/lib/shared.ts`, "utf8"), "// owned");
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - traversal/absolute names are rejected before the CLI", async () => {
  const { executor, calls } = materializingExecutor();
  const destination = await makeTempDir();
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
    assertEquals([...fs.readdirSync(destination, { withFileTypes: true })].length, 0);
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - per-entry failure isolation and staging cleanup", async () => {
  const { executor, calls, stagingHomes } = materializingExecutor((skill) =>
    skill === "skill-a" ? "fail" : "ok"
  );
  const destination = await makeTempDir();
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
    await fsp.stat(`${destination}/skill-b/SKILL.md`);
    let failedAbsent = false;
    try {
      await fsp.stat(`${destination}/skill-a`);
    } catch {
      failedAbsent = true;
    }
    assert(failedAbsent, "a failed skill publishes nothing");
    for (const home of stagingHomes) {
      let removed = false;
      try {
        await fsp.stat(home);
      } catch {
        removed = true;
      }
      assert(removed, `staging HOME ${home} must be removed even on failure`);
    }
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - a successful exit with no materialized directory publishes nothing", async () => {
  const { executor } = materializingExecutor(() => "nothing");
  const destination = await makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    assertEquals([...fs.readdirSync(destination, { withFileTypes: true })].length, 0);
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - linked materialization inside the tree is refused ATOMICALLY (B4)", async () => {
  const { executor } = materializingExecutor(() => "linked");
  const destination = await makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    // FULL validation runs BEFORE the destination is touched: a rejection at
    // scripts/linked.ts publishes NOTHING — the destination entry never even
    // exists (no partial grant, no half-tree).
    let absent = false;
    try {
      await fsp.stat(`${destination}/skill-a`);
    } catch {
      absent = true;
    }
    assert(absent, "a refused publication must leave no destination entry at all");
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - failed refresh PRESERVES the previous external entry (B4)", async () => {
  // Install skill-a successfully, then a refresh whose materialization is
  // hostile (deep link): the previous COMPLETE entry must survive intact and
  // no partial content may be left at the final path.
  let hostile = false;
  const { executor } = materializingExecutor(() => (hostile ? "linked" : "ok"));
  const destination = await makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    await fsp.writeFile(`${destination}/skill-a/KEEP.txt`, "previous");
    hostile = true;
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    // Previous content intact…
    assertEquals(await fsp.readFile(`${destination}/skill-a/KEEP.txt`, "utf8"), "previous");
    await fsp.stat(`${destination}/skill-a/scripts/skill-a.ts`);
    // …no partial tree, no backup leftovers inside the published entry.
    assertEquals(
      [...fs.readdirSync(`${destination}/skill-a`, { withFileTypes: true })].some((e) =>
        e.name.includes("air-refresh")
      ),
      false,
    );
  } finally {
    await fsp.rm(destination, { recursive: true });
  }
});

test("installExternalSkills - linked .agents ancestor is refused (B5)", async () => {
  // The installer previously followed a symlinked `<stagingHome>/.agents`
  // ancestor through realPathSync: the foreign tree's REGULAR files would
  // publish through it. The chain from the private HOME down must be link-free.
  const foreign = await makeTempDir();
  await fsp.mkdir(`${foreign}/.agents-elsewhere/skills/skill-a/scripts`, { recursive: true });
  await fsp.writeFile(`${foreign}/.agents-elsewhere/skills/skill-a/SKILL.md`, "# foreign");
  await fsp.writeFile(
    `${foreign}/.agents-elsewhere/skills/skill-a/scripts/skill-a.ts`,
    "// foreign",
  );
  const executor: SkillInstallExecutor = {
    async run(_cmd, _args, options) {
      // oxlint-disable-next-line typescript/no-non-null-asserted-optional-chain
      const home = options?.env?.HOME!;
      // Hostile staging: `.agents` is a LINK to a foreign tree carrying the
      // skill as regular files.
      await fsp.symlink(`${foreign}/.agents-elsewhere`, `${home}/.agents`);
      return { code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    },
  };
  const destination = await makeTempDir();
  try {
    await installExternalSkills(
      destination,
      [{ repo: "owner/repo-a", skill: "skill-a" }],
      executor,
    );
    let published = true;
    try {
      await fsp.stat(`${destination}/skill-a`);
    } catch {
      published = false;
    }
    assert(!published, "a linked staging ancestor must never publish foreign content");
  } finally {
    await fsp.rm(destination, { recursive: true });
    await fsp.rm(foreign, { recursive: true });
  }
});

test("installExternalSkills - the default executor runs a real CLI with an exact environment", async () => {
  // Exercises the ported subprocess boundary itself (not a mock executor): a stand-in `npx`
  // on PATH materializes the requested skill under the PRIVATE staging HOME, refuses to run
  // if the daemon's ambient environment leaked into the child, and exits non-zero for one
  // requested skill so the per-entry failure path is observed end to end.
  const destination = await makeTempDir();
  const binDir = await makeTempDir();
  const originalPath = process.env["PATH"];
  const originalSentinel = process.env["AIR_SKILL_SENTINEL"];
  try {
    await fsp.writeFile(
      `${binDir}/npx`,
      `#!/bin/sh
if [ -n "$AIR_SKILL_SENTINEL" ]; then exit 3; fi
skill=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-s" ]; then shift; skill="$1"; fi
  shift
done
if [ "$skill" = "failing-skill" ]; then
  echo "install refused" >&2
  exit 1
fi
mkdir -p "$HOME/.agents/skills/$skill"
printf '# %s' "$skill" > "$HOME/.agents/skills/$skill/SKILL.md"
echo installed
`,
    );
    await fsp.chmod(`${binDir}/npx`, 0o755);
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
    // Present in the daemon's own environment only: the executor must NOT forward it.
    process.env["AIR_SKILL_SENTINEL"] = "daemon-only";

    await installExternalSkills(destination, [
      { repo: "owner/repo-a", skill: "spawned-skill" },
      { repo: "owner/repo-b", skill: "failing-skill" },
    ]);

    assertEquals(
      await fsp.readFile(`${destination}/spawned-skill/SKILL.md`, "utf8"),
      "# spawned-skill",
    );
    let failedPublished = true;
    try {
      await fsp.stat(`${destination}/failing-skill`);
    } catch {
      failedPublished = false;
    }
    assert(!failedPublished, "a non-zero installer exit must publish nothing");
  } finally {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
    if (originalSentinel === undefined) {
      delete process.env["AIR_SKILL_SENTINEL"];
    } else {
      process.env["AIR_SKILL_SENTINEL"] = originalSentinel;
    }
    await fsp.rm(destination, { recursive: true });
    await fsp.rm(binDir, { recursive: true });
  }
});
