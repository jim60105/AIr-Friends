# Proposal

## Why

The Bun migration needs an immutable reference point before anything changes: the parity gate, the coverage comparison and the rollback path all depend on Deno-era facts that disappear once the code moves (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, section 8 step 1).

## What Changes

- Add a small, self-contained record tool under `migration/bun/baseline/` that captures the freeze SHA, every Deno test name with its result, and the Deno coverage summary, and that validates the committed records.
- Commit the captured records under `migration/bun/baseline/records/`.
- Add an operator runbook and an operator record template for the two steps that need production access: the old image digest and the `/app/data` backup.
- No file outside `migration/bun/` changes. Deno stays the working runtime.

Operator-run (human with production access; the agent cannot do these): recording the deployed image digest and backing up `/app/data`. These are tasks 3.1 to 3.3 and are marked `OPERATOR` in `tasks.md`.

## Capabilities

### New Capabilities

- `bun-migration-baseline`: capturing and validating the Deno-era reference records that the Bun migration is measured against.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/README.md`, `migration/bun/baseline/` (tool, tests, runbook, records).
- New development dependency, local to `migration/bun/baseline/package.json`: `fast-xml-parser`.
- No change to `src/`, `tests/`, `deno.json`, `deno.lock`, the image, Helm or CI.
- No human review document: every requirement is established by tests.

## Batch:

No `depends-on` lines: this change has no prerequisite and is first in the batch.

Conflict note: no file overlap with any change in the batch. `define-bun-go-no-go-gate` and `record-bun-go-no-go` read `migration/bun/baseline/records-schema.ts` and the records. Operator tasks 3.1 to 3.3 block archive of this change until a human completes them.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result.
