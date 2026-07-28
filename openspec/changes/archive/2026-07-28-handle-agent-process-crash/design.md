## Context

`AgentConnector` (`src/acp/agent-connector.ts`) wraps `@agentclientprotocol/sdk@0.14.1`'s `ClientSideConnection`, communicating with the `opencode acp` subprocess over stdio JSON-RPC. Every outbound call (`initialize()`, `createSession()`, `setSessionModel()`, `prompt()`, etc.) is implemented in the SDK as `Connection#sendRequest()`, which creates a `Promise` stored in a private `#pendingResponses` map and resolved/rejected only when a matching JSON-RPC response arrives on stdin.

Read directly from the installed SDK (`node_modules/.deno/@agentclientprotocol+sdk@0.14.1/.../dist/acp.js`, `Connection#receive()`): when the subprocess dies, its stdout stream reaches EOF, the SDK's internal read loop sees `done === true`, `break`s out, and calls `this.#abortController.abort()` — it never walks `#pendingResponses` to reject them. Any request awaiting a response at that moment (chiefly `initialize()` during `connect()`, or `prompt()` mid-turn) hangs forever; this is an SDK-side gap we do not control and cannot patch upstream in scope of this change.

Today, `AgentConnector.monitorProcessExit()` observes `this.process.status` and only logs on unexpected exit. The only fail-fast mechanism that exists, `monitorIdleTimeout()`, is scoped exclusively to `prompt()` (via `Promise.race()` in the `prompt()` method) and is gated behind `idleTimeoutConfig.enabled`. `connect()`'s `await this.connection.initialize(...)` has zero protection, and `prompt()` has zero protection whenever idle timeout is disabled.

Verified via `tmp/log.clef` from a real production incident: the subprocess spawned, emitted a SQLite corruption error to stderr, and exited with code 1 — all within ~1.1 seconds, entirely inside the `connect()`/`initialize()` window, before `prompt()` was ever reached. No further log lines were ever produced for that request.

Confirmed by reading `src/core/session-orchestrator.ts` and `src/core/message-handler.ts`: both already wrap agent execution in correct `try/finally` chains (typing-indicator cleanup, `sessionRegistry` deregistration, workspace tmp cleanup, `activeEvents` dedup-key release, metrics recording). These blocks are never reached today purely because the awaited call itself never settles — not because the cleanup logic is missing.

Also confirmed by reading `promptWithIdleTimeoutHandling()` (`session-orchestrator.ts` ~line 2506): it classifies a `connector.prompt()` rejection as an "idle timeout" case purely by substring-matching `error.message` against `"ACP connection dead"` / `"ACP agent process exited unexpectedly"` — the exact strings `monitorIdleTimeout()` already throws today. Only errors matching one of those strings trigger a `reconnectAndResumeSession()` attempt; everything else propagates straight up. `reconnectAndResumeSession()` itself always returns `false` today (`supportsLoadSession()` has no agent that reports it), so that attempt currently exists only to produce a clean `"Session lost"` failure message rather than a raw error — it never actually resumes anything.

**Reviewed via rubber-duck critique before finalizing** (see below): an earlier draft of Decision 1 special-cased "intentional shutdown" by leaving the crash signal permanently pending instead of rejecting. That was a genuine bug — it silently reintroduced the exact hang this change exists to fix in the doom-loop-disconnect-while-prompt-in-flight case. This document reflects the corrected design.

## Goals / Non-Goals

**Goals:**
- Any outbound ACP call made by `AgentConnector` (`initialize`, `createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`, `prompt`, `cancel`) SHALL reject promptly — not hang — when the underlying subprocess exits, for any reason, at any point in the connector's lifecycle, regardless of whether idle-timeout is enabled.
- `connect()` SHALL additionally fail fast if the subprocess spawns but never completes the ACP handshake within a bounded time (hung, not crashed) — a case a pure exit-signal cannot catch.
- Preserve the existing downstream cleanup behavior in `SessionOrchestrator`/`MessageHandler` as-is: no changes needed there, since fixing `AgentConnector` to reject is sufficient for their existing `finally` blocks to run.
- Preserve today's "one connector per request" isolation: a crash in one request's connector SHALL NOT affect any other connector instance or in-flight request.

**Non-Goals:**
- Fixing or patching `@agentclientprotocol/sdk` itself — out of scope; we work around its gap entirely on our side.
- Fixing OpenCode's own SQLite database corruption — explicitly out of scope per the user; that is OpenCode's bug.
- Any cross-request retry/self-healing logic (e.g. automatically re-attempting the *same* user request after a crash) — out of scope. The existing design already lets the *next* incoming request spawn a fresh subprocess; that is sufficient.
- Making `reconnectAndResumeSession()` actually resume anything, or changing `promptWithIdleTimeoutHandling()`'s classification strategy — out of scope. This change only needs to ensure a crash-during-prompt error does *not* get miscategorized as the (currently always-futile) idle-timeout-reconnect path; see Decision 5.
- Refactoring `SessionOrchestrator`'s per-`process*`-method duplication into a shared `runAgentSession()`. Note: `openspec/specs/session-lifecycle/spec.md` already describes such a method as if it exists, but `grep -r runAgentSession src` finds zero matches — that spec is aspirational/stale relative to the current codebase, not a description of shipped behavior. This change does not attempt to reconcile that drift; it is called out here so it isn't mistaken for new information discovered by this design.

## Decisions

### Decision 1: A single per-subprocess "crash signal" promise, raced against every outbound SDK call, that ALWAYS rejects on exit

Introduce a private `#crashSignal: Promise<never>` on `AgentConnector`, created fresh in `connect()` immediately after `command.spawn()` (so `reconnectAndResumeSession()`'s disconnect-then-reconnect cycle gets a signal tied to the *new* subprocess, not a stale one from a previous crash). It is built from the existing `this.process.status` promise and **rejects unconditionally whenever the subprocess exits, regardless of the reason** (crash, or `disconnect()`'s own `SIGTERM`):

- The signal rejects with a descriptive `Error` (e.g. `Agent process exited unexpectedly (code=1, signal=null) while awaiting a response`) as soon as `this.process.status` resolves — always, with no exception for "this was a deliberate `disconnect()`".
- A no-op `.catch(() => {})` is attached to `#crashSignal` at creation time so it never produces a Deno "unhandled promise rejection" warning on its own. This is precisely what makes unconditional rejection safe even in the common case where nothing is racing against the signal at the moment the process exits (a normal, already-completed session being torn down).
- The exit is logged exactly once, inside `monitorProcessExit()` (Decision 2) — the crash-signal builder itself does not log, to avoid duplicate "Agent process exited unexpectedly" log lines for a single exit event.

A single private helper, `#raceAgainstCrash<T>(operation: Promise<T>): Promise<T>`, wraps `Promise.race([operation, this.#crashSignal])` and is used at every call site that awaits an SDK response (`initialize`, `createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`, `prompt`, `cancel`). This replaces bespoke handling per call site with one small, uniformly-applied wrapper.

**Why unconditional rejection, not "only reject on unexpected exit" (rejected alternative, caught by review):** An earlier draft left the signal permanently pending when `#intentionalShutdown` was `true`, reasoning that a deliberate `disconnect()` shouldn't be treated as a "crash." That reasoning has a hole: `SessionOrchestrator`'s doom-loop terminate callback (`sessionRegistry.setTerminateCallback(shellSessionId, async () => { await connector.disconnect(); })`) calls the *same* `disconnect()` while a `prompt()` may still be in flight. Under the earlier draft, that would mark the shutdown "intentional," leave `#crashSignal` pending forever, and the in-flight `prompt()` would have no remaining way to settle — reproducing the original hang, just triggered by doom-loop protection instead of a real crash. Rejecting unconditionally removes this hole entirely: whenever the process is gone, anything still waiting on a response from it should fail, full stop — there is no scenario where a response can still legitimately arrive after the process has exited.

**Other alternatives considered:**
- *Only wrap `connect()`/`prompt()`* (the two call sites where the bug was reproduced): rejected because a crash between `connect()` succeeding and `prompt()` being called (e.g. during `createSession()` or `setSessionModel()`) would hang just as badly, and OpenCode's DB corruption is not guaranteed to manifest at exactly the same phase every time.
- *Monkey-patch or fork the SDK's `Connection` class to reject `#pendingResponses` directly*: rejected — `#pendingResponses` and `#receive()` are private class fields/methods, inaccessible from outside; forking the dependency is a much larger maintenance burden than an external race-based workaround, for a package we don't control.
- *AbortController-based cancellation of the SDK call itself*: the SDK's `sendRequest()` accepts no `AbortSignal`, so there is nothing to cancel — `Promise.race()` is the only viable way to "give up" on a promise we cannot cancel.

### Decision 2: `#intentionalShutdown` flag controls log severity ONLY, never whether the crash signal settles

Set `#intentionalShutdown = true` at the very start of `disconnect()`, before sending `SIGTERM`, and reset it to `false` at the start of each `connect()`. `monitorProcessExit()` consults this flag purely to choose between an `ERROR`-level "exited unexpectedly" log and a `DEBUG`-level "exited after intentional shutdown" log — mirroring today's existing log-severity split, just driven by an explicit flag (set precisely where the shutdown is initiated) instead of the current `!this.promptCompleted` proxy, which doesn't generalize to shutdowns that happen mid-`createSession()` or mid-anything-else.

This flag has no bearing on `#crashSignal` (Decision 1): the signal rejects the same way whether the exit was intentional or not. Killing the process — for any reason, deliberate or not — while something is still awaiting a response from it should fail that wait; log severity is a separate, purely-cosmetic concern.

### Decision 3: Bounded connect-time timeout, separate from the crash signal, with an early warning and a cleared timer

Add `CONNECT_TIMEOUT_MS` (default 30000 ms, configurable via `agent.connectTimeoutMs` / `AGENT_CONNECT_TIMEOUT_MS` env override, following the exact existing convention used for `agent.idleTimeout.*`). In `connect()`, race `connection.initialize()` against both `#crashSignal` and a timeout promise. This catches the case the crash signal cannot: the subprocess is spawned and alive, but never completes the ACP handshake (e.g. stuck on startup, deadlocked) — not crashed, just hung. Without this, such a hang would be indistinguishable from a working slow-starting agent and would block forever exactly as today.

Two refinements added after review:
- The timeout's `setTimeout` handle SHALL be cleared (`clearTimeout()`) as soon as the race settles by any other arm, so a successful, fast `connect()` doesn't leave a ~30-second dangling timer alive per call.
- The 30-second default was chosen by convention (matching the idle-timeout default), not from measured OpenCode startup-latency data — only one incident's timing (`tmp/log.clef`) was available, and that incident crashed in ~1.1s, which says nothing about the high end of normal, non-crashing startup latency. To reduce the chance of a false-positive timeout under a slow cold start, `connect()` SHALL log a `WARN` once elapsed time passes 80% of `connectTimeoutMs` (i.e. still waiting on `initialize()` at 24s by default) so operators get advance signal before a hard failure, and so real production latency data can inform whether 30s needs adjusting after rollout (tracked as a follow-up observation task, not a blocking one).

**Alternative considered:** rely solely on the crash signal and skip the timeout, reasoning that OpenCode's crash-on-corruption always terminates the process anyway. Rejected: the observed failure mode this session did terminate the process, but a well-known-in-general failure mode of long-running CLI-wrapped subprocesses is "hung, still alive" (e.g. waiting on a lock file) — the whole point of the sibling `idleTimeoutConfig` for `prompt()` is exactly this concern, so `connect()` deserves the same treatment for consistency and completeness.

### Decision 4: No changes to `SessionOrchestrator` or `MessageHandler`

Verified by reading both files fully: `processMessageInternal()`, `processSpontaneousPost()`, `processSelfResearch()`, `processMemoryMaintenance()` in `session-orchestrator.ts` each wrap `connector.connect()`/`prompt()` in an inner `try/finally` (typing indicator, `connector.disconnect()`, `sessionRegistry.remove()`, workspace tmp cleanup) nested inside an outer `try/catch/finally` (error logging, audit `session_end`, metrics). `MessageHandler.handleEvent()` wraps `orchestrator.processMessage()` in `try/finally` releasing the `activeEvents` dedup key. All of these already do the right thing *once the awaited call actually settles*. No code changes are needed in these files — only verification (covered in tasks.md) that an integration test confirms the cascade works end-to-end once `AgentConnector` is fixed.

Note one specific interaction that must be verified rather than assumed: `connect()`'s own `catch` block already calls `await this.disconnect(); throw error;` on initialization failure (pre-existing code). With this change, a connect-time crash or timeout now reaches that `catch` far more often than before. The outer `SessionOrchestrator`'s `finally` block *also* calls `connector.disconnect()` unconditionally. `disconnect()` must therefore tolerate being called twice in a row for the same failed connection attempt — verified safe by inspection (`if (this.process)` guard makes the second call a no-op on the process-kill step; all field resets are idempotent), and pinned down by an explicit test (tasks.md 4.10) rather than left as an inspection-only claim.

### Decision 5: Crash-signal error wording deliberately does not match `promptWithIdleTimeoutHandling()`'s reconnect-trigger strings

`promptWithIdleTimeoutHandling()` only attempts `reconnectAndResumeSession()` when `error.message` contains `"ACP connection dead"` or `"ACP agent process exited unexpectedly"` — and that attempt is always futile today (`reconnectAndResumeSession()` always returns `false`; no agent currently reports `loadSession` support), so today it exists only to turn a raw error into the cleaner `"Session lost due to idle timeout and reconnection failure"` message.

The new crash-signal error message (`"Agent process exited unexpectedly (code=…, signal=…) while awaiting a response"`) is deliberately worded to **not** contain either trigger substring, so a crash-during-`prompt()` propagates directly to the outer `catch` in `session-orchestrator.ts` instead of first taking the always-futile reconnect detour. This is a real behavioral choice, not an accident of wording — it is documented with a comment at the point the message is constructed in `agent-connector.ts`, and locked in with an explicit test (tasks.md 4.11) asserting `promptWithIdleTimeoutHandling()` does *not* attempt reconnection for this specific error, so a future, well-meaning wording tweak (e.g. someone "harmonizing" the message with the idle-timeout one) doesn't silently reintroduce the pointless detour without a test failing to flag it.

## Risks / Trade-offs

- **[Risk] `Promise.race()` doesn't cancel the loser.** After `#crashSignal` wins a race, the original SDK call (e.g. `connection.initialize()`) is still technically pending inside the SDK's `#pendingResponses` map forever (same as today). → **Mitigation:** this is unavoidable without patching the SDK (see Decision 1 alternatives), but harmless: nothing in our code continues to await that specific losing promise, `connect()`/`prompt()` propagate the crash error and return control to the caller, which calls `disconnect()` and discards the `AgentConnector` instance entirely (each request builds a fresh one). The abandoned promise and its subprocess are garbage-collected/reaped normally.
- **[Risk] Widening `#raceAgainstCrash()` to every SDK call site is more surface area than the two originally-reported call sites.** → **Mitigation:** it is a single small helper applied uniformly (not bespoke per-call logic), reviewed here explicitly, and covered by unit tests for each wrapped call site listed in tasks.md.
- **[Risk] Fragile string-based coupling between the crash-signal message and `promptWithIdleTimeoutHandling()`'s classification.** → **Mitigation:** documented explicitly as Decision 5, with a code comment at the source and a dedicated regression test rather than relying on implicit non-matching wording staying accidentally correct.
- **[Trade-off] New `agent.connectTimeoutMs` config surface, with a default chosen by convention rather than measured data.** → Accepted with a mitigation: an 80%-elapsed early-warning log gives operators visibility before real failures start, and the value should be revisited once production connect-latency data accumulates post-rollout.

## Migration Plan

Internal-only behavior fix; no data model or API changes. No backward-compatibility or migration steps needed — early-stage project, no users in production. Ship as a normal deploy; rollback is a plain revert if needed.

## Open Questions

None — verified all key behaviors directly against the installed SDK source and the current repository code, and this draft has already been through one round of rubber-duck review whose blocking finding (the intentional-shutdown special case reintroducing the hang) has been incorporated above rather than left open.
