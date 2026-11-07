# Proposal

## Why

Proof-of-concept results mean nothing unless they run on the target runtime with the exact pins, and the host cannot provide that: its libc lives at a different path and its agents are newer than the pins (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 7 and 8). Every proof change needs one shared way to run a suite and capture what happened.

## What Changes

- Add the proof-of-concept workspace `migration/bun/poc/` with exact Bun and agent pins.
- Add a container image that reproduces the target runtime, and `run-suite.sh`, which runs one suite under production-like restrictions.
- Add evidence collection: `bun test` JUnit reports become evidence files bound to the tree and to the production sources in use.
- No product file changes. Deno stays the working runtime.

## Capabilities

### New Capabilities

- `bun-poc-harness`: running a proof-of-concept suite on the pinned runtime and capturing bound evidence.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/` (image, run script, evidence helpers, harness suite).
- New dependencies, local to `migration/bun/poc/package.json`: `@agentclientprotocol/sdk`, `zod`, `fast-xml-parser`.
- No change to `src/`, `tests/`, `deno.json`, `deno.lock`, the root `Containerfile`, Helm or CI.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: capture-deno-baseline

Follows design section 8 order. Conflict note: this change creates `Containerfile`, `run-suite.sh`, `package.json`, `gate/pins.ts` and `gate/evidence.ts`; later changes must not edit them. No file overlap with `capture-deno-baseline`.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result.
