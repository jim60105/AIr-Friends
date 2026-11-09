# Design

## Context

See `proposal.md`. The gate binds evidence to `pocTreeSha256`, so any edit under `migration/bun/poc/` makes all earlier evidence stale. Every suite must therefore be rerun on both architectures from the commit that holds this fix.

## Decisions

### D1. Non-periodic fixture text

Byte `i` is `PRINTABLE[lowbias32(seed + i) % PRINTABLE.length]`. The integer hash keeps the property that a chunk is regenerable from its offset alone, and it excludes `"` and `\`, so JSON escaping cannot change a byte count. Lowering the size or changing the agent pin was rejected, because it would hide a real transport fault if one existed.

### D2. Client timeout in ACP-06

The timeout is a client concern. The suite mirrors `AgentConnector.prompt()`: `Promise.race([prompt, timer])`, where the timer arm only rejects with `ClientTimeoutError`. Assertions:

1. The raw prompt has not settled after 3 s, so the stalled provider did not end it.
2. The raced call rejects with `ClientTimeoutError`.
3. Teardown and the wrapper exit each resolve within 5 s.
4. The raw request settles within 5 s after teardown and is never left hanging.

On SIGTERM, OpenCode exits without answering, so its raw request rejects. OMP answers with stop reason `cancelled`. Both outcomes are valid ACP, and neither depends on the parent runtime.

### D3. Final runs

The run order is the same as `record-bun-go-no-go` design D1, with the same tag workflow for arm64 and the same Deno check (D3 there).

## Risks / Trade-offs

- [ACP-06 no longer requires the agent itself to reject an abandoned request] → Production never relies on that. The client-side rejection, the bounded teardown and "never hangs" are still asserted.
- [Suite-level aggregation still turns one failing test into failures for the whole suite] → Kept on purpose, because a failing hook drops the tests it guarded.
