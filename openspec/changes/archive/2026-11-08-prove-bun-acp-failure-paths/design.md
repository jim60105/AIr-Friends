# Design

## Context

See `proposal.md` for motivation. The provider's `paced` and `stall` scripts, `stallAfter` and `promptOrCrash` exist from `prove-bun-acp-real-agents`. `AgentConnector` races every outbound call against a crash signal; `promptOrCrash` mirrors that.

## Goals / Non-Goals

**Goals:** prove criteria ACP-04 to ACP-08 for both agents.

**Non-Goals:**

- No edit to `acp/`, `process/`, `gate/`, `Containerfile`, `run-suite.sh` or product files. If the driver lacks something, stop and report it.
- No proof that backpressure reached the agent's internals. ACP-04 proves integrity under a stalled reader; PROC-01 proves the pipe stops.
- No idle-timeout or recovery logic from the connector.

## Decisions

### D1. Suite method

`migration/bun/poc/suites/acp-failure.spec.ts` follows the shape of `suites/acp.spec.ts`: provider per test, `afterEach` runs `run.stop()` and kills recorded survivors, loop over `[["opencode", "OC"], ["omp", "OMP"]]`.

| ID | Method |
| --- | --- |
| ACP-04 | `startRun(kind, { wrapStdout: stallAfter(1048576, 3000) })`, `text` script of 4 MiB with `chunkBytes` 262144. Compare SHA-256. |
| ACP-05 | `paced` script (65536 bytes, 50 ms, 60 s). Await `firstText`, call `connection.cancel({ sessionId })`, race the prompt with 5 s, assert stop reason `cancelled`. |
| ACP-06 | `stall` script. Race the prompt with a 3 s timer and assert the timer won, then assert `stop()` resolves within 5 s while the prompt was pending and `exited` is settled. The second half is the point of this test. |
| ACP-07 | `paced` script. Await `firstText`, `process.kill(await waitForChild(handle.pid), "SIGKILL")`, assert `promptOrCrash` rejects within 3 s, await `exited`. |
| ACP-08 | After a short prompt, `stop()`, then race `connection.closed` with 5 s and assert it resolved. |

The agent's process is the direct child of `dumb-init`. Killing it makes `dumb-init` exit with the child's status, so `exited` resolves.

## Risks / Trade-offs

- [An agent does not end the prompt with `cancelled` on a paced stream] → A real ACP-05 failure, reported with the observed stop reason. Under gate design D5, do not extend the 5 s bound.
- [A fresh OMP data home slows start-up] → The 3 s and 5 s bounds start after `firstText` or after `stop()`, so start-up time is not counted.
