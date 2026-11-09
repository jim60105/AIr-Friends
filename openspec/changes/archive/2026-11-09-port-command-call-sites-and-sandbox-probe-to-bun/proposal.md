# Proposal

## Why

Source design section 4.3 moves every `Deno.Command` call site other than the agent spawn to `node:child_process`, each keeping its current environment semantics, and section 4.7 keeps real `unshare` and `bwrap` execution as the sandbox probe with fail-closed behavior. Seven production sites remain after step 4 (git backup, git credential setup, skill installation, GIF conversion, two version probes, the sandbox probes), plus `scripts/omp/prepare-native-cache.ts`, which could not move in step 3 because it imports the OMP version probe. P0-7 (sandbox detection and fail-closed behavior) is entirely open after the Go record.

## What Changes

- Port the `Deno.Command` sites in `src/core/git-backup-service.ts`, `src/core/git-credential-setup.ts`, `src/core/skill-installer.ts`, `src/core/session-orchestrator.ts` (ImageMagick `convert`), `src/utils/omp-version.ts`, `src/utils/opencode-version.ts` and `src/acp/sandbox-capabilities.ts` to `node:child_process` with the environment rules in the design.
- `sandbox-capabilities.ts` uses `runtimeOs()` and `spawnSync`, keeping the exact probe commands and the cache.
- Convert `scripts/omp/prepare-native-cache.ts` to Bun (shebang, `node:*`, explicit-env child) and its test; add the `prepare:omp-natives` script.
- Add `tests/acp/sandbox-capabilities.test.ts` covering capable, incapable and failing-tool environments through real process execution.
- Convert `tests/utils/omp-version.test.ts`, `tests/utils/opencode-version.test.ts` and `tests/utils/prepare-native-cache.test.ts`; the tests deferred by `convert-core-sessions-and-workspaces-to-bun` now pass.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sandbox-hardening`: adds `Sandbox Capability Probes Execute The Real Tools`.

## Impact

- Edited: the seven production files above, `scripts/omp/prepare-native-cache.ts`, `package.json`, three converted test files. New: `tests/acp/sandbox-capabilities.test.ts`.
- Authorized out-of-D1 edits (standing authorization, recorded in design D5): `src/utils/process-lifecycle.ts`, `tests/core/session-orchestrator.test.ts`, `tests/core/git-backup-service.test.ts`, `tests/core/git-credential-setup.test.ts`, `tests/core/skill-installer.test.ts` and `migration/bun/baseline/parity-exceptions.json`.
- P0 ownership: **P0-7** at process and CI level (real probes in capable and incapable environments, fail-closed results). The target-container check is `package-bun-container-image`; the CI capable/incapable jobs are `migrate-ci-and-docs-to-bun`.
- No human review document.

## Batch:

depends-on: convert-core-sessions-and-workspaces-to-bun
depends-on: convert-acp-policy-and-filesystem-to-bun
depends-on: convert-utils-platforms-and-test-support-to-bun
depends-on: bundle-omp-extension-with-bun

Conflict note: edits four `src/core/` files after `convert-core-sessions-and-workspaces-to-bun`, and `package.json` (one script). Independent of the other step 5 changes.
