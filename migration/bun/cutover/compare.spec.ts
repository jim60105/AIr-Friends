// migration/bun/cutover/compare.spec.ts
//
// The four `bun-cutover-drill` comparison scenarios (design D3), with
// in-memory measurements and an injected thresholds commit time.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import {
  compareMeasurements,
  type MeasurementFile,
  type RunMeasurement,
  type ThresholdsFile,
} from "./compare.ts";

function run(overrides: Partial<RunMeasurement> = {}): RunMeasurement {
  return {
    startupSeconds: 10,
    idleMemoryMiB: 100,
    idleFds: 20,
    processes: ["1 dumb-init", "2 bun"],
    leftoverProcesses: 0,
    stopSeconds: 2,
    stopExit: 0,
    containerExit: 0,
    restartReady: true,
    ...overrides,
  };
}

function measurement(label: string, runs: RunMeasurement[]): MeasurementFile {
  return {
    image: label === "bun" ? "localhost/air-friends:bun-local" : "rollback@sha256:test",
    label,
    measuredAt: "2026-11-10T12:00:00.000Z",
    runs,
  };
}

const thresholds: ThresholdsFile = {
  derivedFrom: "measurements/deno.json",
  rule: {
    startupSeconds: "median(deno.runs[].startupSeconds) * 1.25",
    idleMemoryMiB: "median(deno.runs[].idleMemoryMiB) * 1.25",
    idleFds: "max(deno.runs[].idleFds) * 1.25",
    leftoverProcesses: 0,
    stopSeconds: 15,
    restartReady: true,
  },
  startupSeconds: 12.5,
  idleMemoryMiB: 125,
  idleFds: 25,
  leftoverProcesses: 0,
  stopSeconds: 15,
  restartReady: true,
};

const deno = measurement("deno", [run()]);
const bun = measurement("bun", [run()]);

test("Thresholds committed first", () => {
  const result = compareMeasurements(deno, bun, thresholds, {
    thresholdsCommittedAt: "2026-11-10T11:00:00.000Z",
  });

  assertEquals(result.exitCode, 0);
  assertEquals(result.lines.length, 6);
  assertEquals(
    result.lines.map((line) => line.split(" ")[0]),
    [
      "startupSeconds",
      "idleMemoryMiB",
      "idleFds",
      "leftoverProcesses",
      "stopSeconds",
      "restartReady",
    ],
  );
  assert(result.lines.every((line) => line.endsWith(" ok")));
});

test("Thresholds missing or later", () => {
  const missing = compareMeasurements(deno, bun, thresholds, {
    thresholdsCommittedAt: null,
  });
  assertEquals(missing.exitCode, 2);
  assertEquals(missing.lines, []);
  assertStringIncludes(missing.reason ?? "", "no commit");

  const later = compareMeasurements(deno, bun, thresholds, {
    thresholdsCommittedAt: "2026-11-10T13:00:00.000Z",
  });
  assertEquals(later.exitCode, 2);
  assertEquals(later.lines, []);
  assertStringIncludes(later.reason ?? "", "after the Bun measurement");
});

test("Within thresholds", () => {
  const result = compareMeasurements(deno, bun, thresholds, {
    thresholdsCommittedAt: "2026-11-10T11:00:00.000Z",
  });

  assertEquals(result.exitCode, 0);
  assertEquals(result.lines.length, 6);
  assert(result.lines.every((line) => line.endsWith(" ok")));
});

test("One metric over", () => {
  const overMemory = measurement("bun", [run({ idleMemoryMiB: 150 })]);
  const result = compareMeasurements(deno, overMemory, thresholds, {
    thresholdsCommittedAt: "2026-11-10T11:00:00.000Z",
  });

  assertEquals(result.exitCode, 1);
  const memoryLine = result.lines.find((line) => line.startsWith("idleMemoryMiB "));
  assert(memoryLine !== undefined);
  // Names the metric, the threshold (125) and the measured median (150).
  assertEquals(memoryLine, "idleMemoryMiB 125 150 FAIL");
  assertStringIncludes(memoryLine, "125");
  assertStringIncludes(memoryLine, "150");
});
