import type { SuiteEvidence } from "./evidence.ts";
import { POC_PINS } from "./pins.ts";
import { ARCHS, P0_IDS, SUITES } from "./catalog.ts";
import type { Arch, Criterion, Deferral, P0Id, SuiteName } from "./catalog.ts";

export type CriterionStatus = "pass" | "fail" | "missing" | "stale";

export interface CriterionResult {
  id: string;
  p0: P0Id;
  arch: Arch;
  status: CriterionStatus;
  detail: string;
}

export interface GateInput {
  catalog: readonly Criterion[];
  deferrals: readonly Deferral[];
  evidence: readonly SuiteEvidence[];
  pocTreeSha256: string;
  productSourcesSha256: string;
  changedPaths: readonly string[];
  baselineState: "valid" | "invalid";
}

export interface GateResult {
  outcome: "Go" | "No-Go";
  criteria: CriterionResult[];
  blockers: string[];
}

export const ALLOWED_CHANGED_PREFIXES = ["migration/bun/", "openspec/", "docs/superpowers/"] as const;
export const ALLOWED_CHANGED_FILES = [".github/workflows/bun-poc-arm64.yml"] as const;

const CRITERION_ID = /^[A-Z]+-\d{2}(-[A-Z]+)?$/;
/** Suites whose spawn backend must agree: they exercise child processes the same way. */
const SPAWN_BACKEND_SUITES: readonly SuiteName[] = ["process", "acp", "acp-failure"];

/** Paths changed since the merge base that the migration is not allowed to touch. */
export function isolationViolations(changedPaths: readonly string[]): string[] {
  const allowedFiles: readonly string[] = ALLOWED_CHANGED_FILES;
  const allowedPrefixes: readonly string[] = ALLOWED_CHANGED_PREFIXES;
  return changedPaths.filter(
    (path) =>
      !allowedFiles.includes(path) && !allowedPrefixes.some((prefix) => path.startsWith(prefix)),
  );
}

/**
 * Rejects a catalog that cannot decide the migration: an unmapped P0 blocker,
 * a duplicate or malformed identifier, or a criterion without a suite or arch.
 */
export function validateCatalog(
  catalog: readonly Criterion[],
  deferrals: readonly Deferral[],
): string[] {
  const problems: string[] = [];
  const knownP0: readonly string[] = P0_IDS;
  const knownSuites: readonly string[] = SUITES;
  const knownArchs: readonly string[] = ARCHS;

  for (const p0 of P0_IDS) {
    const covered =
      catalog.some((criterion) => criterion.p0 === p0) ||
      deferrals.some((deferral) => deferral.p0 === p0);
    if (!covered) problems.push(`${p0}: no criterion or deferral`);
  }

  const seen = new Set<string>();
  for (const criterion of catalog) {
    const id = criterion.id;
    if (seen.has(id)) problems.push(`duplicate criterion id \`${id}\``);
    seen.add(id);
    if (!CRITERION_ID.test(id)) problems.push(`criterion \`${id}\`: malformed identifier`);
    if (!knownP0.includes(criterion.p0)) problems.push(`criterion \`${id}\`: unknown P0 \`${criterion.p0}\``);
    if (!knownSuites.includes(criterion.suite)) {
      problems.push(`criterion \`${id}\`: unknown suite \`${criterion.suite}\``);
    }
    if (criterion.archs.length === 0) problems.push(`criterion \`${id}\`: no architecture`);
    for (const arch of criterion.archs) {
      if (!knownArchs.includes(arch)) problems.push(`criterion \`${id}\`: unknown architecture \`${arch}\``);
    }
    if (!Number.isInteger(criterion.minTests) || criterion.minTests < 1) {
      problems.push(`criterion \`${id}\`: minTests must be at least 1`);
    }
  }

  for (const deferral of deferrals) {
    if (!knownP0.includes(deferral.p0)) {
      problems.push(`deferral \`${deferral.p0}\`: unknown P0`);
    }
  }

  return problems;
}

/** Problems that make evidence unusable for the current tree and runtime. */
export function checkBinding(
  evidence: SuiteEvidence,
  pocTreeSha256: string,
  productSourcesSha256: string,
): string[] {
  const problems: string[] = [];
  if (evidence.bunVersion !== POC_PINS.bunVersion) {
    problems.push(`bun version ${evidence.bunVersion} differs from pin ${POC_PINS.bunVersion}`);
  }
  if (!evidence.bunRevision.startsWith(POC_PINS.bunRevisionPrefix)) {
    problems.push(
      `bun revision ${evidence.bunRevision} does not start with ${POC_PINS.bunRevisionPrefix}`,
    );
  }
  if (evidence.baseImageDigest !== POC_PINS.baseImageDigest) {
    problems.push(`base image digest ${evidence.baseImageDigest} differs from the pin`);
  }
  if (evidence.opencodeVersion !== POC_PINS.opencodeVersion) {
    problems.push(
      `opencode version ${evidence.opencodeVersion} differs from pin ${POC_PINS.opencodeVersion}`,
    );
  }
  if (evidence.ompVersion !== POC_PINS.ompVersion) {
    problems.push(`omp version ${evidence.ompVersion} differs from pin ${POC_PINS.ompVersion}`);
  }
  if (evidence.pocTreeSha256 !== pocTreeSha256) {
    problems.push(`proof-of-concept tree hash ${evidence.pocTreeSha256} differs from ${pocTreeSha256}`);
  }
  if (evidence.productSourcesSha256 !== productSourcesSha256) {
    problems.push(
      `product sources hash ${evidence.productSourcesSha256} differs from ${productSourcesSha256}`,
    );
  }
  if (evidence.arch === "aarch64" && /x86_64|amd64/i.test(evidence.kernel)) {
    problems.push(`kernel ${evidence.kernel} reports an x86_64 host for aarch64 evidence`);
  }
  return problems;
}

function evaluateCriterion(
  criterion: Criterion,
  arch: Arch,
  input: GateInput,
): CriterionResult {
  const base = { id: criterion.id, p0: criterion.p0, arch };
  const evidence = input.evidence.find(
    (entry) => entry.suite === criterion.suite && entry.arch === arch,
  );
  if (evidence === undefined) {
    return { ...base, status: "missing", detail: `no evidence for suite \`${criterion.suite}\` on ${arch}` };
  }

  const binding = checkBinding(evidence, input.pocTreeSha256, input.productSourcesSha256);
  if (binding.length > 0) {
    return { ...base, status: "stale", detail: binding.join("; ") };
  }

  // A failing hook leaves one `(unnamed)` failure behind and drops the tests it
  // guarded, so a failure anywhere in the suite fails every criterion of it.
  const failed = evidence.tests.filter((test) => test.status === "failed");
  if (failed.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `${failed.length} failed test(s): ${failed.map((test) => test.name).join(", ")}`,
    };
  }

  const prefix = `${criterion.id}:`;
  const prefixed = evidence.tests.filter((test) => test.name.startsWith(prefix));
  const skipped = prefixed.filter((test) => test.status === "skipped");
  if (skipped.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `${skipped.length} skipped test(s): ${skipped.map((test) => test.name).join(", ")}`,
    };
  }
  const unasserted = prefixed.filter((test) => test.status === "passed" && !(test.assertions >= 1));
  if (unasserted.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `no assertions in ${unasserted.map((test) => test.name).join(", ")}`,
    };
  }

  if (prefixed.length < criterion.minTests) {
    return {
      ...base,
      status: "missing",
      detail: `${prefixed.length} of ${criterion.minTests} required test(s) for \`${criterion.id}\``,
    };
  }

  return { ...base, status: "pass", detail: `${prefixed.length} test(s) passed` };
}

function spawnBackendProblems(evidence: readonly SuiteEvidence[]): string[] {
  const problems: string[] = [];
  for (const arch of ARCHS) {
    const backends = new Set(
      evidence
        .filter((entry) => entry.arch === arch && SPAWN_BACKEND_SUITES.includes(entry.suite as SuiteName))
        .map((entry) => entry.spawnBackend),
    );
    if (backends.size > 1) {
      problems.push(`spawnBackend ${arch}: ${[...backends].sort().join(", ")}`);
    }
  }
  return problems;
}

/** Decides Go only when every criterion passes on every required architecture. */
export function evaluate(input: GateInput): GateResult {
  const blockers: string[] = [...validateCatalog(input.catalog, input.deferrals)];

  for (const path of isolationViolations(input.changedPaths)) {
    blockers.push(`isolation: ${path}`);
  }
  if (input.baselineState !== "valid") blockers.push("baseline: invalid");
  blockers.push(...spawnBackendProblems(input.evidence));

  const criteria: CriterionResult[] = [];
  for (const criterion of input.catalog) {
    for (const arch of criterion.archs) {
      const result = evaluateCriterion(criterion, arch, input);
      criteria.push(result);
      if (result.status !== "pass") blockers.push(`${result.id} ${result.arch}: ${result.status}`);
    }
  }

  return { outcome: blockers.length === 0 ? "Go" : "No-Go", criteria, blockers };
}
