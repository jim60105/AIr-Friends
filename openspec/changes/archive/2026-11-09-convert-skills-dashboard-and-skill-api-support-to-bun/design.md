# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 840 `Deno.` matches (`tests/skills/memory-handler.test.ts` has 267). Manual hotspots:

- `Deno.open` in `src/skills/email-handler.ts` (non-high-risk use, README D4 note).
- Stats properties: `src/skills/email-handler.ts` (1), `src/dashboard/audit-history-loader.ts` (3).
- `src/skills/file-handler.ts` implements the send-file boundary: `Deno.stat(...).size`, `Deno.readFile`, `Deno.realPathSync` for both the file and the base, and `Deno.errors.NotFound`. Every one has a codemod row.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No change to the dashboard or Skill API HTTP handling.

## Decisions

### D1. File list

35 files: 14 production or script files, 21 test files and 0 test helpers.

```text
src/skills/index.ts
src/skills/reaction-handler.ts
src/skills/email-handler.ts
src/skills/reminder-handler.ts
src/skills/file-handler.ts
src/skills/context-handler.ts
src/skills/reply-handler.ts
src/skills/types.ts
src/skills/registry.ts
src/skills/memory-handler.ts
src/skill-api/session-registry.ts
src/dashboard/audit-history-loader.ts
src/dashboard/auth.ts
src/dashboard/completed-session-store.ts
tests/skills/channel-memory-authz.test.ts
tests/skills/memory-patch-channel-scope.test.ts
tests/skills/registry.reminder.test.ts
tests/skills/registry.test.ts
tests/skills/reaction-handler.test.ts
tests/skills/file-handler.test.ts
tests/skills/email-compose-smoke.test.ts
tests/skills/email-handler.test.ts
tests/skills/skill-docs-token-gate.test.ts
tests/skills/email-forward-smoke.test.ts
tests/skills/email-forward.test.ts
tests/skills/reminder-handler.test.ts
tests/skills/context-handler.test.ts
tests/skills/reply-handler.test.ts
tests/skills/memory-handler.test.ts
tests/skill-api/caller-token.test.ts
tests/skill-api/session-registry.test.ts
tests/dashboard/audit-history-loader.test.ts
tests/dashboard/auth.test.ts
tests/dashboard/completed-session-store.test.ts
tests/dashboard/config.test.ts
```

### D2. Send-file boundary

After the codemod, `file-handler.ts` must still resolve both the file and the workspace base with `fs.realpathSync` before the containment check, and still read with `fsp.readFile` only after the check. Confirm the symlink-escape tests in `tests/skills/file-handler.test.ts` pass, not defer.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [The send-file containment check regresses silently] → Design D2 requires the symlink tests to pass in this change.
