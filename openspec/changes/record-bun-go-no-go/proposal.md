# Proposal

## Why

The migration may continue only on a recorded decision, and steps 3 to 8 are planned only after a Go result (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, section 8). This change runs the frozen proof of concept once on both architectures and commits the outcome: Go or No-Go.

## What Changes

- Run every suite with `--final` on x86_64 from one commit.
- Run the FFI suites on a native arm64 host from the same commit. This step is operator-run: it needs a real arm64 kernel and the agent has none.
- Commit the evidence, generate `migration/bun/poc/GO-NO-GO.md` and `GO-NO-GO.json` with the gate, and verify them.
- Confirm Deno still works on the branch.
- No product file changes, whichever outcome results.

Operator-run (human with a native arm64 Linux host; the agent cannot do this): task 2.1, marked `OPERATOR` in `tasks.md`.

## Capabilities

### New Capabilities

- `bun-go-no-go-outcome`: the committed outcome artifact stating Go or No-Go and how it is verified.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/evidence/`, `migration/bun/poc/GO-NO-GO.md`, `migration/bun/poc/GO-NO-GO.json`.
- No code is added; the gate from `define-bun-go-no-go-gate` does the work.
- No human review document: the outcome is computed from evidence.

## Batch:

depends-on: capture-deno-baseline
depends-on: build-bun-poc-harness
depends-on: define-bun-go-no-go-gate
depends-on: prove-bun-ffi-confinement
depends-on: prove-bun-agent-process-boundary
depends-on: prove-bun-acp-real-agents
depends-on: prove-bun-acp-failure-paths
depends-on: prove-bun-egress-proxy
depends-on: prove-bun-injection-defenses

Must run last, because any change under `migration/bun/poc/` afterward makes the evidence stale through the tree hash. Conflict note: no change may edit `migration/bun/poc/` between task 1.1 and the final commit.

Deferred, not part of this batch: design section 8 steps 3 to 8 are planned only after a Go result: 3 Toolchain, 4 Mechanical conversion, 5 High-risk modules, 6 Skills and gate, 7 Packaging and deployment, 8 Cutover. Unfreezing `master` after a No-Go is an owner decision.
