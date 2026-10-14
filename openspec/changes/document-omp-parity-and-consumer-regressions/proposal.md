# Proposal

## Why

The approved 2026-10-14 OMP/OpenCode parity design replaces OMP-specific governance with native configuration and shared ACP policy. This change delivers a dependency-closed part of that approved design without changing OpenCode policy.

## What Changes

- Complete consumer handoff/non-regression coverage and synchronize current OMP documentation, unchanged-item dispositions, and operational evidence limits.
- **BREAKING**: Remove superseded pre-release contracts and their callers without compatibility aliases, migrations, or placeholder bridges.
- Synchronize this unit's behavior tests, affected current specification requirements, behavior documentation and CHANGELOG entry during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: change the requirements enumerated in this change’s spec delta.
- `skills-and-reply`: change the requirements enumerated in this change’s spec delta.

## Impact

Planning only. Implementation scope and concrete source evidence are in `design.md`; ordered edits, observable acceptance and per-task estimates are in `tasks.md`. Design item coverage for this unit: 1, 7, 16, 17, 18, 19, 24, 26, 28, 33, 34, 35, 36, 37. The complete 37-item ledger and implementation ownership matrix are in `../document-omp-parity-and-consumer-regressions/coverage.md`.

Estimated implementation effort, including verification and repair allowance: **7.50 hours**, strictly below 8 hours. This is an estimate, not a guarantee. No runtime/build/test/formatter execution is authorized by proposal creation.

## Non-goals

No OpenCode JSON-to-OMP translation, generated YAML, configuration templates, new governance/control channel, paid-model or platform delivery, UI redesign, public-code-search revival, or inverse assertions about cancelled policies. Preserve shared sandbox, callbacks, command policy, session JWT/staging/pointer and OpenCode’s existing recovery behavior.

## Batch:

depends-on: cutover-omp-native-runtime
depends-on: simplify-omp-container-installation

code-conflict: tests/mocks/omp-mock-session.ts; tests/integration/omp-skill-handoff/; tests/integration/omp-native-runtime/; tests/fixtures/omp-native-runtime/; docs/OMP_*.md; docs/omp-features/; config.example.yaml; .env.example; helm/values.yaml; openspec/specs/configuration-and-deployment/spec.md; openspec/specs/skills-and-reply/spec.md; CHANGELOG.md

Implementation order is the DAG recorded in `coverage.md`; shared-file edits are serialized even when changes have no behavioral dependency. Each predecessor remains a working deliverable. No prerequisite is deleted while a retained consumer imports it.
