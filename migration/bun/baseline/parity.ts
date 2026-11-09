import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { BaselineTest } from "./records-schema.ts";

export interface BunTestResult {
  file: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  failureType?: string;
  failureMessage?: string;
}

export type Disposition = "removed" | "skipped" | "renamed";

export interface ParityReplacement {
  file: string;
  name: string;
}

export interface ParityException {
  file: string;
  name: string;
  disposition: Disposition;
  reason: string;
  replacement?: ParityReplacement;
}

export interface ParityOptions {
  scope?: readonly string[];
  allowDeferred?: boolean;
}

export interface ParityFailure {
  file: string;
  name: string;
  type: string;
  message: string;
}

export interface ParitySummary {
  scope: string[];
  baselineInScope: number;
  matched: number;
  missing: { file: string; name: string }[];
  failures: ParityFailure[];
  deferred: { file: string; name: string }[];
  exceptionsApplied: number;
  invalidExceptions: string[];
  ok: boolean;
}

interface ExceptionsRecord {
  schemaVersion: 1;
  exceptions: ParityException[];
}

interface TestRecord {
  schemaVersion: 1;
  tests: BaselineTest[];
}

const DISPOSITIONS: readonly Disposition[] = ["removed", "skipped", "renamed"];
const BASELINE_STATUSES: readonly BaselineTest["status"][] = [
  "passed",
  "failed",
  "ignored",
];

// Same configuration as `junit.ts`: attributes lose their prefix, and the
// element-only `isArray` keeps attribute lookups from turning suites or cases
// into accidental arrays.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: true,
  isArray: (name, _jpath, _isLeafNode, isAttribute) =>
    !isAttribute && (name === "testsuite" || name === "testcase"),
});

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stripDotSlash(value: string): string {
  return value.replace(/^\.\//, "");
}

function testKey(test: { file: string; name: string }): string {
  return `${test.file}\u0000${test.name}`;
}

function statusOf(testCase: Record<string, unknown>): BunTestResult["status"] {
  // `fast-xml-parser` parses an attribute-less empty element such as
  // `<skipped />` as `""`, so presence is checked against `undefined`.
  if (testCase.failure !== undefined || testCase.error !== undefined) {
    return "failed";
  }
  if (testCase.skipped !== undefined) return "skipped";
  return "passed";
}

function failureOf(
  testCase: Record<string, unknown>,
): { type?: string; message?: string } | undefined {
  const element = testCase.failure ?? testCase.error;
  if (element === undefined) return undefined;
  const failure = asObject(element);
  return {
    type: typeof failure.type === "string" ? failure.type : undefined,
    message: typeof failure.message === "string" ? failure.message : undefined,
  };
}

/**
 * Parses Bun's `--reporter=junit` output into one entry per test case. Each
 * top-level `testsuite` is a file; its name is not a `describe`, so only nested
 * suite names join the prefix that makes the full name match Deno's
 * `Parent > step` step naming.
 */
export function parseBunJunit(xml: string): BunTestResult[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(
      `invalid JUnit XML: ${validation.err.msg} at line ${validation.err.line}`,
    );
  }

  const root = asObject(parser.parse(xml));
  const results: BunTestResult[] = [];

  const visit = (
    suite: Record<string, unknown>,
    prefixes: string[],
    inheritedFile: string | undefined,
    topLevel: boolean,
  ): void => {
    const suiteName = typeof suite.name === "string" ? suite.name : "";
    const suiteFile = typeof suite.file === "string"
      ? stripDotSlash(suite.file)
      : inheritedFile ??
        (topLevel && suiteName !== "" ? stripDotSlash(suiteName) : undefined);
    const nextPrefixes = topLevel || suiteName === ""
      ? prefixes
      : [...prefixes, suiteName];

    for (const raw of asArray(suite.testcase)) {
      const testCase = asObject(raw);
      const file = typeof testCase.file === "string"
        ? stripDotSlash(testCase.file)
        : suiteFile ?? "";
      const testName = typeof testCase.name === "string" ? testCase.name : "";
      const result: BunTestResult = {
        file,
        name: [...nextPrefixes, testName].filter((part) => part !== "").join(
          " > ",
        ),
        status: statusOf(testCase),
      };
      const failure = failureOf(testCase);
      if (failure?.type !== undefined) result.failureType = failure.type;
      if (failure?.message !== undefined) {
        result.failureMessage = failure.message;
      }
      results.push(result);
    }

    for (const raw of asArray(suite.testsuite)) {
      visit(asObject(raw), nextPrefixes, suiteFile, false);
    }
  };

  if (root.testsuites !== undefined) {
    for (const raw of asArray(asObject(root.testsuites).testsuite)) {
      visit(asObject(raw), [], undefined, true);
    }
  } else {
    visit(root, [], undefined, true);
  }
  return results;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validateException(
  raw: unknown,
  index: number,
  baselineKeys: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): { exception?: ParityException; problem?: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { problem: `exception ${index}: not an object` };
  }
  const record = raw as Record<string, unknown>;
  const file = record.file;
  const name = record.name;
  const label = `exception ${index}` +
    (typeof file === "string"
      ? ` (${file}${typeof name === "string" ? ` > ${name}` : ""})`
      : "");

  if (!isNonEmptyString(file)) {
    return { problem: `${label}: file must be a non-empty string` };
  }
  if (!isNonEmptyString(name)) {
    return { problem: `${label}: name must be a non-empty string` };
  }
  const disposition = record.disposition;
  if (!DISPOSITIONS.includes(disposition as Disposition)) {
    return {
      problem: `${label}: disposition must be removed, skipped or renamed`,
    };
  }
  if (!isNonEmptyString(record.reason)) {
    return { problem: `${label}: reason must not be empty` };
  }

  const replacement = record.replacement;
  if (disposition === "renamed") {
    const replacementRecord = asObject(replacement);
    if (
      replacement === undefined || !isNonEmptyString(replacementRecord.file) ||
      !isNonEmptyString(replacementRecord.name)
    ) {
      return {
        problem:
          `${label}: renamed exception needs a replacement file and name`,
      };
    }
  } else if (replacement !== undefined) {
    return {
      problem: `${label}: replacement is only allowed for renamed exceptions`,
    };
  }

  const key = testKey({ file, name });
  if (!baselineKeys.has(key)) {
    return { problem: `${label}: matches no baseline test` };
  }
  if (seen.has(key)) {
    return { problem: `${label}: duplicate exception for the same test` };
  }

  const exception: ParityException = {
    file,
    name,
    disposition: disposition as Disposition,
    reason: record.reason,
  };
  if (disposition === "renamed") {
    const replacementRecord = asObject(replacement);
    exception.replacement = {
      file: replacementRecord.file as string,
      name: replacementRecord.name as string,
    };
  }
  return { exception };
}

/**
 * Compares a Bun report with the Deno baseline. `ok` is false exactly when the
 * command must exit non-zero: missing names, real failures, invalid exception
 * records, or deferred failures without `allowDeferred`.
 */
export function checkParity(
  baseline: readonly BaselineTest[],
  results: readonly BunTestResult[],
  exceptions: readonly ParityException[],
  options: ParityOptions = {},
): ParitySummary {
  const scope = (options.scope ?? [])
    .map((prefix) => stripDotSlash(prefix))
    .filter((prefix) => prefix !== "");
  const inScope = baseline.filter((test) =>
    scope.length === 0 || scope.some((prefix) => test.file.startsWith(prefix))
  );

  const baselineKeys = new Set(baseline.map(testKey));
  const seen = new Set<string>();
  const validExceptions: ParityException[] = [];
  const invalidExceptions: string[] = [];
  exceptions.forEach((raw, index) => {
    const validated = validateException(raw, index, baselineKeys, seen);
    if (validated.problem !== undefined) {
      invalidExceptions.push(validated.problem);
      return;
    }
    if (validated.exception !== undefined) {
      validExceptions.push(validated.exception);
      seen.add(testKey(validated.exception));
    }
  });
  const exceptionByKey = new Map(
    validExceptions.map((exception) => [testKey(exception), exception]),
  );

  const queues = new Map<string, { items: BunTestResult[]; cursor: number }>();
  for (const result of results) {
    const key = testKey(result);
    const queue = queues.get(key);
    if (queue === undefined) queues.set(key, { items: [result], cursor: 0 });
    else queue.items.push(result);
  }
  const take = (key: string): BunTestResult | undefined => {
    const queue = queues.get(key);
    if (queue === undefined || queue.cursor >= queue.items.length) {
      return undefined;
    }
    const result = queue.items[queue.cursor];
    queue.cursor += 1;
    return result;
  };

  const missing: { file: string; name: string }[] = [];
  const failures: ParityFailure[] = [];
  const deferred: { file: string; name: string }[] = [];
  let matched = 0;
  let exceptionsApplied = 0;

  const recordOutcome = (
    baselineTest: BaselineTest,
    result: BunTestResult,
  ): void => {
    if (baselineTest.status !== "passed" || result.status === "passed") return;
    if (result.status === "skipped") {
      if (
        exceptionByKey.get(testKey(baselineTest))?.disposition === "skipped"
      ) {
        exceptionsApplied += 1;
        return;
      }
      failures.push({
        file: baselineTest.file,
        name: baselineTest.name,
        type: "skipped",
        message: "Bun reported the test as skipped",
      });
      return;
    }
    if (
      result.failureType === "ReferenceError" &&
      result.failureMessage === "Deno is not defined"
    ) {
      deferred.push({ file: baselineTest.file, name: baselineTest.name });
      return;
    }
    failures.push({
      file: baselineTest.file,
      name: baselineTest.name,
      type: result.failureType ?? "Error",
      message: result.failureMessage ?? "",
    });
  };

  for (const baselineTest of inScope) {
    const direct = take(testKey(baselineTest));
    if (direct !== undefined) {
      matched += 1;
      recordOutcome(baselineTest, direct);
      continue;
    }

    const exception = exceptionByKey.get(testKey(baselineTest));
    if (exception !== undefined && exception.disposition !== "renamed") {
      exceptionsApplied += 1;
      continue;
    }
    if (exception?.replacement !== undefined) {
      const replacement = take(testKey(exception.replacement));
      if (replacement !== undefined) {
        matched += 1;
        exceptionsApplied += 1;
        recordOutcome(baselineTest, replacement);
        continue;
      }
    }
    missing.push({ file: baselineTest.file, name: baselineTest.name });
  }

  return {
    scope,
    baselineInScope: inScope.length,
    matched,
    missing,
    failures,
    deferred,
    exceptionsApplied,
    invalidExceptions,
    ok: missing.length === 0 && failures.length === 0 &&
      invalidExceptions.length === 0 &&
      (deferred.length === 0 || options.allowDeferred === true),
  };
}

const repoRoot = resolve(import.meta.dir, "../../..");
const recordsDir = join(import.meta.dir, "records");
const exceptionsFile = join(import.meta.dir, "parity-exceptions.json");

/** Resolves a report path against the repository root, never the working directory. */
export function resolveJunitPath(input: string): string {
  return isAbsolute(input) ? input : resolve(repoRoot, input);
}

function usage(message: string): never {
  console.error(`parity: ${message}`);
  console.error(
    "usage: bun run --no-env-file parity.ts --junit <path> --scope <prefix> [--scope <prefix>...] [--allow-deferred]",
  );
  process.exit(2);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `parity: cannot read ${path}: ${
        error instanceof Error ? error.message : error
      }`,
    );
    process.exit(2);
  }
}

function loadBaseline(): BaselineTest[] {
  const record = asObject(readJson(join(recordsDir, "deno-tests.json")));
  if (record.schemaVersion !== 1 || !Array.isArray(record.tests)) {
    console.error(
      'parity: records/deno-tests.json needs schemaVersion 1 and a "tests" array',
    );
    process.exit(2);
  }
  return record.tests.map((raw, index) => {
    const test = asObject(raw);
    if (
      !isNonEmptyString(test.file) || typeof test.name !== "string" ||
      !BASELINE_STATUSES.includes(test.status as BaselineTest["status"])
    ) {
      console.error(
        `parity: records/deno-tests.json test ${index} is malformed`,
      );
      process.exit(2);
    }
    return {
      file: test.file,
      name: test.name,
      status: test.status as BaselineTest["status"],
    };
  });
}

function loadExceptions(): ParityException[] {
  const record = asObject(readJson(exceptionsFile)) as Partial<
    ExceptionsRecord
  >;
  if (record.schemaVersion !== 1 || !Array.isArray(record.exceptions)) {
    console.error(
      'parity: parity-exceptions.json needs schemaVersion 1 and an "exceptions" array',
    );
    process.exit(2);
  }
  return record.exceptions;
}

function loadReport(path: string): BunTestResult[] {
  let xml: string;
  try {
    xml = readFileSync(path, "utf8");
  } catch (error) {
    console.error(
      `parity: cannot read ${path}: ${
        error instanceof Error ? error.message : error
      }`,
    );
    process.exit(2);
  }
  try {
    return parseBunJunit(xml);
  } catch (error) {
    console.error(
      `parity: ${path}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(2);
  }
}

function parseArguments(argv: readonly string[]): {
  junit: string;
  scope: string[];
  allowDeferred: boolean;
} {
  let junit: string | undefined;
  const scope: string[] = [];
  let allowDeferred = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--junit": {
        junit = argv[index + 1];
        index += 1;
        if (junit === undefined || junit === "") usage("--junit needs a path");
        break;
      }
      case "--scope": {
        const value = argv[index + 1];
        index += 1;
        if (value === undefined || stripDotSlash(value) === "") {
          usage("--scope needs a non-empty file prefix");
        }
        scope.push(value);
        break;
      }
      case "--allow-deferred":
        allowDeferred = true;
        break;
      default:
        usage(`unknown argument ${argument}`);
    }
  }

  if (junit === undefined) usage("--junit is required");
  return { junit, scope, allowDeferred };
}

function main(): number {
  const options = parseArguments(process.argv.slice(2));
  const summary = checkParity(
    loadBaseline(),
    loadReport(resolveJunitPath(options.junit)),
    loadExceptions(),
    { scope: options.scope, allowDeferred: options.allowDeferred },
  );
  console.log(JSON.stringify(summary, null, 2));
  return summary.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main());
}
