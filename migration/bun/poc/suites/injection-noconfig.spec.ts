/**
 * Missing trusted config suite: records what the pinned Bun does when the
 * hardened shebang points at an absent `--config` file, and turns that fact
 * into a result (design D4, criterion INJ-08). The run mounts an empty tmpfs
 * on `/opt/air`, so the image stays the same and only the config disappears.
 */
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observe } from "../gate/evidence.ts";
import { makeAttackerDir, pwned, runDirect, runLiteral, SKILL_PATH } from "../injection/attacker-dir.ts";

const CONFIG_PATH = "/opt/air/skill-bunfig.toml";
const BASE_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
const LAUNCHER = join(import.meta.dir, "..", "injection", "skill-launcher.sh");

const scratch: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The run environment: `PATH` and a fresh `HOME`. */
function env(): Record<string, string> {
  return { PATH: BASE_PATH, HOME: scratchDir("inj-noconfig-home-") };
}

/** The first non-empty stderr line, which carries Bun's error text. */
function firstStderrLine(stderr: string): string {
  for (const line of stderr.split("\n")) {
    if (line.trim() !== "") return line.trim();
  }
  return "";
}

test("INJ-08: the trusted config file is absent from this run", () => {
  expect(existsSync(CONFIG_PATH)).toBe(false);
});

test("INJ-08: an absent trusted config stops the skill before any attacker code runs", () => {
  // A run that still has the file would prove nothing, so it cannot pass here.
  expect(existsSync(CONFIG_PATH)).toBe(false);
  const dir = makeAttackerDir(["bunfig"]);
  scratch.push(dir);
  const runs = [
    { form: "direct", result: runDirect(dir, env()) },
    { form: "literal", result: runLiteral(dir, env()) },
  ];
  observe("missingConfigExit", runs.map(({ result }) => result.exitCode));
  observe("missingConfigStderr", runs.map(({ result }) => firstStderrLine(result.stderr)));
  // A diagnostic failure (the binary could not be spawned, empty stderr) is not
  // Bun stopping, so it cannot classify as `fail-stop`.
  const stopped = runs.every(({ result }) =>
    result.exitCode > 0 &&
    firstStderrLine(result.stderr) !== "" &&
    !result.stdout.includes("SKILL-RAN") &&
    !pwned(dir)
  );
  const behavior = stopped ? "fail-stop" : "fallback";
  observe("missingConfigBehavior", behavior);

  if (behavior === "fail-stop") {
    expect(stopped).toBe(true);
    expect(pwned(dir)).toBe(false);
    return;
  }

  // Bun fell back to discovery, so the direct form needs a launcher to stop
  // before Bun starts; the literal form is typed by the agent and stays open.
  expect(existsSync(LAUNCHER)).toBe(true);
  const launcherDir = makeAttackerDir(["bunfig"]);
  scratch.push(launcherDir);
  const viaLauncher = spawnSync(LAUNCHER, [SKILL_PATH, "--flag", "v"], {
    cwd: launcherDir,
    env: env(),
    encoding: "utf8",
  });
  expect(viaLauncher.status).toBe(78);
  expect(viaLauncher.stdout).not.toContain("SKILL-RAN");
  expect(pwned(launcherDir)).toBe(false);
  observe("literalFormUnprotected", true);
});
