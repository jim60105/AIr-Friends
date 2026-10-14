# Proposal

## Why

The approved 2026-10-14 OMP/OpenCode parity design replaces OMP-specific governance with native configuration and shared ACP policy. This change delivers a dependency-closed part of that approved design without changing OpenCode policy.

## What Changes

- Atomically replace the governance extension with a capability-name default-deny callback, restore native network/skill tools, and switch launch to authored YAML with native model-file discovery.
- **BREAKING**: Remove superseded pre-release contracts and their callers without compatibility aliases, migrations, or placeholder bridges.
- Synchronize this unit's behavior tests, affected current specification requirements, behavior documentation and CHANGELOG entry during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `shared-acp-process-pool`: retain entry/lease behavior while replacing obsolete mode-specific cwd/TMPDIR requirements with selected native data separation.

- `acp-integration`: change the requirements enumerated in this change’s spec delta.
- `container-packaging`: change the requirements enumerated in this change’s spec delta.
- `configuration-and-deployment`: remove physical-trust and manifest language from the current generated-artifact documentation contract.

## Impact

Planning only. Implementation scope and concrete source evidence are in `design.md`; ordered edits, observable acceptance and per-task estimates are in `tasks.md`. Design item coverage for this unit: 2, 3, 5, 6, 8, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 35. The complete 37-item ledger and implementation ownership matrix are in `../document-omp-parity-and-consumer-regressions/coverage.md`.

Estimated implementation effort, including verification and repair allowance: **7.75 hours**, strictly below 8 hours. This is an estimate, not a guarantee. No runtime/build/test/formatter execution is authorized by proposal creation.

## Non-goals

No OpenCode JSON-to-OMP translation, generated YAML, configuration templates, new governance/control channel, paid-model or platform delivery, UI redesign, public-code-search revival, or inverse assertions about cancelled policies. Preserve shared sandbox, callbacks, command policy, session JWT/staging/pointer and OpenCode’s existing recovery behavior.

## Batch:

depends-on: normalize-omp-destructive-acp-ingress
depends-on: simplify-omp-session-boundaries
depends-on: simplify-omp-recovery-context

code-conflict: src/acp/types.ts; src/acp/agent-factory.ts; src/utils/omp-paths.ts; src/acp/sandbox-manager.ts; src/core/agent-process-pool.ts; src/acp/omp/; scripts/omp/; Containerfile; tests/mocks/omp-mock-session.ts; tests/integration/omp-lifecycle/; tests/integration/omp-skill-handoff/; tests/utils/omp-packaging.test.ts; docs/OMP_*.md; openspec/specs/acp-integration/spec.md; openspec/specs/container-packaging/spec.md; openspec/specs/configuration-and-deployment/spec.md; CHANGELOG.md
code-conflict: src/acp/filesystem-confinement.ts; tests/acp/filesystem-confinement.test.ts; tests/acp/sandbox-manager.test.ts; openspec/specs/shared-acp-process-pool/spec.md

Implementation order is the DAG recorded in `coverage.md`; shared-file edits are serialized even when changes have no behavioral dependency. Each predecessor remains a working deliverable. No prerequisite is deleted while a retained consumer imports it.
