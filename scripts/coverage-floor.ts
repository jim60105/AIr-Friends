#!/usr/bin/env bun
// scripts/coverage-floor.ts — enforce Bun's line-coverage floor over `src/`.
//
// Usage: bun run --no-env-file scripts/coverage-floor.ts <lcov> <floor>
//
// OpenSpec `migrate-ci-and-docs-to-bun`, design D2: Bun 1.4.2 LCOV has no
// branch records, so the 75% floor applies to line coverage over `src/`.
// Only records whose `SF:` path is repository-relative under `src/` count;
// test records never do.

import { isAbsolute, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

export interface LineCoverage {
  hit: number;
  found: number;
  percent: number;
}

/**
 * Sum `LH`/`LF` over every `src/` record and return the line percentage, or
 * `null` when the report holds no `src/` record with found lines.
 */
export function computeLineCoverage(
  text: string,
  repoRoot: string = REPO_ROOT,
): LineCoverage | null {
  let hit = 0;
  let found = 0;
  let sawSrc = false;

  for (const record of text.split("end_of_record")) {
    const sf = /^SF:(.+)$/m.exec(record)?.[1]?.trim();
    if (sf === undefined || sf === "") continue;

    const repoRelative = isAbsolute(sf) ? relative(repoRoot, sf) : sf.replace(/^\.\//, "");
    if (!repoRelative.split("\\").join("/").startsWith("src/")) continue;

    sawSrc = true;
    found += Number(/^LF:(\d+)/m.exec(record)?.[1] ?? 0);
    hit += Number(/^LH:(\d+)/m.exec(record)?.[1] ?? 0);
  }

  if (!sawSrc || found === 0) return null;
  return { hit, found, percent: (hit / found) * 100 };
}

function usage(): never {
  console.error("usage: coverage-floor.ts <lcov> <floor>");
  process.exit(2);
}

if (import.meta.main) {
  const [lcovPath, floorArg, ...rest] = process.argv.slice(2);
  if (lcovPath === undefined || floorArg === undefined || rest.length > 0) usage();

  const floor = Number(floorArg);
  if (!Number.isFinite(floor) || floor < 0 || floor > 100) usage();

  let text: string;
  try {
    text = await Bun.file(lcovPath).text();
  } catch (error) {
    console.error(`coverage-floor: cannot read ${lcovPath}: ${(error as Error).message}`);
    process.exit(1);
  }

  const coverage = computeLineCoverage(text);
  if (coverage === null) {
    console.error(`coverage-floor: no src/ record (empty report) in ${lcovPath}`);
    process.exit(1);
  }

  console.log(coverage.percent.toFixed(2));
  if (coverage.percent < floor) {
    console.error(
      `coverage-floor: ${coverage.percent.toFixed(2)}% line coverage over src/ is below the ${floor}% floor`,
    );
    process.exit(1);
  }
}
