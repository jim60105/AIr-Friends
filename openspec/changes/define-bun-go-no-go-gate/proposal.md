# Proposal

## Why

The migration has an early exit, but "Go" needs a definition a test can establish before any proof-of-concept result exists, or the decision drifts toward whatever the results happen to show. The source design (`docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 8 and 9) requires a Go/No-Go step tied to the P0 release blockers, and section 3 states that the earlier probes satisfy none of them.

## What Changes

- Add the proof-of-concept workspace `migration/bun/poc/` with exact Bun and agent pins and a container image that reproduces the target runtime.
- Define the criterion catalog: one explicit pass/fail criterion per check, each mapped to a P0 blocker, plus an explicit deferral for every part of a P0 blocker the proof of concept does not reach.
- Add the gate: evidence collected from `bun test` JUnit reports, binding checks that reject stale evidence, the Go/No-Go evaluation, the product-isolation condition, and the outcome record writer and verifier.
- No product file changes. Deno stays the working runtime.

## Capabilities

### New Capabilities

- `bun-go-no-go-gate`: the catalog, evidence, evaluation and outcome-record rules that decide whether the Bun migration proceeds.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/` (image, run script, gate, harness suite, fixtures).
- New dependencies, local to `migration/bun/poc/package.json`: `@agentclientprotocol/sdk`, `zod`, `fast-xml-parser`.
- Reads `migration/bun/baseline/records-schema.ts`.
- No change to `src/`, `tests/`, `deno.json`, `deno.lock`, the root `Containerfile`, Helm or CI.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: capture-deno-baseline

Follows design section 8 order and imports `validateBaselineDir` from `migration/bun/baseline/records-schema.ts`. Conflict note: this change creates `Containerfile`, `package.json`, the catalog and the suite table, and the four `prove-*` changes must not edit them. Their criterion IDs are fixed here. No file overlap with `capture-deno-baseline`.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result.
