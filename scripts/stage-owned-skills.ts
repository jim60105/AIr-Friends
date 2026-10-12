// scripts/stage-owned-skills.ts
//
// Owned-image packaging filter (`unify-omp-skill-root-resolution` D2/D7): the
// owned OMP root `/opt/air/skills` is built from the deployment-controlled
// bundled-skill CATALOG plus the reserved shared `lib` content ONLY — never a
// broad `COPY skills/` of whatever a development machine happens to have
// installed under `skills/` (which would smuggle an external addition into an
// owned image). The stager copies each catalog directory (and `lib`) from the
// source tree into a staging directory, rechecking entry identity: any
// symlink/linked entry or path escaping the source root FAILS THE BUILD.
//
// Usage: deno run scripts/stage-owned-skills.ts <source-skills-dir> <staging-dir>
//
// The Containerfile consumes the staging directory as the ONLY source for the
// owned root COPY; the OpenCode personal-root COPY stays content-faithful.

import { BUNDLED_SKILLS, RESERVED_SKILL_ENTRIES } from "../src/core/bundled-skills.ts";

const [sourceDir, stagingDir] = Deno.args;
if (!sourceDir || !stagingDir) {
  console.error("usage: stage-owned-skills.ts <source-skills-dir> <staging-dir>");
  Deno.exit(2);
}

const sourceRoot = Deno.realPathSync(sourceDir);
const catalog = [...RESERVED_SKILL_ENTRIES, ...BUNDLED_SKILLS];

/** Copy one non-symlink tree, refusing linked entries and escaping paths. */
function copyTree(source: string, target: string): void {
  const stat = Deno.lstatSync(source);
  if (stat.isSymlink) {
    console.error(`stage-owned-skills: linked entry refused: ${source}`);
    Deno.exit(1);
  }
  if (stat.isDirectory) {
    Deno.mkdirSync(target, { recursive: true });
    for (const entry of Deno.readDirSync(source)) {
      copyTree(`${source}/${entry.name}`, `${target}/${entry.name}`);
    }
    return;
  }
  Deno.copyFileSync(source, target);
}

Deno.mkdirSync(stagingDir, { recursive: true });
const stagedCanonical = Deno.realPathSync(stagingDir);

for (const name of catalog) {
  const source = `${sourceRoot}/${name}`;
  try {
    Deno.lstatSync(source);
  } catch {
    console.error(
      `stage-owned-skills: catalog entry "${name}" is missing from ${sourceRoot} ` +
        `(the source tree must match the authored catalog)`,
    );
    Deno.exit(1);
  }
  const canonicalSource = Deno.realPathSync(source);
  if (canonicalSource !== source && !canonicalSource.startsWith(sourceRoot + "/")) {
    console.error(`stage-owned-skills: catalog entry "${name}" escapes the source root`);
    Deno.exit(1);
  }
  copyTree(source, `${stagedCanonical}/${name}`);
}

// Fail loudly on ANY source entry outside the catalog: an unlisted directory is
// exactly the external development addition this filter exists to exclude, so
// it is simply NOT staged (and is reported for build-log visibility).
for (const entry of Deno.readDirSync(sourceRoot)) {
  if (!catalog.includes(entry.name)) {
    console.log(`stage-owned-skills: excluded non-catalog source entry: ${entry.name}`);
  }
}
console.log(
  `stage-owned-skills: staged ${BUNDLED_SKILLS.length} catalog skill(s) + ` +
    `${RESERVED_SKILL_ENTRIES.length} reserved entr(ies) into ${stagedCanonical}`,
);
