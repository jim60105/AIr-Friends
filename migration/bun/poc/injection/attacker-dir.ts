/**
 * Attacker-controlled working directories and invocation helpers for the
 * injection suites (design D2).
 *
 * Every directory is a fresh `mkdtemp` under `/tmp` holding the files an agent
 * that can write its workspace would plant: environment files, a config
 * preload, project files that redirect a bare import, and a symlinked spelling
 * of the trusted script beside an attacker helper. Each run gets an explicit
 * environment of `PATH` and `HOME` only, so nothing leaks in from the suite.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The trusted script as the image copies it into `/repo`. */
export const SKILL_PATH = "/repo/migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts";

/** The exact literal prefix the approval grammar accepts before the script. */
export const LITERAL_BUN_RUN = [
  "bun",
  "run",
  "--no-env-file",
  "--no-install",
  "--config=/opt/air/skill-bunfig.toml",
] as const;

export type AttackFile = "dotenv" | "bunfig" | "project" | "symlink";

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

export interface SkillRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Creates an attacker directory holding `evil-preload.ts` plus the files of
 * each requested vector. The caller owns the directory.
 */
export function makeAttackerDir(files: readonly AttackFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "inj-attack-"));
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
          `${JSON.stringify({
            compilerOptions: { paths: { "poc-bare-probe": ["./evil-preload.ts"] } },
          }, null, 2)}\n`,
        );
        writeFileSync(
          join(dir, "package.json"),
          `${JSON.stringify({
            name: "poc-attacker",
            type: "module",
            scripts: { "report.ts": "touch PWNED" },
          }, null, 2)}\n`,
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
export function pwned(dir: string): boolean {
  return existsSync(join(dir, "PWNED"));
}

const DEFAULT_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

/** The explicit environment every run gets; `HOME` is always caller-supplied. */
function baseEnv(env: Record<string, string>): Record<string, string> {
  return { PATH: DEFAULT_PATH, ...env };
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): SkillRun {
  const result = spawnSync(command, args, { cwd, env: baseEnv(env), encoding: "utf8" });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Executes the script path itself, so the kernel honours its hardened shebang. */
export function runDirect(
  cwd: string,
  env: Record<string, string>,
  path: string = SKILL_PATH,
): SkillRun {
  return run(path, ["--flag", "v"], cwd, env);
}

/** Executes the literal `bun run` form; only `bun` itself is unhardened here. */
export function runLiteral(
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
export function runPlain(
  cwd: string,
  env: Record<string, string>,
  path: string = SKILL_PATH,
): SkillRun {
  return run(LITERAL_BUN_RUN[0], ["run", path, "--flag", "v"], cwd, env);
}
