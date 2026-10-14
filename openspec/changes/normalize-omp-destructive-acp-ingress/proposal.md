# Proposal

## Why

The approved 2026-10-14 OMP/OpenCode parity design replaces OMP-specific governance with native configuration and shared ACP policy. This change delivers a dependency-closed part of that approved design without changing OpenCode policy.

## What Changes

- Normalize configured OMP delete/move permission inputs at ACP client ingress and put destructive types under the shared policy owner.
- **BREAKING**: Remove superseded pre-release contracts and their callers without compatibility aliases, migrations, or placeholder bridges.
- Synchronize this unit's behavior tests, affected current specification requirements, behavior documentation and CHANGELOG entry during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: change the requirements enumerated in this change’s spec delta.

## Impact

Planning only. Implementation scope and concrete source evidence are in `design.md`; ordered edits, observable acceptance and per-task estimates are in `tasks.md`. Design item coverage for this unit: 15, 16, 18. The complete 37-item ledger and implementation ownership matrix are in `../document-omp-parity-and-consumer-regressions/coverage.md`.

Estimated implementation effort, including verification and repair allowance: **5.50 hours**, strictly below 8 hours. This is an estimate, not a guarantee. No runtime/build/test/formatter execution is authorized by proposal creation.

## Non-goals

No OpenCode JSON-to-OMP translation, generated YAML, configuration templates, new governance/control channel, paid-model or platform delivery, UI redesign, public-code-search revival, or inverse assertions about cancelled policies. Preserve shared sandbox, callbacks, command policy, session JWT/staging/pointer and OpenCode’s existing recovery behavior.

## Batch:

depends-on: none

code-conflict: src/acp/client.ts; src/acp/agent-connector.ts; openspec/specs/acp-integration/spec.md

Implementation order is the DAG recorded in `coverage.md`; shared-file edits are serialized even when changes have no behavioral dependency. Each predecessor remains a working deliverable. No prerequisite is deleted while a retained consumer imports it.
