# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 1,124 `Deno.` matches. Manual hotspots:

- `t.step`: `tests/core/config-loader.test.ts` (25 steps).
- `FakeTime`: `tests/core/rate-limiter.test.ts`, `tests/core/context-assembler.test.ts`.
- `@std/yaml`: `src/core/config-loader.ts` (`parse`), `scripts/memory-recall-benchmark.ts`.
- Stats properties: `src/core/audit-retention.ts` (2), `research-output.ts` (2), `memory-recall/snapshot-cache.ts` (3), `scripts/migrate-memory-v2.ts` (2), `scripts/memory-recall-benchmark.ts` (1), `tests/core/audit-retention.test.ts` (1).
- `Deno.args`: both scripts (`import.meta.main` guards stay; Bun supports them). The benchmark script assigns a `Deno.*` function once.
- `src/core/template-renderer.ts` imports `ventojs` and the type `Environment` from `ventojs/core/environment.ts`; npm `ventojs@2.2.0` exposes `./core/environment.js` with types.
- `src/core/memory-recall/tokenizer.ts` builds the segmenter with `Jieba.withDict(Deno.readFileSync(DICT_URL))`, where `DICT_URL` is a `file:` URL; `fs.readFileSync` accepts a `URL`.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json` and the
  supervisor-authorized import/runtime sites listed under D1's "Scope deviations (supervisor-
  authorized at apply time)".
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No change to `DENO_ENV` handling or to YAML semantics beyond the parser swap.

## Decisions

### D1. File list

81 files: 39 production or script files, 41 test files and 1 test helpers.

```text
src/core/audit-retention-scheduler.ts
src/core/audit-retention.ts
src/core/base-scheduler.ts
src/core/channel-lurk-scheduler.ts
src/core/event-router.ts
src/core/git-backup-scheduler.ts
src/core/memory-maintenance-scheduler.ts
src/core/message-handler.ts
src/core/mod.ts
src/core/rate-limiter.ts
src/core/reminder-scheduler.ts
src/core/reply-policy.ts
src/core/research-output.ts
src/core/self-research-scheduler.ts
src/core/memory-recall/tokenizer.ts
src/core/memory-recall/query-hints.ts
src/core/memory-recall/indexed-memory.ts
src/core/memory-recall/note-chunker.ts
src/core/memory-recall/ranker.ts
src/core/memory-recall/snapshot-cache.ts
src/core/memory-recall/types.ts
src/core/memory-recall/fixed-selection.ts
src/core/memory-recall/fast-recall.ts
src/core/memory-recall/recall-config.ts
src/core/memory-recall/retriever.ts
src/core/template-renderer.ts
src/core/scheduler-state-store.ts
src/core/spontaneous-scheduler.ts
src/core/model-router.ts
src/core/reply-dispatcher.ts
src/core/audit-logger.ts
src/core/reminder-store.ts
src/core/spontaneous-target.ts
src/core/config-loader.ts
src/core/identity-registry.ts
src/core/context-assembler.ts
src/core/memory-store.ts
tests/core/audit-logger.test.ts
tests/core/audit-retention.test.ts
tests/core/base-scheduler.test.ts
tests/core/channel-lurk-scheduler.test.ts
tests/core/config-loader.extra.test.ts
tests/core/git-backup-scheduler.test.ts
tests/core/message-handler.test.ts
tests/core/rate-limiter.test.ts
tests/core/reminder-scheduler.test.ts
tests/core/reply-policy.test.ts
tests/core/scheduler-state-store.test.ts
tests/core/self-research-untrusted-rss.test.ts
tests/core/template-renderer.test.ts
tests/core/memory-recall/tokenizer.test.ts
tests/core/memory-recall/indexed-memory.test.ts
tests/core/memory-recall/query-hints.test.ts
tests/core/memory-recall/note-chunker.test.ts
tests/core/memory-recall/ranker.test.ts
tests/core/memory-recall/fixed-selection.test.ts
tests/core/memory-recall/benchmark.test.ts
tests/core/memory-recall/fast-recall.test.ts
tests/core/memory-recall/memory-fixture.ts
tests/core/memory-recall/snapshot-cache.test.ts
tests/core/memory-recall/retriever.test.ts
tests/core/memory-store-v2.test.ts
tests/core/memory-store.test.ts
tests/core/self-research-scheduler.test.ts
tests/core/spontaneous-scheduler.test.ts
tests/core/spontaneous-target.test.ts
tests/core/reasoning-effort-config.test.ts
tests/core/memory-maintenance-scheduler.test.ts
tests/core/model-router.test.ts
tests/core/reply-dispatcher.test.ts
tests/core/reminder-store.test.ts
tests/core/config-loader.test.ts
tests/core/identity-registry.test.ts
tests/core/context-assembler.test.ts
tests/integration/agent-flow.integration.test.ts
tests/integration/memory-persistence.integration.test.ts
tests/integration/memory-v2.integration.test.ts
tests/integration/identity-linked-memory.integration.test.ts
tests/scripts/migrate-memory-v2.test.ts
scripts/migrate-memory-v2.ts
scripts/memory-recall-benchmark.ts
```

Scope deviations (supervisor-authorized at apply time):

- Import-specifier only, identical imported names, one line per file. Without these the D1
  test files abort at module load with `error: Cannot find module '<specifier>' from <file>`,
  which parity cannot treat as a deferred `ReferenceError`; the sibling order-5/6 changes that
  own these files are not applied yet. Each owner must still convert the file's remaining
  `Deno.*` calls.
  - `src/core/workspace-manager.ts`: `@std/path` → `node:path` (`SEPARATOR` → `sep as SEPARATOR`).
    Removes the load error for 11 D1 test files (identity-registry, context-assembler,
    memory-store, memory-store-v2, memory-maintenance-scheduler, memory-recall retriever /
    snapshot-cache / benchmark, and the three memory integration files). Owner:
    `convert-core-sessions-and-workspaces-to-bun`.
  - `src/core/session-orchestrator.ts`: `@std/path` → `node:path`. Owner:
    `convert-core-sessions-and-workspaces-to-bun`.
  - `src/acp/agent-factory.ts`: `@std/path` → `node:path` and `@std/yaml` → `yaml` (same
    `parse as parseYaml`). Removes the load error for `config-loader.test.ts` and
    `self-research-untrusted-rss.test.ts`. Owner: `convert-acp-client-and-factory-to-bun`.
  - `src/platforms/email/message-store.ts`, `src/platforms/email/durable-files.ts`,
    `src/platforms/email/attachment-materializer.ts`: `@std/path` → `node:path`. Removes the
    load error for `reminder-store.test.ts` and `self-research-untrusted-rss.test.ts`. Owner:
    `convert-email-platform-to-bun`.
  - `src/skills/email-handler.ts`: `@std/path` → `node:path` (`SEPARATOR` → `sep as SEPARATOR`).
    Removes the load error for `reminder-store.test.ts`. Owner:
    `convert-skills-dashboard-and-skill-api-support-to-bun` / `convert-email-platform-to-bun`.
  - `src/acp/skill-inventory.ts`, `src/acp/filesystem-access.ts`,
    `src/acp/filesystem-roots.ts`, `src/acp/command-path-policy.ts`,
    `src/acp/filesystem-policy.ts`: `@std/path` → `node:path` (`SEPARATOR` →
    `sep as SEPARATOR` where imported). Removes the load error for
    `self-research-untrusted-rss.test.ts`. Owner: `convert-acp-policy-and-filesystem-to-bun`.
  - `src/acp/client.ts`, `src/acp/omp/session-artifacts.ts`: `@std/path` → `node:path`
    (`SEPARATOR` → `sep as SEPARATOR` in `client.ts`). Same load error. Owner:
    `convert-acp-client-and-factory-to-bun`.
- `src/core/workspace-manager.ts`, runtime sites, no other line: `readWorkspaceFile` reads with
  `fsp.readFile(path, "utf8")` instead of `Deno.readTextFile`, and `appendWorkspaceFile` appends
  with `fsp.appendFile` instead of `Deno.writeTextFile(..., { append: true })`; the two
  `error instanceof Deno.errors.NotFound` checks reached by the D1 stores become
  `isNotFoundError(error)` (import from `../utils/fs-compat.ts`). With the Deno globals still
  absent, `Deno.errors` itself throws `ReferenceError` rather than reporting a missing file, so
  the D4 format guard (`memory-v2`, `identity-linked-memory`) could not pass. Everything else in
  the file stays: `Deno.readDir` in `listWorkspaces`, the remaining write/stat/readDir/FileInfo
  calls and their not-found checks are the deferral left for
  `convert-core-sessions-and-workspaces-to-bun` (one `memory-maintenance-scheduler` test is
  deferred with `ReferenceError: Deno is not defined` at `workspace-manager.ts:448`).
  One remaining site there is not loud: `getOrCreateWorkspace` still runs
  `const stat = await Deno.stat(path)` inside `try { ... } catch { /* Ignore stat errors */ }`,
  so under Bun the swallowed `ReferenceError` leaves `WorkspaceInfo.createdAt` undefined for an
  existing workspace. `createdAt` is currently write-only, so no D1 assertion observes it and
  parity cannot see it. Hand-off: `convert-core-sessions-and-workspaces-to-bun` converts that
  stat and adds a `createdAt` assertion.
- `migration/bun/baseline/parity-exceptions.json` gains the four `t.step` container entries of
  `tests/core/config-loader.test.ts`, the same disposition and reason as the existing
  `tests/utils/omp-native-cache.test.ts` entry: Deno reported the container as its own passing
  case, bun:test has no case for a bare `describe` suite, and an empty `test(parent)` would be a
  fake pass.

### D2. YAML

`config-loader.ts` uses `parse` from `yaml` (YAML 1.2 core schema, duplicate keys rejected), like `@std/yaml`. Core schema is the decided semantics: date-like scalars stay strings and `<<` merge keys are not resolved (`@std/yaml`'s timestamp/merge behavior is not preserved), and no repo config or fixture uses them; a later config that needs them must say so explicitly rather than rely on parser defaults. Keep every existing config test unchanged; a config test that now fails is a semantic difference and must be reported, not worked around. The benchmark script's YAML use follows README D5.

### D3. Scripts

`scripts/migrate-memory-v2.ts` and `scripts/memory-recall-benchmark.ts`: `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`; a `deno run` shebang or usage comment becomes `bun run --no-env-file`. The benchmark's single `Deno.*` assignment becomes the same assignment on the `fs`/`fsp` default object (README D1).

### D4. Data format guard

The Deno baseline already passed these tests. After converting, `tests/integration/memory-persistence.integration.test.ts`, `memory-v2.integration.test.ts` and `identity-linked-memory.integration.test.ts` are the format guard; they must pass, not defer.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [`yaml` accepts input `@std/yaml` rejected, or the reverse] → The config tests are the check; report any difference.
