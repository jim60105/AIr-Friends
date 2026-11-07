import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { PRODUCT_SOURCES } from "./pins.ts";

export interface EvidenceTest {
  name: string;
  status: "passed" | "failed" | "skipped";
  assertions: number; // JUnit `assertions` attribute
}

export interface SuiteEvidence {
  schemaVersion: 1;
  suite: string;
  arch: string; // `uname -m` value
  kernel: string;
  bunVersion: string; // Bun.version
  bunRevision: string; // Bun.revision
  baseImageDigest: string; // POC_BASE_IMAGE_DIGEST
  opencodeVersion: string; // parsed from `opencode --version`
  ompVersion: string; // parsed from `omp --version`, which prints `omp/<version>`
  pocTreeSha256: string;
  productSourcesSha256: string;
  spawnBackend: string; // POC_SPAWN_BACKEND
  gitHead: string; // report only
  imageId: string; // report only
  capturedAt: string;
  observations: Record<string, unknown>;
  tests: EvidenceTest[];
}

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
function collectCases(holder: Record<string, unknown>): Record<string, unknown>[] {
  const cases: Record<string, unknown>[] = [];
  for (const suite of asArray(holder.testsuite)) {
    const suiteObject = asObject(suite);
    for (const testCase of asArray(suiteObject.testcase)) cases.push(asObject(testCase));
    cases.push(...collectCases(suiteObject));
  }
  return cases;
}

function statusOf(testCase: Record<string, unknown>): EvidenceTest["status"] {
  // `fast-xml-parser` maps an element without attributes or text to `""`, which is
  // falsy, so presence is checked against `undefined` instead of truthiness.
  if (testCase.failure !== undefined || testCase.error !== undefined) return "failed";
  if (testCase.skipped !== undefined) return "skipped";
  return "passed";
}

/** A missing `assertions` attribute reads as 0. */
function assertionCount(testCase: Record<string, unknown>): number {
  const value = Number(testCase.assertions ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Parses a JUnit report into one entry per test case, named or not, at any depth.
 * A failing hook in Bun leaves one failed `<testcase name="(unnamed)">` behind.
 */
export function collectTests(junitXml: string): EvidenceTest[] {
  const root = asObject(parser.parse(junitXml));
  // Reports wrap suites in `testsuites`, but a bare root `testsuite` is also valid.
  const holder = asObject(root.testsuites ?? root);
  return collectCases(holder).map((testCase) => ({
    name: String(testCase.name ?? ""),
    status: statusOf(testCase),
    assertions: assertionCount(testCase),
  }));
}

/** Directories that hold records, dependencies or work-in-progress evidence. */
const SKIPPED_DIRECTORIES: Record<string, true> = {
  node_modules: true,
  evidence: true,
  ".evidence-wip": true,
};
const SKIPPED_FILES: Record<string, true> = { "GO-NO-GO.json": true };

function listFiles(root: string, dir: string = root, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES[entry.name] !== undefined) continue;
      listFiles(root, path, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIPPED_FILES[entry.name] !== undefined || entry.name.endsWith(".md")) continue;
    files.push(relative(root, path));
  }
  return files;
}

/**
 * Hashes the proof-of-concept tree over sorted relative paths and file bytes.
 * Evidence, dependencies, Markdown and outcome records are skipped, so the hash
 * covers only material that can change a result.
 */
export function hashPocTree(dir: string): string {
  const hash = createHash("sha256");
  for (const relativePath of listFiles(dir).sort()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(join(dir, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Hashes the production sources the suites load, in `PRODUCT_SOURCES` order. */
export function hashProductSources(repoRoot: string): string {
  const hash = createHash("sha256");
  for (const relativePath of PRODUCT_SOURCES) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(join(repoRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Appends one observation line for the evidence record; a no-op outside a run. */
export function observe(key: string, value: unknown): void {
  const file = process.env.POC_OBSERVATIONS_FILE;
  if (file === undefined) return;
  appendFileSync(file, `${JSON.stringify({ key, value })}\n`);
}

/** Folds the observation lines into the last value per key. */
export function readObservations(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const observations: Record<string, unknown> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const entry = asObject(JSON.parse(line));
    observations[String(entry.key)] = entry.value;
  }
  return observations;
}
