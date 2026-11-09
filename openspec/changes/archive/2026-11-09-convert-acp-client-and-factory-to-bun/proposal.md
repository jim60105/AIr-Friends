# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the ACP client (permission gate and file operations), the agent factory that builds launch configuration and environments for OpenCode and OMP, and their tests, including the email intent profiles.

## What Changes

- Convert `src/acp/client.ts`, `src/acp/agent-factory.ts`, `src/acp/mod.ts` and the 10 test files in design D1.
- `src/acp/agent-factory.ts`: `@std/yaml` → `yaml`; `Deno.pid` → `process.pid`; `Deno.build.os` → `runtimeOs()`.
- The environment allowlists (`inheritVars` with `DENO_DIR`) are not changed here; `adopt-bun-agent-process-boundary` owns the production variable set (P0-1).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Behavior is unchanged; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Files: design D1 (13 files). `tests/acp/client.test.ts` alone has 663 `Deno.` matches.
- User-facing `deno task bundle:omp-extension` remedy strings stay until `rename-deno-runtime-identifiers`.
- P0 ownership: none.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun
depends-on: convert-acp-policy-and-filesystem-to-bun

Conflict note: file set disjoint from the other `convert-*` changes. Depends on `convert-acp-policy-and-filesystem-to-bun` because `client.ts` imports the policy and filesystem modules and `client.test.ts` uses `tests/acp/filesystem-test-calls.ts`.
