# Proposal

## Why

The migration has an early exit, but "Go" needs a definition a test can establish before any proof-of-concept result exists, or the decision drifts toward whatever the results happen to show. The source design (`docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 8 and 9) requires a Go/No-Go step tied to the P0 release blockers, and section 3 states that the earlier probes satisfy none of them.

## What Changes

- Define the criterion catalog: one explicit pass/fail criterion per check, each mapped to a P0 blocker, plus an explicit deferral for every part of a P0 blocker the proof of concept does not reach.
- Add the gate: binding checks that reject stale evidence, the Go/No-Go evaluation, the product-isolation condition, and the outcome record writer and verifier.
- No product file changes. Deno stays the working runtime.

## Capabilities

### New Capabilities

- `bun-go-no-go-gate`: the catalog, evidence, evaluation and outcome-record rules that decide whether the Bun migration proceeds.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/gate/catalog.ts`, `evaluate.ts`, `record.ts`, `verify-record.ts`, `gate.spec.ts`.
- Reads `migration/bun/baseline/records-schema.ts`.
- No change to product files, Helm or CI.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: capture-deno-baseline
depends-on: build-bun-poc-harness

Imports `validateBaselineDir` from `migration/bun/baseline/records-schema.ts`, and `SuiteEvidence`, the hash helpers and `POC_PINS` from the harness. Conflict note: this change creates the catalog, and no `prove-*` change may edit it. Their criterion IDs are fixed here. No file overlap with either dependency.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result.
