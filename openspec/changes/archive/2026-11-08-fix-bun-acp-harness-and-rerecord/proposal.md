# Proposal

## Why

`record-bun-go-no-go` recorded No-Go with 20 blockers. All of them trace back to three OMP tests (ACP-02-OMP, ACP-04-OMP and ACP-06-OMP). The ACP-04-OMP failure also failed every other criterion of its suite through suite-level aggregation, and ACP-02-OMP did the same for its suite. A review found that none of the three failures involves the Bun parent:

- ACP-02-OMP and ACP-04-OMP: `printableText()` produced a 92-character cycle. OMP 18.6.1 has a thinking-loop detector that reported `Thinking loop detected: the model repeated near-identical content (repeated an exact 92-character cycle 13× back-to-back). Treating as a stream stall and retrying.` and forwarded only 12,990 bytes, whatever the script length. A runtime-neutral probe reproduced the same 12,990 bytes with a Node parent and a Node provider. With non-periodic text, Node and Bun both deliver 16 MiB byte-identically.
- ACP-06-OMP: the suite never implemented a client-side timeout. It waited 3 s, tore the agent down and required the raw ACP request to reject. On SIGTERM, OMP answers the outstanding prompt with stop reason `cancelled` before exiting. That is the agent's shutdown choice, not a parent-runtime property. Production `AgentConnector.prompt()` races the request against a client timer arm that only rejects (`src/acp/agent-connector.ts`), so the client call rejects whatever the agent does later.

## What Changes

- `acp/loopback-provider.ts`: `printableText()` derives byte `i` from a 32-bit integer hash of `seed + i`. Slices stay regenerable from their offset, the alphabet is unchanged and no short cycle appears.
- `suites/acp-failure.spec.ts`: ACP-06 races the prompt against a client timer that only rejects, as production does. The test asserts that this call rejects with the client timeout error and that teardown and the wrapper exit stay within their 5 s bounds. It also asserts that the abandoned raw request settles instead of hanging.
- Clarify the Client Timeout requirement so that "the call" is the client call with its timeout.
- Rerun every final suite on both architectures from one commit and re-record the outcome with the gate.

No size, bound, criterion or catalog entry changes. No product file changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-poc-acp-resilience`: the Client Timeout requirement names the client-side call.
- `bun-poc-acp-transport`: the scripted text must be non-periodic.

## Impact

- `migration/bun/poc/acp/loopback-provider.ts`, `migration/bun/poc/suites/acp-failure.spec.ts`.
- Regenerated `migration/bun/poc/evidence/`, `GO-NO-GO.md` and `GO-NO-GO.json`.
- The owner approved pushing `feat/migrate-to-bun` and one new `bun-poc-final-*` tag.
