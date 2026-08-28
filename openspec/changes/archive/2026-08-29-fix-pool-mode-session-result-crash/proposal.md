# Proposal: fix-pool-mode-session-result-crash

## Why

Every pooled message session ends with `ERROR PlatformAdapter "Event handler error: Cannot read properties of undefined (reading 'success')"` (production log: two occurrences, one per session — 13:21:52 and 13:29:45). Cause: each `process*` method in `SessionOrchestrator` wraps its body in `try { ... } finally { this.recordSessionMetrics({ ..., success: result!.success, ... }) }`, but the shared-process (pool) branches — and several per-spawn early-return paths — `return { ... }` object literals WITHOUT assigning `result` first. The `finally` then dereferences `undefined.success`, throwing a TypeError that REPLACES the already-computed successful return. Consequence: the caller (`MessageHandler.handleEvent` → `AgentCore.handleEvent`) never receives the `SessionResponse`, error dispatch is skipped, and — silently — session metrics (`airfriends_sessions_total`, duration histogram) are NEVER recorded for pooled sessions. The crash also poisons every log stream with a fake ERROR per healthy session.

## What Changes

- In all six lifecycle methods of `src/core/session-orchestrator.ts` (`processMessageInternal`, `processSpontaneousPost`, `processSelfResearch`, `processMemoryMaintenance`, `processChannelMemoryMaintenance`, `processReminder`), every `return` statement inside the `try` guarded by a `result!.success` finally SHALL assign `result` before returning (pattern: `return (result = { ... });`, mirroring the existing per-spawn `result = {...}; return result;` style).
- No behavior, signature, or metrics-shape changes — only the missing assignment and, as a guard rail, a defensive non-null pattern that cannot silently regress (see design).
- Regression tests: pooled run resolves with a real `SessionResponse` (no throw) and metrics recording receives `success: true`; per-spawn idle-timeout-lost path likewise.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `session-lifecycle`: new requirement "Session response finalization" — every `process*` method SHALL resolve with a `SessionResponse` on all paths, and post-session bookkeeping (metrics) SHALL observe the response actually returned, never an unassigned local.

## Impact

- `src/core/session-orchestrator.ts` (return statements in the six methods; ~20–30 call sites)
- Tests: `tests/core/session-orchestrator.test.ts` (add pool-mode regression via injected fake `processPool`), possibly `tests/core/agent-core.test.ts`
- Restores accuracy of `metrics-export` counters in pool mode (no spec change needed there — the spec already requires recording)
- No wire, config, or deployment impact
