# Tasks

## 1. State-preserving bounded cleanup (1.5 hours)

- [ ] 1.1 Add workspace-manager cleanup/discovery helpers for recognized user/internal/channel workspace shapes. Preserve `tmp` itself and reserved `omp-agent`/`opencode-data` children for both engines and modes; never scan pool/runtime/shared-agent roots or unrelated nested `tmp` directories.
- [ ] 1.2 Implement design D4's bounded synchronous no-symlink-descent traversal, 2,048-node/depth-64 limits, missing-entry tolerance and nonfatal partial-failure diagnostics. Replace whole-root recursive deletion rather than leaving a second policy in the orchestrator.

## 2. Producer lifetime and startup integration (2 hours)

- [ ] 2.1 Add workspace temporary-use acquire/release ownership independent of registry TTL. Apply it before workspace creation in every existing session-producing entrypoint and release once in the outer lifecycle after setup failures, dry runs, retry/completion, cancellation and failure paths.
- [ ] 2.2 Settle `AgentProcessPool.run()` results after the existing child-drain/pointer/JWT release path; preserve exact result classification, queue serialization and once-only settlement on acquisition/runner/release errors. Hold cleanup protection through uncertain teardown and report its skip.
- [ ] 2.3 Route existing teardown cleanup callsites through the shared owner and run actual cleanup on final idle release. Add awaited startup reclamation in bootstrap before AgentCore/Skill API, dashboard, platform and scheduler session ingress becomes reachable.

## 3. Lifecycle and filesystem regressions (2.5 hours)

- [ ] 3.1 Update existing orchestrator tmp-cleanup tests to assert entry removal and native-state preservation rather than disappearance of the entire tmp directory. Add workspace-manager fixtures for orphan staging/browser/conversion files, both native modes, OpenCode state, native runtime links, same-user concurrency and unchanged memory/pool/shared payload sentinels.
- [ ] 3.2 Add explicit barriers for pre-registration workspace creation, TTL-evicted live agents, pooled result-before-drain regression and per-spawn teardown. Cover every owning session entrypoint, dry-run/setup errors, queue expiry and exactly-once release without sleep-based races.
- [ ] 3.3 Add bootstrap ordering tests proving cleanup finishes before dashboard/platform/scheduler ingress. Cover no workspaces, recognized channel/internal layouts, missing/permission-failed entries, unsafe ancestry, disposable symlink targets, special nodes and small injected traversal budgets followed by later completion.
- [ ] 3.4 Retain computed SessionResponse/audit/metric behavior on cleanup errors and pool release failures; verify no completed session or startup fails solely because disposable removal failed.

## 4. Documentation and final verification (1.5 hours)

- [ ] 4.1 Document startup/idle cleanup, independent live-use protection, the supported single-owner volume/process-tree assumption, preserved native-state names, traversal bounds and retained state. Add the release-note entry without describing same-user leftovers as cross-user exposure.
- [ ] 4.2 Run focused workspace/orchestrator/pool/bootstrap tests once after edits, then project type/lint/format checks and strict OpenSpec validation. Record exercised filesystem/mock lifecycle evidence without claiming cross-instance or hostile-process race protection.
