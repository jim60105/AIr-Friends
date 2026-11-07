/**
 * Injection defense suite: proves that the hardened skill invocation is immune
 * to an attacker-writable working directory, home directory and environment,
 * and that the exact approval grammar accepts only the two invocation forms
 * (design D4). Each test title starts with the criterion ID the gate matches.
 */
import { afterAll, expect, test } from "bun:test";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { observe } from "../gate/evidence.ts";
import { matchTrustedInvocation } from "../injection/approval-grammar.ts";
import {
  LITERAL_BUN_RUN,
  makeAttackerDir,
  pwned,
  runDirect,
  runLiteral,
  runPlain,
  SKILL_PATH,
  type AttackFile,
  type SkillRun,
} from "../injection/attacker-dir.ts";

const BASE_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
const FORMS = [
  { form: "direct", run: runDirect },
  { form: "literal", run: runLiteral },
] as const;

/** Everything a test creates, removed once the suite ends. */
const scratch: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function attackDir(files: readonly AttackFile[]): string {
  const dir = makeAttackerDir(files);
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The explicit run environment: `PATH`, a fresh `HOME`, then the overrides. */
function envFor(overrides: Record<string, string> = {}): Record<string, string> {
  return { PATH: BASE_PATH, HOME: scratchDir("inj-home-"), ...overrides };
}

/** `relative(cwd, SKILL_PATH)`, prefixed with `./` when it has no leading dot. */
function relativeSpelling(cwd: string): string {
  const spelled = relative(cwd, SKILL_PATH);
  return spelled.startsWith(".") ? spelled : `./${spelled}`;
}

interface Comparison {
  form: string;
  spelling: string;
  attack: SkillRun;
  control: SkillRun;
}

/**
 * Runs both invocation forms, with the absolute and the working-directory
 * relative spelling, from the attack directory and from an empty control
 * directory, and asserts the attack run is indistinguishable from the control.
 */
function compareAttack(
  attackCwd: string,
  env: { attack?: Record<string, string>; control?: Record<string, string> } = {},
): Comparison[] {
  const comparisons: Comparison[] = [];
  for (const { form, run } of FORMS) {
    for (const spelling of [SKILL_PATH, relativeSpelling(attackCwd)]) {
      const controlDir = scratchDir("inj-control-");
      const control = run(controlDir, envFor(env.control), spelling);
      const attack = run(attackCwd, envFor(env.attack), spelling);
      expect(attack.exitCode).toBe(control.exitCode);
      expect(attack.stdout).toBe(control.stdout);
      expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
      expect(pwned(attackCwd)).toBe(false);
      expect(pwned(controlDir)).toBe(false);
      comparisons.push({ form, spelling, attack, control });
    }
  }
  return comparisons;
}

// --- INJ-01: environment files in the working directory change nothing ---

test("INJ-01: an unhardened bun run loads the attacker environment files", () => {
  const dir = attackDir(["dotenv"]);
  const control = runPlain(scratchDir("inj-control-"), envFor());
  const attack = runPlain(dir, envFor());
  expect(control.stdout).toContain('"marker":"SKILL-RAN"');
  expect(control.stdout).toContain('"attackerEnv":[]');
  expect(attack.stdout).toContain("AIR_POC_ATTACKER_ENV");
  expect(attack.stdout).toContain("AIR_POC_ATTACKER_LOCAL");
});

test("INJ-01: .env and .env.local in the working directory change nothing", () => {
  compareAttack(attackDir(["dotenv"]));
});

// --- INJ-02: a config preload in the working directory never runs ---

test("INJ-02: an unhardened bun run executes the working-directory preload", () => {
  const dir = attackDir(["bunfig"]);
  const attack = runPlain(dir, envFor());
  expect(attack.stdout).toContain("EVIL");
  expect(pwned(dir)).toBe(true);
  rmSync(join(dir, "PWNED"), { force: true });
  expect(pwned(dir)).toBe(false);
});

test("INJ-02: a bunfig.toml in the working directory changes nothing", () => {
  compareAttack(attackDir(["bunfig"]));
});

// --- INJ-03: project files and a symlinked spelling change nothing ---

test("INJ-03: tsconfig.json, package.json and node_modules change nothing", () => {
  const dir = attackDir(["project"]);
  const comparisons = compareAttack(dir);
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"bare":"absent"');
    expect(comparison.control.stdout).toContain('"bare":"absent"');
  }
});

test("INJ-03: a symlinked spelling beside an attacker helper changes nothing", () => {
  const dir = attackDir(["symlink"]);
  const baseline = runDirect(scratchDir("inj-control-"), envFor(), SKILL_PATH);
  expect(baseline.stdout).toContain('"marker":"SKILL-RAN"');
  for (const { run } of FORMS) {
    const attack = run(dir, envFor(), "./report.ts");
    expect(attack.exitCode).toBe(baseline.exitCode);
    expect(attack.stdout).toBe(baseline.stdout);
    expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
    expect(pwned(dir)).toBe(false);
  }
});

// --- INJ-04: an environment prefix is denied, and is the defence's job ---

test("INJ-04: the grammar denies a BUN_OPTIONS command prefix", () => {
  const grants = new Set([SKILL_PATH]);
  const literal = LITERAL_BUN_RUN.join(" ");
  expect(matchTrustedInvocation(`BUN_OPTIONS=--preload=/tmp/e.ts ${SKILL_PATH}`, grants, "/repo"))
    .toBeUndefined();
  expect(matchTrustedInvocation(`BUN_OPTIONS="--preload /tmp/e.ts" ${literal} ${SKILL_PATH}`, grants, "/repo"))
    .toBeUndefined();
  expect(matchTrustedInvocation(`env BUN_OPTIONS=x ${SKILL_PATH}`, grants, "/repo")).toBeUndefined();
});

test("INJ-04: BUN_OPTIONS reaches Bun, which is why the grammar denies it", () => {
  const dir = attackDir([]);
  const attack = runLiteral(dir, envFor({ BUN_OPTIONS: `--preload=${join(dir, "evil-preload.ts")}` }));
  observe("bunOptionsEffective", pwned(dir));
  expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
});

// --- INJ-05: the grammar accepts exactly the two invocation forms ---

const GRANTS = new Set([SKILL_PATH]);
const GRAMMAR_CWD = "/repo";
const RELATIVE_SCRIPT = "migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts";
const LITERAL = LITERAL_BUN_RUN;

/** The literal form with one extra token inserted inside the prefix. */
function withFlag(flag: string): string {
  return [LITERAL[0], LITERAL[1], flag, ...LITERAL.slice(2), SKILL_PATH].join(" ");
}

/** The literal form with the prefix element at `index` moved one place later. */
function reordered(index: number): string {
  const prefix = [...LITERAL];
  const target = (index + 1) % prefix.length;
  [prefix[index], prefix[target]] = [prefix[target], prefix[index]];
  return [...prefix, SKILL_PATH].join(" ");
}

/** The literal form with the prefix element at `index` removed. */
function without(index: number): string {
  return [...LITERAL.filter((_, at) => at !== index), SKILL_PATH].join(" ");
}

const ACCEPTED: readonly { name: string; command: string }[] = [
  { name: "the absolute path", command: SKILL_PATH },
  { name: "the absolute path with skill arguments", command: `${SKILL_PATH} --flag v` },
  { name: "a relative path with a slash", command: RELATIVE_SCRIPT },
  { name: "a relative path with skill arguments", command: `${RELATIVE_SCRIPT} --flag v` },
  { name: "the literal form with the absolute path", command: [...LITERAL, SKILL_PATH].join(" ") },
  {
    name: "the literal form with the absolute path and arguments",
    command: [...LITERAL, SKILL_PATH, "--flag", "v"].join(" "),
  },
  { name: "the literal form with a relative path", command: [...LITERAL, RELATIVE_SCRIPT].join(" ") },
  { name: "a quoted absolute path", command: `"${SKILL_PATH}"` },
  { name: "a tolerated fd redirect", command: `${SKILL_PATH} --flag v 2>&1` },
];

const DENIED: readonly { name: string; command: string }[] = [
  { name: "an added --preload", command: withFlag("--preload=/tmp/e.ts") },
  { name: "an added --require", command: withFlag("--require=/tmp/e.ts") },
  { name: "an added --import", command: withFlag("--import=/tmp/e.ts") },
  { name: "an added --inspect", command: withFlag("--inspect=127.0.0.1:9229") },
  { name: "an added --env-file", command: withFlag("--env-file=/tmp/e.env") },
  { name: "an added --cwd", command: withFlag("--cwd=/tmp") },
  { name: "an added --tsconfig-override", command: withFlag("--tsconfig-override=/tmp/tsconfig.json") },
  {
    name: "a different --config",
    command: [
      LITERAL[0],
      LITERAL[1],
      LITERAL[2],
      LITERAL[3],
      "--config=/tmp/attacker-bunfig.toml",
      SKILL_PATH,
    ].join(" "),
  },
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
  { name: "a script that is not granted", command: "/repo/src/acp/command-syntax.ts" },
  { name: "a slashless script in the literal form", command: [...LITERAL, "report.ts"].join(" ") },
  { name: "a shell operator", command: `${SKILL_PATH} --flag v; id` },
  { name: "a shell expansion", command: "$HOME/migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts" },
];

for (const scenario of ACCEPTED) {
  test(`INJ-05: the grammar accepts ${scenario.name}`, () => {
    expect(matchTrustedInvocation(scenario.command, GRANTS, GRAMMAR_CWD)).toBe(SKILL_PATH);
  });
}

for (const scenario of DENIED) {
  test(`INJ-05: the grammar denies ${scenario.name}`, () => {
    expect(matchTrustedInvocation(scenario.command, GRANTS, GRAMMAR_CWD)).toBeUndefined();
  });
}

// An ambiguous `..` spelling that physically reaches a granted script through a
// symlink, while its lexical target is a different path, must be denied.

const PARENT_ROOT = scratchDir("inj-parent-");
const PARENT_GRANT = join(PARENT_ROOT, "scripts", "x.ts");
mkdirSync(join(PARENT_ROOT, "scripts"), { recursive: true });
writeFileSync(PARENT_GRANT, 'console.log("grant");\n');
mkdirSync(join(PARENT_ROOT, "w"), { recursive: true });
symlinkSync(join(PARENT_ROOT, "scripts"), join(PARENT_ROOT, "w", "jump"));

test("INJ-05: a symlinked path without an ambiguous parent still matches", () => {
  expect(matchTrustedInvocation("w/jump/x.ts", new Set([PARENT_GRANT]), PARENT_ROOT))
    .toBe(PARENT_GRANT);
});

test("INJ-05: the grammar denies an ambiguous parent spelling", () => {
  expect(matchTrustedInvocation("w/jump/../jump/x.ts", new Set([PARENT_GRANT]), PARENT_ROOT))
    .toBeUndefined();
});

// --- INJ-06: the trusted config file's shape ---

test("INJ-06: the trusted config file is empty, root-owned and read-only", () => {
  const list = statSync("/opt/air/skill-bunfig.toml");
  expect(list.size).toBe(0);
  expect(list.uid).toBe(0);
  expect(() => closeSync(openSync("/opt/air/skill-bunfig.toml", "a"))).toThrow(/EACCES/);
});

// --- INJ-07: global config files change nothing ---

test("INJ-07: a .bunfig.toml in $HOME changes nothing", () => {
  const evil = attackDir([]);
  const home = scratchDir("inj-hostile-home-");
  writeFileSync(join(home, ".bunfig.toml"), `preload = ["${join(evil, "evil-preload.ts")}"]\n`);
  compareAttack(scratchDir("inj-cwd-"), { attack: { HOME: home } });
  expect(pwned(evil)).toBe(false);
});

test("INJ-07: a .bunfig.toml in $XDG_CONFIG_HOME changes nothing", () => {
  const evil = attackDir([]);
  const configHome = scratchDir("inj-hostile-xdg-");
  writeFileSync(join(configHome, ".bunfig.toml"), `preload = ["${join(evil, "evil-preload.ts")}"]\n`);
  compareAttack(scratchDir("inj-cwd-"), { attack: { XDG_CONFIG_HOME: configHome } });
  expect(pwned(evil)).toBe(false);
});
