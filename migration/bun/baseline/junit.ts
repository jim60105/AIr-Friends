import { XMLParser } from "fast-xml-parser";
import type { BaselineTest, CoverageSummary } from "./records-schema.ts";

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: true,
  // Attributes share the element namespace once their prefix is removed, so the
  // element-only test keeps a `testsuite`/`testcase` attribute from becoming an array.
  isArray: (name, _jpath, _isLeafNode, isAttribute) =>
    !isAttribute && (name === "testsuite" || name === "testcase"),
});

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Collects `testcase` elements from every `testsuite`, including nested suites. */
function collectTestCases(suiteHolder: Record<string, unknown>): Record<string, unknown>[] {
  const cases: Record<string, unknown>[] = [];
  for (const suite of asArray(suiteHolder.testsuite)) {
    const suiteObject = asObject(suite);
    for (const testCase of asArray(suiteObject.testcase)) {
      cases.push(asObject(testCase));
    }
    cases.push(...collectTestCases(suiteObject));
  }
  return cases;
}

function statusOf(testCase: Record<string, unknown>): BaselineTest["status"] {
  // `fast-xml-parser` maps an element without attributes or text to `""`, which is
  // falsy, so presence is checked against `undefined` instead of truthiness.
  if (testCase.failure !== undefined) return "failed";
  if (testCase.skipped !== undefined) return "ignored";
  return "passed";
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Parses Deno's `--junit-path` output into one entry per test case. */
export function parseDenoJunit(xml: string): BaselineTest[] {
  const root = asObject(parser.parse(xml));
  const suiteHolder = asObject(root.testsuites ?? root);
  const tests = collectTestCases(suiteHolder).map((testCase) => ({
    file: String(testCase.classname ?? "").replace(/^\.\//, ""),
    name: String(testCase.name ?? ""),
    status: statusOf(testCase),
  }));
  // Array.prototype.sort is stable, so repeated file/name pairs keep their order.
  return tests.sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.name, b.name));
}

function parsePercent(cell: string, row: string): number {
  const value = Number.parseFloat(cell.trim());
  if (Number.isNaN(value)) {
    throw new Error(`coverage table row "${row.trim()}" has a non-numeric percentage`);
  }
  return value;
}

/** Reads branch, function and line percentages from Deno's `All files` row. */
export function parseCoverageTable(text: string): CoverageSummary {
  const lines = text.replace(ANSI_ESCAPE, "").split("\n");
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line.split("|");
    if (cells[1]?.trim() !== "All files") continue;
    if (cells.length < 5) {
      throw new Error(`coverage table row "${line.trim()}" is missing percentage columns`);
    }
    return {
      branchPercent: parsePercent(cells[2], line),
      functionPercent: parsePercent(cells[3], line),
      linePercent: parsePercent(cells[4], line),
    };
  }
  throw new Error('coverage table has no "All files" row');
}
