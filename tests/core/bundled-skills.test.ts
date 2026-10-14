// tests/core/bundled-skills.test.ts
//
// Authored catalog parity + external-install collision protection
// (`unify-omp-skill-root-resolution` D2, trimmed to its surviving roles by
// `collapse-skill-packaging-to-one-tree`). The catalog is daemon application
// source: it never grows from an installed tree, and it bounds external
// publication only — no packaging filter consumes it anymore.

import { assert, assertEquals } from "@std/assert";
import {
  BUNDLED_SKILLS,
  collidesWithBundledContent,
  isValidSkillNameComponent,
  RESERVED_SKILL_ENTRIES,
} from "@core/bundled-skills.ts";

Deno.test("catalog parity - the authored catalog matches the repository skills/ directories", () => {
  const sourceRoot = new URL("../../skills", import.meta.url).pathname;
  const authoredDirs: string[] = [];
  for (const entry of Deno.readDirSync(sourceRoot)) {
    if (entry.isDirectory) authoredDirs.push(entry.name);
  }
  const catalog = new Set([...RESERVED_SKILL_ENTRIES, ...BUNDLED_SKILLS]);
  for (const dir of authoredDirs) {
    assert(
      catalog.has(dir),
      `repository skill directory "${dir}" is missing from the authored catalog`,
    );
  }
  for (const name of catalog) {
    assert(
      authoredDirs.includes(name),
      `catalog entry "${name}" has no authored directory under skills/`,
    );
  }
});

Deno.test("catalog - reserved lib is never an installable/collidable skill name via bundling", () => {
  assert(collidesWithBundledContent("lib"));
  assert(collidesWithBundledContent("memory-save"));
  assertEquals(collidesWithBundledContent("create-blog-post"), false);
});

Deno.test("name component - traversal/absolute/separator names rejected", () => {
  for (const bad of ["", ".", "..", "a/b", "a\\b", "/abs", "..hidden", "x/../y", "a\0b"]) {
    assertEquals(isValidSkillNameComponent(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
  for (const ok of ["create-blog-post", "a.b", "skill_name", "x-y"]) {
    assertEquals(isValidSkillNameComponent(ok), true, `must accept ${ok}`);
  }
});

// --- Stock-image declarations (`collapse-skill-packaging-to-one-tree` 1.1):
// the declared COPY / config /
// working-directory relationship, proven by Containerfile parse ONLY — no
// container is built (image build acceptance stays user-owned). ---

Deno.test("Containerfile - installs exactly one skill tree, at the personal skill root", () => {
  const containerfile = Deno.readTextFileSync(
    new URL("../../Containerfile", import.meta.url).pathname,
  );
  // Exactly ONE instruction sources the repository `skills/` tree, so no
  // second skill tree can be installed anywhere in the image.
  const skillsCopies = containerfile
    .split("\n")
    .filter((line) => /^COPY\b.* skills\/ /.test(line));
  assertEquals(skillsCopies.length, 1, skillsCopies.join("\n"));
  // ...and it installs the personal root every agent type resolves and
  // external runtime installs publish into.
  assertEquals(
    skillsCopies[0],
    "COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/",
  );
  // The retired owned skill tree, its packaging stage and its stager script
  // are gone from the image definition.
  assert(!containerfile.includes("/opt/air/skills"));
  assert(!containerfile.includes("owned-skills-stager"));
  assert(!containerfile.includes("stage-owned-skills"));
});

Deno.test("Containerfile and Helm declare the same shared installed root; development default stays 'skills'", () => {
  const containerfile = Deno.readTextFileSync(
    new URL("../../Containerfile", import.meta.url).pathname,
  );
  const helm = Deno.readTextFileSync(
    new URL("../../helm/values.yaml", import.meta.url).pathname,
  );
  const envExample = Deno.readTextFileSync(
    new URL("../../.env.example", import.meta.url).pathname,
  );
  // Stock image declares the SAME tree the COPY installs.
  assert(containerfile.includes("ENV AGENT_SKILLS_DIR=/home/deno/.agents/skills"));
  // Helm default matches the stock image (the drift this task removed).
  assert(/AGENT_SKILLS_DIR: '\/home\/deno\/\.agents\/skills'/.test(helm), helm.slice(0, 400));
  // Development default (`skills`) is unchanged in the example env.
  assert(envExample.includes("# AGENT_SKILLS_DIR=skills"));
});
