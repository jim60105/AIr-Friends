# Tasks: fix-pool-mode-session-result-crash

## 1. Regression tests first (red)

- [x] 1.1 In `tests/core/session-orchestrator.test.ts`, add a pooled-message test using existing `createTestConfig`/workspace helpers: construct `SessionOrchestrator` passing a stub `processPool` (10th constructor arg, last positional after `skillApiSecret`) whose `run(options, runner)` immediately calls `runner(fakeConnector, options)` and resolves `{ acpSessionId: "ses_fake", cancelledByDeadline: false }`; fake connector stubs: `createSession` → `"ses_fake"`, `setSessionModel`/`setSessionMode`/`setSessionGateContext`/`setReasoningEffort` → resolve, `prompt` → `{ stopReason: "end_turn" }`, `cancel`, `getProcessPid` → undefined (add any further method the runner reaches). Set `config.agent.idleTimeout.enabled = false` and `config.conversationSummary.enabled = false`
- [x] 1.2 Assert: `await orchestrator.processMessage(event, mockAdapter)` RESOLVES with `{ success: false, error: "Agent did not generate a reply" }` (agent sent nothing). Run `deno task test --filter <new test name>` → MUST FAIL today with `Cannot read properties of undefined (reading 'success')` (red state; this is the regression test). Add a second pooled-message variant where the runner's `onPrompt` marks a reply sent → RESOLVES `{ success: true, replySent: true }` and the `status="success"` session counter is recorded (metrics recording receives `success: true`, per proposal)
- [x] 1.3 Add the same-shaped pooled regression test for `processSpontaneousPost`, `processSelfResearch`, and `processMemoryMaintenance` (these reach the bug through the direct `return await this.runSharedPoolSession(...)` sites) — each asserts resolve-not-throw with the expected `success` value
- [x] 1.4 Per-spawn idle-timeout-lost regression (proposal: "per-spawn idle-timeout-lost path likewise"): for `processMessageInternal` AND `processSpontaneousPost`, make the mock connector's `prompt` throw `Error("ACP connection dead")` and `reconnectAndResumeSession` resolve `true` (the re-issued prompt also throws → `promptWithIdleTimeoutHandling` returns `null` → the `response === null` early-return branch runs inside the guarded try). Pre-fix these THROW; post-fix each resolves with its branch's exact response (`{ success: false, error: "Session lost due to idle timeout..." }` shapes)

## 2. Fix the assignment pattern

- [x] 2.1 In `src/core/session-orchestrator.ts`, convert EVERY `return` inside the six `try` bodies guarded by a `finally` that reads `result!` into assign-then-return (`result = <obj>; return result;`), INCLUDING the three `return await this.runSharedPoolSession({...})` sites (~1475 spontaneous, ~1874 self-research, ~2371 memory-maintenance) → `result = await this.runSharedPoolSession({...}); return result;`. Locations to audit: pool branches 853–908 (message), the three helper returns, every `response === null` early return (e.g. ~1052, ~1602), and any other `return {` inside those six methods' try bodies. Returns BEFORE the guarded `try` (e.g. the `/clear` early return) stay unchanged
- [x] 2.2 Verify: `deno check src/main.ts` exits 0; the new tests from 1.1–1.3 pass

## 3. Harden the finally blocks (gauge + response protection)

- [x] 3.1 Move `activeSessionsGauge.dec()` OUT of `recordSessionMetrics()` into each of the six `finally` blocks as its own `try { dec } catch { logger.error(...) }`; then wrap the `recordSessionMetrics({ ... })` call in a second `try/catch` (logger.error, swallow). Keep cleanup ordering after metrics unchanged (tmp cleanup, deregister, audit `session_end`). Confirm: `rg -n "activeSessionsGauge.dec" src/core/session-orchestrator.ts` → six hits, all inside finallys; `inc()` count still 6
- [x] 3.2 Gauge tests: stub `recordSessionMetrics` internals (or the prom-counter) to throw → assert gauge decremented AND method resolves; make `dec` itself throw (inject) → assert response still returned. If injection is impractical without refactoring, test the two-try structure via a subclass override seam that already exists; do NOT add new seams

## 4. Green + sweep

- [x] 4.1 Grep sweep: `rg -n "return (\{|await)" src/core/session-orchestrator.ts` — every hit INSIDE the six guarded try ranges must be an assign-then-return (returns before `try {`, inside nested callbacks, and inside `runSharedPoolSession`/runner bodies are excluded — the runner's own `return undefined`/`return acpSessionId` contract is untouched)
- [x] 4.2 Full gates: `deno task test`, `deno lint src/ tests/`, `deno fmt src/ tests/` then `deno fmt --check src/ tests/`

## 5. Out-of-scope reminders

- [x] 5.1 Do NOT refactor toward `runAgentSession()`, reorder logic, or alter response object shapes ("Cancelled by queue deadline" / "Agent did not generate a reply" error strings are caller-visible)
