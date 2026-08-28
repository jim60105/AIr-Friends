# Design: fix-pool-mode-session-result-crash

## Evidence (confirmed at commit bad78dc)

- `processMessageInternal`: `let result: SessionResponse;` (line 454) declared, `try` opens at 458, the six-method pattern ends with `finally { this.recordSessionMetrics({ ..., success: result!.success, ... }) }` (lines 1285–1294).
- Shared-process branches return WITHOUT assigning `result`:
  - `processMessageInternal` pool branch: lines 853–861 (`cancelledByDeadline`), 871 (`lurkSkipped`), 884–891 (success), 896–908 (no-reply).
  - `processSpontaneousPost` (~1475), `processSelfResearch` (~1874), `processMemoryMaintenance` (~2371): DIRECT `return await this.runSharedPoolSession({...})` inside the guarded try — no `result` assignment at all.
- Per-spawn paths with the same latent bug: `response === null` early returns (`return {` at ~1052 in `processMessageInternal`; ~1602 in `processSpontaneousPost`). The per-spawn happy paths DO assign (`result = {...}; return result;`) — they are the existing correct style.
- Production proof: `Event handler error: Cannot read properties of undefined (reading 'success')` fires once per pooled session, at the exact millisecond the summary/model-restore logs end; no `processed successfully` log ever appears.
- `activeSessionsGauge.dec()` happens ONLY inside `recordSessionMetrics()` (line 3841, first statement); every session type's finally relies on it.

## Decisions

### D1: Assign-then-return at every guarded return site

Pattern (matches existing style in the same methods):

```ts
result = { success: true, replySent, reactionSent, fileSent };
return result;
```

Apply to EVERY `return` statement inside the six `try` bodies whose finally reads `result!`:
- `processMessageInternal` (~426–1297)
- `processSpontaneousPost` (~1302–1729) — includes `return await this.runSharedPoolSession({...})` → `result = await this.runSharedPoolSession({...}); return result;`
- `processSelfResearch` (~1730–2230) — same helper-return conversion
- `processMemoryMaintenance` (~2231–2576) — same helper-return conversion
- `processChannelMemoryMaintenance` (~2577–2885)
- `processReminder` (~2886–3285)

Returns OUTSIDE the guarded try (e.g. the `/clear` early return before `try` opens) stay as-is.

Do NOT "fix" by changing `result!.success` to `result?.success ?? false` — that silently records false failures for successful sessions and hides future regressions.

### D2: Restructure the finally so bookkeeping can neither lose the gauge nor replace the response

Current finally calls `recordSessionMetrics()` which starts with `activeSessionsGauge.dec()` then records counters/duration/completed-store. Per the rubber-duck review, wrapping only the `recordSessionMetrics()` call still leaves the decrement at the mercy of one code path: if the finally's argument evaluation (e.g. reading `result!.success` before the fix lands, or any future field access) or anything before `dec()` throws, the gauge never decrements → phantom `airfriends_active_sessions` forever.

Restructure each of the six finallys to:

```ts
finally {
  try {
    activeSessionsGauge.dec();
  } catch (error) {
    logger.error("Failed to decrement active sessions gauge", { ... });
  }
  try {
    this.recordSessionMetrics({ ... , success: result!.success, ... });  // dec REMOVED from this method
  } catch (error) {
    logger.error("Failed to record session metrics", { ... });
  }
  ...existing cleanup (tmp cleanup, deregister, audit session_end) unchanged...
}
```

`recordSessionMetrics()` loses its internal `activeSessionsGauge.dec()` (verify: `rg -n "activeSessionsGauge.dec"` shows the call ONLY in the six finallys afterward; the `inc()` sites at 453/1321/1743/2255/2601/2902 are untouched and 1:1 with the finallys).

### D3: Regression guard beyond tests

After the fix, a `rg` gate is part of done criteria: within the six method ranges, every `return` must be preceded by assignment to `result`. Implementers verify with `rg -n "return (\{|await)" src/core/session-orchestrator.ts` eyeball pass (scripted enforcement is out of scope; the future `runAgentSession()` refactor per the existing spec will remove the pattern entirely).

## Test strategy

- Unit regression (primary): in `tests/core/session-orchestrator.test.ts` (reuse its `createTestConfig`/mock-adapter helpers), construct `SessionOrchestrator` with the 7th constructor arg `processPool` set to a stub whose `run()` invokes the runner with a minimal fake `AgentConnector` (stub methods: `createSession`, `setSessionModel`, `setSessionMode`, `setSessionGateContext`, `setReasoningEffort`, `prompt`, `cancel`, `getProcessPid`) and resolves `{ acpSessionId: "ses_fake", cancelledByDeadline: false }`. One pooled regression test PER METHOD (message, spontaneous, self-research, memory-maintenance) asserting resolve-not-throw and the correct `success` value. Pre-fix these THROW — that is the regression assertion.
- Gauge test: stub metrics so the counter/duration/store step throws → assert `activeSessionsGauge` value still decremented and the method still resolves; and `dec`-throws case → response still returned.
- Existing suites must stay green: `tests/core/agent-core.test.ts`, `tests/integration/shared-process.integration.test.ts`.

## Risks

- Touching ~20–35 return sites in a 4.3k-line file: mechanical but noisy in review. Keep the diff to `result = ...; return result;` conversions plus the finally restructure — no reformatting or reordering.
- Watch the `lurkSkipped`/`cancelledByDeadline` branches: they must keep their exact response shapes (callers branch on `error` strings like "Cancelled by queue deadline").
