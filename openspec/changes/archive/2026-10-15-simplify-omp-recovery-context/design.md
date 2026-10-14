# Design

## Context

Observed `reconnectAndResumeSession()` requires OMP ownership plus complete gate context before disconnect, checks ownership again after reconnect and rejects OMP context-free recovery. OpenCode's pre-existing optional-context path checks supplied ownership before teardown, repeats it after connect and performs supplied gate-cwd validation after load. The orchestrator records acquisition ownership for all agent types and threads OMP-specific recovery context overloads. Pool identity is already mode-separated for OMP and unchanged for OpenCode.

## Goals / Non-Goals

Restart OMP from this connector's immutable options and use existing capability-based load/model/reasoning recovery. Keep shared per-session policy context replay and gate restore, current session JWT/pointer lifecycle and response-gated retry. OpenCode optional ownership and context outcomes remain unchanged. No pool key changes or config synthesis.

## Decisions

1. Depend on `simplify-omp-session-boundaries`, which removes the scanning gates and OMP skill producer without deleting still-used bootstrap modules. Remove the OMP unconditional ownership trigger and `prevalidateOmpRecoveryGateContext()` with all of its complete-field comparisons.
2. Apply ownership checks exclusively to configured OpenCode recovery with supplied ownership or gate context, using the same existing helper and ordering as before. Do not rewrite the helper to always return match for OMP. Keep its foreign-agent/mode rejection vocabulary because OpenCode callers can supply a foreign record and currently receive a denial.
3. OMP recovery ignores legacy OMP ownership as authorization input and production OMP callers stop creating/passing that input. Define `recoveryContextSupplied` for OMP from `opts.gateContext` only. Both agent types retain existing post-load supplied gate-cwd validation; OMP can use the existing cwd-only restore when neither supplied nor cached extra context is required. Cached contexts remain per ACP ID. The orchestrator continues supplying each active session's complete policy context for pooled work, so production callback identity does not depend on process defaults.
4. Remove `OmpRecoveryContext` from the orchestrator recovery builder's return type. Use the existing common optional `RecoveryContext`; `perSpawnRecoveryContext()` still returns undefined for existing OpenCode context-free callers, and `recoveryOwnershipFromRegistry()` returns records for OpenCode only. Guard acquisition `recordOwnership()` calls by `agentType === opencode`. Keep mode resolution and `process_acquired` audit values for both agents as observations, not prerequisites. The registry's fields/method remain because OpenCode still consumes them.
5. Preserve disconnect/connect/load, config-option cache refresh, prior model selection, best-effort reasoning, gate restore, optional hook and `true` ordering. Missing load capability or live connection still returns false and cleans up. Model catalog misses and hook errors still fail only the recovering session; the orchestrator continues avoiding duplicate reply/file/reaction effects.

## Risks / Trade-offs

Removing OMP ownership must not alter supplied OpenCode foreign-record failures. Tests cover absent OpenCode context, explicit matching/mismatching records, legacy cwd-only path and post-load cwd errors. OMP mode isolation remains process/pool selection and explicit native mode launch; this change does not reconstruct a mode from a mutable namespace.

## Migration Plan

Update recovery callers and lifecycle fixtures with the connector change. No compatibility record translation. Existing persisted native sessions resume through the configured native process and reported load capability; no guarantee is added for a session absent from native storage.
