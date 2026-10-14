# Tasks

## 1. Dependency-closed implementation

All estimates include the named work; the final task explicitly includes integration verification and repair allowance. Implement in the listed order. Land each task’s named behavior tests/docs with its edits, then run acceptance once after the whole change is coherent. Do not run builds/tests/linters/formatters mid-flight. No test of import wiring, source text, fixed schema/default copies, byte-equal settings, epoch constants, or inverse cancelled-policy behavior is acceptable. Production native YAML is hand-authored and never generated or rewritten.

- [x] 1.1 Remove connector lifecycle scanning gates (1.25 h estimate).
  - Prerequisite: None; serialize client/connector edits after ingress change if both are scheduled.
  - Exact targets: src/acp/agent-connector.ts acceptedOverlayIdentities, acceptedExecutableObservation, lastExecutableObservation, verifyOmpSettingsSourcesBeforeRequest(), verifyOmpExecutableSourcesBeforeRequest(), connect(), createSession(), reconnectAndResumeSession(); tests/acp/omp-settings-sources.test.ts; tests/acp/omp-executable-sources.test.ts.
  - Ordered edits: Delete connector observer fields/methods/getter/imports and all pre-native-request invocations. Retain normal skill inventory creation before spawn and current handshake/error cleanup. Remove gate-specific connector fixture cases; keep pure scanner tests while bootstrap still consumes scanners. Update docs/OMP_DISCOVERY.md with this exact interim lifecycle boundary.
  - Input/output/error behavior: Normal native startup/new/load errors flow from native/transport/shared policy; scanning adds no separate rejection. Missing shared skillsRoot still fails inventory before spawn.
  - Remove or migrate: Migrate connector scanner fixture callers; leave scanner modules and factory settingsSourcePlan alive for old bootstrap/factory consumers.
  - Non-goals: No factory/cwd/YAML/bootstrap change; no test guaranteeing upstream never scans.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/agent-connector.test.ts tests/integration/omp-lifecycle/lifecycle.integration.test.ts; normal handshake/new/load SHALL complete and shared inventory failure SHALL still spawn no process.

- [x] 1.2 Use the shared root observation for OMP callbacks (1.50 h estimate).
  - Prerequisite: Task 1.1.
  - Exact targets: src/acp/agent-connector.ts setSessionGateContext(); src/acp/client.ts observeFilesystemRoots(), setSessionContext(); src/acp/filesystem-policy.ts TrustedSkillsSource; src/acp/filesystem-roots.ts CriticalSkillReference; src/acp/omp/owned-skills.ts.
  - Ordered edits: Remove the connector's OMP ownedSkillsBaseline and observeOwnedSkills call/import. For OMP context registration derive existing root metadata from agentConfig.skillsRoot.root/identity; preserve OpenCode ctx.trustedSkills. Remove criticalSkills from shared source and copy paths plus client critical checks/PINNED_CRITICAL_SKILLS import. Move the complete CriticalSkillReference type into existing OMP owned-skills.ts, and type that producer's existing return/previous values as OwnedSkillsObservation extending shared TrustedSkillsSource with criticalSkills. Keep the producer and extension/critical-skills.ts import/re-export/call because old bootstrap still uses them. Keep canonical callback root identity/containment/no-follow observations. Retain nextRegistrationGeneration as a private common generation helper because setSessionContext calls it.
  - Input/output/error behavior: The same configured skill root supplies inventory/mount/callback metadata; session generations still protect shared context. Missing identity remains the existing shared callback failure. Native auto-approved reads gain no callback-only restriction.
  - Remove or migrate: Migrate all shared CriticalSkillReference/criticalSkills fixtures, client/connector copies and comments. Native owned-skills.ts consumes its relocated OMP-only type directly; no shared alias remains. Old extension critical-skills and owned-skills modules stay until the core replaces their runtime/build consumers.
  - Non-goals: No shared filesystem policy loosening or OpenCode source-selection change.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/filesystem-roots.test.ts tests/acp/filesystem-authorization.test.ts tests/acp/skill-inventory.test.ts; trusted skill callback read SHALL return content and write SHALL remain denied in both modes.

- [x] 1.3 Remove scanner-specific orchestration failures (1.00 h estimate).
  - Prerequisite: Task 1.1.
  - Exact targets: src/core/session-orchestrator.ts imports, RecoveryAbortReason, classifyRecoveryFailure() and scanner-specific catches; tests/core/session-orchestrator.test.ts; docs/OMP_RECOVERY.md.
  - Ordered edits: Remove SettingsSourceRejectionError/ExecutableSourceRejectionError imports and classification branches/string union entries. Preserve native error path, recovery fence, session failure reporting and common callback-denial reasons. Delete scanner-only orchestration assertions and document existing error isolation.
  - Input/output/error behavior: Removed scan error classes no longer terminate sessions; actual native/config/transport and shared authorization errors retain existing handling.
  - Remove or migrate: Migrate all scanner failure strings and fixture imports in orchestration tests; scanner source modules remain for bootstrap.
  - Non-goals: No retry-trigger expansion or recovery ownership change.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/core/session-orchestrator.test.ts; model/callback/transport failure SHALL remain scoped to the affected session and lease cleanup SHALL occur.

- [x] 1.4 Migrate callback and lifecycle behavior fixtures (1.50 h estimate).
  - Prerequisite: Tasks 1.1–1.3.
  - Exact targets: tests/acp/filesystem-authorization.test.ts fixture root producers and replay tests; tests/acp/filesystem-roots.test.ts; tests/integration/omp-lifecycle/lifecycle.integration.test.ts; tests/integration/omp-skill-handoff/handoff.integration.test.ts; docs/OMP_DISCOVERY.md; docs/OMP_TOOL_POLICY.md; CHANGELOG.md.
  - Ordered edits: Replace synthetic critical instructions/reference-generation producers with the shared canonical root observation. Keep temporary root files, actual read/write callbacks, denied side effects and sibling-context tests. Remove only critical/root-baseline/scan assertions, including sealed review/destructive/lsp/readiness fixtures. Revise interim docs and changelog to describe shared callback identity and native skill discovery responsibility.
  - Input/output/error behavior: Protected IO and per-session staging/JWT behavior remain; no fabricated critical skills are created.
  - Remove or migrate: Retire daemon callback fixtures importing owned-skills.ts and obsolete shared critical fields, including tests/acp/client.test.ts root producers; do not remove native bootstrap tests still consuming the OMP-only producer or filesystem containment, no-follow, read-extension or script exact-entry tests.
  - Non-goals: No broad handoff expansion assigned to final regression proposal.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/filesystem-authorization.test.ts tests/acp/filesystem-roots.test.ts tests/integration/omp-lifecycle/lifecycle.integration.test.ts tests/integration/omp-skill-handoff/handoff.integration.test.ts; legitimate reads/delivery and unauthorized write denials SHALL remain observable.

- [x] 1.5 Verify shared callback preservation and close the boundary cut (1.50 h estimate).
  - Prerequisite: Tasks 1.1–1.4.
  - Exact targets: Affected source/tests/docs and acp-integration delta.
  - Ordered edits: Run focused tests and deno task check once; repair changed-callsite regressions. Confirm retained bootstrap/factory still has its scanner/settings modules by import resolution rather than a text-wiring assertion. Apply the shared-root requirement delta without imposing callbacks on native reads.
  - Input/output/error behavior: Working connector and callback deliverable; old native extension remains unchanged until the core cutover.
  - Remove or migrate: No daemon callback uses the OMP-only producer; owned-skills.ts and retained scanners still have genuine native bootstrap consumers, all replaced/deleted together by the core.
  - Non-goals: No next-proposal implementation.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/agent-connector.test.ts tests/acp/filesystem-roots.test.ts tests/acp/filesystem-authorization.test.ts tests/acp/skill-inventory.test.ts tests/integration/omp-lifecycle tests/integration/omp-skill-handoff; deno task check. Expected protected callback outcomes and OpenCode paths unchanged.

