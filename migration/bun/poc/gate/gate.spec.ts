import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CRITERIA, DEFERRALS, P0_BLOCKERS } from "./catalog.ts";
import type { Arch, Criterion, Deferral, P0Id, SuiteName } from "./catalog.ts";
import type { EvidenceTest, SuiteEvidence } from "./evidence.ts";
import {
  ALLOWED_CHANGED_FILES,
  checkBinding,
  evaluate,
  isolationViolations,
  validateCatalog,
} from "./evaluate.ts";
import type { CriterionStatus, GateInput, GateResult } from "./evaluate.ts";
import { POC_PINS, PRODUCT_SOURCES } from "./pins.ts";
import { renderMarkdown, writeRecord } from "./record.ts";
import type { OutcomeRecord } from "./record.ts";
import { compareLive, compareRecord } from "./verify-record.ts";

const TREE_HASH = "1".repeat(64);
const SOURCES_HASH = "2".repeat(64);
const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function deferralAll(): Deferral[] {
  return (Object.keys(P0_BLOCKERS) as P0Id[]).map((p0) => ({
    p0,
    scope: "test scope",
    owner: "test owner",
  }));
}

function criterion(
  id: string,
  p0: P0Id,
  suite: SuiteName,
  archs: readonly Arch[],
  minTests = 1,
): Criterion {
  return { id, p0, suite, archs, check: "test check", minTests };
}

function evidence(
  suite: SuiteName,
  arch: Arch,
  tests: EvidenceTest[],
  overrides: Partial<SuiteEvidence> = {},
): SuiteEvidence {
  return {
    schemaVersion: 1,
    suite,
    arch,
    kernel: "6.8.0-1018-azure",
    bunVersion: POC_PINS.bunVersion,
    bunRevision: `${POC_PINS.bunRevisionPrefix}abcdef`,
    baseImageDigest: POC_PINS.baseImageDigest,
    opencodeVersion: POC_PINS.opencodeVersion,
    ompVersion: POC_PINS.ompVersion,
    pocTreeSha256: TREE_HASH,
    productSourcesSha256: SOURCES_HASH,
    spawnBackend: "node",
    gitHead: "",
    imageId: "",
    capturedAt: "2026-11-08T00:00:00.000Z",
    observations: {},
    tests,
    ...overrides,
  };
}

function passed(name: string, assertions = 1): EvidenceTest {
  return { name, status: "passed", assertions };
}

function gateInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    catalog: [],
    deferrals: deferralAll(),
    evidence: [],
    pocTreeSha256: TREE_HASH,
    productSourcesSha256: SOURCES_HASH,
    changedPaths: [],
    baselineState: "valid",
    ...overrides,
  };
}

function singleStatus(
  oneCriterion: Criterion,
  suiteEvidence: SuiteEvidence[],
  overrides: Partial<GateInput> = {},
): CriterionStatus {
  const result = evaluate(
    gateInput({ catalog: [oneCriterion], evidence: suiteEvidence, ...overrides }),
  );
  expect(result.criteria).toHaveLength(1);
  return result.criteria[0].status;
}

describe("validateCatalog real catalog", () => {
  test("accepts the shipped catalog and deferrals", () => {
    expect(validateCatalog(CRITERIA, DEFERRALS)).toEqual([]);
  });

  test("covers every P0 blocker", () => {
    const covered = new Set<string>([
      ...CRITERIA.map((entry) => entry.p0),
      ...DEFERRALS.map((entry) => entry.p0),
    ]);
    expect([...covered].sort()).toEqual(Object.keys(P0_BLOCKERS).sort());
  });
});

describe("validateCatalog", () => {
  test("fails an unmapped blocker and names it", () => {
    const problems = validateCatalog(
      [],
      deferralAll().filter((entry) => entry.p0 !== "P0-7"),
    );
    expect(problems.some((problem) => problem.includes("P0-7"))).toBe(true);
  });

  test("fails a duplicate identifier and names it", () => {
    const duplicate = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const problems = validateCatalog([duplicate, { ...duplicate }], deferralAll());
    expect(problems.some((problem) => problem.includes("duplicate") && problem.includes("FFI-01"))).toBe(
      true,
    );
  });

  test("fails a malformed identifier", () => {
    const problems = validateCatalog([criterion("bad", "P0-4", "ffi", ["x86_64"])], deferralAll());
    expect(problems.some((problem) => problem.includes("malformed"))).toBe(true);
  });

  test("fails a criterion without an architecture", () => {
    const problems = validateCatalog([criterion("FFI-01", "P0-4", "ffi", [])], deferralAll());
    expect(problems.some((problem) => problem.includes("no architecture"))).toBe(true);
  });
});

describe("Criterion Result From Test Report", () => {
  const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);

  test("passes when all tests for the criterion passed", () => {
    const status = singleStatus(ffi, [evidence("ffi", "x86_64", [passed("FFI-01: a"), passed("FFI-01: b")])]);
    expect(status).toBe("pass");
  });

  test("fails when one test for the criterion failed", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [
        passed("FFI-01: a"),
        { name: "FFI-01: b", status: "failed", assertions: 1 },
      ]),
    ]);
    expect(status).toBe("fail");
  });

  test("fails on a skipped test for the criterion", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [{ name: "FFI-01: a", status: "skipped", assertions: 0 }]),
    ]);
    expect(status).toBe("fail");
  });

  test("is missing when no test matches the criterion", () => {
    const status = singleStatus(ffi, [evidence("ffi", "x86_64", [passed("other helper")])]);
    expect(status).toBe("missing");
  });

  test("fails when a test outside the criterion's tests failed", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [
        { name: "(unnamed)", status: "failed", assertions: 0 },
        passed("FFI-01: a"),
      ]),
    ]);
    expect(status).toBe("fail");
  });

  test("is missing with fewer tests than the minimum", () => {
    const three = criterion("FFI-06", "P0-4", "ffi", ["x86_64"], 3);
    const status = singleStatus(three, [
      evidence("ffi", "x86_64", [passed("FFI-06: a"), passed("FFI-06: b")]),
    ]);
    expect(status).toBe("missing");
  });

  test("fails on a passing test with no assertions", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [{ name: "FFI-01: a", status: "passed", assertions: 0 }]),
    ]);
    expect(status).toBe("fail");
  });

  test("fails on a passing test with a negative assertion count", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [{ name: "FFI-01: a", status: "passed", assertions: -1 }]),
    ]);
    expect(status).toBe("fail");
  });
});

describe("Evidence Binding", () => {
  const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);

  test("marks criteria stale when the tree hash differs", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [passed("FFI-01: a")], { pocTreeSha256: "f".repeat(64) }),
    ]);
    expect(status).toBe("stale");
  });

  test("marks criteria stale on a wrong Bun version", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [passed("FFI-01: a")], { bunVersion: "1.4.1" }),
    ]);
    expect(status).toBe("stale");
  });

  test("marks criteria stale on a wrong Bun revision", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [passed("FFI-01: a")], { bunRevision: "0000000000" }),
    ]);
    expect(status).toBe("stale");
  });

  test("marks criteria stale when the product source hash differs", () => {
    const status = singleStatus(ffi, [
      evidence("ffi", "x86_64", [passed("FFI-01: a")], { productSourcesSha256: "f".repeat(64) }),
    ]);
    expect(status).toBe("stale");
  });

  test("marks aarch64 criteria stale on an x86_64 kernel", () => {
    const both = criterion("FFI-01", "P0-4", "ffi", ["aarch64"]);
    const status = singleStatus(both, [
      evidence("ffi", "aarch64", [passed("FFI-01: a")], { kernel: "6.8.0-1018-azure x86_64" }),
    ]);
    expect(status).toBe("stale");
  });

  test("reports each binding problem from the pin and hashes", () => {
    const problems = checkBinding(
      evidence("ffi", "x86_64", [], { bunVersion: "1.0.0", pocTreeSha256: "0".repeat(64) }),
      TREE_HASH,
      SOURCES_HASH,
    );
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.some((problem) => problem.includes("bun version"))).toBe(true);
    expect(problems.some((problem) => problem.includes("tree hash"))).toBe(true);
  });
});

describe("Outcome Evaluation", () => {
  test("returns Go when everything passes", () => {
    const both = criterion("FFI-01", "P0-4", "ffi", ["x86_64", "aarch64"]);
    const result = evaluate(
      gateInput({
        catalog: [both],
        evidence: [
          evidence("ffi", "x86_64", [passed("FFI-01: a")]),
          evidence("ffi", "aarch64", [passed("FFI-01: a")]),
        ],
      }),
    );
    expect(result.outcome).toBe("Go");
    expect(result.blockers).toEqual([]);
    expect(result.criteria.map((entry) => entry.status)).toEqual(["pass", "pass"]);
  });

  test("returns No-Go and names the criterion and architecture when one is missing", () => {
    const both = criterion("FFI-01", "P0-4", "ffi", ["x86_64", "aarch64"]);
    const result = evaluate(
      gateInput({
        catalog: [both],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
      }),
    );
    expect(result.outcome).toBe("No-Go");
    expect(result.blockers).toContain("FFI-01 aarch64: missing");
  });

  test("returns No-Go and names the spawn backend when they disagree", () => {
    const processCriterion = criterion("PROC-01", "P0-2", "process", ["x86_64"]);
    const acpCriterion = criterion("ACP-01-OC", "P0-2", "acp", ["x86_64"]);
    const result = evaluate(
      gateInput({
        catalog: [processCriterion, acpCriterion],
        evidence: [
          evidence("process", "x86_64", [passed("PROC-01: a")], { spawnBackend: "node" }),
          evidence("acp", "x86_64", [passed("ACP-01-OC: a")], { spawnBackend: "bun" }),
        ],
      }),
    );
    expect(result.outcome).toBe("No-Go");
    expect(result.criteria.map((entry) => entry.status)).toEqual(["pass", "pass"]);
    const backend = result.blockers.find((blocker) => blocker.includes("spawnBackend"));
    expect(backend).toBeDefined();
    expect(backend).toContain("node");
    expect(backend).toContain("bun");
  });

  test("returns No-Go and names the baseline when it is invalid", () => {
    const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const result = evaluate(
      gateInput({
        catalog: [ffi],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
        baselineState: "invalid",
      }),
    );
    expect(result.outcome).toBe("No-Go");
    expect(result.blockers.some((blocker) => blocker.includes("baseline"))).toBe(true);
  });

  test("refuses an invalid catalog", () => {
    const duplicate = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const result = evaluate(
      gateInput({
        catalog: [duplicate, { ...duplicate }],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
      }),
    );
    expect(result.outcome).toBe("No-Go");
    expect(result.blockers.some((blocker) => blocker.includes("duplicate"))).toBe(true);
  });

  test("lists every non-passing criterion as a blocker", () => {
    const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const result: GateResult = evaluate(gateInput({ catalog: [ffi] }));
    expect(result.blockers).toContain("FFI-01 x86_64: missing");
  });
});

describe("Product Isolation Condition", () => {
  test("reports a changed product file", () => {
    expect(isolationViolations(["src/main.ts"])).toEqual(["src/main.ts"]);
  });

  test("returns No-Go when a product file changed", () => {
    const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const result = evaluate(
      gateInput({
        catalog: [ffi],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
        changedPaths: ["src/main.ts"],
      }),
    );
    expect(result.blockers.some((blocker) => blocker.includes("src/main.ts"))).toBe(true);
    expect(result.outcome).toBe("No-Go");
  });

  test("reports another workflow file", () => {
    expect(isolationViolations([".github/workflows/ci.yaml"])).toEqual([
      ".github/workflows/ci.yaml",
    ]);
    const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);
    const result = evaluate(
      gateInput({
        catalog: [ffi],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
        changedPaths: [".github/workflows/ci.yaml"],
      }),
    );
    expect(result.outcome).toBe("No-Go");
  });

  test("accepts only the allowed paths", () => {
    const [workflow] = ALLOWED_CHANGED_FILES;
    const changed = [
      "migration/bun/poc/gate/catalog.ts",
      "openspec/changes/x/tasks.md",
      "docs/superpowers/specs/x.md",
      workflow,
    ];
    expect(isolationViolations(changed)).toEqual([]);
  });
});

function recordFrom(result: GateResult, overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    schemaVersion: 1,
    outcome: result.outcome,
    decidedAt: "2026-11-08T00:00:00.000Z",
    freezeSha: "734c8b03c60a021a3982a07d18c3c3f75962c472",
    head: "f3926fd938585fd9b919a813d3c51e57f0af91f5",
    pins: POC_PINS,
    pocTreeSha256: TREE_HASH,
    productSourcesSha256: SOURCES_HASH,
    changedPaths: [],
    baselineState: "valid",
    criteria: result.criteria,
    blockers: result.blockers,
    deferrals: [...DEFERRALS],
    observations: {},
    ...overrides,
  };
}

/** A real-catalog evaluation with no evidence: every criterion is missing. */
function noEvidenceResult(): GateResult {
  return evaluate({
    catalog: CRITERIA,
    deferrals: DEFERRALS,
    evidence: [],
    pocTreeSha256: TREE_HASH,
    productSourcesSha256: SOURCES_HASH,
    changedPaths: [],
    baselineState: "valid",
  });
}

function outcomeLineCount(markdown: string, outcome: "Go" | "No-Go"): number {
  return markdown.split("\n").filter((line) => line === `Outcome: ${outcome}`).length;
}

describe("Outcome Record", () => {
  const ffi = criterion("FFI-01", "P0-4", "ffi", ["x86_64"]);

  test("a Go record states the outcome and the still-open P0 scope", () => {
    const result = evaluate(
      gateInput({
        catalog: [ffi],
        evidence: [evidence("ffi", "x86_64", [passed("FFI-01: a")])],
      }),
    );
    expect(result.outcome).toBe("Go");
    const markdown = renderMarkdown(recordFrom(result));
    expect(outcomeLineCount(markdown, "Go")).toBe(1);
    expect(markdown).toContain("Open after this decision");
    expect(markdown).toContain("Production variable set");
    expect(markdown).toContain("None.");
    expect(markdown).toContain("Plan design section 8 steps 3 to 8");
    expect(markdown).toContain(POC_PINS.bunVersion);
  });

  test("a No-Go record states the outcome and every blocker", () => {
    const result = noEvidenceResult();
    expect(result.outcome).toBe("No-Go");
    const markdown = renderMarkdown(recordFrom(result));
    expect(outcomeLineCount(markdown, "No-Go")).toBe(1);
    for (const blocker of result.blockers) expect(markdown).toContain(blocker);
    expect(markdown).toContain("Stop the migration");
  });

  test("writes the machine-readable and Markdown records", () => {
    const record = recordFrom(noEvidenceResult());
    const dir = tempRoot("bun-gate-record-");
    writeRecord(record, dir);
    const written = JSON.parse(readFileSync(join(dir, "GO-NO-GO.json"), "utf8")) as OutcomeRecord;
    expect(written).toEqual(record);
    expect(readFileSync(join(dir, "GO-NO-GO.md"), "utf8")).toBe(renderMarkdown(record));
  });
});

describe("Outcome Record Verification", () => {
  test("reports no difference for a matching record", () => {
    const result = noEvidenceResult();
    expect(compareRecord(recordFrom(result), result)).toEqual([]);
  });

  test("reports an edited outcome", () => {
    const result = noEvidenceResult();
    const problems = compareRecord(recordFrom(result, { outcome: "Go" }), result);
    expect(problems.some((problem) => problem.includes("outcome"))).toBe(true);
  });

  test("reports an edited criterion status and a duplicate entry", () => {
    const result = noEvidenceResult();
    const record = recordFrom(result);
    const edited = { ...record, criteria: [{ ...record.criteria[0], status: "pass" as const }] };
    expect(compareRecord(edited, result).some((problem) => problem.includes("criteria:"))).toBe(true);

    const duplicated = { ...record, criteria: [record.criteria[0], record.criteria[0]] };
    expect(compareRecord(duplicated, result).some((problem) => problem.includes("duplicate"))).toBe(
      true,
    );
  });

  test("reports a live tree hash mismatch", () => {
    const record = recordFrom(noEvidenceResult());
    const problems = compareLive(record, {
      pocTreeSha256: "f".repeat(64),
      productSourcesSha256: record.productSourcesSha256,
      violations: [],
    });
    expect(problems.some((problem) => problem.includes("pocTreeSha256"))).toBe(true);
  });

  test("reports a live product source mismatch and an isolation violation", () => {
    const record = recordFrom(noEvidenceResult());
    const problems = compareLive(record, {
      pocTreeSha256: record.pocTreeSha256,
      productSourcesSha256: "f".repeat(64),
      violations: ["src/main.ts"],
    });
    expect(problems.some((problem) => problem.includes("productSourcesSha256"))).toBe(true);
    expect(problems.some((problem) => problem.includes("src/main.ts"))).toBe(true);
  });

  test("reports a recorded isolation violation that the checkout no longer has", () => {
    const record = recordFrom(noEvidenceResult(), { changedPaths: ["src/main.ts"] });
    const problems = compareLive(record, {
      pocTreeSha256: record.pocTreeSha256,
      productSourcesSha256: record.productSourcesSha256,
      violations: [],
    });
    expect(problems.some((problem) => problem.includes("src/main.ts"))).toBe(true);
  });

  function runVerify(args: string[]): { exitCode: number; stderr: string } {
    const result = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "verify-record.ts"), ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
    return { exitCode: result.exitCode ?? 1, stderr: result.stderr.toString() };
  }

  function pocWithRecord(record: OutcomeRecord): string {
    const dir = tempRoot("bun-gate-verify-");
    writeFileSync(join(dir, "GO-NO-GO.json"), `${JSON.stringify(record, null, 2)}\n`);
    return dir;
  }

  test("exits 0 for a record produced from the committed evidence", () => {
    const dir = pocWithRecord(recordFrom(noEvidenceResult()));
    expect(runVerify(["--poc", dir])).toEqual({ exitCode: 0, stderr: "" });
  });

  test("exits 1 and names the outcome for an edited record", () => {
    const dir = pocWithRecord(recordFrom(noEvidenceResult(), { outcome: "Go" }));
    const run = runVerify(["--poc", dir]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("outcome");
  });

  test("exits 1 and names the hash mismatch for live verification on a changed tree", () => {
    const poc = pocWithRecord(recordFrom(noEvidenceResult()));
    const repo = tempRoot("bun-gate-repo-");
    for (const relativePath of PRODUCT_SOURCES) {
      const path = join(repo, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "// product source\n");
    }
    const run = runVerify(["--live", "--poc", poc, "--repo", repo]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("pocTreeSha256");
  });

  test("exits 0 without live verification on a later tree", () => {
    const dir = pocWithRecord(recordFrom(noEvidenceResult()));
    writeFileSync(join(dir, "later.txt"), "changed after the record\n");
    expect(runVerify(["--poc", dir])).toEqual({ exitCode: 0, stderr: "" });
  });
});
