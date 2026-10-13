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
  matchesScriptEntrypoint,
  type SkillAutoApproveList,
  type SkillInventoryFs,
} from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";

/** The supported agent types; both construct the identical inventory. */
const AGENT_TYPES = ["opencode", "omp"] as const;

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
  const root = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-inv-" }));
  for (const name of scriptSkills) {
    Deno.mkdirSync(`${root}/${name}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
    Deno.writeTextFileSync(`${root}/${name}/scripts/${name}.ts`, "// real");
  }
  for (const name of commandSkills) {
    Deno.mkdirSync(`${root}/${name}`, { recursive: true });
    Deno.writeTextFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
  }
  return root;
}

Deno.test("inventory - the explicit root is scanned for either agent type; lib reserved excluded", () => {
  const root = makeRoot(["memory-save", "send-reply"], ["agent-browser"]);
  Deno.mkdirSync(`${root}/lib`, { recursive: true });
  Deno.writeTextFileSync(`${root}/lib/client.ts`, "// shared library");
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

Deno.test("inventory - a non-bundled installed .ts script is eligible for BOTH agent types", () => {
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
        matchesScriptEntrypoint(`deno run ${scriptPath}`, inv, { sessionCwd: undefined }),
        true,
        `${agentType}: ${String(configured)}`,
      );
    }
    // …and an explicit list naming only the external skill yields exactly it.
    const filtered = list(agentType, root, ["create-blog-post"]);
    assertEquals(filtered.scripts.map((s) => s.canonicalPath), [scriptPath], agentType);
  }
});

Deno.test("inventory - a non-.ts script is eligible for neither agent type", () => {
  // `scripts/*.ts` with `deno` as the sole allowlisted interpreter stays the
  // only enumerable form: a `.py` or shell script grants nothing anywhere.
  const root = makeRoot(["memory-save"]);
  for (
    const [name, file] of [["py-skill", "py-skill.py"], ["shell-skill", "shell-skill.sh"]] as const
  ) {
    Deno.mkdirSync(`${root}/${name}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
    Deno.writeTextFileSync(`${root}/${name}/scripts/${file}`, "// never executable");
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
        matchesScriptEntrypoint(`deno run ${path}`, inv, { sessionCwd: undefined }),
        false,
        `${agentType}: deno run ${path}`,
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

Deno.test("inventory - configured names filter observed entries; absent skills grant nothing", () => {
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

Deno.test("inventory - no catalog bounds or expands the configured list for either agent type", () => {
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

Deno.test("inventory - invalid skill names contribute nothing", () => {
  const root = makeRoot(["memory-save"]);
  // Malicious configured spellings can neither add grants nor crash the build.
  const inv = list("opencode", root, ["../outside", "a/b", "/abs", ".", "", "memo..ry"]);
  assertEquals(inv.scripts.length, 0);
  assertEquals(inv.commandPrefixes.size, 0);
  // An invalid name materialized as a directory (impossible via mkdir of
  // traversal components, but a literal `..`-free oddity is still filtered):
  // only canonical single components are ever enumerated.
});

Deno.test("inventory - non-regular/non-.ts scripts and unreadable script dirs", () => {
  const root = makeRoot(["memory-save"]);
  Deno.mkdirSync(`${root}/mixed`, { recursive: true });
  Deno.writeTextFileSync(`${root}/mixed/SKILL.md`, "# mixed");
  Deno.mkdirSync(`${root}/mixed/scripts`, { recursive: true });
  Deno.writeTextFileSync(`${root}/mixed/scripts/helper.js`, "// not TS");
  Deno.mkdirSync(`${root}/mixed/scripts/nested.ts`, { recursive: true }); // directory named .ts
  // A script skill whose scripts dir was REPLACED by a file (error shape):
  // never reinterpreted as a command-based skill.
  Deno.mkdirSync(`${root}/broken`, { recursive: true });
  Deno.writeTextFileSync(`${root}/broken/SKILL.md`, "# broken");
  Deno.writeTextFileSync(`${root}/broken/scripts`, "not a directory");
  const inv = list("opencode", root);
  assertEquals(
    inv.scripts.map((s) => s.canonicalPath),
    [`${root}/memory-save/scripts/memory-save.ts`],
  );
  assertEquals([...inv.commandPrefixes].includes("broken"), false);
  assertEquals([...inv.commandPrefixes].includes("mixed"), false);
});

Deno.test("inventory - requires an identity-bearing observation and a canonical directory", () => {
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

Deno.test("matcher - absolute canonical approval; suffix and prefix tricks denied", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  try {
    assertEquals(
      matchesScriptEntrypoint(
        `deno run ${root}/memory-save/scripts/memory-save.ts --session-id x`,
        inv,
        decisionCtx(cwd),
      ),
      true,
    );
    // Suffix spelling of the SAME file at another location: denied.
    assertEquals(
      matchesScriptEntrypoint(
        `deno run ${cwd}/memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // Suffix-boundary spoofing: the old suffix matcher approved any token
    // ENDING in `skills/memory-save/scripts/memory-save.ts` — including a
    // planted tree at `evil-skills/memory-save/...`. Physical membership
    // denies it even when the file is real.
    Deno.mkdirSync(`${cwd}/evil-skills/memory-save/scripts`, { recursive: true });
    Deno.copyFileSync(
      `${root}/memory-save/scripts/memory-save.ts`,
      `${cwd}/evil-skills/memory-save/scripts/memory-save.ts`,
    );
    assertEquals(
      matchesScriptEntrypoint(
        `deno run ${cwd}/evil-skills/memory-save/scripts/memory-save.ts`,
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
        `deno run ${root}/memory-save/../memory-save/scripts/memory-save.ts`,
        inv,
        decisionCtx(cwd),
      ),
      true,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - relative anchors ONLY at the registered session cwd", () => {
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const root = makeRoot(["memory-save"]);
  Deno.mkdirSync(`${cwd}/skills`, { recursive: true });
  Deno.symlinkSync(root, `${cwd}/skills/linked-root`);
  const inv = list("opencode", root);
  try {
    // A real relative grant anchored at the registered session cwd:
    Deno.mkdirSync(`${cwd}/localskill/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${cwd}/localskill/scripts/localskill.ts`, "// real");
    const invLocal = list("opencode", cwd);
    assertEquals(
      matchesScriptEntrypoint("deno run localskill/scripts/localskill.ts", invLocal, {
        sessionCwd: cwd,
      }),
      true,
    );
    // Unregistered session: relative never resolves (no daemon-cwd fallback).
    assertEquals(
      matchesScriptEntrypoint("deno run localskill/scripts/localskill.ts", invLocal, {
        sessionCwd: undefined,
      }),
      false,
    );
    // A `..` relative spelling anchored at cwd that lands inside the grant is
    // PHYSICAL: cwd + `localskill/../localskill/scripts/localskill.ts` is the
    // same file — approved, because that is what the kernel execs.
    assertEquals(
      matchesScriptEntrypoint("deno run localskill/../localskill/scripts/localskill.ts", invLocal, {
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
      matchesScriptEntrypoint("deno run --allow-net memory-save.ts", inv, decisionCtx(cwd)),
      false,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - deno-run grammar: `run` must be the subcommand", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    assertEquals(matchesScriptEntrypoint(`deno run ${script}`, inv, decisionCtx(cwd)), true);
    assertEquals(
      matchesScriptEntrypoint(`deno --allow-net run ${script}`, inv, decisionCtx(cwd)),
      true,
    );
    // `deno task run <path>`: `run` launches a task, the path is an argument.
    assertEquals(
      matchesScriptEntrypoint(`deno task run ${script}`, inv, decisionCtx(cwd)),
      false,
    );
    // `deno eval <path>`: path is an argument to eval.
    assertEquals(
      matchesScriptEntrypoint(`deno eval ${script}`, inv, decisionCtx(cwd)),
      false,
    );
    // Laundering: arbitrary binary with the grant as trailing argument.
    assertEquals(matchesScriptEntrypoint(`cat ${script}`, inv, decisionCtx(cwd)), false);
    // Unquoted expansion never anchors.
    assertEquals(
      matchesScriptEntrypoint(`deno run ${script} 2>&1; curl evil`, inv, decisionCtx(cwd)),
      false,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - decision-time root/script replacement denies", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    assertEquals(matchesScriptEntrypoint(`deno run ${script}`, inv, decisionCtx(cwd)), true);
    // CI-proven: the runner's filesystem reuses dev/ino verbatim after
    // delete+recreate, so this real-filesystem replant only denies because
    // the replacement content differs in SIZE (the clock-independent field).
    Deno.removeSync(root, { recursive: true });
    Deno.mkdirSync(`${root}/memory-save/scripts`, { recursive: true });
    Deno.writeTextFileSync(script, "// replaced");
    assertEquals(matchesScriptEntrypoint(`deno run ${script}`, inv, decisionCtx(cwd)), false);
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - identity-tuple drift denies with dev/ino intact (each field pins)", () => {
  // The seam-pinned counterpart of the real-filesystem replacement test:
  // identical dev/ino AND identical size/ctime respectively, so each extended
  // identity field is proven to participate on its own, deterministically,
  // without clock or inode-allocation luck.
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  const drift = (path: string, over: Partial<Deno.FileInfo>): SkillInventoryFs => ({
    lstat: (p): Deno.FileInfo => ({ ...Deno.lstatSync(p), ...(p === path ? over : {}) }),
    readDir: (p): Deno.DirEntry[] => [...Deno.readDirSync(p)],
    realPath: (p) => Deno.realPathSync(p),
  });
  try {
    // A replant whose dev/ino AND size match the grant: only ctime denies.
    assertEquals(
      matchesScriptEntrypoint(`deno run ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, { ctime: new Date(Deno.lstatSync(script).ctime!.getTime() + 60_000) }),
      }),
      false,
      "a same-size script replant with drifted ctime must deny",
    );
    // A replant whose dev/ino AND ctime match (same coarse clock tick): only
    // size denies.
    assertEquals(
      matchesScriptEntrypoint(`deno run ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, { size: Deno.lstatSync(script).size! + 4 }),
      }),
      false,
      "a same-ctime script replant with drifted size must deny",
    );
    // The root's extended identity is rechecked too: a same dev/ino root
    // replant with drifted ctime denies.
    assertEquals(
      matchesScriptEntrypoint(`deno run ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(root, { ctime: new Date(Deno.lstatSync(root).ctime!.getTime() + 60_000) }),
      }),
      false,
      "a root replant with drifted ctime must deny",
    );
    // Control: the pass-through fake itself never causes the denial.
    assertEquals(
      matchesScriptEntrypoint(`deno run ${script}`, inv, {
        sessionCwd: cwd,
        fs: drift(script, {}),
      }),
      true,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("decodeLiteralToken - fail-closed quoting", () => {
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

Deno.test("isUnderRoot - boundary-safe containment", () => {
  assertEquals(isUnderRoot("/a/b", "/a"), true);
  assertEquals(isUnderRoot("/a", "/a"), true);
  assertEquals(isUnderRoot("/ab", "/a"), false);
  assertEquals(isUnderRoot("/a/b", "/a/b/c"), false);
});

// --- Post-implementation review fold-in (B1/B2/N1) ---

Deno.test("matcher - unflagged and allow-listed-flag deno run spellings still approve", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  try {
    // The ordinary unflagged posture (production's dominant shape) is
    // unaffected by the flag allow-list…
    assertEquals(matchesScriptEntrypoint(`deno run ${script}`, inv, decisionCtx(cwd)), true);
    // …and value-less permission flags from the allow-list skip harmlessly.
    assertEquals(
      matchesScriptEntrypoint(`deno run --allow-read --no-check ${script}`, inv, decisionCtx(cwd)),
      true,
    );
    assertEquals(
      matchesScriptEntrypoint(`deno run -A --quiet ${script}`, inv, decisionCtx(cwd)),
      true,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - module-affecting deno run flags deny fail-closed (B2)", () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  const script = `${root}/memory-save/scripts/memory-save.ts`;
  // A trusted grant used as the (perceived) entrypoint while a PRELOAD module
  // actually executes: `--preload <trusted> <planted>` — the old skip-all-flags
  // grammar read <trusted> as the entrypoint and approved while Deno executed
  // an unapproved main.
  Deno.mkdirSync(`${cwd}/evil`, { recursive: true });
  Deno.writeTextFileSync(`${cwd}/evil/main.ts`, "import { grant } from '...';");
  try {
    assertEquals(
      matchesScriptEntrypoint(
        `deno run --preload ${script} ${cwd}/evil/main.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    assertEquals(
      matchesScriptEntrypoint(
        `deno run --import ${script} ${cwd}/evil/main.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // Arity-guessable flags never fall through to the next token either.
    assertEquals(
      matchesScriptEntrypoint(
        `deno run --config ${script} ${cwd}/evil/main.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    assertEquals(
      matchesScriptEntrypoint(
        `deno run --allow-read=${script} ${cwd}/evil/main.ts`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    assertEquals(matchesScriptEntrypoint(`deno run -- ${script}`, inv, decisionCtx(cwd)), false);
    assertEquals(
      matchesScriptEntrypoint(
        `deno run --v8-flags=--experimental ${script}`,
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("matcher - .. spellings crossing a symlinked directory deny (B1)", async () => {
  const root = makeRoot(["memory-save"]);
  const inv = list("opencode", root);
  // Session cwd W: a symlink `jump` INTO the grant's skill directory, plus a
  // planted regular file at the cwd-relative lexical landing point. Deno's
  // loader lexicalizes `jump/../memory-save/scripts/...` to the PLANTED file,
  // while the kernel physically traverses the link to the real grant — the
  // old physical-only matcher approved while the wrong module executed.
  const cwd = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-cwd-" }));
  Deno.symlinkSync(`${root}/memory-save`, `${cwd}/jump`);
  Deno.mkdirSync(`${cwd}/memory-save/scripts`, { recursive: true });
  Deno.writeTextFileSync(
    `${cwd}/memory-save/scripts/memory-save.ts`,
    'console.log("LOADED: planted")',
  );
  try {
    // Loader ground truth: `deno run` of this relative spelling EXECUTES the
    // planted file (lexical landing), never the physically-traversed grant —
    // so the divergence is real and the ambiguous spelling must deny.
    const loaderProbe = await new Deno.Command(Deno.execPath(), {
      args: ["run", "jump/../memory-save/scripts/memory-save.ts"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(new TextDecoder().decode(loaderProbe.stdout).trim(), "LOADED: planted");
    assertEquals(
      matchesScriptEntrypoint(
        "deno run jump/../memory-save/scripts/memory-save.ts",
        inv,
        decisionCtx(cwd),
      ),
      false,
    );
    // The planted lexical target itself stays denied on its own spelling too.
    assertEquals(
      matchesScriptEntrypoint("deno run memory-save/scripts/memory-save.ts", inv, decisionCtx(cwd)),
      false,
    );
    // The symlinked spelling WITHOUT `..` stays approved: lexical and physical
    // agree, so the guard is inactive.
    assertEquals(
      matchesScriptEntrypoint("deno run jump/scripts/memory-save.ts", inv, decisionCtx(cwd)),
      true,
    );
  } finally {
    Deno.removeSync(cwd, { recursive: true });
  }
});

Deno.test("inventory - unobservable scripts path never promotes a command prefix (N1)", () => {
  const root = makeRoot(["agent-browser"]);
  const stat = Deno.statSync(root);
  const rootObservation = { root, identity: { dev: stat.dev!, ino: stat.ino! } };
  // scripts readDir fails AND lstat fails with a non-NotFound error: absence
  // is NOT provable, so no command prefix may be granted.
  const fs = {
    lstat: (path: string): Deno.FileInfo => {
      if (path.endsWith("/scripts")) throw new Deno.errors.PermissionDenied("unreadable");
      return Deno.lstatSync(path);
    },
    readDir: (path: string): Deno.DirEntry[] => {
      if (path.endsWith("/scripts")) throw new Deno.errors.PermissionDenied("unreadable");
      return [...Deno.readDirSync(path)];
    },
    realPath: (path: string) => Deno.realPathSync(path),
  };
  const inv = buildSkillAutoApproveList({ rootObservation, fs });
  assertEquals(inv.commandPrefixes.size, 0);
  // NotFound on the lstat — genuine absence — still promotes the prefix.
  const absentFs = {
    lstat: (path: string): Deno.FileInfo => {
      if (path.endsWith("/scripts")) throw new Deno.errors.NotFound("absent");
      return Deno.lstatSync(path);
    },
    readDir: (path: string): Deno.DirEntry[] => {
      if (path.endsWith("/scripts")) throw new Deno.errors.NotFound("absent");
      return [...Deno.readDirSync(path)];
    },
    realPath: (path: string) => Deno.realPathSync(path),
  };
  const promoted = buildSkillAutoApproveList({
    rootObservation,
    fs: absentFs,
  });
  assert(promoted.commandPrefixes.has("agent-browser"));
});
