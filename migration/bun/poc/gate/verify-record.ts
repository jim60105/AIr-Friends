import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CRITERIA, DEFERRALS } from "./catalog.ts";
import { hashPocTree, hashProductSources } from "./evidence.ts";
import { evaluate, isolationViolations } from "./evaluate.ts";
import type { GateInput, GateResult } from "./evaluate.ts";
import { collectChangedPaths, readEvidence } from "./record.ts";
import type { OutcomeRecord } from "./record.ts";

/** Differences between a record and a fresh evaluation from committed evidence. */
export function compareRecord(record: OutcomeRecord, result: GateResult): string[] {
  const problems: string[] = [];
  if (record.outcome !== result.outcome) {
    problems.push(`outcome: record says ${record.outcome}, evaluation says ${result.outcome}`);
  }
  if (record.criteria.length !== result.criteria.length) {
    problems.push(
      `criteria: record has ${record.criteria.length} entries, evaluation has ${result.criteria.length}`,
    );
  }

  const recorded = new Map<string, string>();
  for (const criterion of record.criteria) {
    const key = `${criterion.id} ${criterion.arch}`;
    if (recorded.has(key)) problems.push(`criteria: duplicate entry ${key}`);
    recorded.set(key, criterion.status);
  }

  const evaluated = new Set<string>();
  for (const criterion of result.criteria) {
    const key = `${criterion.id} ${criterion.arch}`;
    evaluated.add(key);
    const status = recorded.get(key);
    if (status === undefined) {
      problems.push(`criteria: ${key} missing from the record`);
    } else if (status !== criterion.status) {
      problems.push(`criteria: ${key} recorded ${status}, evaluated ${criterion.status}`);
    }
  }
  for (const key of recorded.keys()) {
    if (!evaluated.has(key)) problems.push(`criteria: ${key} is not in the evaluation`);
  }

  return problems;
}

/** Differences between a record and the checkout it claims to describe. */
export function compareLive(
  record: OutcomeRecord,
  live: { pocTreeSha256: string; productSourcesSha256: string; violations: string[] },
): string[] {
  const problems: string[] = [];
  if (record.pocTreeSha256 !== live.pocTreeSha256) {
    problems.push(`pocTreeSha256: record ${record.pocTreeSha256}, checkout ${live.pocTreeSha256}`);
  }
  if (record.productSourcesSha256 !== live.productSourcesSha256) {
    problems.push(
      `productSourcesSha256: record ${record.productSourcesSha256}, checkout ${live.productSourcesSha256}`,
    );
  }
  for (const violation of live.violations) {
    problems.push(`isolation: ${violation} changed since the merge base`);
  }
  return problems;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const pocDir = resolve(option("--poc") ?? join(import.meta.dir, ".."));
  const repoRoot = resolve(option("--repo") ?? join(import.meta.dir, "../../../.."));
  const recordFile = join(pocDir, "GO-NO-GO.json");
  if (!existsSync(recordFile)) {
    console.error(`no record at ${recordFile}`);
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(recordFile, "utf8")) as OutcomeRecord;
  const input: GateInput = {
    catalog: CRITERIA,
    deferrals: DEFERRALS,
    evidence: readEvidence(pocDir),
    pocTreeSha256: record.pocTreeSha256,
    productSourcesSha256: record.productSourcesSha256,
    changedPaths: record.changedPaths,
    baselineState: record.baselineState,
  };
  const problems = compareRecord(record, evaluate(input));
  if (process.argv.includes("--live")) {
    problems.push(
      ...compareLive(record, {
        pocTreeSha256: hashPocTree(pocDir),
        productSourcesSha256: hashProductSources(repoRoot),
        violations: isolationViolations(collectChangedPaths(repoRoot)),
      }),
    );
  }
  for (const problem of problems) console.error(problem);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (import.meta.main) await main();
