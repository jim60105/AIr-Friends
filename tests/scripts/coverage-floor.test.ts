// tests/scripts/coverage-floor.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { computeLineCoverage } from "../../scripts/coverage-floor.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLI = join(REPO_ROOT, "scripts", "coverage-floor.ts");

const ABOVE_FLOOR = [
  "TN:",
  "SF:src/example.ts",
  "LF:200",
  "LH:160",
  "end_of_record",
  "",
].join("\n");

const BELOW_FLOOR = [
  "TN:",
  "SF:src/example.ts",
  "LF:200",
  "LH:140",
  "end_of_record",
  "",
].join("\n");

const WITH_TEST_RECORD = [
  "TN:",
  "SF:tests/example.test.ts",
  "LF:100",
  "LH:0",
  "end_of_record",
  "TN:",
  "SF:src/example.ts",
  "LF:100",
  "LH:80",
  "end_of_record",
  "",
].join("\n");

const ONLY_TEST_RECORD = [
  "TN:",
  "SF:tests/example.test.ts",
  "LF:10",
  "LH:10",
  "end_of_record",
  "",
].join("\n");

async function runFloor(
  lcov: string,
  floor: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const dir = await mkdtemp(join(tmpdir(), "coverage-floor-"));
  try {
    const path = join(dir, "lcov.info");
    await writeFile(path, lcov);
    const proc = Bun.spawn([process.execPath, CLI, path, String(floor)], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("coverage floor - above the floor prints 80.00 and exits 0", async () => {
  const coverage = computeLineCoverage(ABOVE_FLOOR);
  assertEquals(coverage?.percent, 80);

  const result = await runFloor(ABOVE_FLOOR, 75);
  assertEquals(result.stdout.trim(), "80.00");
  assertEquals(result.code, 0);
});

test("coverage floor - below the floor prints 70.00 and exits 1", async () => {
  const coverage = computeLineCoverage(BELOW_FLOOR);
  assertEquals(coverage?.percent, 70);

  const result = await runFloor(BELOW_FLOOR, 75);
  assertEquals(result.stdout.trim(), "70.00");
  assertEquals(result.code, 1);
});

test("coverage floor - tests/ records are ignored", async () => {
  const coverage = computeLineCoverage(WITH_TEST_RECORD);
  assertEquals(coverage?.percent, 80);

  const result = await runFloor(WITH_TEST_RECORD, 75);
  assertEquals(result.stdout.trim(), "80.00");
  assertEquals(result.code, 0);
});

test("coverage floor - an empty report exits 1 naming the empty report", async () => {
  assertEquals(computeLineCoverage(ONLY_TEST_RECORD), null);

  const result = await runFloor(ONLY_TEST_RECORD, 75);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "empty report");
});

test("coverage floor - sums every src record, including absolute and ./ spellings", () => {
  const report = [
    "TN:",
    "SF:./src/a.ts",
    "LF:10",
    "LH:10",
    "end_of_record",
    "TN:",
    "SF:/repo/src/b.ts",
    "LF:30",
    "LH:20",
    "end_of_record",
    "",
  ].join("\n");

  assertEquals(computeLineCoverage(report, "/repo")?.percent, 75);
});

test("coverage floor - a src record with no found lines is an empty report", () => {
  const report = ["TN:", "SF:src/empty.ts", "LF:0", "LH:0", "end_of_record", ""].join("\n");

  assertEquals(computeLineCoverage(report), null);
});
