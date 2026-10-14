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

/**
 * Every instruction that puts a SKILL TREE into the image, as the destination
 * it installs to (or its own text for a RUN). Handles shell and JSON forms,
 * any flag order, and backslash continuations, so an equivalent rewrite of the
 * sanctioned instruction is accepted while a second tree in ANY form — a
 * stage-sourced copy, a differently spelled source, a RUN that duplicates the
 * tree — is surfaced.
 */
function skillsTreeInstalls(containerfile: string): string[] {
  // Join continuations first: a wrapped instruction is ONE logical line.
  const logical: string[] = [];
  for (const raw of containerfile.split("\n")) {
    const previous = logical.length - 1;
    if (previous >= 0 && logical[previous].endsWith("\\")) {
      logical[previous] = `${logical[previous].slice(0, -1).trimEnd()} ${raw.trim()}`;
    } else {
      logical.push(raw.trim());
    }
  }
  const installs: string[] = [];
  for (const line of logical) {
    const instruction = line.match(/^(?:COPY|ADD)\s+(.*)$/);
    if (instruction) {
      const json = instruction[1].match(/^\[.*\]$/);
      let args: string[] | null = null;
      if (json) {
        try {
          args = JSON.parse(instruction[1]) as string[];
        } catch {
          args = null;
        }
      } else {
        args = instruction[1].split(/\s+/);
      }
      if (!args || args.length < 2) continue;
      // The source and destination are the last two arguments; everything
      // before them is a flag in either form.
      const source = args[args.length - 2];
      const destination = args[args.length - 1];
      if (source.includes("skills") || destination.includes("skills")) {
        installs.push(destination);
      }
    } else if (line.startsWith("RUN") && line.includes("skills")) {
      // A RUN that touches a skills path can install a second tree too.
      installs.push(line);
    }
  }
  return installs;
}

Deno.test("Containerfile - installs exactly one skill tree, at the personal skill root", () => {
  const containerfile = Deno.readTextFileSync(
    new URL("../../Containerfile", import.meta.url).pathname,
  );
  // Exactly ONE instruction installs a skill tree, and it is the personal
  // root every agent type resolves and external runtime installs publish into.
  assertEquals(skillsTreeInstalls(containerfile), ["/home/deno/.agents/skills/"]);
  // The retired owned skill tree, its packaging stage and its stager script
  // are gone from the image definition.
  assert(!containerfile.includes("/opt/air/skills"));
  assert(!containerfile.includes("owned-skills-stager"));
  assert(!containerfile.includes("stage-owned-skills"));
});

Deno.test("Containerfile guard - a second skill tree is surfaced in every form", () => {
  // A second source COPY, whatever its spelling.
  assertEquals(
    skillsTreeInstalls(
      [
        "COPY --link skills/ /home/deno/.agents/skills/",
        "COPY --link skills /opt/air/skills/",
      ].join("\n"),
    ),
    ["/home/deno/.agents/skills/", "/opt/air/skills/"],
  );
  // A tree re-imported from a packaging stage.
  assertEquals(
    skillsTreeInstalls("COPY --from=stager /owned-skills/ /opt/air/skills/"),
    ["/opt/air/skills/"],
  );
  // A RUN that duplicates the tree, across a continuation.
  assertEquals(
    skillsTreeInstalls("RUN install -d /tmp/x && \\\n    cp -a /home/deno/.agents/skills /tmp/x"),
    ["RUN install -d /tmp/x && cp -a /home/deno/.agents/skills /tmp/x"],
  );
  // ...while an equivalent rewrite of the one sanctioned instruction passes in
  // either form and in any flag order.
  assertEquals(
    skillsTreeInstalls('COPY ["--chmod=775", "skills/", "/home/deno/.agents/skills/"]'),
    ["/home/deno/.agents/skills/"],
  );
  assertEquals(
    skillsTreeInstalls("COPY --chmod=775 --chown=$UID:0 --link skills/ /home/deno/.agents/skills/"),
    ["/home/deno/.agents/skills/"],
  );
  // An unrelated copy is not a skill tree.
  assertEquals(skillsTreeInstalls("COPY --link prompts/ /app/prompts/"), []);
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
