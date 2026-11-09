# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the session orchestrator, workspace management, skill installation and root resolution, git backup and credential setup, and bootstrap. These modules decide what the agent may see on disk, so their many monkeypatched filesystem tests must keep working.

## What Changes

- Convert the ten production files in design D1 and their tests with the codemod and the manual guide.
- `Deno.Command` calls in `git-backup-service.ts`, `git-credential-setup.ts`, `session-orchestrator.ts` and `skill-installer.ts` stay for `port-command-call-sites-and-sandbox-probe-to-bun`; tests that reach them are deferred.
- Test-side `Deno.Command`, `Deno.serve` and monkeypatches are converted here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-trust-boundary`: `Workspace tmp/ Cleanup on Session End` names the not-found condition without the Deno error class.

## Impact

- Files: design D1 (31 files). `src/core/agent-process-pool.ts` is not here (`port-process-lifecycle-and-pool-to-bun`).
- The `/home/deno` fallback in `git-credential-setup.ts` stays until `rename-deno-runtime-identifiers`.
- P0 ownership: none.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun

Conflict note: file set disjoint from the other `convert-*` changes. `port-command-call-sites-and-sandbox-probe-to-bun` later edits four of these production files, so it depends on this change.
