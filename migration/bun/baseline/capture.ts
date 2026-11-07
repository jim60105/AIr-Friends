import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCoverageTable, parseDenoJunit } from "./junit.ts";
import type { BaselineSummary, BaselineTest, DenoTestRecord } from "./records-schema.ts";

const repoRoot = resolve(import.meta.dir, "../../..");
const recordsDir = join(import.meta.dir, "records");
const MAX_BUFFER = 64 * 1024 * 1024;

// D3: `tests/` is passed explicitly so the run ignores `test-repo/`, `build/` and
// `.worktrees/`. `<tmp>` is substituted with the run's temporary directory; it stays
// a placeholder in `baseline.json` so a re-capture produces a clean diff.
const DENO_TEST_ARGS = [
  "test",
  "--allow-net",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
  "--coverage=<tmp>/cov",
  "--junit-path=<tmp>/junit.xml",
  "tests/",
];

export interface FreezeDecision {
  ok: boolean;
  exitCode: 0 | 2;
  reasons: string[];
}

/** Refuses capture unless `master` is the freeze point and no recorded source drifted. */
export function decideFreeze(
  masterSha: string,
  mergeBase: string,
  driftedPaths: string[],
): FreezeDecision {
  const reasons: string[] = [];
  if (masterSha !== mergeBase) {
    reasons.push(
      `master ${masterSha} has commits that are not the merge base ${mergeBase}; merge master into this branch before capturing`,
    );
  }
  for (const path of driftedPaths) {
    reasons.push(`drifted from the freeze point ${mergeBase}: ${path}`);
  }
  return { ok: reasons.length === 0, exitCode: reasons.length === 0 ? 0 : 2, reasons };
}

/** A missing JUnit file is the only capture failure; a non-zero test exit is data. */
export function decideCapture(junitExists: boolean): "write" | "abort" {
  return junitExists ? "write" : "abort";
}

/** Counts test entries into the summary `totals`, including failures. */
export function summarizeTests(tests: BaselineTest[]): BaselineSummary["totals"] {
  return {
    tests: tests.length,
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    ignored: tests.filter((test) => test.status === "ignored").length,
  };
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").trimEnd();
}

/**
 * Extracts paths from `git status --porcelain`. The output is never trimmed on the
 * left: an unstaged ` M path` line starts with a space that belongs to its status.
 */
function porcelainPaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const raw = line.slice(3);
      if (raw.startsWith('"') && raw.endsWith('"')) {
        try {
          return JSON.parse(raw) as string;
        } catch {
          return raw;
        }
      }
      return raw;
    });
}

function runDeno(args: string[], env: NodeJS.ProcessEnv, stdio: "inherit" | "pipe") {
  return spawnSync("deno", args, {
    cwd: repoRoot,
    env,
    stdio,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
}

/** Removes comments outside strings; `deno.json` is JSON with comments. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        index++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      out += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
      index++;
      continue;
    }
    out += char;
  }
  return out;
}

/** Reads `version` from a `deno.json` that may carry comments. */
export function parseAppVersion(manifestText: string): string {
  const manifest: unknown = JSON.parse(stripJsonComments(manifestText));
  if (!manifest || typeof manifest !== "object" || !("version" in manifest)) {
    throw new Error("deno.json has no version");
  }
  return String(manifest.version);
}

function main(): number {
  const masterSha = git(["rev-parse", "master"]);
  const mergeBase = git(["merge-base", "master", "HEAD"]);
  const branchHead = git(["rev-parse", "HEAD"]);

  const driftedPaths = [
    ...new Set([
      ...git(["diff", "--name-only", mergeBase, "HEAD", "--", "src", "tests", "deno.json", "deno.lock"])
        .split("\n")
        .filter((path) => path !== ""),
      ...porcelainPaths(
        git(["status", "--porcelain", "--no-renames", "-uall", "--", "src", "tests", "deno.json", "deno.lock"]),
      ),
    ]),
  ];

  const decision = decideFreeze(masterSha, mergeBase, driftedPaths);
  if (!decision.ok) {
    for (const reason of decision.reasons) console.error(reason);
    console.error("capture refused");
    return decision.exitCode;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "air-friends-baseline-"));
  const env = { ...process.env, NO_COLOR: "1" };
  try {
    const coverageDir = join(tmpDir, "cov");
    const junitPath = join(tmpDir, "junit.xml");
    const denoTestArgs = DENO_TEST_ARGS.map((arg) =>
      arg.replace("<tmp>", tmpDir)
    );

    console.log(`running deno ${denoTestArgs.join(" ")}`);
    // `stdio: "inherit"`: the suite runs for minutes and its output is not parsed.
    const testRun = runDeno(denoTestArgs, env, "inherit");
    console.log(`deno test exited with status ${String(testRun.status)}`);

    if (decideCapture(existsSync(junitPath)) === "abort") {
      console.error(`no JUnit output at ${junitPath}`);
      return 3;
    }

    const coverageRun = runDeno(["coverage", coverageDir, "--exclude=tests/"], env, "pipe");
    if (coverageRun.status !== 0) {
      throw new Error(`deno coverage failed: ${(coverageRun.stderr ?? "").trim()}`);
    }

    const tests = parseDenoJunit(readFileSync(junitPath, "utf8"));
    const coverage = parseCoverageTable(coverageRun.stdout ?? "");
    const denoVersionRun = runDeno(["--version"], env, "pipe");
    const denoVersion = (denoVersionRun.stdout ?? "").split("\n")[0] ?? "";
    const appVersion = parseAppVersion(readFileSync(join(repoRoot, "deno.json"), "utf8"));

    const testRecord: DenoTestRecord = { schemaVersion: 1, tests };
    const baseline: BaselineSummary = {
      schemaVersion: 1,
      freezeSha: mergeBase,
      branchHead,
      capturedAt: new Date().toISOString(),
      denoVersion,
      appVersion,
      command: DENO_TEST_ARGS,
      totals: summarizeTests(tests),
      coverage,
    };

    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, "deno-tests.json"), `${JSON.stringify(testRecord, null, 2)}\n`);
    writeFileSync(join(recordsDir, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `wrote ${testRecord.tests.length} tests (${baseline.totals.failed} failed) and coverage branch ${coverage.branchPercent}%`,
    );
    return 0;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(main());
}
