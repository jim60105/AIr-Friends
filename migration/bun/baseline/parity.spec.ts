import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { BaselineTest } from "./records-schema.ts";
import {
  type BunTestResult,
  checkParity,
  type ParityException,
  type ParitySummary,
  parseBunJunit,
  resolveJunitPath,
} from "./parity.ts";

const FILE = "tests/example.test.ts";
const NESTED_FILE = "tests/x.test.ts";
const repoRoot = resolve(import.meta.dir, "../../..");

const PARSER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="8">
  <testsuite name="./tests/x.test.ts" file="./tests/x.test.ts">
    <testcase name="flat" file="./tests/x.test.ts" />
    <testsuite name="Parent" file="./tests/x.test.ts">
      <testsuite name="Child" file="./tests/x.test.ts">
        <testcase name="step a" file="./tests/x.test.ts" />
        <testcase name="skip me" file="./tests/x.test.ts"><skipped /></testcase>
        <testcase name="fails" file="./tests/x.test.ts"><failure type="ReferenceError" message="Deno is not defined">ReferenceError: Deno is not defined</failure></testcase>
        <testcase name="errors" file="./tests/x.test.ts"><error type="Error" message="boom">Error: boom</error></testcase>
      </testsuite>
    </testsuite>
  </testsuite>
  <testsuite name="./tests/y.test.ts" file="./tests/y.test.ts">
    <testcase name="second file" file="./tests/y.test.ts" />
  </testsuite>
</testsuites>`;

function bunTest(
  name: string,
  status: BunTestResult["status"] = "passed",
  failure: { type?: string; message?: string } = {},
): BunTestResult {
  const result: BunTestResult = { file: FILE, name, status };
  if (failure.type !== undefined) result.failureType = failure.type;
  if (failure.message !== undefined) result.failureMessage = failure.message;
  return result;
}

function exception(overrides: Partial<ParityException>): ParityException {
  const base: ParityException = {
    file: FILE,
    name: "a",
    disposition: "removed",
    reason: "covered elsewhere",
  };
  return { ...base, ...overrides };
}

function passedTests(...names: string[]): BaselineTest[] {
  const tests: BaselineTest[] = [];
  for (const name of names) tests.push({ file: FILE, name, status: "passed" });
  return tests;
}

function runParity(args: string[]) {
  return spawnSync(process.execPath, [
    "--no-env-file",
    resolve(import.meta.dir, "parity.ts"),
    ...args,
  ], { cwd: import.meta.dir, encoding: "utf8" });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

describe("Bun JUnit report parsing", () => {
  test("parses a flat test case in the file suite and strips a leading ./", () => {
    const results = parseBunJunit(PARSER_XML);
    const flat = results.find((result) => result.name === "flat");
    expect(flat).toEqual({ file: NESTED_FILE, name: "flat", status: "passed" });
  });

  test("joins a nested describe chain two levels deep with ' > '", () => {
    const results = parseBunJunit(PARSER_XML);
    const step = results.find((result) =>
      result.name === "Parent > Child > step a"
    );
    expect(step?.status).toBe("passed");
  });

  test("marks a test case carrying a skipped child as skipped", () => {
    const results = parseBunJunit(PARSER_XML);
    const skipped = results.find((result) =>
      result.name === "Parent > Child > skip me"
    );
    expect(skipped?.status).toBe("skipped");
  });

  test("reads failure type and message from the failure element", () => {
    const results = parseBunJunit(PARSER_XML);
    const failed = results.find((result) =>
      result.name === "Parent > Child > fails"
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.failureType).toBe("ReferenceError");
    expect(failed?.failureMessage).toBe("Deno is not defined");
  });

  test("treats an error element as a failure and reads its details", () => {
    const results = parseBunJunit(PARSER_XML);
    const errored = results.find((result) =>
      result.name === "Parent > Child > errors"
    );
    expect(errored?.status).toBe("failed");
    expect(errored?.failureType).toBe("Error");
    expect(errored?.failureMessage).toBe("boom");
  });

  test("walks every top-level file suite", () => {
    const results = parseBunJunit(PARSER_XML);
    expect(results.some((result) => result.file === "tests/y.test.ts")).toBe(
      true,
    );
    expect(results.some((result) => result.name === "second file")).toBe(true);
  });

  test("rejects malformed XML", () => {
    expect(() => parseBunJunit("<testsuites>")).toThrow(/invalid JUnit XML/);
  });
});

describe("Baseline name coverage", () => {
  test("passes when every baseline name is present", () => {
    const summary = checkParity(passedTests("a", "b"), [
      bunTest("a"),
      bunTest("b"),
    ], []);
    expect(summary.baselineInScope).toBe(2);
    expect(summary.matched).toBe(2);
    expect(summary.missing).toEqual([]);
    expect(summary.ok).toBe(true);
  });

  test("reports the file and name of a missing test", () => {
    const summary = checkParity(passedTests("a", "b"), [bunTest("a")], []);
    expect(summary.matched).toBe(1);
    expect(summary.missing).toEqual([{ file: FILE, name: "b" }]);
    expect(summary.ok).toBe(false);
  });

  test("counts repeated baseline names instead of collapsing them", () => {
    const summary = checkParity(passedTests("a", "a"), [bunTest("a")], []);
    expect(summary.matched).toBe(1);
    expect(summary.missing).toEqual([{ file: FILE, name: "a" }]);
    expect(summary.ok).toBe(false);
  });

  test("reads a repository-relative report and maps missing names to exit 1", () => {
    const records = JSON.parse(
      readFileSync(join(import.meta.dir, "records/deno-tests.json"), "utf8"),
    ) as { tests: BaselineTest[] };
    const hashTests = records.tests.filter((entry) =>
      entry.file === "tests/utils/hash.test.ts"
    );
    expect(hashTests.length).toBeGreaterThan(0);

    const scratchRoot = join(repoRoot, ".parity");
    mkdirSync(scratchRoot, { recursive: true });
    const dir = mkdtempSync(join(scratchRoot, "parity-spec-"));
    try {
      const relative = `.parity/${basename(dir)}/r.xml`;
      const reportPath = join(dir, "r.xml");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="1">
  <testsuite name="tests/utils/hash.test.ts" file="tests/utils/hash.test.ts">
    <testcase name="${
        escapeXml(hashTests[0].name)
      }" file="tests/utils/hash.test.ts" />
  </testsuite>
</testsuites>`;
      writeFileSync(reportPath, xml);
      expect(resolveJunitPath(relative)).toBe(reportPath);

      const result = runParity([
        "--junit",
        relative,
        "--scope",
        "tests/utils/hash.test.ts",
      ]);
      expect(result.status).toBe(1);
      const summary = JSON.parse(result.stdout) as ParitySummary;
      expect(summary.baselineInScope).toBe(hashTests.length);
      expect(summary.matched).toBe(1);
      expect(summary.missing.length).toBe(hashTests.length - 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 2 when the repository-relative report is missing", () => {
    const scratchRoot = join(repoRoot, ".parity");
    mkdirSync(scratchRoot, { recursive: true });
    rmSync(join(scratchRoot, "missing-report.xml"), { force: true });

    const result = runParity([
      "--junit",
      ".parity/missing-report.xml",
      "--scope",
      "tests/utils/hash.test.ts",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  test("exits 2 when --junit is absent", () => {
    const result = runParity(["--scope", "tests/"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--junit is required");
  });

  test("exits 2 when a flag is used as the --scope value", () => {
    const result = runParity([
      "--junit",
      ".parity/missing-report.xml",
      "--scope",
      "--allow-deferred",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--scope needs a non-empty file prefix");
  });

  test("matches a nested describe name built by the parser", () => {
    const baseline: BaselineTest[] = [{
      file: NESTED_FILE,
      name: "Parent > Child > step a",
      status: "passed",
    }];
    const results = parseBunJunit(PARSER_XML).filter((result) =>
      result.file === NESTED_FILE
    );
    const summary = checkParity(baseline, results, []);
    expect(summary.matched).toBe(1);
    expect(summary.missing).toEqual([]);
    expect(summary.ok).toBe(true);
  });
});

describe("Recorded exceptions", () => {
  test("accepts a removed test with a non-empty reason", () => {
    const summary = checkParity(
      passedTests("a"),
      [],
      [exception({
        disposition: "removed",
        reason: "covered by tests/b.test.ts",
      })],
    );
    expect(summary.missing).toEqual([]);
    expect(summary.exceptionsApplied).toBe(1);
    expect(summary.invalidExceptions).toEqual([]);
    expect(summary.ok).toBe(true);
  });

  test("rejects an exception whose reason is empty", () => {
    const summary = checkParity(passedTests("a"), [], [
      exception({ reason: "   " }),
    ]);
    expect(summary.invalidExceptions.length).toBe(1);
    expect(summary.invalidExceptions[0]).toContain("reason");
    expect(summary.invalidExceptions[0]).toContain("a");
    expect(summary.ok).toBe(false);
  });

  test("keeps a renamed original missing when its replacement is absent", () => {
    const summary = checkParity(passedTests("a"), [], [
      exception({
        disposition: "renamed",
        replacement: { file: FILE, name: "renamed" },
      }),
    ]);
    expect(summary.missing).toEqual([{ file: FILE, name: "a" }]);
    expect(summary.exceptionsApplied).toBe(0);
    expect(summary.ok).toBe(false);
  });

  test("accepts a renamed original when its replacement exists", () => {
    const summary = checkParity(passedTests("a"), [bunTest("renamed")], [
      exception({
        disposition: "renamed",
        replacement: { file: FILE, name: "renamed" },
      }),
    ]);
    expect(summary.missing).toEqual([]);
    expect(summary.matched).toBe(1);
    expect(summary.exceptionsApplied).toBe(1);
    expect(summary.ok).toBe(true);
  });

  test("rejects a replacement on a non-renamed exception", () => {
    const summary = checkParity(passedTests("a"), [], [
      exception({
        disposition: "removed",
        replacement: { file: FILE, name: "renamed" },
      }),
    ]);
    expect(summary.invalidExceptions.length).toBe(1);
    expect(summary.invalidExceptions[0]).toContain("replacement");
    expect(summary.ok).toBe(false);
  });

  test("rejects an exception that matches no baseline test", () => {
    const summary = checkParity(passedTests("a"), [], [
      exception({ name: "absent" }),
    ]);
    expect(summary.invalidExceptions.length).toBe(1);
    expect(summary.invalidExceptions[0]).toContain("matches no baseline test");
    expect(summary.ok).toBe(false);
  });

  test("rejects two exceptions for the same baseline test", () => {
    const summary = checkParity(passedTests("a"), [], [
      exception({ reason: "first" }),
      exception({ reason: "second" }),
    ]);
    expect(summary.invalidExceptions.length).toBe(1);
    expect(summary.invalidExceptions[0]).toContain("duplicate");
    expect(summary.ok).toBe(false);
  });
});

describe("Outcome parity", () => {
  test("reports a failed counterpart as a failure with or without --allow-deferred", () => {
    const results = [
      bunTest("a", "failed", { type: "AssertionError", message: "expected 2" }),
    ];
    for (const allowDeferred of [false, true]) {
      const summary = checkParity(passedTests("a"), results, [], {
        allowDeferred,
      });
      expect(summary.failures).toEqual([{
        file: FILE,
        name: "a",
        type: "AssertionError",
        message: "expected 2",
      }]);
      expect(summary.deferred).toEqual([]);
      expect(summary.ok).toBe(false);
    }
  });

  test("defers a ReferenceError naming the missing Deno global when allowed", () => {
    const results = [bunTest("a", "failed", {
      type: "ReferenceError",
      message: "Deno is not defined",
    })];
    const summary = checkParity(passedTests("a"), results, [], {
      allowDeferred: true,
    });
    expect(summary.deferred).toEqual([{ file: FILE, name: "a" }]);
    expect(summary.failures).toEqual([]);
    expect(summary.ok).toBe(true);
  });

  test("fails the same deferred error without --allow-deferred", () => {
    const results = [bunTest("a", "failed", {
      type: "ReferenceError",
      message: "Deno is not defined",
    })];
    const summary = checkParity(passedTests("a"), results, []);
    expect(summary.deferred).toEqual([{ file: FILE, name: "a" }]);
    expect(summary.ok).toBe(false);
  });

  test("does not defer a different ReferenceError message", () => {
    const results = [bunTest("a", "failed", {
      type: "ReferenceError",
      message: "other is not defined",
    })];
    const summary = checkParity(passedTests("a"), results, [], {
      allowDeferred: true,
    });
    expect(summary.deferred).toEqual([]);
    expect(summary.failures.length).toBe(1);
    expect(summary.ok).toBe(false);
  });

  test("accepts a skipped counterpart only with a skipped exception", () => {
    const results = [bunTest("a", "skipped")];
    const withoutException = checkParity(passedTests("a"), results, []);
    expect(withoutException.failures).toEqual([{
      file: FILE,
      name: "a",
      type: "skipped",
      message: "Bun reported the test as skipped",
    }]);
    expect(withoutException.ok).toBe(false);

    const withException = checkParity(passedTests("a"), results, [
      exception({ disposition: "skipped", reason: "platform not available" }),
    ]);
    expect(withException.failures).toEqual([]);
    expect(withException.exceptionsApplied).toBe(1);
    expect(withException.ok).toBe(true);
  });

  test("accepts any Bun status for a baseline ignored test", () => {
    const baseline: BaselineTest[] = [{
      file: FILE,
      name: "a",
      status: "ignored",
    }];
    const failed = [
      bunTest("a", "failed", { type: "AssertionError", message: "boom" }),
    ];
    const skipped = [bunTest("a", "skipped")];
    expect(checkParity(baseline, failed, []).ok).toBe(true);
    expect(checkParity(baseline, skipped, []).ok).toBe(true);
  });
});
