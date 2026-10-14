/**
 * Consumer-visible outcome tests for the restricted native OMP capability
 * decision.
 *
 * The restricted capability extension owns exactly one decision: a native
 * `tool_call` whose name is an own property of the frozen capability table
 * continues to native dispatch, and every other name is blocked before
 * dispatch with the bounded `rejected_unknown_tool` reason.
 *
 * Pure decision logic only: nothing here demonstrates that the official binary
 * enforces a denial.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  decideOmpToolCapability,
  OMP_TOOL_CAPABILITY_MAP,
  type OmpToolCapability,
} from "@acp/omp/tool-inventory.ts";

const MAPPED_NAMES: ReadonlyArray<readonly [string, OmpToolCapability]> = [
  ["read", "read"],
  ["grep", "search"],
  ["glob", "search"],
  ["find", "search"],
  ["todo", "todo"],
  ["web_search", "network"],
  ["bash", "execute"],
  ["edit", "modify"],
  ["write", "modify"],
  ["delete", "destructive"],
  ["move", "destructive"],
];

Deno.test("decideOmpToolCapability - every mapped name continues with its capability", () => {
  for (const [name, capability] of MAPPED_NAMES) {
    assertEquals(decideOmpToolCapability(name), { decision: "continue", capability });
  }
});

Deno.test("decideOmpToolCapability - an unmatched name blocks with the bounded reason", () => {
  for (const name of ["skill", "fetch", "unknown_tool", "Read", "read ", " bash"]) {
    assertEquals(decideOmpToolCapability(name), {
      decision: "block",
      reason: "rejected_unknown_tool",
    });
  }
});

Deno.test("decideOmpToolCapability - prototype-shaped and empty names block (own-property membership)", () => {
  for (const name of ["__proto__", "toString", "constructor", "hasOwnProperty", ""]) {
    assertEquals(decideOmpToolCapability(name), {
      decision: "block",
      reason: "rejected_unknown_tool",
    });
  }
});

Deno.test("OMP_TOOL_CAPABILITY_MAP - is frozen and holds exactly the eleven mapped names", () => {
  assertStrictEquals(Object.isFrozen(OMP_TOOL_CAPABILITY_MAP), true);
  assertEquals(
    Object.keys(OMP_TOOL_CAPABILITY_MAP),
    MAPPED_NAMES.map(([name]) => name),
  );
});
