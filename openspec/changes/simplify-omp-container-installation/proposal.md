# Proposal

## Why

The approved 2026-10-14 OMP/OpenCode parity design replaces OMP-specific governance with native configuration and shared ACP policy. This change delivers a dependency-closed part of that approved design without changing OpenCode policy.

## What Changes

- Use existing OpenCode ownership/install conventions for OMP artifacts and remove internal package manifests while retaining pinned download checks and notices.
- **BREAKING**: Remove superseded pre-release contracts and their callers without compatibility aliases, migrations, or placeholder bridges.
- Synchronize this unit's behavior tests, affected current specification requirements, behavior documentation and CHANGELOG entry during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: change the requirements enumerated in this change’s spec delta.

## Impact

Planning only. Implementation scope and concrete source evidence are in `design.md`; ordered edits, observable acceptance and per-task estimates are in `tasks.md`. Design item coverage for this unit: 14, 29, 30. The complete 37-item ledger and implementation ownership matrix are in `../document-omp-parity-and-consumer-regressions/coverage.md`.

Estimated implementation effort, including verification and repair allowance: **5.00 hours**, strictly below 8 hours. This is an estimate, not a guarantee. No runtime/build/test/formatter execution is authorized by proposal creation.

## Non-goals

No OpenCode JSON-to-OMP translation, generated YAML, configuration templates, new governance/control channel, paid-model or platform delivery, UI redesign, public-code-search revival, or inverse assertions about cancelled policies. Preserve shared sandbox, callbacks, command policy, session JWT/staging/pointer and OpenCode’s existing recovery behavior.

## Batch:

depends-on: cutover-omp-native-runtime

code-conflict: Containerfile; scripts/omp/generate-omp-manifest.sh; tests/utils/omp-packaging.test.ts; tests/acp/omp-owned-module-bundle-smoke.test.ts; docs/OMP_PACKAGING.md; docs/OMP_SPAWN.md; openspec/specs/container-packaging/spec.md; CHANGELOG.md

Implementation order is the DAG recorded in `coverage.md`; shared-file edits are serialized even when changes have no behavioral dependency. Each predecessor remains a working deliverable. No prerequisite is deleted while a retained consumer imports it.
