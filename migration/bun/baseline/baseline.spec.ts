import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decideCapture, decideFreeze, parseAppVersion, summarizeTests } from "./capture.ts";
import { parseCoverageTable, parseDenoJunit } from "./junit.ts";
import { validateBaselineDir } from "./records-schema.ts";

const JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="6" failures="1" ignored="1">
  <testsuite name="tests/a_test.ts" tests="5">
    <testcase name="plain" classname="./tests/a_test.ts" time="0.001"/>
    <testcase name="skipped one" classname="./tests/a_test.ts" time="0.001"><skipped/></testcase>
    <testcase name="fails" classname="./tests/a_test.ts" time="0.002"><failure message="boom">assertion body</failure></testcase>
    <testcase name="with step &gt; inner a" classname="./tests/a_test.ts" time="0.001"/>
    <testcase name="repeated" classname="./tests/a_test.ts" time="0.001"/>
    <testcase name="repeated" classname="./tests/a_test.ts" time="0.001"/>
  </testsuite>
  <testsuite name="tests/nested/b_test.ts" tests="1">
    <testsuite name="tests/nested/b_test.ts" tests="1">
      <testcase name="repeated" classname="./tests/nested/b_test.ts" time="0.001"/>
    </testsuite>
  </testsuite>
</testsuites>`;

const COVERAGE_TABLE = `
| File                     | Branch % | Function % | Line % |
| ------------------------ | -------- | ---------- | ------ |
| All files                |     50.0 |      100.0 |   90.5 |
| src/core/example.ts      |     50.0 |      100.0 |   90.5 |
`;

const FREEZE_SHA = "734c8b03c60a021a3982a07d18c3c3f75962c472";
const BRANCH_HEAD = "4fbe61a6320e707900cc60900df3a25898f14f1b";
const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;
const CAPTURED_AT = "2026-11-08T00:00:00.000Z";

function testRecordFixture() {
  return {
    schemaVersion: 1,
    tests: [
      { file: "tests/a_test.ts", name: "fails", status: "failed" },
      { file: "tests/a_test.ts", name: "plain", status: "passed" },
      { file: "tests/a_test.ts", name: "skipped one", status: "ignored" },
    ],
  };
}

function baselineFixture() {
  return {
    schemaVersion: 1,
    freezeSha: FREEZE_SHA,
    branchHead: BRANCH_HEAD,
    capturedAt: CAPTURED_AT,
    denoVersion: "deno 2.9.0 (stable, release, x86_64-unknown-linux-gnu)",
    appVersion: "0.36.1",
    command: ["test", "--coverage=<tmp>/cov", "--junit-path=<tmp>/junit.xml", "tests/"],
    totals: { tests: 3, passed: 1, failed: 1, ignored: 1 },
    coverage: { branchPercent: 50, functionPercent: 100, linePercent: 90.5 },
  };
}

function rollbackFixture() {
  return {
    schemaVersion: 1,
    capturedAt: CAPTURED_AT,
    reference: `ghcr.io/jim60105/air-friends@${DIGEST}`,
    digest: DIGEST,
    sourceRevision: FREEZE_SHA,
    observedFrom: "kubectl imageID, namespace air-friends",
  };
}

/** Writes a record set into a fresh temporary directory and validates it there. */
function validateWith(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "baseline-spec-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), `${JSON.stringify(contents, null, 2)}\n`);
    }
    return validateBaselineDir(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function validFiles(): Record<string, unknown> {
  return {
    "deno-tests.json": testRecordFixture(),
    "baseline.json": baselineFixture(),
    "rollback-reference.json": rollbackFixture(),
  };
}

function validFilesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "baseline-spec-"));
  for (const [name, contents] of Object.entries(validFiles())) {
    writeFileSync(join(dir, name), `${JSON.stringify(contents, null, 2)}\n`);
  }
  return dir;
}

function runValidator(dir: string) {
  return spawnSync(process.execPath, ["--no-env-file", resolve(import.meta.dir, "validate.ts"), dir], {
    cwd: import.meta.dir,
    encoding: "utf8",
  });
}

describe("Deno test result record", () => {
  test("derives passed, ignored and failed from the JUnit test case", () => {
    const tests = parseDenoJunit(JUNIT_XML);
    const statusOf = (name: string) => tests.find((entry) => entry.name === name)?.status;
    expect(statusOf("plain")).toBe("passed");
    expect(statusOf("skipped one")).toBe("ignored");
    expect(statusOf("fails")).toBe("failed");
  });

  test("keeps the full step name with XML entities decoded", () => {
    const tests = parseDenoJunit(JUNIT_XML);
    expect(tests.some((entry) => entry.name === "with step > inner a")).toBe(true);
  });

  test("keeps every occurrence of a repeated name, across and within files", () => {
    const tests = parseDenoJunit(JUNIT_XML);
    const repeated = tests.filter((entry) => entry.name === "repeated");
    expect(repeated.length).toBe(3);
    expect(repeated.filter((entry) => entry.file === "tests/a_test.ts").length).toBe(2);
    expect(repeated.filter((entry) => entry.file === "tests/nested/b_test.ts").length).toBe(1);
  });

  test("strips a leading ./ from the file name and sorts by file then name", () => {
    const tests = parseDenoJunit(JUNIT_XML);
    expect(tests.every((entry) => !entry.file.startsWith("./"))).toBe(true);
    const sorted = [...tests].sort((a, b) =>
      a.file === b.file ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.file < b.file ? -1 : 1
    );
    expect(tests).toEqual(sorted);
  });

  test("counts failures in the totals", () => {
    const totals = summarizeTests(parseDenoJunit(JUNIT_XML));
    expect(totals).toEqual({ tests: 7, passed: 5, failed: 1, ignored: 1 });
  });
});

describe("Coverage summary record", () => {
  test("parses the All files row by column", () => {
    expect(parseCoverageTable(COVERAGE_TABLE)).toEqual({
      branchPercent: 50,
      functionPercent: 100,
      linePercent: 90.5,
    });
  });

  test("fails naming the missing row", () => {
    expect(() => parseCoverageTable("| File | Branch % | Function % | Line % |")).toThrow(/All files/);
  });
});

describe("Baseline summary fields", () => {
  test("reads the version from a deno.json that carries comments", () => {
    const manifest = `{
  "name": "@air-friends/core",
  "version": "0.36.1",
  // Deno allows comments in this file.
  "imports": { "ventojs": "https://cdn.jsdelivr.net/gh/ventojs/vento@2.2.0/mod.ts" },
  /* block */
  "tasks": {}
}`;
    expect(parseAppVersion(manifest)).toBe("0.36.1");
  });
});

describe("Capture refuses a drifted tree", () => {
  test("moved master stops capture with exit code 2", () => {
    const decision = decideFreeze(BRANCH_HEAD, FREEZE_SHA, []);
    expect(decision.ok).toBe(false);
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain(BRANCH_HEAD);
  });

  test("source drift stops capture and lists the drifted paths", () => {
    const decision = decideFreeze(FREEZE_SHA, FREEZE_SHA, ["src/main.ts", "deno.lock"]);
    expect(decision.ok).toBe(false);
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain("src/main.ts");
    expect(decision.reasons.join(" ")).toContain("deno.lock");
  });

  test("a clean tree at the freeze point is allowed", () => {
    const decision = decideFreeze(FREEZE_SHA, FREEZE_SHA, []);
    expect(decision).toEqual({ ok: true, exitCode: 0, reasons: [] });
  });
});

describe("Failed tests are recorded", () => {
  test("a non-zero test run with JUnit output writes the records", () => {
    expect(decideCapture(true)).toBe("write");
  });

  test("a missing JUnit file aborts the capture", () => {
    expect(decideCapture(false)).toBe("abort");
  });
});

describe("Baseline record validation", () => {
  test("a complete record set is valid and the validator exits 0", () => {
    expect(validateWith(validFiles())).toEqual({ state: "valid", problems: [] });

    const dir = validFilesDir();
    try {
      const result = runValidator(dir);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")[0]).toBe("valid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("totals disagreeing with the entries are invalid and named", () => {
    const files = validFiles();
    files["baseline.json"] = { ...baselineFixture(), totals: { tests: 3, passed: 2, failed: 1, ignored: 0 } };
    const { state, problems } = validateWith(files);
    expect(state).toBe("invalid");
    expect(problems.join(" ")).toContain("totals");
  });

  test("an absent rollback reference is invalid and the validator exits 1", () => {
    const files = validFiles();
    delete files["rollback-reference.json"];
    const { state, problems } = validateWith(files);
    expect(state).toBe("invalid");
    expect(problems.join(" ")).toContain("rollback-reference.json");

    const dir = mkdtempSync(join(tmpdir(), "baseline-spec-"));
    try {
      for (const [name, contents] of Object.entries(files)) {
        writeFileSync(join(dir, name), `${JSON.stringify(contents, null, 2)}\n`);
      }
      const result = runValidator(dir);
      expect(result.status).toBe(1);
      expect(result.stdout.trim().split("\n")[0]).toBe("invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Rollback reference validation", () => {
  test("a tag-only image reference is invalid and named", () => {
    const files = validFiles();
    const reference = "ghcr.io/jim60105/air-friends:latest";
    files["rollback-reference.json"] = { ...rollbackFixture(), reference };
    const { state, problems } = validateWith(files);
    expect(state).toBe("invalid");
    expect(problems.join(" ")).toContain(reference);
  });

  test("a reference and digest that disagree are invalid", () => {
    const files = validFiles();
    files["rollback-reference.json"] = {
      ...rollbackFixture(),
      reference: `ghcr.io/jim60105/air-friends@${DIGEST}`,
      digest: OTHER_DIGEST,
    };
    const { state, problems } = validateWith(files);
    expect(state).toBe("invalid");
    expect(problems.join(" ")).toContain(OTHER_DIGEST);
  });

  test("a source revision differing from the freeze SHA is invalid and named", () => {
    const files = validFiles();
    const sourceRevision = BRANCH_HEAD;
    files["rollback-reference.json"] = { ...rollbackFixture(), sourceRevision };
    const { state, problems } = validateWith(files);
    expect(state).toBe("invalid");
    expect(problems.join(" ")).toContain(sourceRevision);
  });
});
