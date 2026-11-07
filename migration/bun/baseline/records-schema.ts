import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TestStatus = "passed" | "failed" | "ignored";

export interface BaselineTest {
  file: string;
  name: string;
  status: TestStatus;
}

export interface DenoTestRecord {
  schemaVersion: 1;
  tests: BaselineTest[];
}

export interface CoverageSummary {
  branchPercent: number;
  functionPercent: number;
  linePercent: number;
}

export interface BaselineSummary {
  schemaVersion: 1;
  freezeSha: string;
  branchHead: string;
  capturedAt: string;
  denoVersion: string;
  appVersion: string;
  command: string[];
  totals: { tests: number; passed: number; failed: number; ignored: number };
  coverage: CoverageSummary;
}

export interface RollbackReference {
  schemaVersion: 1;
  capturedAt: string;
  reference: string;
  digest: string;
  sourceRevision: string;
  observedFrom: string;
}

export type BaselineState = "valid" | "invalid";

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DIGEST_REFERENCE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const STATUSES: TestStatus[] = ["passed", "failed", "ignored"];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Reads one record file; a missing or unparsable file is reported, not thrown. */
function readRecord(recordsDir: string, name: string, problems: string[]): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(join(recordsDir, name), "utf8");
  } catch {
    problems.push(`missing ${name}`);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) {
      problems.push(`${name} is not a JSON object`);
      return null;
    }
    return parsed;
  } catch (error) {
    problems.push(`${name} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function validateTestRecord(
  record: Record<string, unknown>,
  name: string,
  problems: string[],
): BaselineTest[] | null {
  const before = problems.length;
  if (record.schemaVersion !== 1) problems.push(`${name} schemaVersion must be 1`);
  if (!Array.isArray(record.tests)) {
    problems.push(`${name} tests must be an array`);
    return null;
  }
  const tests: BaselineTest[] = [];
  for (const [index, entry] of record.tests.entries()) {
    if (!isObject(entry)) {
      problems.push(`${name} tests[${index}] is not an object`);
      continue;
    }
    const file = entry.file;
    const testName = entry.name;
    const status = entry.status;
    if (typeof file !== "string") problems.push(`${name} tests[${index}].file must be a string`);
    if (typeof testName !== "string") problems.push(`${name} tests[${index}].name must be a string`);
    if (typeof status !== "string" || !STATUSES.includes(status as TestStatus)) {
      problems.push(`${name} tests[${index}].status "${String(status)}" is not passed, failed or ignored`);
      continue;
    }
    tests.push({ file: String(file), name: String(testName), status: status as TestStatus });
  }
  return problems.length === before ? tests : null;
}

function validateBaseline(
  record: Record<string, unknown>,
  name: string,
  problems: string[],
): string | null {
  if (record.schemaVersion !== 1) problems.push(`${name} schemaVersion must be 1`);
  if (typeof record.freezeSha !== "string" || !SHA40.test(record.freezeSha)) {
    problems.push(`${name} freezeSha "${String(record.freezeSha)}" is not a 40-character hex SHA`);
  }
  if (typeof record.branchHead !== "string" || !SHA40.test(record.branchHead)) {
    problems.push(`${name} branchHead "${String(record.branchHead)}" is not a 40-character hex SHA`);
  }
  if (!isDate(record.capturedAt)) problems.push(`${name} capturedAt "${String(record.capturedAt)}" is not a date`);
  if (!isNonEmptyString(record.denoVersion)) problems.push(`${name} denoVersion must be a non-empty string`);
  if (!isNonEmptyString(record.appVersion)) problems.push(`${name} appVersion must be a non-empty string`);
  if (!Array.isArray(record.command) || record.command.some((arg) => typeof arg !== "string")) {
    problems.push(`${name} command must be an array of strings`);
  }
  if (!isObject(record.totals)) {
    problems.push(`${name} totals must be an object`);
  } else {
    for (const key of ["tests", "passed", "failed", "ignored"] as const) {
      if (!isCount(record.totals[key])) {
        problems.push(`${name} totals.${key} "${String(record.totals[key])}" is not a count`);
      }
    }
  }
  if (!isObject(record.coverage)) {
    problems.push(`${name} coverage must be an object`);
  } else {
    for (const key of ["branchPercent", "functionPercent", "linePercent"] as const) {
      const value = record.coverage[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`${name} coverage.${key} "${String(value)}" is not a number`);
      }
    }
  }
  return typeof record.freezeSha === "string" && SHA40.test(record.freezeSha) ? record.freezeSha : null;
}

function countTests(tests: BaselineTest[]): BaselineSummary["totals"] {
  return {
    tests: tests.length,
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    ignored: tests.filter((test) => test.status === "ignored").length,
  };
}

function validateTotals(
  record: Record<string, unknown>,
  name: string,
  tests: BaselineTest[],
  problems: string[],
) {
  if (!isObject(record.totals)) return;
  const counted = countTests(tests);
  for (const key of ["tests", "passed", "failed", "ignored"] as const) {
    const total = record.totals[key];
    if (total !== counted[key]) {
      problems.push(
        `${name} totals.${key} (${String(total)}) does not match the ${counted[key]} entries counted in deno-tests.json`,
      );
    }
  }
}

function validateRollback(
  record: Record<string, unknown>,
  name: string,
  freezeSha: string | null,
  problems: string[],
) {
  if (record.schemaVersion !== 1) problems.push(`${name} schemaVersion must be 1`);
  if (!isDate(record.capturedAt)) problems.push(`${name} capturedAt "${String(record.capturedAt)}" is not a date`);
  if (!isNonEmptyString(record.observedFrom)) problems.push(`${name} observedFrom must be a non-empty string`);

  const reference = record.reference;
  if (typeof reference !== "string" || !DIGEST_REFERENCE.test(reference)) {
    problems.push(`${name} reference "${String(reference)}" is not an immutable image digest reference`);
  }

  const digest = record.digest;
  const digestValid = typeof digest === "string" && DIGEST.test(digest);
  if (!digestValid) {
    problems.push(`${name} digest "${String(digest)}" is not sha256:<64 hex characters>`);
  }
  if (typeof reference === "string" && DIGEST_REFERENCE.test(reference) && digestValid && !reference.endsWith(`@${digest}`)) {
    problems.push(`${name} reference "${reference}" does not end with its digest "${String(digest)}"`);
  }

  const revision = record.sourceRevision;
  if (typeof revision !== "string" || !SHA40.test(revision)) {
    problems.push(`${name} sourceRevision "${String(revision)}" is not a 40-character hex SHA`);
    return;
  }
  if (freezeSha !== null && revision !== freezeSha) {
    problems.push(
      `${name} sourceRevision "${revision}" does not match baseline.json freezeSha "${freezeSha}"`,
    );
  }
}

/** Reports whether the record directory is a complete, consistent baseline. */
export function validateBaselineDir(recordsDir: string): { state: BaselineState; problems: string[] } {
  const problems: string[] = [];

  const testRecord = readRecord(recordsDir, "deno-tests.json", problems);
  const tests = testRecord ? validateTestRecord(testRecord, "deno-tests.json", problems) : null;

  const baseline = readRecord(recordsDir, "baseline.json", problems);
  const freezeSha = baseline ? validateBaseline(baseline, "baseline.json", problems) : null;

  const rollback = readRecord(recordsDir, "rollback-reference.json", problems);
  if (rollback) validateRollback(rollback, "rollback-reference.json", freezeSha, problems);

  // Totals are only comparable when the test record itself is sound.
  if (baseline && tests) validateTotals(baseline, "baseline.json", tests, problems);

  return { state: problems.length === 0 ? "valid" : "invalid", problems };
}
