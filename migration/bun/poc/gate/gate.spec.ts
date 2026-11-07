import { describe, expect, test } from "bun:test";
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
import { POC_PINS } from "./pins.ts";

const TREE_HASH = "1".repeat(64);
const SOURCES_HASH = "2".repeat(64);

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
    const status = singleStatus(ffi, [evidence("ffi", "x86_64", [passed("FFI-01: a")].map((entry) => ({ ...entry, assertions: 0 })))]);
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
  });

  test("accepts only the allowed paths", () => {
    const [workflow] = ALLOWED_CHANGED_FILES;
    const changed = ["migration/bun/poc/gate/catalog.ts", "openspec/changes/x/tasks.md", "docs/superpowers/specs/x.md", workflow];
    expect(isolationViolations(changed)).toEqual([]);
  });
});
