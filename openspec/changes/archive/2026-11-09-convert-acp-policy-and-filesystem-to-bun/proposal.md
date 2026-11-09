# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the ACP permission and filesystem policy layer: command syntax and path policy, destructive-target policy, the filesystem roots, access and confinement logic, the sandbox manager, the skill inventory and the OMP helpers. These are the agent's security boundary, so their tests (design section 6 names `tests/acp/skill-inventory.test.ts` and `tests/acp/opencode-skill-permission-routing.test.ts`) must keep their intent exactly.

## What Changes

- Convert the 17 production files and 19 test files in design D1 with the codemod and the manual guide.
- `src/acp/skill-inventory.ts` gets only its filesystem calls converted. Its `deno run` grammar and interpreter allowlist stay until `enforce-bun-skill-approval-grammar`.
- `src/acp/filesystem-access-linux.ts` (FFI) and `src/acp/sandbox-capabilities.ts` are not in this slice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Behavior is unchanged; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Files: design D1 (36 files).
- The confinement entries `/deno-dir`, `/app/deno.json`, `/app/deno.lock` and `/home/deno/...` in `filesystem-confinement.ts` and `DENO_DIR`/`DENO_NO_UPDATE_CHECK` in `sandbox-manager.ts` stay until `rename-deno-runtime-identifiers`.
- P0 ownership: none. Security test intent is preserved; P0-4 (FFI) belongs to `port-filesystem-ffi-to-bun-ffi` and P0-6 to `enforce-bun-skill-approval-grammar`.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun

Conflict note: file set disjoint from the other `convert-*` changes. `port-filesystem-ffi-to-bun-ffi`, `port-command-call-sites-and-sandbox-probe-to-bun`, `enforce-bun-skill-approval-grammar` and `rename-deno-runtime-identifiers` later edit files of this slice and depend on it.
