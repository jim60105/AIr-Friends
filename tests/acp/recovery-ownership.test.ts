// tests/acp/recovery-ownership.test.ts
//
// Pure-helper tests for the row-11 recovery-ownership verification (task 2.1):
// both mismatch directions, namespace-only mismatch, OMP fail-closed `unverified`
// cases, OpenCode absent-record pass + `yolo-switch` construction, the pinned
// verdict→reason mapping, and error-message bounding.

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  deriveActualRecoveryTarget,
  mapOwnershipVerdictToReason,
  RecoveryOwnershipError,
  verifyRecoveryOwnership,
} from "@acp/recovery-ownership.ts";

const OMP_RESTRICTED_NS = "/data/omp-pools/discord:c1/omp-agent/restricted";
const OMP_YOLO_NS = "/data/omp-pools/discord:c1/omp-agent/native-yolo";
const OC_NS = "/data/opencode-data/discord:c1";

const ompRestrictedActual = {
  agentType: "omp" as const,
  permissionMode: "restricted",
  processNamespace: OMP_RESTRICTED_NS,
};
const ompYoloActual = {
  agentType: "omp" as const,
  permissionMode: "native-yolo",
  processNamespace: OMP_YOLO_NS,
};
const ocActual = {
  agentType: "opencode" as const,
  permissionMode: "yolo-switch",
  processNamespace: OC_NS,
};

Deno.test("verifyRecoveryOwnership - OMP same mode + same namespace matches", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "native-yolo", processNamespace: OMP_YOLO_NS },
      ompYoloActual,
    ),
    "match",
  );
});

Deno.test("verifyRecoveryOwnership - restricted recovery context vs native-YOLO-owned record is mode-mismatch", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "native-yolo", processNamespace: OMP_YOLO_NS },
      ompRestrictedActual,
    ),
    "mode-mismatch",
  );
});

Deno.test("verifyRecoveryOwnership - native-YOLO recovery context vs restricted-owned record is mode-mismatch (second direction)", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "restricted", processNamespace: OMP_RESTRICTED_NS },
      ompYoloActual,
    ),
    "mode-mismatch",
  );
});

Deno.test("verifyRecoveryOwnership - same mode but different namespace is namespace-mismatch", () => {
  assertEquals(
    verifyRecoveryOwnership(
      {
        agentType: "omp",
        permissionMode: "restricted",
        processNamespace: "/data/omp-pools/other:channel/omp-agent/restricted",
      },
      ompRestrictedActual,
    ),
    "namespace-mismatch",
  );
});

Deno.test("verifyRecoveryOwnership - OMP absent record fails closed as unverified", () => {
  assertEquals(verifyRecoveryOwnership(undefined, ompRestrictedActual), "unverified");
});

Deno.test("verifyRecoveryOwnership - OMP incomplete records fail closed as unverified", () => {
  // Empty namespace.
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "restricted", processNamespace: "" },
      ompRestrictedActual,
    ),
    "unverified",
  );
  // Pooled-OpenCode identity cannot authorize an OMP recovery target.
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "yolo-switch", processNamespace: OMP_RESTRICTED_NS },
      ompRestrictedActual,
    ),
    "unverified",
  );
  // Actual target whose mode is underivable from the spawn env.
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "restricted", processNamespace: OMP_RESTRICTED_NS },
      { agentType: "omp", permissionMode: "", processNamespace: OMP_RESTRICTED_NS },
    ),
    "unverified",
  );
  // Actual target whose namespace is missing from the spawn env.
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "restricted", processNamespace: OMP_RESTRICTED_NS },
      { agentType: "omp", permissionMode: "restricted", processNamespace: "" },
    ),
    "unverified",
  );
});

Deno.test("verifyRecoveryOwnership - OpenCode yolo-switch record + matching data root matches by construction", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "opencode", permissionMode: "yolo-switch", processNamespace: OC_NS },
      ocActual,
    ),
    "match",
  );
});

Deno.test("verifyRecoveryOwnership - OpenCode ABSENT record passes (today's behavior preserved)", () => {
  assertEquals(verifyRecoveryOwnership(undefined, ocActual), "match");
});

Deno.test("verifyRecoveryOwnership - OpenCode data-root identity mismatch is namespace-mismatch", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "opencode", permissionMode: "yolo-switch", processNamespace: "/data/other" },
      ocActual,
    ),
    "namespace-mismatch",
  );
});

Deno.test("verifyRecoveryOwnership - OpenCode with unreadable data root is unverified, never a mismatch", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "opencode", permissionMode: "yolo-switch", processNamespace: OC_NS },
      { agentType: "opencode", permissionMode: "yolo-switch", processNamespace: "" },
    ),
    "unverified",
  );
});

Deno.test("verifyRecoveryOwnership - record under a different agent type cannot authorize", () => {
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "opencode", permissionMode: "yolo-switch", processNamespace: OC_NS },
      ompRestrictedActual,
    ),
    "mode-mismatch",
  );
  assertEquals(
    verifyRecoveryOwnership(
      { agentType: "omp", permissionMode: "restricted", processNamespace: OMP_RESTRICTED_NS },
      ocActual,
    ),
    "mode-mismatch",
  );
});

Deno.test("deriveActualRecoveryTarget - OMP reads mode/namespace from the factory env, never recomputes", () => {
  assertEquals(
    deriveActualRecoveryTarget("omp", {
      PI_CODING_AGENT_DIR: OMP_RESTRICTED_NS,
      TMPDIR: `${OMP_RESTRICTED_NS}/tmp`,
    }),
    { agentType: "omp", permissionMode: "restricted", processNamespace: OMP_RESTRICTED_NS },
  );
  assertEquals(
    deriveActualRecoveryTarget("omp", {
      PI_CODING_AGENT_DIR: OMP_YOLO_NS,
      TMPDIR: `${OMP_YOLO_NS}/tmp`,
    }),
    { agentType: "omp", permissionMode: "native-yolo", processNamespace: OMP_YOLO_NS },
  );
  // Fallback to TMPDIR; mode underivable when the agent dir is absent -> "".
  assertEquals(
    deriveActualRecoveryTarget("omp", { TMPDIR: "/work/tmp/omp-agent/native-yolo" }),
    { agentType: "omp", permissionMode: "", processNamespace: "/work/tmp/omp-agent/native-yolo" },
  );
  // Fully empty env -> empty, underivable target (fail closed downstream).
  assertEquals(deriveActualRecoveryTarget("omp", {}), {
    agentType: "omp",
    permissionMode: "",
    processNamespace: "",
  });
});

Deno.test("deriveActualRecoveryTarget - OpenCode is the fixed yolo-switch identity over the pool data root", () => {
  assertEquals(deriveActualRecoveryTarget("opencode", { XDG_DATA_HOME: OC_NS }), {
    agentType: "opencode",
    permissionMode: "yolo-switch",
    processNamespace: OC_NS,
  });
  assertEquals(deriveActualRecoveryTarget("opencode", {}), {
    agentType: "opencode",
    permissionMode: "yolo-switch",
    processNamespace: "",
  });
});

Deno.test("mapOwnershipVerdictToReason - pinned verdict vocabulary", () => {
  assertEquals(mapOwnershipVerdictToReason("mode-mismatch"), "ownership_violation");
  assertEquals(mapOwnershipVerdictToReason("namespace-mismatch"), "namespace_mismatch");
  assertEquals(mapOwnershipVerdictToReason("unverified"), "ownership_unverified");
});

Deno.test("RecoveryOwnershipError - bounded single-line message names session and mismatch, no secrets", () => {
  const SECRET = "MCP-HEADER-SECRET-DO-NOT-LEAK";
  const err = new RecoveryOwnershipError({
    sessionId: "sess_42",
    expectedMode: "native-yolo",
    expectedNamespace: OMP_YOLO_NS,
    actualMode: "restricted",
    actualNamespace: OMP_RESTRICTED_NS,
    reason: "ownership_violation",
  });
  assertEquals(err.message.includes("\n"), false);
  assertStringIncludes(err.message, "sess_42");
  assertStringIncludes(err.message, "ownership_violation");
  assertStringIncludes(err.message, "native-yolo");
  assertStringIncludes(err.message, "restricted");
  assertEquals(err.message.includes(SECRET), false);
  assertEquals(err.name, "RecoveryOwnershipError");
  assertEquals(err instanceof Error, true);
});
