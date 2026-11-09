// migration/bun/cutover/compare.ts
//
// Threshold comparison for the pre-cutover drill (design D3).
//
// `thresholds.json` is derived from the Deno (rollback-image) measurements and
// committed BEFORE the Bun measurement file is created. The command refuses to
// compare (exit 2) unless the thresholds file exists, is the repository's
// committed copy with no uncommitted changes, and its last commit precedes the
// Bun file's `measuredAt`. A comparison failure (any metric over its
// threshold) exits 1; a clean comparison exits 0.
//
// Usage:
//   cd migration/bun/cutover
//   bun run --no-env-file compare.ts measurements/deno.json measurements/bun.json thresholds.json

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Repository-relative path of the only thresholds file this command trusts. */
export const THRESHOLDS_REPO_PATH = "migration/bun/cutover/thresholds.json";

export interface RunMeasurement {
  /** Seconds from `podman run` returning to the first 200 from /ready. */
  startupSeconds: number;
  /** Resident memory after the idle period, MiB. */
  idleMemoryMiB: number;
  /** Open file descriptors after the idle period. */
  idleFds: number;
  /** Processes observed while running, one `podman top` line each. */
  processes: string[];
  /** Captured container processes still alive after the stop. */
  leftoverProcesses: number;
  /** Seconds the graceful stop took. */
  stopSeconds: number;
  /** Exit status of the `podman stop` command. */
  stopExit: number;
  /** Exit status the container recorded. */
  containerExit: number;
  /** Whether /ready answered 200 after the restart. */
  restartReady: boolean;
}

export interface MeasurementFile {
  image: string;
  label: string;
  measuredAt: string;
  runs: RunMeasurement[];
}

export interface ThresholdsFile {
  derivedFrom: string;
  rule: Record<string, unknown>;
  startupSeconds: number;
  idleMemoryMiB: number;
  idleFds: number;
  leftoverProcesses: number;
  stopSeconds: number;
  restartReady: boolean;
}

export interface CompareOptions {
  /** Repo commit timestamp of thresholds.json, or null when it has no commit. */
  thresholdsCommittedAt: string | null;
}

export interface CompareResult {
  lines: string[];
  exitCode: 0 | 1 | 2;
  reason?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIntegerCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Why `value` is not a measurement file, or null when it is valid. */
function measurementProblem(value: unknown, name: string): string | null {
  if (typeof value !== "object" || value === null) return `${name}: not an object`;
  const file = value as Partial<MeasurementFile>;
  if (typeof file.image !== "string" || file.image === "") return `${name}: missing image`;
  if (typeof file.label !== "string" || file.label === "") return `${name}: missing label`;
  if (!isIsoTimestamp(file.measuredAt)) return `${name}: invalid measuredAt`;
  if (!Array.isArray(file.runs) || file.runs.length === 0) {
    return `${name}: no runs`;
  }
  for (let index = 0; index < file.runs.length; index += 1) {
    const run = file.runs[index] as Partial<RunMeasurement> | null;
    const where = `${name} run ${index + 1}`;
    if (typeof run !== "object" || run === null) return `${where}: not an object`;
    if (!isFiniteNumber(run.startupSeconds)) return `${where}: invalid startupSeconds`;
    if (!isFiniteNumber(run.idleMemoryMiB)) return `${where}: invalid idleMemoryMiB`;
    if (!isIntegerCount(run.idleFds)) return `${where}: invalid idleFds`;
    if (
      !Array.isArray(run.processes) ||
      !run.processes.every((entry) => typeof entry === "string")
    ) {
      return `${where}: invalid processes`;
    }
    if (!isIntegerCount(run.leftoverProcesses)) return `${where}: invalid leftoverProcesses`;
    if (!isFiniteNumber(run.stopSeconds)) return `${where}: invalid stopSeconds`;
    if (!Number.isInteger(run.stopExit)) return `${where}: invalid stopExit`;
    if (!Number.isInteger(run.containerExit)) return `${where}: invalid containerExit`;
    if (typeof run.restartReady !== "boolean") return `${where}: invalid restartReady`;
  }
  return null;
}

/** Why `value` is not a thresholds file, or null when it is valid. */
function thresholdsProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "thresholds: not an object";
  const thresholds = value as Partial<ThresholdsFile>;
  if (typeof thresholds.derivedFrom !== "string" || thresholds.derivedFrom === "") {
    return "thresholds: missing derivedFrom";
  }
  if (
    typeof thresholds.rule !== "object" || thresholds.rule === null ||
    Array.isArray(thresholds.rule)
  ) {
    return "thresholds: missing rule";
  }
  if (!isFiniteNumber(thresholds.startupSeconds)) return "thresholds: invalid startupSeconds";
  if (!isFiniteNumber(thresholds.idleMemoryMiB)) return "thresholds: invalid idleMemoryMiB";
  if (!isFiniteNumber(thresholds.idleFds)) return "thresholds: invalid idleFds";
  // The fixed drill rule cannot be weakened in the committed file.
  if (thresholds.leftoverProcesses !== 0) return "thresholds: leftoverProcesses must be 0";
  if (thresholds.stopSeconds !== 15) return "thresholds: stopSeconds must be 15";
  if (thresholds.restartReady !== true) return "thresholds: restartReady must be true";
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function maximum(values: number[]): number {
  return values.reduce((largest, value) => value > largest ? value : largest, values[0]);
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function metricLine(
  metric: string,
  threshold: number | boolean,
  measured: number | boolean,
  ok: boolean,
): string {
  const thresholdText = typeof threshold === "number" ? formatNumber(threshold) : String(threshold);
  const measuredText = typeof measured === "number" ? formatNumber(measured) : String(measured);
  return `${metric} ${thresholdText} ${measuredText} ${ok ? "ok" : "FAIL"}`;
}

/**
 * Compare one Bun measurement against the committed thresholds. Pure and
 * synchronous; the commit time is injected so the scenarios are testable
 * without a repository.
 */
export function compareMeasurements(
  deno: MeasurementFile,
  bun: MeasurementFile,
  thresholds: ThresholdsFile,
  options: CompareOptions,
): CompareResult {
  const inputProblem = measurementProblem(deno, "deno") ?? measurementProblem(bun, "bun") ??
    thresholdsProblem(thresholds);
  if (inputProblem !== null) {
    return { lines: [], exitCode: 2, reason: inputProblem };
  }

  if (options.thresholdsCommittedAt === null) {
    return {
      lines: [],
      exitCode: 2,
      reason: "thresholds.json has no commit (it is missing or uncommitted)",
    };
  }
  const committedAt = Date.parse(options.thresholdsCommittedAt);
  const measuredAt = Date.parse(bun.measuredAt);
  if (!Number.isFinite(committedAt) || !Number.isFinite(measuredAt)) {
    return { lines: [], exitCode: 2, reason: "invalid thresholds commit or measuredAt time" };
  }
  if (committedAt > measuredAt) {
    return {
      lines: [],
      exitCode: 2,
      reason: "thresholds.json was committed after the Bun measurement (measuredAt)",
    };
  }

  const startup = median(bun.runs.map((run) => run.startupSeconds));
  const memory = median(bun.runs.map((run) => run.idleMemoryMiB));
  const descriptors = maximum(bun.runs.map((run) => run.idleFds));
  const leftovers = maximum(bun.runs.map((run) => run.leftoverProcesses));
  const stop = maximum(bun.runs.map((run) => run.stopSeconds));
  const stopExit = maximum(bun.runs.map((run) => run.stopExit));
  const restartsReady = bun.runs.every((run) => run.restartReady);

  const lines = [
    metricLine("startupSeconds", thresholds.startupSeconds, startup, startup <= thresholds.startupSeconds),
    metricLine("idleMemoryMiB", thresholds.idleMemoryMiB, memory, memory <= thresholds.idleMemoryMiB),
    metricLine("idleFds", thresholds.idleFds, descriptors, descriptors <= thresholds.idleFds),
    metricLine("leftoverProcesses", 0, leftovers, leftovers === 0),
    metricLine("stopSeconds", 15, stop, stop < 15),
    metricLine("stopExit", 0, stopExit, stopExit === 0),
    metricLine("restartReady", true, restartsReady, restartsReady),
  ];

  const failed = lines.some((line) => line.endsWith(" FAIL"));
  return { lines, exitCode: failed ? 1 : 0 };
}

interface ThresholdsCommit {
  sha: string;
  committedAt: string;
}

/** The last commit touching thresholds.json, or null when there is none. */
function readThresholdsCommit(repoRoot: string): ThresholdsCommit | null {
  try {
    const output = execFileSync(
      "git",
      ["-C", repoRoot, "log", "-1", "--format=%H%n%cI", "--", THRESHOLDS_REPO_PATH],
      { encoding: "utf8" },
    ).trim();
    if (output === "") return null;
    const [sha, committedAt] = output.split("\n");
    if (sha === undefined || committedAt === undefined) return null;
    return { sha, committedAt };
  } catch {
    return null;
  }
}

/**
 * Verify that `thresholdsPath` is the repository's committed thresholds file
 * and that its working bytes equal the blob of its last commit. Returns a
 * problem description, or null when the file is the committed copy.
 */
function committedThresholdsProblem(
  repoRoot: string,
  thresholdsPath: string,
  commit: ThresholdsCommit,
): string | null {
  let expectedPath: string;
  let suppliedPath: string;
  try {
    expectedPath = realpathSync(resolve(repoRoot, THRESHOLDS_REPO_PATH));
    suppliedPath = realpathSync(thresholdsPath);
  } catch {
    return `thresholds file not found at ${THRESHOLDS_REPO_PATH}`;
  }
  if (suppliedPath !== expectedPath) {
    return `thresholds file must be ${THRESHOLDS_REPO_PATH}`;
  }
  try {
    const committedBlob = execFileSync(
      "git",
      ["-C", repoRoot, "rev-parse", `${commit.sha}:${THRESHOLDS_REPO_PATH}`],
      { encoding: "utf8" },
    ).trim();
    const workingBlob = execFileSync("git", ["-C", repoRoot, "hash-object", expectedPath], {
      encoding: "utf8",
    }).trim();
    if (committedBlob !== workingBlob) {
      return "thresholds.json has uncommitted changes";
    }
  } catch {
    return "could not verify the committed thresholds.json";
  }
  return null;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error(
      "usage: bun run --no-env-file compare.ts <deno.json> <bun.json> <thresholds.json>",
    );
    process.exit(2);
  }
  const [denoPath, bunPath, thresholdsPath] = args;
  let deno: MeasurementFile;
  let bun: MeasurementFile;
  let thresholds: ThresholdsFile;
  try {
    deno = readJson(denoPath) as MeasurementFile;
    bun = readJson(bunPath) as MeasurementFile;
    thresholds = readJson(thresholdsPath) as ThresholdsFile;
  } catch (error) {
    console.error(`compare: could not read an input file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const repoRoot = resolve(import.meta.dir, "../../..");
  const commit = readThresholdsCommit(repoRoot);
  if (commit === null) {
    console.error(
      "compare: thresholds.json has no commit (compare refuses to run before the thresholds are fixed)",
    );
    process.exit(2);
  }
  const commitProblem = committedThresholdsProblem(repoRoot, thresholdsPath, commit);
  if (commitProblem !== null) {
    console.error(`compare: ${commitProblem}`);
    process.exit(2);
  }

  const result = compareMeasurements(deno, bun, thresholds, {
    thresholdsCommittedAt: commit.committedAt,
  });
  for (const line of result.lines) console.log(line);
  if (result.exitCode === 2) {
    console.error(`compare: ${result.reason ?? "refused to compare"}`);
  }
  process.exit(result.exitCode);
}
