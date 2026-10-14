# Tasks

## 1. Dependency-closed implementation

All estimates include the named work; the final task explicitly includes integration verification and repair allowance. Implement in the listed order. Land each task’s named behavior tests/docs with its edits, then run acceptance once after the whole change is coherent. Do not run builds/tests/linters/formatters mid-flight. No test of import wiring, source text, fixed schema/default copies, byte-equal settings, epoch constants, or inverse cancelled-policy behavior is acceptable. Production native YAML is hand-authored and never generated or rewritten.

- [ ] 1.1 Limit recovery ownership checks to unchanged OpenCode context (1.00 h estimate).
  - Prerequisite: simplify-omp-session-boundaries tasks 1.1–1.5.
  - Exact targets: src/acp/agent-connector.ts reconnectAndResumeSession(), prevalidateOmpRecoveryGateContext(), verifyRecoveryOwnership(); tests/acp/agent-connector.test.ts; tests/acp/recovery-ownership.test.ts.
  - Ordered edits: Remove unconditional OMP ownership/prevalidation blocks. Keep pre-teardown and post-connect ownership verification only for configured OpenCode with its existing supplied-context triggers. For OMP derive recoveryContextSupplied from gateContext, not obsolete ownership. Delete prevalidateOmpRecoveryGateContext. Preserve shared reconnect/load/cache/model/reasoning/post-load gate restore/hook ordering.
  - Input/output/error behavior: OMP without ownership can attempt supported native load; unsupported load still returns false with cleanup. OpenCode missing-context and foreign/mismatched supplied-record outcomes retain exact ordering and errors.
  - Remove or migrate: Delete OMP-prevalidation tests; keep OpenCode helper and foreign-record vocabulary because that branch still needs it.
  - Non-goals: No helper that always matches OMP; no mode reconstruction.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/agent-connector.test.ts tests/acp/recovery-ownership.test.ts; OMP normal recovery SHALL load, while OpenCode mismatched explicit ownership SHALL perform zero teardown/load effects.

- [ ] 1.2 Migrate every orchestrator recovery and acquisition caller (1.00 h estimate).
  - Prerequisite: Task 1.1.
  - Exact targets: src/core/session-orchestrator.ts OmpRecoveryContext, perSpawnRecoveryContext(), recoveryOwnershipFromRegistry(), pooled recovery objects at message/correction paths, eight acquisition recordOwnership sites; src/skill-api/session-registry.ts existing OpenCode bookkeeping.
  - Ordered edits: Remove OmpRecoveryContext and type the OMP per-spawn builder with common RecoveryContext, still returning undefined for existing OpenCode context-free per-spawn callers. Remove ownership property from OMP options; recoveryOwnershipFromRegistry returns OpenCode records only. Guard each recordOwnership write with OpenCode selection. Keep audit permissionMode/processNamespace observations and all existing current gate/effort/cwd/MCP values.
  - Input/output/error behavior: All OMP message/lurk/spontaneous/research/correction/maintenance/reminder and pooled runners retain their own session policy context. OpenCode optional contexts still receive existing recorded values.
  - Remove or migrate: Migrate all eight recordOwnership callers and recovery object builders; retain registry method/fields consumed by OpenCode and existing audit.
  - Non-goals: No session registry schema migration, pool key or permission-mode resolution change.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/core/session-orchestrator.test.ts tests/skill-api/session-registry.test.ts; recovery SHALL use the active session context and response fences SHALL prevent duplicate delivery.

- [ ] 1.3 Replace OMP ownership posture assertions with recovery outcomes (1.00 h estimate).
  - Prerequisite: Tasks 1.1 and 1.2.
  - Exact targets: tests/integration/omp-lifecycle/lifecycle.integration.test.ts recovery/cross-mode cases; tests/integration/omp-lifecycle/opencode-regression.integration.test.ts; tests/core/omp-pool-modes.test.ts.
  - Ordered edits: Remove OMP cross-mode ownership rejection fixtures and required-complete-context assertions. Exercise two real mode entries, crash/reload on the selected connector, model catalog miss isolation, gate restoration, global lease and response-gated re-prompt. Preserve explicit OpenCode foreign ownership/mismatch cases unchanged.
  - Input/output/error behavior: Selected mode entry remains distinct through recovery; sibling contexts/processes survive and duplicate responses stay prevented.
  - Remove or migrate: Retire only OMP ownership-based expectations; preserve pool mode selection and OpenCode record tests.
  - Non-goals: No inverse assertion promising all mismatched native sessions load.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/integration/omp-lifecycle tests/core/omp-pool-modes.test.ts; selected-mode recovery and global single lease SHALL hold; missing native session SHALL still report its native error.

- [ ] 1.4 Synchronize recovery docs and current requirements (0.50 h estimate).
  - Prerequisite: Tasks 1.1–1.3.
  - Exact targets: docs/OMP_RECOVERY.md; docs/OMP_POOL_MODES.md; CHANGELOG.md; acp-integration and shared-acp-process-pool delta requirements in this change.
  - Ordered edits: Describe native option-based OMP recovery, optional shared context, preserved OpenCode checks, mode-separated process reason and unverified real-native resumption. Remove mandatory OMP ownership/setup comparison checklists. Retain cache/model/reasoning/hook and duplicate-response behavior.
  - Input/output/error behavior: Operator sees actual recovery prerequisites and evidence limits.
  - Remove or migrate: Remove OMP record-required prose and cross-mode ownership claims from current docs, leaving historical archived documents unchanged.
  - Non-goals: No final inventory rewrite deferred from another unit.
  - Acceptance after this change is complete: Review documented recovery scenarios against the actual behavior tests; no native/image/platform acceptance claim follows from mock results.

- [ ] 1.5 Verify recovery cutover and repair focused regressions (1.00 h estimate).
  - Prerequisite: Tasks 1.1–1.4.
  - Exact targets: Affected source/tests/docs and both spec deltas.
  - Ordered edits: Run recovery/consumer tests and deno task check once; repair changed-context regressions. Record exact mock/native layers exercised.
  - Input/output/error behavior: OMP recovery is a complete shared consumer; OpenCode optional branches and global lease remain.
  - Remove or migrate: No mandatory OMP context type or production ownership read/write remains; shared OpenCode ownership mechanism remains live.
  - Non-goals: No new retries or native runtime cutover.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/agent-connector.test.ts tests/acp/recovery-ownership.test.ts tests/core/session-orchestrator.test.ts tests/core/omp-pool-modes.test.ts tests/integration/omp-lifecycle; deno task check. Expected bounded session-isolated errors and no duplicate delivery.

