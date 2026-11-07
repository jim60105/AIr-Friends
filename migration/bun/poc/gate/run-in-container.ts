import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { machine, release } from "node:os";
import { join } from "node:path";
import {
  collectTests,
  hashPocTree,
  hashProductSources,
  readObservations,
  type SuiteEvidence,
} from "./evidence.ts";

const POC_DIR = "/repo/migration/bun/poc";
const REPO_ROOT = "/repo";
const EVIDENCE_DIR = "/evidence";
const OBSERVATIONS_FILE = "/tmp/observations.jsonl";
const JUNIT_FILE = "/tmp/junit.xml";

/** A finished run is evidence whenever Bun wrote a report; only a missing report fails. */
export function decideRun(junitExists: boolean): { write: boolean; exitCode: 0 | 2 } {
  return junitExists ? { write: true, exitCode: 0 } : { write: false, exitCode: 2 };
}

function capture(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return result.stdout.toString().trim();
}

/** Reads the first `major.minor.patch` token; `omp --version` prints `omp/<version>`. */
function parseVersion(output: string): string {
  const match = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(output);
  return match === null ? output : match[0];
}

async function main(): Promise<void> {
  const suite = process.argv[2];
  if (suite === undefined || suite === "") {
    console.error("usage: run-in-container.ts <suite>");
    process.exit(2);
  }
  process.env.POC_OBSERVATIONS_FILE = OBSERVATIONS_FILE;
  rmSync(JUNIT_FILE, { force: true });
  rmSync(OBSERVATIONS_FILE, { force: true });
  const run = Bun.spawn(
    [
      process.execPath,
      "test",
      "--timeout=120000",
      "--reporter=junit",
      `--reporter-outfile=${JUNIT_FILE}`,
      `./suites/${suite}.spec.ts`,
    ],
    {
      cwd: POC_DIR,
      stdout: "inherit",
      stderr: "inherit",
      // Bun.spawn does not forward later `process.env` mutations, so the
      // observation file has to be handed to the suite explicitly.
      env: { ...process.env, POC_OBSERVATIONS_FILE: OBSERVATIONS_FILE },
    },
  );
  const testExitCode = await run.exited;
  const decision = decideRun(existsSync(JUNIT_FILE));
  if (!decision.write) {
    console.error(`no JUnit report for suite "${suite}" (bun test exited ${testExitCode})`);
    process.exit(decision.exitCode);
  }
  const evidence: SuiteEvidence = {
    schemaVersion: 1,
    suite,
    arch: machine(),
    kernel: release(),
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    baseImageDigest: process.env.POC_BASE_IMAGE_DIGEST ?? "",
    opencodeVersion: parseVersion(capture(["opencode", "--version"])),
    ompVersion: parseVersion(capture(["omp", "--version"])),
    pocTreeSha256: hashPocTree(POC_DIR),
    productSourcesSha256: hashProductSources(REPO_ROOT),
    spawnBackend: process.env.POC_SPAWN_BACKEND ?? "node",
    gitHead: process.env.POC_GIT_HEAD ?? "",
    imageId: process.env.POC_IMAGE_ID ?? "",
    capturedAt: new Date().toISOString(),
    observations: readObservations(OBSERVATIONS_FILE),
    tests: collectTests(readFileSync(JUNIT_FILE, "utf8")),
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, `${suite}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  const passed = evidence.tests.filter((test) => test.status === "passed").length;
  console.log(`${suite}: ${passed}/${evidence.tests.length} tests passed`);
  process.exit(decision.exitCode);
}

if (import.meta.main) await main();
