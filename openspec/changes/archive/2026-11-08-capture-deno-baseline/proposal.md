# Proposal

## Why

The Bun migration needs an immutable reference point before anything changes: the parity gate, the coverage comparison and the rollback path all depend on Deno-era facts that disappear once the code moves (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, section 8 step 1).

## What Changes

- Add a small, self-contained record tool under `migration/bun/baseline/` that captures the freeze SHA, every Deno test name with its result, and the Deno coverage summary, and that validates the committed records.
- Commit the captured records under `migration/bun/baseline/records/`.
- Record the deployed image as an immutable rollback reference, read by the agent with `kubectl` and `skopeo`.
- No file outside `migration/bun/` changes. Deno stays the working runtime.

No step needs a human. Owner decision: step 1 takes no `/app/data` backup, because no step before cutover touches production data. Backup at cutover stays in section 10 of the source design.

## Capabilities

### New Capabilities

- `bun-migration-baseline`: capturing and validating the Deno-era reference records that the Bun migration is measured against.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/README.md`, `migration/bun/baseline/` (tool, tests, records).
- New development dependency, local to `migration/bun/baseline/package.json`: `fast-xml-parser`.
- No change to `src/`, `tests/`, `deno.json`, `deno.lock`, the image, Helm or CI.
- No human review document: every requirement is established by tests.

## Batch:

No `depends-on` lines: this change has no prerequisite and is first in the batch.

Conflict note: no file overlap with any change in the batch. `define-bun-go-no-go-gate` and `record-bun-go-no-go` read `migration/bun/baseline/records-schema.ts` and the records.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result.
