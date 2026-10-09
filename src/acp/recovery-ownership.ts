// src/acp/recovery-ownership.ts
//
// Pure, connection-free recovery-ownership verification (restore-mode-owned-acp-sessions).
//
// The recorded values are the recovery TARGET, never an input to a new decision: the
// permission mode / process-state namespace written at acquisition (row 10) are consumed
// read-only here, and `actual` is read from the connector's own factory-produced spawn
// env (the single namespace formula row 10 recorded from). This module never resolves a
// mode from configuration, never recomputes a path, and never touches a connection.

import type { AgentType } from "./types.ts";

/**
 * Acquisition-time permission-mode vocabulary (row 10's registry record):
 * OMP records `restricted`/`native-yolo`; pooled OpenCode records the fixed
 * per-session `yolo-switch` identity. No new vocabulary is introduced here.
 */
export type RecordedPermissionMode = "restricted" | "native-yolo" | "yolo-switch";

/**
 * Session recovery ownership: the values row 10 wrote at acquisition, read-only.
 * `agentType` selects the comparison rule (deployment agent type, assumed stable
 * for the registry session's lifetime — connector options are fixed at acquisition).
 */
export interface SessionRecoveryOwnership {
  agentType: AgentType;
  permissionMode: RecordedPermissionMode;
  processNamespace: string;
}

/**
 * The connector's own recovery target, derived from its factory-produced spawn env.
 * `permissionMode` is `""` when the mode is underivable from the env, and
 * `processNamespace` is `""` when the namespace root is absent — both feed the
 * fail-closed `unverified` verdict instead of guessing.
 */
export interface ActualRecoveryTarget {
  agentType: AgentType;
  permissionMode: string;
  processNamespace: string;
}

export type OwnershipVerdict = "match" | "mode-mismatch" | "namespace-mismatch" | "unverified";

/**
 * Bounded machine-readable classification of a failed ownership check. Pinned verdict
 * mapping (recovery-ownership spec): `mode-mismatch` → `ownership_violation`,
 * `namespace-mismatch` → `namespace_mismatch`, `unverified` → `ownership_unverified`.
 */
export type RecoveryOwnershipReason =
  | "ownership_violation"
  | "namespace_mismatch"
  | "ownership_unverified";

/** Pin the verdict→reason mapping so the reason vocabulary cannot silently drift. */
export function mapOwnershipVerdictToReason(
  verdict: Exclude<OwnershipVerdict, "match">,
): RecoveryOwnershipReason {
  switch (verdict) {
    case "mode-mismatch":
      return "ownership_violation";
    case "namespace-mismatch":
      return "namespace_mismatch";
    case "unverified":
      return "ownership_unverified";
  }
}

/**
 * Read the connector's actual recovery target from its own spawn env — the SAME
 * factory-produced env row 10 recorded from (never recomputed, never re-derived):
 * - OMP: namespace = `PI_CODING_AGENT_DIR` (fallback `TMPDIR`); the mode is the
 *   mode-scoped state-root suffix the factory writes (`.../omp-agent/<mode>`). An env
 *   whose mode segment is underivable yields `permissionMode: ""` → `unverified`.
 * - OpenCode: a fixed per-session `yolo-switch` identity by construction; the pool-key
 *   data root is `XDG_DATA_HOME`. An absent data root yields `""` → `unverified`
 *   (an empty actual namespace never matches by luck and never mismatches asymmetrically).
 */
export function deriveActualRecoveryTarget(
  agentType: AgentType,
  env?: Record<string, string>,
): ActualRecoveryTarget {
  if (agentType === "omp") {
    const agentDir = env?.["PI_CODING_AGENT_DIR"] ?? "";
    const processNamespace = agentDir !== "" ? agentDir : (env?.["TMPDIR"] ?? "");
    let permissionMode = "";
    if (agentDir.endsWith("/restricted")) permissionMode = "restricted";
    else if (agentDir.endsWith("/native-yolo")) permissionMode = "native-yolo";
    return { agentType, permissionMode, processNamespace };
  }
  return {
    agentType: "opencode",
    permissionMode: "yolo-switch",
    processNamespace: env?.["XDG_DATA_HOME"] ?? "",
  };
}

/**
 * Verify a session's recorded acquisition ownership against the connector's actual
 * recovery target. Pure and connection-free.
 *
 * - OMP (provenance required): an absent or incomplete record, or an actual target
 *   whose mode/namespace cannot be read from the spawn env, is `unverified` — recovery
 *   without provenance cannot prove same-mode and fails closed. Any recorded field
 *   difference is the named mismatch.
 * - OpenCode: the fixed `yolo-switch` identity matches by construction when the
 *   pool-key data-root identity agrees; an ABSENT record passes (`match`) — today's
 *   behavior is preserved. An unreadable data root is `unverified`, never a mismatch.
 */
export function verifyRecoveryOwnership(
  recorded: SessionRecoveryOwnership | undefined,
  actual: ActualRecoveryTarget,
): OwnershipVerdict {
  if (recorded !== undefined && recorded.agentType !== actual.agentType) {
    // A record written under a different agent type cannot authorize this recovery.
    return "mode-mismatch";
  }

  if (actual.agentType === "opencode") {
    if (recorded === undefined) return "match";
    if (recorded.permissionMode !== "yolo-switch" || actual.permissionMode !== "yolo-switch") {
      return "mode-mismatch";
    }
    if (actual.processNamespace === "") return "unverified";
    if (recorded.processNamespace !== actual.processNamespace) return "namespace-mismatch";
    return "match";
  }

  // OMP: provenance required.
  const incompleteRecord = recorded === undefined ||
    recorded.processNamespace === "" ||
    (recorded.permissionMode !== "restricted" && recorded.permissionMode !== "native-yolo");
  if (incompleteRecord) return "unverified";
  if (actual.permissionMode === "" || actual.processNamespace === "") return "unverified";
  if (recorded.permissionMode !== actual.permissionMode) return "mode-mismatch";
  if (recorded.processNamespace !== actual.processNamespace) return "namespace-mismatch";
  return "match";
}

/**
 * Ownership-verification failure. Raised BEFORE any teardown, so it carries zero
 * connector side effects. The message is a bounded single line: session id plus the
 * expected/actual mode and the two namespace roots only — never MCP env, headers,
 * or any other secret material.
 */
export class RecoveryOwnershipError extends Error {
  readonly sessionId: string;
  readonly expectedMode: string | undefined;
  readonly expectedNamespace: string | undefined;
  readonly actualMode: string;
  readonly actualNamespace: string;
  readonly reason: RecoveryOwnershipReason;

  constructor(params: {
    sessionId: string;
    expectedMode: string | undefined;
    expectedNamespace: string | undefined;
    actualMode: string;
    actualNamespace: string;
    reason: RecoveryOwnershipReason;
  }) {
    super(
      `Recovery ownership check failed for session ${params.sessionId} (${params.reason}): ` +
        `expected mode=${params.expectedMode ?? "none"} namespace=${
          params.expectedNamespace ?? "none"
        }; actual mode=${params.actualMode !== "" ? params.actualMode : "underivable"} namespace=${
          params.actualNamespace !== "" ? params.actualNamespace : "missing"
        }`,
    );
    this.name = "RecoveryOwnershipError";
    this.sessionId = params.sessionId;
    this.expectedMode = params.expectedMode;
    this.expectedNamespace = params.expectedNamespace;
    this.actualMode = params.actualMode;
    this.actualNamespace = params.actualNamespace;
    this.reason = params.reason;
  }
}
