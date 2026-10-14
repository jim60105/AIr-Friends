# Tasks

## 1. Dependency-closed implementation

All estimates include the named work; the final task explicitly includes integration verification and repair allowance. Implement in the listed order. Land each task’s named behavior tests/docs with its edits, then run acceptance once after the whole change is coherent. Do not run builds/tests/linters/formatters mid-flight. No test of import wiring, source text, fixed schema/default copies, byte-equal settings, epoch constants, or inverse cancelled-policy behavior is acceptable. Production native YAML is hand-authored and never generated or rewritten.

- [ ] 1.1 Give shared destructive types one owner (0.75 h estimate).
  - Prerequisite: None; this is a runnable prerequisite unit.
  - Exact targets: src/acp/destructive-policy.ts; src/acp/omp/compatibility-contracts.ts; src/acp/omp/destructive-validator.ts; src/acp/omp/destructive-decision.ts; src/acp/omp/extension/_daemon/mod.ts; src/acp/client.ts; tests/acp/destructive-policy.test.ts.
  - Ordered edits: Move the complete DestructiveIntentInput and DestructiveOperation declarations into destructive-policy.ts. Remove their ledger declarations. Point every listed consumer directly at the shared owner; retain ledger validators still used by the old extension. Update relevant destructive-policy docs and CHANGELOG with shared ownership.
  - Input/output/error behavior: Type ownership changes only; decode, normalize, denial reason and all-target authorization outcomes stay unchanged.
  - Remove or migrate: Migrate all imports of both moved declarations, including current extension façade type exports; do not leave a ledger re-export alias.
  - Non-goals: No ledger/module deletion, parser change, or new helper framework.
  - Acceptance after this change is complete: Run deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/destructive-policy.test.ts; the complete existing conformance cases SHALL retain allow/denial/ordered-target outcomes.

- [ ] 1.2 Supply connector-selected agent type to client ingress (0.75 h estimate).
  - Prerequisite: Task 1.1.
  - Exact targets: src/acp/types.ts ClientConfig; src/acp/agent-connector.ts connect(); src/acp/client.ts requestPermission(); tests/acp/client.test.ts.
  - Ordered edits: Add optional internal agentType to ClientConfig. In connect() pass {...clientConfig, agentType: this.options.agentType}, overriding any duplicate config field. In client choose OMP normalizer only from this field. Keep omitted type on current decoder. Add behavior fixtures invoking requestPermission with conflicting request metadata.
  - Input/output/error behavior: Configured OMP selects OMP ingress; configured OpenCode/omitted type retains current decoder. Caller rawInput cannot select agent type.
  - Remove or migrate: Migrate connector-created clients; direct fixtures without a type remain valid. Remove no public supported-type defaults.
  - Non-goals: No dashboard or app configuration field; no fifth constructor protocol.
  - Acceptance after this change is complete: Run deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/client.test.ts tests/acp/agent-connector.test.ts; a spoofed OMP marker on an OpenCode request SHALL produce the original selected allow/reject outcome.

- [ ] 1.3 Normalize native single destructive inputs (1.25 h estimate).
  - Prerequisite: Tasks 1.1 and 1.2.
  - Exact targets: new src/acp/omp/destructive-ingress.ts normalizeOmpDestructivePermissionInput(); src/acp/client.ts requestDestructivePermission(); tests/acp/client.test.ts.
  - Ordered edits: Implement the pure helper with native Delete/Move kind/title identification, documented nullish alias precedence and supported single-operation field guard. Canonicalize only complete delete/path or move/source/destination shapes. Preserve incomplete/unsupported forms for existing denial. Serialize once for both rawInput and executionInputBinding. Pass the canonical intent into the existing decoder while keeping original params for diagnostics and the existing location/context expansion.
  - Input/output/error behavior: Complete OMP single operations use common all-target decisions. Title-only, malformed JSON, invalid higher-priority alias, missing endpoint/locations and patch/edit lists remain shared denials. YOLO returns before this adapter as before.
  - Remove or migrate: Replace only the OMP kind-only intent construction; retain OpenCode construction. No request operations/provenance is promoted to trusted adapter input.
  - Non-goals: No canonical path or command policy duplication; no native first-operation patch decoder.
  - Acceptance after this change is complete: Run deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/client.test.ts tests/acp/destructive-policy.test.ts; complete allowed staging delete/move SHALL select allow_once, denied endpoint/partial locations SHALL select reject_once and retain files.

- [ ] 1.4 Exercise native shapes through permission consumers (1.25 h estimate).
  - Prerequisite: Task 1.3.
  - Exact targets: tests/acp/client.test.ts; tests/acp/destructive-policy.test.ts; tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts; docs/OMP_TOOL_POLICY.md destructive section.
  - Ordered edits: Add table-driven permission fixtures for missing kind, all move aliases, invalid preferred alias, title-only, extra mutation fields, truncated and conflicting locations, unsupported embedded patches, YOLO and matching OpenCode requests. Use real temporary files and session gate context. Add an ACP client integration case independent of old extension admission. Update docs to distinguish this fixed ingress from old extension restrictions.
  - Input/output/error behavior: Assert selected permission and file outcomes, audit original input and correct per-session target authorization. OpenCode unsupported patches stay rejected.
  - Remove or migrate: Delete any new test that asserts canonical helper serialization alone; preserve existing behavioral common fixtures.
  - Non-goals: No real paid model, platform or config change.
  - Acceptance after this change is complete: Run deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/client.test.ts tests/acp/destructive-policy.test.ts tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts; actual ACP ingress outcomes SHALL match the scenarios above without asserting obsolete extension provenance.

- [ ] 1.5 Verify the closed client change and repair regressions (1.50 h estimate).
  - Prerequisite: Tasks 1.1–1.4.
  - Exact targets: All files above; this change’s acp-integration delta; docs/OMP_TOOL_POLICY.md; CHANGELOG.md.
  - Ordered edits: Run the listed focused tests together and deno task check once; repair only this unit’s regressions. Reconcile the delta with changed behavior and record source/mock evidence separately.
  - Input/output/error behavior: Client destructive operations and OpenCode cases pass; native runtime is not claimed by this unit.
  - Remove or migrate: No obsolete ledger type declarations or aliases remain; retained old runtime still has all prerequisites.
  - Non-goals: No builds, image validation or implementation of later proposals.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/acp/client.test.ts tests/acp/destructive-policy.test.ts tests/acp/agent-connector.test.ts tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts; deno task check. Expected no changed permission outcome outside OMP ingress.

