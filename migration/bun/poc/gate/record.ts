import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateBaselineDir } from "../../baseline/records-schema.ts";
import { CRITERIA, DEFERRALS } from "./catalog.ts";
import type { Deferral } from "./catalog.ts";
import { hashPocTree, hashProductSources } from "./evidence.ts";
import type { SuiteEvidence } from "./evidence.ts";
import { evaluate } from "./evaluate.ts";
import type { CriterionResult, GateInput } from "./evaluate.ts";
import { POC_PINS } from "./pins.ts";

export interface OutcomeRecord {
  schemaVersion: 1;
  outcome: "Go" | "No-Go";
  decidedAt: string;
  freezeSha: string;
  head: string;
  pins: typeof POC_PINS;
  pocTreeSha256: string;
  productSourcesSha256: string;
  changedPaths: string[];
  baselineState: "valid" | "invalid";
  criteria: CriterionResult[];
  blockers: string[];
  deferrals: Deferral[];
  observations: Record<string, Record<string, unknown>>; // keyed by `<arch>/<suite>`
}

const GO_NEXT_STEP =
  "Plan design section 8 steps 3 to 8 using these findings. No P0 blocker is closed by this record.";
const NO_GO_NEXT_STEP =
  "Stop the migration. An owner decides whether a blocker is solvable; if not, master unfreezes.";

/** A table cell cannot carry a pipe or a line break. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function deferralTable(deferrals: readonly Deferral[]): string[] {
  const lines = ["| P0 | Scope | Owner |", "| --- | --- | --- |"];
  for (const deferral of deferrals) {
    lines.push(`| ${deferral.p0} | ${cell(deferral.scope)} | ${cell(deferral.owner)} |`);
  }
  return lines;
}

/** Renders the generated Markdown record; the file is never hand-edited. */
export function renderMarkdown(record: OutcomeRecord): string {
  const lines: string[] = ["# Bun migration Go/No-Go", "", `Outcome: ${record.outcome}`, ""];
  const freezeSha = record.freezeSha === "" ? "unknown" : record.freezeSha;
  lines.push(`Date: ${record.decidedAt}`, `Freeze SHA: ${freezeSha}`, `Head: ${record.head}`, "");

  lines.push("## Pins", "");
  lines.push(`- Bun version: ${record.pins.bunVersion}`);
  lines.push(`- Bun revision prefix: ${record.pins.bunRevisionPrefix}`);
  lines.push(`- Base image digest: ${record.pins.baseImageDigest}`);
  lines.push(`- opencode version: ${record.pins.opencodeVersion}`);
  lines.push(`- omp version: ${record.pins.ompVersion}`, "");

  lines.push("## Blockers", "");
  if (record.blockers.length === 0) {
    lines.push("None.");
  } else {
    for (const blocker of record.blockers) lines.push(`- ${blocker}`);
  }
  lines.push("");

  lines.push(
    "## Criteria",
    "",
    "| ID | P0 | Arch | Status | Detail |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const criterion of record.criteria) {
    lines.push(
      `| ${criterion.id} | ${criterion.p0} | ${criterion.arch} | ${criterion.status} | ${cell(criterion.detail)} |`,
    );
  }
  lines.push("");

  lines.push("## Observations", "");
  const observationKeys = Object.keys(record.observations).sort();
  if (observationKeys.length === 0) {
    lines.push("None.");
  } else {
    for (const key of observationKeys) {
      lines.push(`- ${key}: ${JSON.stringify(record.observations[key])}`);
    }
  }
  lines.push("");

  lines.push("## Open after this decision", "");
  lines.push(...deferralTable(record.deferrals), "");

  lines.push("## Next step", "");
  lines.push(record.outcome === "Go" ? GO_NEXT_STEP : NO_GO_NEXT_STEP);

  return `${lines.join("\n")}\n`;
}

/** Writes both records; the outcome line is generated, never edited by hand. */
export function writeRecord(record: OutcomeRecord, dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "GO-NO-GO.json"), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(dir, "GO-NO-GO.md"), renderMarkdown(record));
}

/** Reads `evidence/<arch>/<suite>.json`; a missing directory means no evidence. */
export function readEvidence(pocDir: string): SuiteEvidence[] {
  const evidenceDir = join(pocDir, "evidence");
  if (!existsSync(evidenceDir)) return [];
  const evidence: SuiteEvidence[] = [];
  const archs = readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const arch of archs) {
    const archDir = join(evidenceDir, arch.name);
    const files = readdirSync(archDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const file of files) {
      evidence.push(JSON.parse(readFileSync(join(archDir, file.name), "utf8")) as SuiteEvidence);
    }
  }
  return evidence;
}

function git(repoRoot: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "";
  return result.stdout.toString();
}

/**
 * Paths changed since the merge base with `master`, committed or uncommitted.
 * The merge base keeps a security fix merged from `master` out of the isolation
 * condition; its effect on the suites is caught by the product source hash.
 */
export function collectChangedPaths(repoRoot: string): string[] {
  if (!existsSync(join(repoRoot, ".git"))) return [];
  const paths = new Set<string>();
  const mergeBase = git(repoRoot, ["merge-base", "master", "HEAD"]).trim();
  if (mergeBase !== "") {
    for (const line of git(repoRoot, ["diff", "--name-only", mergeBase, "HEAD"]).split("\n")) {
      if (line.trim() !== "") paths.add(line.trim());
    }
  }
  // `-z` keeps paths byte-exact: no quoting and no leading-space trimming.
  for (const entry of git(repoRoot, ["status", "--porcelain", "--no-renames", "-uall", "-z"]).split("\0")) {
    if (entry.length > 3) paths.add(entry.slice(3));
  }
  return [...paths].sort();
}

/** The Deno freeze SHA recorded by the baseline capture, or an empty string. */
export function readFreezeSha(pocDir: string): string {
  const file = join(pocDir, "..", "baseline", "records", "baseline.json");
  try {
    const baseline = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return typeof baseline.freezeSha === "string" ? baseline.freezeSha : "";
  } catch {
    return "";
  }
}

function observationsOf(evidence: readonly SuiteEvidence[]): Record<string, Record<string, unknown>> {
  const observations: Record<string, Record<string, unknown>> = {};
  for (const entry of evidence) observations[`${entry.arch}/${entry.suite}`] = entry.observations;
  return observations;
}

async function main(): Promise<void> {
  const pocDir = join(import.meta.dir, "..");
  const repoRoot = join(import.meta.dir, "../../../..");
  const evidence = readEvidence(pocDir);
  const baseline = validateBaselineDir(join(pocDir, "..", "baseline", "records"));
  const input: GateInput = {
    catalog: CRITERIA,
    deferrals: DEFERRALS,
    evidence,
    pocTreeSha256: hashPocTree(pocDir),
    productSourcesSha256: hashProductSources(repoRoot),
    changedPaths: collectChangedPaths(repoRoot),
    baselineState: baseline.state,
  };
  const result = evaluate(input);
  const record: OutcomeRecord = {
    schemaVersion: 1,
    outcome: result.outcome,
    decidedAt: new Date().toISOString(),
    freezeSha: readFreezeSha(pocDir),
    head: git(repoRoot, ["rev-parse", "HEAD"]).trim(),
    pins: POC_PINS,
    pocTreeSha256: input.pocTreeSha256,
    productSourcesSha256: input.productSourcesSha256,
    changedPaths: [...input.changedPaths],
    baselineState: input.baselineState,
    criteria: result.criteria,
    blockers: result.blockers,
    deferrals: [...DEFERRALS],
    observations: observationsOf(evidence),
  };
  writeRecord(record, pocDir);
  console.log(`Outcome: ${record.outcome}`);
  if (baseline.state !== "valid") {
    for (const problem of baseline.problems) console.error(`baseline: ${problem}`);
  }
}

if (import.meta.main) await main();
