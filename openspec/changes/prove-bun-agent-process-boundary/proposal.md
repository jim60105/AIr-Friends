# Proposal

## Why

The design's main runtime risk is that Bun's `node:child_process` differs from Deno's process model under load (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 4.3 and 11). The single spawn boundary has to be proved against deterministic child processes first, so a later real-agent failure can be told apart from a boundary failure.

## What Changes

- Add a proof-of-concept `createAgentProcess` boundary matching the `AgentProcessHandle` contract in design section 4.3, on `node:child_process`, wrapped by `dumb-init`, with an explicit environment.
- Add the teardown helper that mirrors the connector's SIGTERM then SIGKILL after 2 seconds.
- Add the `process` suite, implementing criteria PROC-01 to PROC-09: backpressure in both directions, large round trip, stderr drain, stdin EOF, real child environment, signals and descriptor and process counts.
- If and only if a criterion fails on `node:child_process`, add the `Bun.spawn` fallback behind the same boundary, as the design allows.
- No product file changes. `AgentConnector` keeps `Deno.Command`.

## Capabilities

### New Capabilities

- `bun-poc-agent-process`: behavior the Bun agent spawn boundary must prove with deterministic child processes before real agents are attempted.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/process/`, `migration/bun/poc/fixtures/children/`, `migration/bun/poc/suites/process.spec.ts`.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: define-bun-go-no-go-gate

Needs the image, `run-suite.sh`, the `observe` helper and the failure policy (gate design D7). Conflict note: touches only its own new files. `prove-bun-acp-real-agents` imports `migration/bun/poc/process/agent-process.ts` and `process/proc-tree.ts`.

Deferred, not part of this batch: moving `AgentConnector` to this boundary is design section 8 step 5, planned only after a Go result.
