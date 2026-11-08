# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 1,352 `Deno.` matches (`tests/core/session-orchestrator.test.ts` alone has 514). Manual hotspots:

- Monkeypatching: `tests/core/workspace-tmp-lifecycle.test.ts` replaces `Deno.lstatSync`, `Deno.readDirSync` and `Deno.removeSync` 18 times; `tests/core/session-orchestrator.test.ts` 4 times. After conversion they replace `fs.lstatSync`, `fs.readdirSync` and `fs.rmSync` (or the `fs-compat` helper module function the production code now calls) on the shared default objects (README D1). If production now calls `removePathSync` from `fs-compat.ts`, the test patches `fs.rmdirSync`/`fs.unlinkSync` that `removePathSync` uses, or calls through an exported object; choose the option that keeps the test's assertion unchanged and note it in the task report.
- Stats properties: `src/core/workspace-manager.ts` (21), `skill-installer.ts` (7), `skills-root.ts`, `git-backup-service.ts`, and six test files.
- Test-side `Deno.Command`: `tests/core/git-backup-service.test.ts` (31, runs real `git`), `git-credential-setup.test.ts` (2), `git-backup-reserved-cache.test.ts`, `workspace-tmp-lifecycle.test.ts`, `session-orchestrator.test.ts` (3 plus 2 `Deno.ChildProcess`). Test-side `Deno.serve` and `Deno.NetAddr` in `session-orchestrator.test.ts`.
- `tests/core/git-backup-relative-cwd.ts` is a child program using `Deno.args`.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No port of the four production `Deno.Command` sites.

## Decisions

### D1. File list

31 files: 10 production or script files, 20 test files and 1 test helpers.

```text
src/core/git-credential-setup.ts
src/core/session-staging.ts
src/core/skill-installer.ts
src/core/skills-root.ts
src/core/workspace-manager.ts
src/core/git-backup-service.ts
src/core/bundled-skills.ts
src/core/session-orchestrator.ts
src/core/agent-core.ts
src/bootstrap.ts
tests/core/git-credential-setup.test.ts
tests/core/workspace-manager.test.ts
tests/core/git-backup-relative-cwd.ts
tests/core/session-staging.test.ts
tests/core/skill-installer.test.ts
tests/core/external-skill-publication-parity.test.ts
tests/core/session-orchestrator-idle-timeout.test.ts
tests/core/skills-root.test.ts
tests/core/bundled-skills.test.ts
tests/core/prompt-staging-literals.test.ts
tests/core/git-backup-reserved-cache.test.ts
tests/core/skill-root-wiring.test.ts
tests/core/prompt-permission-guidance.test.ts
tests/core/bootstrap-startup-cleanup.test.ts
tests/core/session-orchestrator.dry-run.test.ts
tests/core/git-backup-service.test.ts
tests/core/workspace-tmp-lifecycle.test.ts
tests/core/session-orchestrator.test.ts
tests/core/session-orchestrator.reminder.test.ts
tests/core/agent-core.test.ts
tests/integration/agent-workspace.integration.test.ts
```

### D2. Git in tests

Test helpers that run `git` use `spawnSync("git", args, { cwd, env, encoding: "utf8" })` and assert on `status`, `stdout` and `stderr` as before. Where the Deno test passed `clearEnv: true`, pass exactly the listed `env`; otherwise `{ ...process.env, ...env }` (README D4).

### D3. Session orchestrator test servers

Replace `Deno.serve` with `Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })`, `server.port` for the address and `server.stop(true)` for shutdown; `Deno.NetAddr` reads become `server.hostname`/`server.port`.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [`tests/core/session-orchestrator.test.ts` is too large to convert in one pass] → Convert it last; its deferred failures are expected from the ImageMagick `convert` call and agent spawning.
