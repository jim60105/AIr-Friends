// tests/acp/skill-inventory.test.ts
//
// Root-exact inventory unit regressions (`unify-skill-root-and-inventory` 3.1,
// generalizing `unify-omp-skill-root-resolution` 2.1/2.2): one eligibility rule
// for BOTH agent types, explicit-root-only scanning, invalid names,
// absent-skill non-promotion, and physical decision-time matching.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildSkillAutoApproveList,
  decodeLiteralToken,
  isUnderRoot,
  LITERAL_BUN_RUN,
  matchesScriptEntrypoint,
  type SkillAutoApproveList,
  type SkillInventoryFs,
} from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import fs from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

/** The supported agent types; both construct the identical inventory. */
const AGENT_TYPES = ["opencode", "omp"] as const;

/** The one literal prefix the gate accepts before a script spelling. */
const BUN_RUN = LITERAL_BUN_RUN.join(" ");

function list(
  agentType: (typeof AGENT_TYPES)[number],
  root: string,
  configuredSkills?: string[],
): SkillAutoApproveList {
  // The production seam for the selected agent: the factory observes the ONE
  // configured root for THAT agent type and the connector builds the inventory
  // from it. Since `unify-skill-root-and-inventory` the input carries no
  // agent-type selector, so both agent types construct the identical inventory.
  return buildSkillAutoApproveList({
    rootObservation: observeTrustedSkillsRoot(agentType, root),
    configuredSkills,
  });
}

function makeRoot(scriptSkills: string[], commandSkills: string[] = []): string {
  const root = fs.realpathSync(makeTempDirSync({ prefix: "air-inv-" }));
  for (const name of scriptSkills) {
    fs.mkdirSync(`${root}/${name}/scripts`, { recursive: true });
    fs.writeFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
    fs.writeFileSync(`${root}/${name}/scripts/${name}.ts`, "// real");
  }
  for (const name of commandSkills) {
    fs.mkdirSync(`${root}/${name}`, { recursive: true });
    fs.writeFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
  }
  return root;
}

test("inventory - the explicit root is scanned for either agent type; lib reserved excluded", () => {
  const root = makeRoot(["memory-save", "send-reply"], ["agent-browser"]);
  fs.mkdirSync(`${root}/lib`, { recursive: true });
  fs.writeFileSync(`${root}/lib/client.ts`, "// shared library");
  for (const agentType of AGENT_TYPES) {
    const inv = list(agentType, root);
    assertEquals(
      inv.scripts.map((s) => s.canonicalPath).sort(),
      [
        `${root}/memory-save/scripts/memory-save.ts`,
        `${root}/send-reply/scripts/send-reply.ts`,
      ],
      agentType,
    );
    assert(inv.commandPrefixes.has("agent-browser"), agentType);
    assertEquals([...inv.commandPrefixes].includes("lib"), false, agentType);
    assertEquals(inv.root.canonicalPath, root, agentType);
  }
});

test("inventory - a non-bundled installed .ts script is eligible for BOTH agent types", () => {
  // A runtime-installed external addition that is not in the authored catalog
  // shares the one resolved root: no catalog entry is required for either agent
  // type, under an empty AND an explicitly configured approval list.
  const root = makeRoot(["create-blog-post", "memory-save"]);
  const scriptPath = `${root}/create-blog-post/scripts/create-blog-post.ts`;
  for (const agentType of AGENT_TYPES) {
    // Empty list: the whole root is enumerated, so the external script is among
    // the grants…
    for (const configured of [undefined, ["create-blog-post", "memory-save"]]) {
      const inv = list(agentType, root, configured);
      assertEquals(
        inv.scripts.some((s) => s.canonicalPath === scriptPath),
        true,
        `${agentType}: ${String(configured)}`,
      );
      assertEquals(
        matchesScriptEntrypoint(`${BUN_RUN} ${scriptPath}`, inv, { sessionCwd: undefined }),
        true,
        `${agentType}: ${String(configured)}`,
      );
    }
    // …and an explicit list naming only the external skill yields exactly it.
    const filtered = list(agentType, root, ["create-blog-post"]);
    assertEquals(filtered.scripts.map((s) => s.canonicalPath), [scriptPath], agentType);
  }
});

test("inventory - a non-.ts script is eligible for neither agent type", () => {
  // `scripts/*.ts` with the exact two-form Bun grammar stays the only
  // enumerable form: a `.py` or shell script grants nothing anywhere.
  const root = makeRoot(["memory-save"]);
  for (
    const [name, file] of [["py-skill", "py-skill.py"], ["shell-skill", "shell-skill.sh"]] as const
  ) {
    fs.mkdirSync(`${root}/${name}/scripts`, { recursive: true });
    fs.writeFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
    fs.writeFileSync(`${root}/${name}/scripts/${file}`, "// never executable");
  }
  for (const agentType of AGENT_TYPES) {
    const inv = list(agentType, root);
    assertEquals(
      inv.scripts.map((s) => s.canonicalPath),
      [`${root}/memory-save/scripts/memory-save.ts`],
      agentType,
    );
    for (
      const path of [
        `${root}/py-skill/scripts/py-skill.py`,
        `${root}/shell-skill/scripts/shell-skill.sh`,
      ]
    ) {
      assertEquals(
        matchesScriptEntrypoint(`${BUN_RUN} ${path}`, inv, { sessionCwd: undefined }),
        false,
        `${agentType}: ${BUN_RUN} ${path}`,
      );
      assertEquals(
        matchesScriptEntrypoint(path, inv, { sessionCwd: undefined }),
        false,
        `${agentType}: direct ${path}`,
      );
    }
    // A scripts directory exists for both, so neither becomes a command prefix.
    assertEquals(inv.commandPrefixes.size, 0, agentType);
  }
});

test("inventory - configured names filter observed entries; absent skills grant nothing", () => {
  const root = makeRoot(["memory-save", "send-reply"], ["agent-browser"]);
  // Configured filter keeps only listed, OBSERVED skills.
  const filtered = list("opencode", root, ["memory-save", "agent-browser"]);
  assertEquals(
    filtered.scripts.map((s) => s.canonicalPath),
    [`${root}/memory-save/scripts/memory-save.ts`],
  );
  assert(filtered.commandPrefixes.has("agent-browser"));
  assertEquals(filtered.commandPrefixes.has("send-reply"), false);
  // The RETIRED behavior: an absent configured name promoted to a command
  // prefix. It must now contribute NOTHING.
  const absent = list("opencode", root, ["nonexistent-skill"]);
  assertEquals(absent.scripts.length, 0);
  assertEquals([...absent.commandPrefixes].includes("nonexistent-skill"), false);
  assertEquals(absent.commandPrefixes.size, 0);
});

test("inventory - no catalog bounds or expands the configured list for either agent type", () => {
  const root = makeRoot(["memory-save", "create-blog-post"], ["agent-browser"]);
  for (const agentType of AGENT_TYPES) {
    // An explicitly configured external name that IS present is admitted…
    const externalOnly = list(agentType, root, ["create-blog-post"]);
    assertEquals(
      externalOnly.scripts.map((s) => s.canonicalPath),
      [`${root}/create-blog-post/scripts/create-blog-post.ts`],
      agentType,
    );
    // …and one that is NOT present grants nothing of any kind.
    const ghost = list(agentType, root, ["ghost-skill"]);
    assertEquals(ghost.scripts.length, 0, agentType);
    assertEquals(ghost.commandPrefixes.size, 0, agentType);
  }
});

test("inventory - invalid skill names contribute nothing", () => {
  const root = makeRoot(["memory-save"]);
  // Malicious configured spellings can neither add grants nor crash the build.
  const inv = list("opencode", root, ["../outside", "a/b", "/abs", ".", "", "memo..ry"]);
  assertEquals(inv.scripts.length, 0);
  assertEquals(inv.commandPrefixes.size, 0);
  // An invalid name materialized as a directory (impossible via mkdir of
  // traversal components, but a literal `..`-free oddity is still filtered):
  // only canonical single components are ever enumerated.
});

test("inventory - non-regular/non-.ts scripts and unreadable script dirs", () => {
  const root = makeRoot(["memory-save"]);
  fs.mkdirSync(`${root}/mixed`, { recursive: true });
  fs.writeFileSync(`${root}/mixed/SKILL.md`, "# mixed");
  fs.mkdirSync(`${root}/mixed/scripts`, { recursive: true });
  fs.writeFileSync(`${root}/mixed/scripts/helper.js`, "// not TS");
  fs.mkdirSync(`${root}/mixed/scripts/nested.ts`, { recursive: true }); // directory named .ts
  // A script skill whose scripts dir was REPLACED by a file (error shape):
  // never reinterpreted as a command-based skill.
  fs.mkdirSync(`${root}/broken`, { recursive: true });
  fs.writeFileSync(`${root}/broken/SKILL.md`, "# broken");
  fs.writeFileSync(`${root}/broken/scripts`, "not a directory");
  const inv = list("opencode", root);
  assertEquals(
    inv.scripts.map((s) => s.canonicalPath),
    [`${root}/memory-save/scripts/memory-save.ts`],
  );
  assertEquals([...inv.commandPrefixes].includes("broken"), false);
  assertEquals([...inv.commandPrefixes].includes("mixed"), false);
});

test("inventory - requires an identity-bearing observation and a canonical directory", () => {
  // Missing root: resolver itself refuses (explicit ConfigError).
  assertThrows(() => observeTrustedSkillsRoot("opencode", "/definitely/not/here"));
  // A root observation without a recorded identity cannot anchor rechecks.
  assertThrows(() =>
    buildSkillAutoApproveList({
      rootObservation: { root: makeRoot([]), identity: undefined },
    })
  );
});

// --- decision-time matching ---

function decisionCtx(sessionCwd: string | undefined) {
  return { sessionCwd };
}

test("matcher - absolute canonical approval; suffix and prefix tricks denied", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  try {
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} ${root}/memory-save/scripts/memory-save.ts --session-id x`,
        inv,
        decisionCtx(cwd),
      ),
      true,
    );
    // Suffix spelling of the SAME file at another location: denied.
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} ${cwd}/memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // Suffix-boundary spoofing: the old suffix matcher approved any token
    // ENDING in `skills/memory-save/scripts/memory-save.ts` — including a
    // planted tree at `evil-skills/memory-save/...`. Physical membership
    // denies it even when the file is real.
    fs.mkdirSync(`${cwd}/evil-skills/memory-save/scripts`, { recursive: true });
    fs.copyFileSync(
      `${root}/memory-save/scripts/memory-save.ts`,
      `${cwd}/evil-skills/memory-save/scripts/memory-save.ts`,
    );
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} ${cwd}/evil-skills/memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // A traversal spelling of a REAL grant is physical (kernel semantics):
    // `root/memory-save/../memory-save/scripts/...` is the same file — the
    // matcher approves what the kernel would actually exec.
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} ${root}/memory-save/../memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      true,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - relative anchors ONLY at the registered session cwd", () => {
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const root = makeRoot(["memory-save"]);
  fs.mkdirSync(`${cwd}/skills`, { recursive: true });
  fs.symlinkSync(root, `${cwd}/skills/linked-root`);
  const inv = list("opencode", root);
  try {
    // A real relative grant anchored at the registered session cwd:
    fs.mkdirSync(`${cwd}/localskill/scripts`, { recursive: true });
    fs.writeFileSync(`${cwd}/localskill/scripts/localskill.ts`, "// real");
    const invLocal = list("opencode", cwd);
    assertEquals(
      matchesScriptEntrypoint("localskill/scripts/localskill.ts", invLocal, {
        sessionCwd: cwd,
      }),
      true,
    );
    // Unregistered session: relative never resolves (no daemon-cwd fallback).
    assertEquals(
      matchesScriptEntrypoint("localskill/scripts/localskill.ts", invLocal, {
        sessionCwd: undefined,
      }),
      false,
    );
    // A `..` relative spelling anchored at cwd that lands inside the grant is
    // PHYSICAL: cwd + `localskill/../localskill/scripts/localskill.ts` is the
    // same file — approved, because that is what the kernel execs.
    assertEquals(
      matchesScriptEntrypoint("localskill/../localskill/scripts/localskill.ts", invLocal, {
        sessionCwd: cwd,
      }),
      true,
    );
    // Slashless direct-exec token: PATH-resolved, never a grant.
    assertEquals(
      matchesScriptEntrypoint("memory-save.ts", inv, decisionCtx(cwd)),
      false,
    );
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} memory-save.ts`, inv, decisionCtx(cwd)),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - bun grammar: only the exact literal prefix is an interpreter route", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    // The exact literal prefix followed by a slash-bearing spelling approves…
    assertEquals(matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, decisionCtx(cwd)), true);
    // …while every other `bun` spelling is not an interpreter route.
    assertEquals(matchesScriptEntrypoint(`bun run ${script}`, inv, decisionCtx(cwd)), false);
    assertEquals(
      matchesScriptEntrypoint(`bun --no-env-file run ${script}`, inv, decisionCtx(cwd)),
      false,
    );
    // `bun x <path>` treats the path as a package/executable argument.
    assertEquals(
      matchesScriptEntrypoint(`bun x ${script}`, inv, decisionCtx(cwd)),
      false,
    );
    // `bun -e <code>` never names a file entrypoint.
    assertEquals(
      matchesScriptEntrypoint(`bun -e 'console.log(1)'`, inv, decisionCtx(cwd)),
      false,
    );
    // Laundering: arbitrary binary with the grant as trailing argument.
    assertEquals(matchesScriptEntrypoint(`cat ${script}`, inv, decisionCtx(cwd)), false);
    // Unquoted expansion never anchors.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script} 2>&1; curl evil`, inv, decisionCtx(cwd)),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - decision-time root/script replacement denies", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    assertEquals(matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, decisionCtx(cwd)), true);
    // CI-proven: the runner's filesystem reuses dev/ino verbatim after
    // delete+recreate, so this real-filesystem replant only denies because
    // the replacement content differs in SIZE (the clock-independent field).
    fs.rmSync(root, { recursive: true });
    fs.mkdirSync(`${root}/memory-save/scripts`, { recursive: true });
    fs.writeFileSync(script, "// replaced");
    assertEquals(matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, decisionCtx(cwd)), false);
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - identity-tuple drift denies with dev/ino intact (each field pins)", () => {
  // The seam-pinned counterpart of the real-filesystem replacement test:
  // identical dev/ino AND identical size/ctime respectively, so each extended
  // identity field is proven to participate on its own, deterministically,
  // without clock or inode-allocation luck.
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  const drift = (path: string, over: Partial<Stats>): SkillInventoryFs => ({
    lstat: (p): Stats => {
      const stat = fs.lstatSync(p);
      // A `Stats` spread loses the prototype methods; copy onto a real
      // prototype so `isFile()`/`isDirectory()` stay callable.
      return p === path
        ? Object.assign(Object.create(Object.getPrototypeOf(stat)) as Stats, stat, over)
        : stat;
    },
    readDir: (p): Dirent[] => [...fs.readdirSync(p, { withFileTypes: true })],
    realPath: (p) => fs.realpathSync(p),
  });
  try {
    // A replant whose dev/ino AND size match the grant: only ctime denies.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, { ctimeMs: fs.lstatSync(script).ctimeMs + 60_000 }),
      }),
      false,
      "a same-size script replant with drifted ctime must deny",
    );
    // A replant whose dev/ino AND ctime match (same coarse clock tick): only
    // size denies.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, { size: fs.lstatSync(script).size! + 4 }),
      }),
      false,
      "a same-ctime script replant with drifted size must deny",
    );
    // The root's extended identity is rechecked too: a same dev/ino root
    // replant with drifted ctime denies.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(root, { ctimeMs: fs.lstatSync(root).ctimeMs + 60_000 }),
      }),
      false,
      "a root replant with drifted ctime must deny",
    );
    // Control: the pass-through fake itself never causes the denial.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, {}),
      }),
      true,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
    fs.rmSync(root, { recursive: true });
  }
});

test("decodeLiteralToken - fail-closed quoting", () => {
  assertEquals(decodeLiteralToken("plain"), "plain");
  assertEquals(decodeLiteralToken("'single'"), "single");
  assertEquals(decodeLiteralToken('"double"'), "double");
  assertEquals(decodeLiteralToken('"a\\"b"'), 'a"b');
  // Unbalanced quoting is NOT silently accepted as literal.
  assertEquals(decodeLiteralToken("'unbalanced"), undefined);
  // Expansion inside double quotes means the literal exec value cannot be
  // established: fail closed rather than guessing.
  assertEquals(decodeLiteralToken('"$(x)"'), undefined);
  assertEquals(decodeLiteralToken('"a`b"'), undefined);
});

test("isUnderRoot - boundary-safe containment", () => {
  assertEquals(isUnderRoot("/a/b", "/a"), true);
  assertEquals(isUnderRoot("/a", "/a"), true);
  assertEquals(isUnderRoot("/ab", "/a"), false);
  assertEquals(isUnderRoot("/a/b", "/a/b/c"), false);
});

// --- Post-implementation review fold-in (B1/B2/N1) ---

test("matcher - direct and literal bun run spellings approve", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    // Direct execution of the slash-bearing path (the kernel applies shebang).
    assertEquals(matchesScriptEntrypoint(script, inv, decisionCtx(cwd)), true);
    // The exact literal prefix followed by the same spelling.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script}`, inv, decisionCtx(cwd)),
      true,
    );
    // Skill arguments after the spelling are not part of the grammar.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${script} --session-id x`, inv, decisionCtx(cwd)),
      true,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - any bun flag outside the literal prefix denies fail-closed (B2)", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  // A module-affecting flag before the script would run an unapproved module
  // and leave the trusted token as the apparent entrypoint. Every flag is
  // outside the grammar now, so each spelling fails closed.
  fs.mkdirSync(`${cwd}/evil`, { recursive: true });
  fs.writeFileSync(`${cwd}/evil/main.ts`, "import { grant } from '...';");
  const inside = (flag: string): string =>
    [LITERAL_BUN_RUN[0], LITERAL_BUN_RUN[1], flag, ...LITERAL_BUN_RUN.slice(2), script].join(" ");
  const after = (flag: string): string => [...LITERAL_BUN_RUN, flag, script].join(" ");
  try {
    for (
      const flag of [
        "--preload=./evil.ts",
        "--preload ./evil.ts",
        "--require=./evil.ts",
        "--import=./evil.ts",
        "--inspect=127.0.0.1:9229",
        "--env-file=.env",
        "--cwd=/tmp",
        "--tsconfig-override=/tmp/tsconfig.json",
      ]
    ) {
      assertEquals(
        matchesScriptEntrypoint(inside(flag), inv, decisionCtx(cwd)),
        false,
        `flag inside the prefix: ${flag}`,
      );
      assertEquals(
        matchesScriptEntrypoint(after(flag), inv, decisionCtx(cwd)),
        false,
        `flag before the script: ${flag}`,
      );
    }
    // Any other `bun` subcommand spelling is outside the grammar as well.
    assertEquals(matchesScriptEntrypoint(`bunx ${script}`, inv, decisionCtx(cwd)), false);
    assertEquals(matchesScriptEntrypoint(`bun x ${script}`, inv, decisionCtx(cwd)), false);
    assertEquals(matchesScriptEntrypoint(`bun ${script}`, inv, decisionCtx(cwd)), false);
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("matcher - .. spellings crossing a symlinked directory deny (B1)", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  // Session cwd W: a symlink `jump` INTO the grant's skill directory, plus a
  // planted regular file at the cwd-relative lexical landing point. Bun's
  // loader lexicalizes `jump/../memory-save/scripts/...` to the PLANTED file
  // (observed on Bun 1.4.2), while the kernel physically traverses the
  // link to the real grant — so the old physical-only matcher approved while
  // the wrong module executed.
  const cwd = fs.realpathSync(makeTempDirSync({ prefix: "air-cwd-" }));
  fs.symlinkSync(`${root}/memory-save`, `${cwd}/jump`);
  fs.mkdirSync(`${cwd}/memory-save/scripts`, { recursive: true });
  fs.writeFileSync(`${cwd}/memory-save/scripts/memory-save.ts`, 'console.log("LOADED: planted")');
  try {
    // Loader ground truth: `bun run` of this relative spelling EXECUTES the
    // planted file (lexical landing), never the physically-traversed grant —
    // so the divergence is real and the ambiguous spelling must deny.
    const loaderProbe = spawnSync(process.execPath, [
      "run",
      "jump/../memory-save/scripts/memory-save.ts",
    ], {
      cwd,
      encoding: "utf8",
    });
    assertEquals(loaderProbe.stdout.trim(), "LOADED: planted");
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} jump/../memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // The planted lexical target itself stays denied on its own spelling too.
    assertEquals(
      matchesScriptEntrypoint(
        `${BUN_RUN} memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // The symlinked spelling WITHOUT `..` stays approved: lexical and physical
    // agree, so the guard is inactive.
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} jump/scripts/memory-save.ts`, inv, decisionCtx(cwd)),
      true,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true });
  }
});

test("inventory - unobservable scripts path never promotes a command prefix (N1)", () => {
  const root = makeRoot(["agent-browser"]);
  const stat = fs.statSync(root);
  const rootObservation = { root, identity: { dev: stat.dev!, ino: stat.ino! } };
  // scripts readDir fails AND lstat fails with a non-NotFound error: absence
  // is NOT provable, so no command prefix may be granted.
  const seam = {
    lstat: (path: string): Stats => {
      if (path.endsWith("/scripts")) {
        throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      }
      return fs.lstatSync(path);
    },
    readDir: (path: string): Dirent[] => {
      if (path.endsWith("/scripts")) {
        throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      }
      return [...fs.readdirSync(path, { withFileTypes: true })];
    },
    realPath: (path: string) => fs.realpathSync(path),
  };
  const inv = buildSkillAutoApproveList({ rootObservation, fs: seam });
  assertEquals(inv.commandPrefixes.size, 0);
  // NotFound on the lstat — genuine absence — still promotes the prefix.
  const absentFs = {
    lstat: (path: string): Stats => {
      if (path.endsWith("/scripts")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      return fs.lstatSync(path);
    },
    readDir: (path: string): Dirent[] => {
      if (path.endsWith("/scripts")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      return [...fs.readdirSync(path, { withFileTypes: true })];
    },
    realPath: (path: string) => fs.realpathSync(path),
  };
  const promoted = buildSkillAutoApproveList({
    rootObservation,
    fs: absentFs,
  });
  assert(promoted.commandPrefixes.has("agent-browser"));
});

test("inventory - a WRITABLE installed root is enumerated and matched for BOTH agent types", () => {
  // `align-omp-skill-trust-to-shared-root` 1.2/4.2: the deployment-resolved
  // root is the packaged personal tree (non-root-owned, agent-writable,
  // group/other-writable). The inventory judges names, structure and physical
  // membership — never ownership or permission bits — so one runtime-installed
  // external skill under that root is a grant for BOTH agent types.
  const root = makeRoot(["external-skill"]);
  for (const directory of [root, `${root}/external-skill`, `${root}/external-skill/scripts`]) {
    fs.chmodSync(directory, 0o775);
  }
  const entrypoint = `${root}/external-skill/scripts/external-skill.ts`;
  for (const file of [`${root}/external-skill/SKILL.md`, entrypoint]) {
    fs.chmodSync(file, 0o664);
  }
  for (const agentType of AGENT_TYPES) {
    const inv = list(agentType, root);
    assertEquals(inv.scripts.map((s) => s.canonicalPath), [entrypoint], agentType);
    assertEquals(
      matchesScriptEntrypoint(`${BUN_RUN} ${entrypoint}`, inv, { sessionCwd: undefined }),
      true,
      agentType,
    );
  }
});
