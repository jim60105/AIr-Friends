# Proposal

## Why

The egress proxy is an SSRF defense built on `Deno.connect`, `Deno.listen` and `Deno.resolveDns`, and its correctness depends on stream semantics that differ under `node:net`: half-close, short writes and backpressure (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 4.6 and 9). A silent regression here widens the network reach of an untrusted agent, so it must be proved before mass conversion.

## What Changes

- Add an isolated `node:net` and `node:dns/promises` port of `src/utils/egress-proxy.ts` under `migration/bun/poc/egress/`.
- Add a fake DNS server so resolver behavior, including rebinding, is exercised through the real `node:dns/promises` code path.
- Add the `egress` suite, implementing criteria EGR-01 to EGR-08 and carrying over the intent of `tests/utils/egress-proxy.test.ts`.
- No product file changes. The production proxy stays on Deno APIs.

## Capabilities

### New Capabilities

- `bun-poc-egress-proxy`: behavior a `node:net` egress proxy must prove under Bun before the migration may proceed.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/egress/`, `migration/bun/poc/suites/egress.spec.ts`.
- Reads production `src/utils/ssrf.ts` at run time, unmodified.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: define-bun-go-no-go-gate

Needs the image and `run-suite.sh` from `build-bun-poc-harness`, and the catalog and failure policy (gate design D5). Conflict note: touches only its own new files, so it can be applied in any order relative to the other `prove-*` changes.

Deferred, not part of this batch: migrating `src/utils/egress-proxy.ts` and `src/utils/gelf-transport.ts` is design section 8 step 5, planned only after a Go result.
