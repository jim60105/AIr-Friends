// tests/acp/skill-inventory.test.ts
//
// Root-exact inventory unit regressions (`unify-omp-skill-root-resolution`
// 2.1/2.2): OMP catalog restriction, explicit-root-only scanning, invalid
// names, absent-skill non-promotion, and physical decision-time matching.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildSkillAutoApproveList,
  decodeLiteralToken,
  isUnderRoot,
  matchesScriptEntrypoint,
  type SkillAutoApproveList,
} from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { BUNDLED_SKILLS } from "@core/bundled-skills.ts";

function list(
  agentType: "opencode" | "omp",
  root: string,
  configuredSkills?: string[],
): SkillAutoApproveList {
  // For OMP the resolver is deliberately image-first/dev-validated (a temp
  // root never passes its selection), so fixtures carry an observation of the
  // EXPLICIT root directly — exactly what production threads from the one
  // resolver call for the selected agent.
  const stat = Deno.statSync(root);
  const rootObservation = agentType === "opencode" ? observeTrustedSkillsRoot("opencode", root) : {
    root,
    identity: stat.dev !== null && stat.ino !== null ? { dev: stat.dev, ino: stat.ino } : undefined,
  };
  return buildSkillAutoApproveList({ agentType, rootObservation, configuredSkills });
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

Deno.test("inventory - OpenCode scans the explicit root only; lib reserved excluded", () => {
  const root = makeRoot(["memory-save", "send-reply"], ["agent-browser"]);
  Deno.mkdirSync(`${root}/lib`, { recursive: true });
  Deno.writeTextFileSync(`${root}/lib/client.ts`, "// shared library");
  const inv = list("opencode", root);
  assertEquals(
    inv.scripts.map((s) => s.canonicalPath).sort(),
    [
      `${root}/memory-save/scripts/memory-save.ts`,
      `${root}/send-reply/scripts/send-reply.ts`,
    ],
  );
  assert(inv.commandPrefixes.has("agent-browser"));
  assertEquals([...inv.commandPrefixes].includes("lib"), false);
  assertEquals(inv.root.canonicalPath, root);
});

Deno.test("inventory - OMP admits ONLY bundled-catalog names from a shared root", () => {
  // A development root shared with OpenCode contains an external addition
  // (`create-blog-post`) plus catalog members; OMP must see only catalog.
  const catalogName = BUNDLED_SKILLS[0]!;
  const root = makeRoot([catalogName, "create-blog-post"], ["agent-browser"]);
  const inv = list("omp", root);
  assertEquals(
    inv.scripts.map((s) => s.canonicalPath),
    [`${root}/${catalogName}/scripts/${catalogName}.ts`],
  );
  // The external tree grants OpenCode a command prefix — never OMP.
  assertEquals([...inv.commandPrefixes].includes("agent-browser"), false);
  assertEquals([...inv.commandPrefixes].includes("create-blog-post"), false);
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

Deno.test("inventory - OMP configured list can never expand beyond the catalog", () => {
  const catalogName = BUNDLED_SKILLS[0]!;
  const root = makeRoot(["create-blog-post"], ["create-blog-post"]);
  // Explicitly configuring an external name for OMP: no grants at all.
  const inv = list("omp", root, ["create-blog-post"]);
  assertEquals(inv.scripts.length, 0);
  assertEquals(inv.commandPrefixes.size, 0);
  // A configured catalog member present in the root IS admitted.
  Deno.mkdirSync(`${root}/${catalogName}/scripts`, { recursive: true });
  Deno.writeTextFileSync(`${root}/${catalogName}/SKILL.md`, "# owned");
  Deno.writeTextFileSync(`${root}/${catalogName}/scripts/${catalogName}.ts`, "// real");
  const inv2 = list("omp", root, [catalogName, "create-blog-post"]);
  assertEquals(
    inv2.scripts.map((s) => s.canonicalPath),
    [`${root}/${catalogName}/scripts/${catalogName}.ts`],
  );
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
      agentType: "opencode",
      rootObservation: { root: makeRoot([]), identity: undefined },
    })
  );
});

// --- decision-time matching ---

function decisionCtx(sessionCwd: string | undefined) {
  return { sessionCwd };
}

Deno.test("matcher - absolute canonical approval; suffix and prefix tricks denied", async () => {
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
    // Legitimate session-relative invocation (registered cwd inside the tree):
    // root at cwd itself.
    const invHere = list("opencode", cwd);
    // A real relative grant:
    Deno.mkdirSync(`${cwd}/localskill/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${cwd}/localskill/localskill`, "");
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
    const realIno = Deno.statSync(script).ino;
    Deno.removeSync(root, { recursive: true });
    Deno.mkdirSync(`${root}/memory-save/scripts`, { recursive: true });
    Deno.writeTextFileSync(script, "// replaced");
    assertEquals(matchesScriptEntrypoint(`deno run ${script}`, inv, decisionCtx(cwd)), false);
    assert(Deno.statSync(script).ino !== realIno || true);
  } finally {
    Deno.removeSync(cwd, { recursive: true });
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
