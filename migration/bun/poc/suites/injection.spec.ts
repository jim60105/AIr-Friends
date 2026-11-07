/**
 * Injection defense suite: proves that the hardened skill invocation is immune
 * to an attacker-writable working directory, home directory and environment,
 * and that the exact approval grammar accepts only the two invocation forms
 * (design D4). Each test title starts with the criterion ID the gate matches.
 */
import { afterAll, expect, test } from "bun:test";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
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

/** The run environment: `PATH`, a fresh `HOME`, then the caller's overrides. */
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
 * Runs both invocation forms, with the absolute path and the spelling relative
 * to each run's own working directory, from the attack directory and from an
 * empty control directory, and asserts the attack run is indistinguishable
 * from the control run. Every run must also have succeeded and parsed the skill
 * argument, so a uniformly broken invocation cannot pass as "equal".
 */
function compareAttack(
  attackCwd: string,
  env: { attack?: Record<string, string>; control?: Record<string, string> } = {},
): Comparison[] {
  const comparisons: Comparison[] = [];
  for (const { form, run } of FORMS) {
    for (const absolute of [true, false]) {
      const controlDir = scratchDir("inj-control-");
      const control = run(controlDir, envFor(env.control), absolute ? SKILL_PATH : relativeSpelling(controlDir));
      const attack = run(attackCwd, envFor(env.attack), absolute ? SKILL_PATH : relativeSpelling(attackCwd));
      expect(attack.exitCode).toBe(control.exitCode);
      expect(attack.stdout).toBe(control.stdout);
      expect(attack.exitCode).toBe(0);
      expect(attack.stdout).toContain('"marker":"SKILL-RAN"');
      expect(attack.stdout).toContain('"args":{"flag":"v"}');
      expect(attack.stdout).toContain('"helper":"HELPER-OK"');
      expect(pwned(attackCwd)).toBe(false);
      comparisons.push({ form, spelling: absolute ? SKILL_PATH : relativeSpelling(attackCwd), attack, control });
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
  const comparisons = compareAttack(attackDir(["dotenv"]));
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"attackerEnv":[]');
  }
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
  const comparisons = compareAttack(attackDir(["project"]));
  for (const comparison of comparisons) {
    expect(comparison.attack.stdout).toContain('"bare":"absent"');
    expect(comparison.control.stdout).toContain('"bare":"absent"');
  }
});

test("INJ-03: a symlinked spelling beside an attacker helper changes nothing", () => {
  // The symlinked spelling sits beside the project files, so a loader that
  // resolves relative to the spelling would find the attacker's `tsconfig.json`
  // and `node_modules` in the same directory.
  const dir = attackDir(["symlink", "project"]);
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

const LITERAL = LITERAL_BUN_RUN;
const GRANTS = new Set([SKILL_PATH]);
const GRAMMAR_CWD = "/repo";
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
  return LITERAL.map((token, at) => (at === index ? replacement : token)).concat(SKILL_PATH).join(" ");
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
  { name: "the literal form with a relative path", command: [...LITERAL, RELATIVE_SCRIPT].join(" ") },
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
  { name: "a flag between the prefix and the script (--preload)", command: flagAfter("--preload=/tmp/e.ts") },
  { name: "a flag between the prefix and the script (--cwd)", command: flagAfter("--cwd=/tmp") },
  { name: "a different --config", command: replaced(4, "--config=/tmp/attacker-bunfig.toml") },
  { name: "a replaced bun", command: replaced(0, "bunx") },
  { name: "a replaced run", command: replaced(1, "x") },
  { name: "a replaced --no-env-file", command: replaced(2, "--env-file=.env") },
  { name: "a replaced --no-install", command: replaced(3, "--install") },
  ...LITERAL.map((_, index) => ({ name: `a removal of prefix element ${index}`, command: without(index) })),
  ...LITERAL.map((_, index) => ({ name: `a reorder of prefix element ${index}`, command: reordered(index) })),
  { name: "bunx", command: `bunx ${SKILL_PATH}` },
  { name: "bun x", command: `bun x ${SKILL_PATH}` },
  { name: "deno run", command: `deno run ${SKILL_PATH}` },
  { name: "a script that is not granted", command: "/repo/src/acp/command-syntax.ts" },
  { name: "a slashless script in the literal form", command: [...LITERAL, "report.ts"].join(" "), cwd: SCRIPT_DIR },
  { name: "a slashless script executed directly", command: "report.ts", cwd: SCRIPT_DIR },
  { name: "the literal prefix without a script", command: LITERAL.join(" ") },
  { name: "a command holding only an fd redirect", command: "2>&1" },
  { name: "a dash-prefixed script spelling", command: [...LITERAL, "-p/report.ts"].join(" "), cwd: DASH_ROOT },
  { name: "a NUL byte in the spelling", command: `${SKILL_PATH}\u0000` },
  { name: "a shell operator", command: `${SKILL_PATH} --flag v; id` },
  { name: "a shell pipe", command: `${SKILL_PATH} | tee /tmp/out` },
];

for (const scenario of ACCEPTED) {
  test(`INJ-05: the grammar accepts ${scenario.name}`, () => {
    expect(matchTrustedInvocation(scenario.command, GRANTS, scenario.cwd ?? GRAMMAR_CWD)).toBe(SKILL_PATH);
  });
}

for (const scenario of DENIED) {
  test(`INJ-05: the grammar denies ${scenario.name}`, () => {
    expect(matchTrustedInvocation(scenario.command, GRANTS, scenario.cwd ?? GRAMMAR_CWD)).toBeUndefined();
  });
}

// Shell expansions are denied by the shared decoder, whose known-reference
// exemption is recorded as a fact for the production change instead of being
// asserted here. The literal `$AIR_POC_UNSET` directory makes the denial
// attributable to the expansion check: without it, the path would resolve to
// the granted script.

const UNKNOWN_VAR_CWD = scratchDir("inj-var-");
mkdirSync(join(UNKNOWN_VAR_CWD, "$AIR_POC_UNSET"), { recursive: true });
symlinkSync(SKILL_PATH, join(UNKNOWN_VAR_CWD, "$AIR_POC_UNSET", "report.ts"));
const KNOWN_VAR_CWD = scratchDir("inj-known-var-");
mkdirSync(join(KNOWN_VAR_CWD, "$HOME"), { recursive: true });
symlinkSync(SKILL_PATH, join(KNOWN_VAR_CWD, "$HOME", "report.ts"));

test("INJ-05: the grammar denies a shell expansion", () => {
  expect(matchTrustedInvocation("$AIR_POC_UNSET/report.ts", GRANTS, UNKNOWN_VAR_CWD)).toBeUndefined();
  expect(matchTrustedInvocation("${AIR_POC_UNSET}/report.ts", GRANTS, UNKNOWN_VAR_CWD)).toBeUndefined();
  expect(matchTrustedInvocation("$AIR_POC_UNSET/report.ts --flag v", GRANTS, UNKNOWN_VAR_CWD)).toBeUndefined();
  observe(
    "knownEnvReferenceExempt",
    matchTrustedInvocation("$HOME/report.ts", GRANTS, KNOWN_VAR_CWD) !== undefined,
  );
});

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

test("INJ-05: a symlink-free parent spelling still matches", () => {
  expect(matchTrustedInvocation("scripts/../scripts/x.ts", new Set([PARENT_GRANT]), PARENT_ROOT))
    .toBe(PARENT_GRANT);
});

test("INJ-05: the grammar denies an ambiguous parent spelling", () => {
  expect(matchTrustedInvocation("w/jump/../scripts/x.ts", new Set([PARENT_GRANT]), PARENT_ROOT))
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
  compareAttack(evil, { attack: { HOME: home } });
  expect(pwned(evil)).toBe(false);
});

test("INJ-07: a .bunfig.toml in $XDG_CONFIG_HOME changes nothing", () => {
  const evil = attackDir([]);
  const configHome = scratchDir("inj-hostile-xdg-");
  writeFileSync(join(configHome, ".bunfig.toml"), `preload = ["${join(evil, "evil-preload.ts")}"]\n`);
  compareAttack(evil, { attack: { XDG_CONFIG_HOME: configHome } });
  expect(pwned(evil)).toBe(false);
});
