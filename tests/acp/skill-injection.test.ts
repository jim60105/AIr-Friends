// tests/acp/skill-injection.test.ts
//
// Production injection-defense suite (design D3, P0-6). It proves the two
// properties the Bun migration depends on:
//
// - `Exact Bun Skill Invocation Grammar`: a trusted script is approved only by
//   direct execution of a slash-bearing path, or after the exact literal
//   `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml`
//   prefix. Every other `bun` spelling is denied by the gate itself.
// - `Trusted Skills Ignore Working-Directory Configuration`: an agent-writable
//   working directory holding `.env`, `.env.local`, `bunfig.toml`,
//   `tsconfig.json`, `package.json` and `node_modules` changes nothing, and a
//   missing trusted config stops the skill before its body runs.
//
// Ported from `migration/bun/poc/suites/injection.spec.ts` and
// `injection-noconfig.spec.ts` (INJ-01..INJ-08). The runs execute the real
// fixture under `tests/fixtures/skills/injection-probe/`, so this suite needs
// the image's `/opt/air/skill-bunfig.toml` and must run in the container (or
// another environment that provides it).
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSkillAutoApproveList,
  LITERAL_BUN_RUN,
  matchScriptEntrypoint,
  type SkillAutoApproveList,
} from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const SKILL_ROOT = join(REPO_ROOT, "tests", "fixtures", "skills");
const SKILL_PATH = join(SKILL_ROOT, "injection-probe", "scripts", "report.ts");
const CONFIG_PATH = "/opt/air/skill-bunfig.toml";
const CONFIG_BACKUP = `${CONFIG_PATH}.omp-injection-backup`;

/** The inventory production builds over the fixture root. */
const INVENTORY = buildSkillAutoApproveList({
  rootObservation: observeTrustedSkillsRoot("opencode", SKILL_ROOT),
});

/** Everything a test creates, removed once the suite ends. */
const scratch: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const BASE_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

/** The run environment: `PATH`, a fresh `HOME`, then the caller's overrides. */
function envFor(overrides: Record<string, string> = {}): Record<string, string> {
  return { PATH: BASE_PATH, HOME: scratchDir("inj-home-"), ...overrides };
}

// ---------------------------------------------------------------------------
// Attacker-controlled working directories (ported from
// `migration/bun/poc/injection/attacker-dir.ts`).
// ---------------------------------------------------------------------------

type AttackFile = "dotenv" | "bunfig" | "project" | "symlink";

/** Writes `PWNED` beside itself and prints `EVIL`: a preload's visible effect. */
const EVIL_PRELOAD = `import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "PWNED"), "pwned\\n");
console.log("EVIL");
`;

/** An attacker `helper.ts`: a hijacked relative import is visible and marks the dir. */
const ATTACKER_HELPER = `import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const helperValue = "ATTACKER-HELPER";
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "PWNED"), "pwned\\n");
`;

/** An executable a lookup could reach; it marks the attacker directory root. */
const ATTACKER_EXECUTABLE = `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "PWNED"), "pwned\\n");
`;

/** A package the bare specifier could resolve to; it marks the attacker root. */
const ATTACKER_MODULE = `import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "PWNED"), "pwned\\n");
`;

/**
 * Creates an attacker directory holding `evil-preload.ts` plus the files of
 * each requested vector. The caller owns the directory.
 */
function makeAttackerDir(files: readonly AttackFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "inj-attack-"));
  scratch.push(dir);
  writeFileSync(join(dir, "evil-preload.ts"), EVIL_PRELOAD);
  for (const file of files) {
    switch (file) {
      case "dotenv":
        writeFileSync(join(dir, ".env"), "AIR_POC_ATTACKER_ENV=1\n");
        writeFileSync(join(dir, ".env.local"), "AIR_POC_ATTACKER_LOCAL=1\n");
        break;
      case "bunfig":
        writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./evil-preload.ts"]\n');
        break;
      case "project": {
        writeFileSync(
          join(dir, "tsconfig.json"),
          `${
            JSON.stringify(
              {
                compilerOptions: { paths: { "poc-bare-probe": ["./evil-preload.ts"] } },
              },
              null,
              2,
            )
          }\n`,
        );
        writeFileSync(
          join(dir, "package.json"),
          `${
            JSON.stringify(
              {
                name: "poc-attacker",
                type: "module",
                scripts: { "report.ts": "touch PWNED" },
              },
              null,
              2,
            )
          }\n`,
        );
        const bin = join(dir, "node_modules", ".bin", "report.ts");
        mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
        writeFileSync(bin, ATTACKER_EXECUTABLE);
        chmodSync(bin, 0o755);
        mkdirSync(join(dir, "node_modules", "poc-bare-probe"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "poc-bare-probe", "index.js"), ATTACKER_MODULE);
        break;
      }
      case "symlink":
        writeFileSync(join(dir, "helper.ts"), ATTACKER_HELPER);
        symlinkSync(SKILL_PATH, join(dir, "report.ts"));
        break;
    }
  }
  return dir;
}

/** Whether an attacker file ran inside `dir`. */
function pwned(dir: string): boolean {
  return existsSync(join(dir, "PWNED"));
}

interface SkillRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs one command with an explicit environment of `PATH` and `HOME` only. A
 * caller that needs a specific (hostile) `HOME` passes one; otherwise a fresh
 * `mkdtemp` is created for the run and removed afterwards.
 */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): SkillRun {
  const ownHome = env.HOME === undefined ? mkdtempSync(join(tmpdir(), "inj-run-home-")) : undefined;
  try {
    const result = spawnSync(command, args, {
      cwd,
      env: { PATH: BASE_PATH, ...env, HOME: env.HOME ?? ownHome },
      encoding: "utf8",
    });
    return {
      exitCode: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    if (ownHome !== undefined) rmSync(ownHome, { recursive: true, force: true });
  }
}

/** Executes the script path itself, so the kernel honours its hardened shebang. */
function runDirect(
  cwd: string,
  env: Record<string, string>,
  path: string = SKILL_PATH,
): SkillRun {
  return run(path, ["--flag", "v"], cwd, env);
}

/** Executes the literal `bun run` form; only `bun` itself is unhardened here. */
function runLiteral(
  cwd: string,
  env: Record<string, string>,
  path: string = SKILL_PATH,
): SkillRun {
  return run(
    LITERAL_BUN_RUN[0],
    [...LITERAL_BUN_RUN.slice(1), path, "--flag", "v"],
    cwd,
    env,
  );
}

/** Executes plain `bun run <path>`: the unhardened control a vector must defeat. */
function runPlain(
  cwd: string,
  env: Record<string, string>,
  path: string = SKILL_PATH,
): SkillRun {
  return run(LITERAL_BUN_RUN[0], ["run", path, "--flag", "v"], cwd, env);
}

/** `relative(cwd, SKILL_PATH)`, prefixed with `./` when it has no leading dot. */
function relativeSpelling(cwd: string): string {
  const spelled = relative(cwd, SKILL_PATH);
  return spelled.startsWith(".") ? spelled : `./${spelled}`;
}

const FORMS = [
  { form: "direct", run: runDirect },
  { form: "literal", run: runLiteral },
] as const;

interface Comparison {
  form: string;
  spelling: string;
  attack: SkillRun;
  control: SkillRun;
}

/**
 * Runs both invocation forms, with the absolute path and the spelling relative
 * to each run's own working directory, from the attack directory and from an
 * empty control directory, and asserts the attack run is indistinguishable
 * from the control run.
 */
function compareAttack(
  attackCwd: string,
  env: { attack?: Record<string, string>; control?: Record<string, string> } = {},
): Comparison[] {
  const comparisons: Comparison[] = [];
  for (const { form, run } of FORMS) {
    for (const absolute of [true, false]) {
      const controlDir = scratchDir("inj-control-");
      const control = run(
        controlDir,
        envFor(env.control),
        absolute ? SKILL_PATH : relativeSpelling(controlDir),
      );
      const attack = run(
        attackCwd,
        envFor(env.attack),
        absolute ? SKILL_PATH : relativeSpelling(attackCwd),
      );
      expect(attack.exitCode).toBe(control.exitCode);
      expect(attack.stdout).toBe(control.stdout);
      expect(attack.exitCode).toBe(0);
      expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
      expect(attack.stdout).toContain('"args":{"flag":"v"}');
      expect(attack.stdout).toContain('"helper":"HELPER-OK"');
      expect(pwned(attackCwd)).toBe(false);
      comparisons.push({
        form,
        spelling: absolute ? SKILL_PATH : relativeSpelling(attackCwd),
        attack,
        control,
      });
    }
  }
  return comparisons;
}

// --- INJ-01: environment files in the working directory change nothing ---

test("INJ-01: an unhardened bun run loads the attacker environment files", () => {
  const dir = makeAttackerDir(["dotenv"]);
  const control = runPlain(scratchDir("inj-control-"), envFor());
  const attack = runPlain(dir, envFor());
  expect(control.stdout).toContain('"marker":"SKILL-RAN"');
  expect(control.stdout).toContain('"attackerEnv":[]');
  expect(attack.stdout).toContain("AIR_POC_ATTACKER_ENV");
  expect(attack.stdout).toContain("AIR_POC_ATTACKER_LOCAL");
});

test("INJ-01: .env and .env.local in the working directory change nothing", () => {
  const comparisons = compareAttack(makeAttackerDir(["dotenv"]));
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"attackerEnv":[]');
  }
});

// --- INJ-02: a config preload in the working directory never runs ---

test("INJ-02: an unhardened bun run executes the working-directory preload", () => {
  const dir = makeAttackerDir(["bunfig"]);
  const attack = runPlain(dir, envFor());
  expect(attack.stdout).toContain("EVIL");
  expect(pwned(dir)).toBe(true);
  rmSync(join(dir, "PWNED"), { force: true });
  expect(pwned(dir)).toBe(false);
});

test("INJ-02: a bunfig.toml in the working directory changes nothing", () => {
  compareAttack(makeAttackerDir(["bunfig"]));
});

// --- INJ-03: project files and a symlinked spelling change nothing ---

test("INJ-03: tsconfig.json, package.json and node_modules change nothing", () => {
  const comparisons = compareAttack(makeAttackerDir(["project"]));
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"bare":"absent"');
    expect(comparison.control.stdout).toContain('"bare":"absent"');
  }
});

test("INJ-03: a symlinked spelling beside an attacker helper changes nothing", () => {
  // The symlinked spelling sits beside the project files, so a loader that
  // resolves relative to the spelling would find the attacker's `tsconfig.json`
  // and `node_modules` in the same directory.
  const dir = makeAttackerDir(["symlink", "project"]);
  const baseline = runDirect(scratchDir("inj-control-"), envFor(), SKILL_PATH);
  expect(baseline.exitCode).toBe(0);
  expect(baseline.stdout).toContain('"marker":"SKILL-RAN"');
  for (const { run } of FORMS) {
    const attack = run(dir, envFor(), "./report.ts");
    expect(attack.exitCode).toBe(baseline.exitCode);
    expect(attack.stdout).toBe(baseline.stdout);
    expect(attack.stdout).toContain('"helper":"HELPER-OK"');
    expect(attack.stdout).toContain('"bare":"absent"');
    expect(pwned(dir)).toBe(false);
  }
});

// --- INJ-04: an environment prefix is denied, and is the defence's job ---

test("INJ-04: the grammar denies a BUN_OPTIONS command prefix", () => {
  const literal = LITERAL_BUN_RUN.join(" ");
  expect(
    matchScriptEntrypoint(`BUN_OPTIONS=--preload=./evil.ts ${SKILL_PATH}`, INVENTORY, {
      sessionCwd: REPO_ROOT,
    }),
  ).toBeUndefined();
  expect(
    matchScriptEntrypoint(`BUN_OPTIONS="--preload /tmp/e.ts" ${literal} ${SKILL_PATH}`, INVENTORY, {
      sessionCwd: REPO_ROOT,
    }),
  ).toBeUndefined();
  expect(
    matchScriptEntrypoint(`env BUN_OPTIONS=x ${SKILL_PATH}`, INVENTORY, {
      sessionCwd: REPO_ROOT,
    }),
  ).toBeUndefined();
});

test("INJ-04: BUN_OPTIONS reaches Bun, which is why the grammar denies it", () => {
  const dir = makeAttackerDir([]);
  const attack = runLiteral(
    dir,
    envFor({ BUN_OPTIONS: `--preload=${join(dir, "evil-preload.ts")}` }),
  );
  expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
  expect(pwned(dir)).toBe(true);
});

// --- INJ-05: the grammar accepts exactly the two invocation forms ---

const LITERAL = LITERAL_BUN_RUN;
const GRAMMAR_CWD = REPO_ROOT;
const SCRIPT_DIR = dirname(SKILL_PATH);
const RELATIVE_SCRIPT = relative(GRAMMAR_CWD, SKILL_PATH);

// A spelling that looks like a flag but resolves to the granted script, so a
// missing dash guard would approve it instead of failing on a missing file.
const DASH_ROOT = scratchDir("inj-dash-");
mkdirSync(join(DASH_ROOT, "-p"), { recursive: true });
symlinkSync(SKILL_PATH, join(DASH_ROOT, "-p", "report.ts"));

interface Scenario {
  name: string;
  command: string;
  cwd?: string;
}

/** The literal form with `flag` inserted inside the prefix. */
function flagInside(flag: string): string {
  return [LITERAL[0], LITERAL[1], flag, ...LITERAL.slice(2), SKILL_PATH].join(" ");
}

/** The literal form with `flag` between the prefix and the spelling. */
function flagAfter(flag: string): string {
  return [...LITERAL, flag, SKILL_PATH].join(" ");
}

/** The literal form with the prefix element at `index` swapped with a neighbour. */
function reordered(index: number): string {
  const target = index === LITERAL.length - 1 ? index - 1 : index + 1;
  const prefix = [...LITERAL];
  [prefix[index], prefix[target]] = [prefix[target], prefix[index]];
  return [...prefix, SKILL_PATH].join(" ");
}

/** The literal form with the prefix element at `index` removed. */
function without(index: number): string {
  return [...LITERAL.filter((_, at) => at !== index), SKILL_PATH].join(" ");
}

/** The literal form with the prefix element at `index` replaced by `replacement`. */
function replaced(index: number, replacement: string): string {
  return LITERAL.map((token, at) => (at === index ? replacement : token)).concat(SKILL_PATH).join(
    " ",
  );
}

const ACCEPTED: readonly Scenario[] = [
  { name: "the absolute path", command: SKILL_PATH },
  { name: "the absolute path with skill arguments", command: `${SKILL_PATH} --flag v` },
  { name: "a relative path with a slash", command: RELATIVE_SCRIPT },
  { name: "a relative path with skill arguments", command: `${RELATIVE_SCRIPT} --flag v` },
  { name: "the literal form with the absolute path", command: [...LITERAL, SKILL_PATH].join(" ") },
  {
    name: "the literal form with the absolute path and arguments",
    command: [...LITERAL, SKILL_PATH, "--flag", "v"].join(" "),
  },
  {
    name: "the literal form with a relative path",
    command: [...LITERAL, RELATIVE_SCRIPT].join(" "),
  },
  {
    name: "the literal form with a relative path and arguments",
    command: [...LITERAL, RELATIVE_SCRIPT, "--flag", "v"].join(" "),
  },
  { name: "a quoted absolute path", command: `"${SKILL_PATH}"` },
  { name: "a tolerated fd redirect", command: `${SKILL_PATH} --flag v 2>&1` },
  { name: "a quoted skill argument", command: `${SKILL_PATH} --flag="a b"` },
];

const DENIED: readonly Scenario[] = [
  { name: "a flag inside the prefix (--preload)", command: flagInside("--preload=/tmp/e.ts") },
  { name: "a flag inside the prefix (--require)", command: flagInside("--require=/tmp/e.ts") },
  { name: "a flag inside the prefix (--import)", command: flagInside("--import=/tmp/e.ts") },
  { name: "a flag inside the prefix (--inspect)", command: flagInside("--inspect=127.0.0.1:9229") },
  { name: "a flag inside the prefix (--env-file)", command: flagInside("--env-file=/tmp/e.env") },
  { name: "a flag inside the prefix (--cwd)", command: flagInside("--cwd=/tmp") },
  {
    name: "a flag inside the prefix (--tsconfig-override)",
    command: flagInside("--tsconfig-override=/tmp/tsconfig.json"),
  },
  {
    name: "a flag between the prefix and the script (--preload)",
    command: flagAfter("--preload=/tmp/e.ts"),
  },
  { name: "a flag between the prefix and the script (--cwd)", command: flagAfter("--cwd=/tmp") },
  { name: "a different --config", command: replaced(4, "--config=/tmp/attacker-bunfig.toml") },
  { name: "a replaced bun", command: replaced(0, "bunx") },
  { name: "a replaced run", command: replaced(1, "x") },
  { name: "a replaced --no-env-file", command: replaced(2, "--env-file=.env") },
  { name: "a replaced --no-install", command: replaced(3, "--install") },
  ...LITERAL.map((_, index) => ({
    name: `a removal of prefix element ${index}`,
    command: without(index),
  })),
  ...LITERAL.map((_, index) => ({
    name: `a reorder of prefix element ${index}`,
    command: reordered(index),
  })),
  { name: "bunx", command: `bunx ${SKILL_PATH}` },
  { name: "bun x", command: `bun x ${SKILL_PATH}` },
  { name: "deno run", command: `deno run ${SKILL_PATH}` },
  { name: "a script that is not granted", command: "src/acp/command-syntax.ts" },
  {
    name: "a slashless script in the literal form",
    command: [...LITERAL, "report.ts"].join(" "),
    cwd: SCRIPT_DIR,
  },
  { name: "a slashless script executed directly", command: "report.ts", cwd: SCRIPT_DIR },
  { name: "the literal prefix without a script", command: LITERAL.join(" ") },
  { name: "a command holding only an fd redirect", command: "2>&1" },
  {
    name: "a dash-prefixed script spelling",
    command: [...LITERAL, "-p/report.ts"].join(" "),
    cwd: DASH_ROOT,
  },
  { name: "a NUL byte in the spelling", command: `${SKILL_PATH}\u0000` },
  { name: "a shell operator", command: `${SKILL_PATH} --flag v; id` },
  { name: "a shell pipe", command: `${SKILL_PATH} | tee /tmp/out` },
];

for (const scenario of ACCEPTED) {
  test(`INJ-05: the grammar accepts ${scenario.name}`, () => {
    expect(
      matchScriptEntrypoint(scenario.command, INVENTORY, {
        sessionCwd: scenario.cwd ?? GRAMMAR_CWD,
      }),
    ).toBeDefined();
  });
}

for (const scenario of DENIED) {
  test(`INJ-05: the grammar denies ${scenario.name}`, () => {
    expect(
      matchScriptEntrypoint(scenario.command, INVENTORY, {
        sessionCwd: scenario.cwd ?? GRAMMAR_CWD,
      }),
    ).toBeUndefined();
  });
}

// Shell expansions are denied by the shared decoder. The literal
// `$AIR_POC_UNSET` directory makes the denial attributable to the expansion
// check: without it, the path would resolve to the granted script.

const UNKNOWN_VAR_CWD = scratchDir("inj-var-");
mkdirSync(join(UNKNOWN_VAR_CWD, "$AIR_POC_UNSET"), { recursive: true });
symlinkSync(SKILL_PATH, join(UNKNOWN_VAR_CWD, "$AIR_POC_UNSET", "report.ts"));
const KNOWN_VAR_CWD = scratchDir("inj-known-var-");
mkdirSync(join(KNOWN_VAR_CWD, "$HOME"), { recursive: true });
symlinkSync(SKILL_PATH, join(KNOWN_VAR_CWD, "$HOME", "report.ts"));

test("INJ-05: the grammar denies a shell expansion", () => {
  expect(
    matchScriptEntrypoint("$AIR_POC_UNSET/report.ts", INVENTORY, {
      sessionCwd: UNKNOWN_VAR_CWD,
    }),
  ).toBeUndefined();
  expect(
    matchScriptEntrypoint("${AIR_POC_UNSET}/report.ts", INVENTORY, {
      sessionCwd: UNKNOWN_VAR_CWD,
    }),
  ).toBeUndefined();
  expect(
    matchScriptEntrypoint("$AIR_POC_UNSET/report.ts --flag v", INVENTORY, {
      sessionCwd: UNKNOWN_VAR_CWD,
    }),
  ).toBeUndefined();
});

test("INJ-05: a known environment reference is decoded literally, not expanded", () => {
  // `$HOME` is a harness-known reference the shared decoder accepts; this
  // matcher never expands it, so the literal `$HOME` directory is what the
  // kernel traversal observes. Recorded as a fact, not a grant mechanism.
  expect(
    matchScriptEntrypoint("$HOME/report.ts", INVENTORY, {
      sessionCwd: KNOWN_VAR_CWD,
    }),
  ).toBeDefined();
});

// An ambiguous `..` spelling that physically reaches a granted script through a
// symlink, while its lexical target is a different path, must be denied.

const PARENT_ROOT = scratchDir("inj-parent-");
const PARENT_GRANT = join(PARENT_ROOT, "scripts", "x.ts");
mkdirSync(join(PARENT_ROOT, "scripts"), { recursive: true });
writeFileSync(PARENT_GRANT, 'console.log("grant");\n');
mkdirSync(join(PARENT_ROOT, "w"), { recursive: true });
symlinkSync(join(PARENT_ROOT, "scripts"), join(PARENT_ROOT, "w", "jump"));
const parentStat = statSync(PARENT_GRANT);
const parentRootStat = statSync(PARENT_ROOT);
const PARENT_LIST: SkillAutoApproveList = {
  root: {
    root: PARENT_ROOT,
    canonicalPath: PARENT_ROOT,
    identity: {
      dev: parentRootStat.dev,
      ino: parentRootStat.ino,
      ctimeMs: Math.floor(parentRootStat.ctimeMs / 1000) * 1000,
      size: parentRootStat.size,
    },
  },
  scripts: [{
    skillName: "parent",
    canonicalPath: PARENT_GRANT,
    dev: parentStat.dev,
    ino: parentStat.ino,
    ctimeMs: Math.floor(parentStat.ctimeMs / 1000) * 1000,
    size: parentStat.size,
  }],
  commandPrefixes: new Set<string>(),
};

test("INJ-05: a symlinked path without an ambiguous parent still matches", () => {
  expect(matchScriptEntrypoint("w/jump/x.ts", PARENT_LIST, { sessionCwd: PARENT_ROOT }))
    .toBeDefined();
});

test("INJ-05: a symlink-free parent spelling still matches", () => {
  expect(
    matchScriptEntrypoint("scripts/../scripts/x.ts", PARENT_LIST, {
      sessionCwd: PARENT_ROOT,
    }),
  ).toBeDefined();
});

test("INJ-05: the grammar denies an ambiguous parent spelling", () => {
  expect(
    matchScriptEntrypoint("w/jump/../scripts/x.ts", PARENT_LIST, {
      sessionCwd: PARENT_ROOT,
    }),
  ).toBeUndefined();
});

// --- INJ-06: the trusted config file's shape ---

test.skipIf(!existsSync(CONFIG_PATH))(
  "INJ-06: the trusted config file is empty, root-owned and read-only",
  () => {
    const list = statSync(CONFIG_PATH);
    expect(list.size).toBe(0);
    expect(list.uid).toBe(0);
    // The container process is UID 0 in its user namespace, so it can bypass
    // the read-only mode; the installed mode is the property to assert.
    expect(list.mode & 0o222).toBe(0);
    expect(list.mode & 0o777).toBe(0o444);
  },
);

/** Whether this process can make the trusted config absent and restore it. */
function canManageTrustedConfig(): boolean {
  if (!existsSync(CONFIG_PATH)) return true;
  try {
    accessSync(dirname(CONFIG_PATH));
    return true;
  } catch {
    return false;
  }
}

/** The run environment: `PATH` and a fresh `HOME`. */
function noconfigEnv(): Record<string, string> {
  return { PATH: BASE_PATH, HOME: scratchDir("inj-noconfig-home-") };
}

/** The first non-empty stderr line, which carries Bun's error text. */
function firstStderrLine(stderr: string): string {
  for (const line of stderr.split("\n")) {
    if (line.trim() !== "") return line.trim();
  }
  return "";
}

// --- INJ-07: global config files change nothing ---

test("INJ-07: a .bunfig.toml in $HOME changes nothing", () => {
  const evil = makeAttackerDir([]);
  const home = scratchDir("inj-hostile-home-");
  writeFileSync(join(home, ".bunfig.toml"), `preload = ["${join(evil, "evil-preload.ts")}"]\n`);
  compareAttack(evil, { attack: { HOME: home } });
  expect(pwned(evil)).toBe(false);
});

test("INJ-07: a .bunfig.toml in $XDG_CONFIG_HOME changes nothing", () => {
  const evil = makeAttackerDir([]);
  const configHome = scratchDir("inj-hostile-xdg-");
  writeFileSync(
    join(configHome, ".bunfig.toml"),
    `preload = ["${join(evil, "evil-preload.ts")}"]\n`,
  );
  compareAttack(evil, { attack: { XDG_CONFIG_HOME: configHome } });
  expect(pwned(evil)).toBe(false);
});

// --- Exact Bun Skill Invocation Grammar (requirement scenarios) ---

const grammarCtx = { sessionCwd: GRAMMAR_CWD };

test("grammar - a plain bun run is denied", () => {
  expect(matchScriptEntrypoint(`bun run ${SKILL_PATH}`, INVENTORY, grammarCtx)).toBeUndefined();
});

test("grammar - every flag outside the literal prefix is denied", () => {
  for (
    const flag of [
      "--preload=./evil.ts",
      "--require",
      "--import=./evil.ts",
      "--inspect",
      "--env-file=.env",
      "--cwd=/tmp",
      "--tsconfig-override=/tmp/tsconfig.json",
    ]
  ) {
    expect(
      matchScriptEntrypoint(flagAfter(flag), INVENTORY, grammarCtx),
      `flag before the script: ${flag}`,
    ).toBeUndefined();
    expect(
      matchScriptEntrypoint(flagInside(flag), INVENTORY, grammarCtx),
      `flag inside the prefix: ${flag}`,
    ).toBeUndefined();
  }
});

test("grammar - other bun commands are denied by the gate itself", () => {
  expect(matchScriptEntrypoint("bun -e 'console.log(1)'", INVENTORY, grammarCtx)).toBeUndefined();
  expect(matchScriptEntrypoint("bun x cowsay", INVENTORY, grammarCtx)).toBeUndefined();
  // The literal prefix followed by a non-granted path is denied too.
  expect(
    matchScriptEntrypoint(`${LITERAL.join(" ")} ./workspace/evil.ts`, INVENTORY, grammarCtx),
  ).toBeUndefined();
});

test("grammar - a slashless script token is denied", () => {
  expect(
    matchScriptEntrypoint([...LITERAL, "memory-save.ts"].join(" "), INVENTORY, {
      sessionCwd: SCRIPT_DIR,
    }),
  ).toBeUndefined();
});

test("grammar - an environment prefix is denied", () => {
  expect(
    matchScriptEntrypoint(
      `BUN_OPTIONS=--preload=./evil.ts ${LITERAL.join(" ")} ${SKILL_PATH}`,
      INVENTORY,
      grammarCtx,
    ),
  ).toBeUndefined();
});

// --- Trusted Skills Ignore Working-Directory Configuration (scenarios) ---

test("working-directory config - an attacker directory changes nothing", () => {
  const dir = makeAttackerDir(["dotenv", "bunfig", "project"]);
  const comparisons = compareAttack(dir);
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"attackerEnv":[]');
    expect(comparison.attack.stdout).toContain('"bare":"absent"');
    expect(comparison.attack.stdout).toContain('"helper":"HELPER-OK"');
  }
  expect(pwned(dir)).toBe(false);
});

test.skipIf(!canManageTrustedConfig())(
  "working-directory config - a missing trusted config stops the skill before it runs",
  () => {
    const dir = makeAttackerDir(["bunfig"]);
    const configWasAbsent = !existsSync(CONFIG_PATH);
    if (!configWasAbsent) renameSync(CONFIG_PATH, CONFIG_BACKUP);
    try {
      const runs = [
        { form: "direct", result: runDirect(dir, noconfigEnv()) },
        { form: "literal", result: runLiteral(dir, noconfigEnv()) },
      ];
      for (const { form, result } of runs) {
        expect(result.exitCode, `${form}: exits non-zero`).toBeGreaterThan(0);
        expect(result.stdout, `${form}: must not run the skill body`).not.toContain("SKILL-RAN");
        expect(firstStderrLine(result.stderr), `${form}: Bun reports the missing config`)
          .not.toBe("");
      }
      expect(pwned(dir)).toBe(false);
    } finally {
      if (!configWasAbsent) renameSync(CONFIG_BACKUP, CONFIG_PATH);
    }
  },
);
