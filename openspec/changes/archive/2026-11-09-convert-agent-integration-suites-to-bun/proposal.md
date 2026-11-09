# Proposal

## Why

The agent integration suites (`tests/integration/shared-process.integration.test.ts`, `tests/integration/omp-lifecycle/`, `tests/integration/omp-native-runtime/`) exercise the real connector, pool and lifecycle against mock ACP agents and, where present, the pinned `omp` executable. They depend on every step 5 process change, so they convert last. Source design section 6 accepts losing Deno's 432 sanitizer options only if P0 integration tests check file-descriptor and process counts instead; these suites are where that check belongs. P0-2 needs ACP handshake, large NDJSON, stderr, backpressure, EOF, timeout, cancellation and abrupt exit to pass on production code.

## What Changes

- Convert the four integration files with the codemod and the manual guide; mock agents are launched with `bun run --no-env-file` instead of `deno run`.
- Replace the suites' `which`, `kill`, `pgrep` and `pkill` helper commands with `Bun.which` and the `process-lifecycle.ts` primitives.
- Add `tests/helpers/leak-check.ts` (descriptor and descendant counts) and call it in every test's teardown in the four files, replacing the dropped `sanitizeOps`, `sanitizeResources` and `sanitizeExit` options.
- Keep scripted model text non-periodic (Go record finding 5) and ACP timeouts client-side.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: `Lifecycle Suite Determinism and Execution Boundaries` says `bun`-launched mocks; adds `Integration Suites Leave No Leaked Descriptors Or Processes`.

## Impact

- Edited: the four integration test files. New: `tests/helpers/leak-check.ts`, `tests/helpers/leak-check.test.ts`.
- P0 ownership: **P0-2** integration level (complete together with `adopt-bun-agent-process-boundary`); **P0-3** test-level leak checks.
- No human review document.

## Batch:

depends-on: adopt-bun-agent-process-boundary
depends-on: port-process-lifecycle-and-pool-to-bun
depends-on: port-command-call-sites-and-sandbox-probe-to-bun
depends-on: port-http-servers-to-bun-serve
depends-on: port-egress-proxy-and-gelf-to-node-net
depends-on: port-filesystem-ffi-to-bun-ffi
depends-on: port-signals-and-entrypoint-to-bun

Conflict note: test-only change after every other step 5 change; it is the step 5 exit gate (design section 8: step 5 ends with its affected tests passing).
