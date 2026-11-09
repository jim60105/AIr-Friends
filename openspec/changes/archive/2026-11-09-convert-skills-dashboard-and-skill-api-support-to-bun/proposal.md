# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the in-process skill handlers, the dashboard support modules (authentication, audit history, completed sessions) and the Skill API session registry, with their tests. The two HTTP servers themselves are step 5 (`port-http-servers-to-bun-serve`).

## What Changes

- Convert `src/skills/`, three `src/dashboard/` support modules, `src/skill-api/session-registry.ts` and the 21 test files in design D1.
- Hand-convert `Deno.open` in `src/skills/email-handler.ts`.
- Not here: `src/dashboard/server.ts`, `src/skill-api/server.ts` (step 5) and the tests that execute built-in skill scripts (`convert-builtin-skills-to-bun`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: `Send-File Workspace Boundary` names `realpath`, `stat` and `readFile` instead of the Deno functions.

## Impact

- Files: design D1 (35 files).
- P0 ownership: none. Skill API token validation keeps its behavior; its restart persistence is P0-8 (`drill-bun-cutover-and-rollback`).
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun
depends-on: convert-core-state-and-schedulers-to-bun
depends-on: convert-core-sessions-and-workspaces-to-bun

Conflict note: file set disjoint from the other `convert-*` changes. Depends on the two core slices because the skill handler tests construct `MemoryStore`, `ReminderStore` and `WorkspaceManager`.
