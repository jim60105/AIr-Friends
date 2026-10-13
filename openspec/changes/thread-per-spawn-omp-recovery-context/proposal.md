# Proposal

## Why

Seven per-spawn prompt/retry call sites omit recorded recovery ownership, full gate context and resolved reasoning effort, unlike pooled paths. The connector's optional-context switch then allows OMP to enter a legacy cwd-only restore without the recorded guarantee.

## What Changes

- Pass acquisition-recorded ownership and the session's setup-time gate/cwd/MCP/effort values through every OMP reconnect-capable runner, including research correction retry.
- Require OMP ownership and complete gate context independently of whether optional recovery arguments were supplied; fail before teardown on missing/mismatched ownership.
- Restore load cache/model, best-effort effort, the same session's full gate context, then the existing optional post-restore hook before resumption.
- Preserve OpenCode's existing context-free recovery and the per-spawn fail-fast trigger outside qualifying idle-liveness errors.
- Expand focused recovery mocks and correct pooled-only documentation/comments and CHANGELOG.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: all OMP acquisition shapes carry complete recorded recovery context with verify-first failure behavior.

## Impact

Owns orchestrator runner/helper edits, connector OMP/legacy branch selection and focused existing recovery tests. No new retry/load feature, pool identity formula, fields, credentials or readiness assertion. Existing immutable launch ownership and same-mode namespace selection remain authoritative. Budget is 7h including implementation, focused mock verification and docs.

## Batch:

depends-on: render-delivered-skill-root-contract
code-conflicts: render-delivered-skill-root-contract (session-orchestrator); preserve delivered-root edits while threading recovery.
code-conflicts: synchronize-omp-seam-correction-docs (recovery docs and CHANGELOG); final consolidation last.
code-conflicts: admit-trusted-omp-native-builtins, bind-omp-owned-module-evidence (append-only CHANGELOG ownership); serialize history commits without adding a behavioral dependency.

The predecessor dependency is shared-file serialization, with no behavioral dependency on prompt rendering or native provenance.
