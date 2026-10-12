// tests/core/bundled-skills.test.ts
//
// Authored catalog parity + owned-packaging filter
// (`unify-omp-skill-root-resolution` D2/D7, tasks 1.4/3.4). The catalog is
// daemon application source: it never grows from an installed tree, and the
// owned-image packaging seam stages ONLY catalog + reserved content.

import { assert, assertEquals } from "@std/assert";
import {
  BUNDLED_SKILLS,
  collidesWithBundledContent,
  isValidSkillNameComponent,
  RESERVED_SKILL_ENTRIES,
} from "@core/bundled-skills.ts";

const SCRIPT = new URL("../../scripts/stage-owned-skills.ts", import.meta.url).pathname;

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

Deno.test("packaging filter - stages ONLY catalog + reserved content, never a dev-installed external dir", async () => {
  const base = await Deno.makeTempDir({ prefix: "air-package-" });
  try {
    // A development source tree: catalog members, reserved lib, AND an
    // external skill installed on the development machine.
    // The stager requires EVERY catalog entry to exist (source must match the
    // authored catalog), so materialize the whole catalog first...
    for (const name of [...RESERVED_SKILL_ENTRIES, ...BUNDLED_SKILLS]) {
      Deno.mkdirSync(`${base}/skills/${name}`, { recursive: true });
      Deno.writeTextFileSync(`${base}/skills/${name}/SKILL.md`, `# ${name}`);
    }
    // ...with a script under memory-save for content-parity checking.
    Deno.mkdirSync(`${base}/skills/memory-save/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${base}/skills/memory-save/scripts/memory-save.ts`, "// real");
    // ...plus the dev-installed EXTERNAL addition the filter must exclude.
    Deno.mkdir(`${base}/skills/create-blog-post/scripts`, { recursive: true });
    Deno.writeTextFile(`${base}/skills/create-blog-post/SKILL.md`, "# external (dev-installed)");
    Deno.writeTextFile(
      `${base}/skills/create-blog-post/scripts/create-blog-post.ts`,
      "// external payload",
    );

    const out = `${base}/staged`;
    const proc = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--allow-write", SCRIPT, `${base}/skills`, out],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await proc.output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const log = new TextDecoder().decode(result.stdout);
    // The exclusion is LOUD in the build log.
    assert(log.includes("excluded non-catalog source entry: create-blog-post"), log);

    const staged = [...Deno.readDirSync(out)].map((e) => e.name).sort();
    // ONLY catalog + reserved entries exist in the staging output — and every
    // catalog entry is present (stager fails the build on a missing one, so a
    // complete run proves all landed).
    assert(!staged.includes("create-blog-post"), "external addition must never be staged");
    assert(staged.includes("memory-save"));
    assert(staged.includes("lib"));
    // Byte content of a staged file is preserved.
    assertEquals(
      await Deno.readTextFile(`${out}/memory-save/scripts/memory-save.ts`),
      "// real",
    );
    assertEquals(
      [...Deno.readDirSync(out)].length,
      BUNDLED_SKILLS.length + RESERVED_SKILL_ENTRIES.length,
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("packaging filter - linked catalog entries fail the build", async () => {
  const base = await Deno.makeTempDir({ prefix: "air-package-" });
  try {
    Deno.mkdir(`${base}/skills`, { recursive: true });
    // Every catalog entry exists for real except ONE replaced by a symlink.
    for (const name of [...RESERVED_SKILL_ENTRIES, ...BUNDLED_SKILLS]) {
      if (name === "memory-save") continue;
      Deno.mkdirSync(`${base}/skills/${name}`, { recursive: true });
      Deno.writeTextFileSync(`${base}/skills/${name}/x`, name);
    }
    Deno.mkdirSync(`${base}/elsewhere/memory-save/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${base}/elsewhere/memory-save/scripts/memory-save.ts`, "// linked");
    await Deno.symlink(`${base}/elsewhere/memory-save`, `${base}/skills/memory-save`);

    const proc = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--allow-write", SCRIPT, `${base}/skills`, `${base}/staged`],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await proc.output();
    const err = new TextDecoder().decode(result.stderr);
    assertEquals(result.code, 1, `linked entry must fail the build; got ${result.code}: ${err}`);
    assert(err.includes("linked entry refused"), err);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("packaging filter - a missing catalog entry fails the build (source must match the catalog)", async () => {
  const base = await Deno.makeTempDir({ prefix: "air-package-" });
  try {
    Deno.mkdir(`${base}/skills`, { recursive: true });
    // Only the reserved entry exists; the whole catalog is "missing".
    Deno.mkdirSync(`${base}/skills/lib`, { recursive: true });
    const proc = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--allow-write", SCRIPT, `${base}/skills`, `${base}/staged`],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await proc.output();
    assertEquals(result.code, 1);
    const err = new TextDecoder().decode(result.stderr);
    assert(err.includes("missing from"), err);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
