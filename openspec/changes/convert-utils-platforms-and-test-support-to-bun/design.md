# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice (grep): 816 `Deno.` matches. Manual hotspots:

- `t.step`: `tests/utils/omp-native-cache.test.ts` (13 steps).
- Stats or Dirent properties used as booleans: `src/utils/omp-native-cache.ts` (8), `opencode-paths.ts` (2), `omp-paths.ts` (1), `skill-secret.ts` (1), `tests/utils/omp-native-cache.test.ts` (5), `tests/utils/skill-secret.test.ts` (1).
- `@std/testing/time` `FakeTime`: `tests/platforms/misskey/misskey-adapter.test.ts`, `tests/mocks/omp-mock-session.ts`. Kept: `@std/testing` is aliased to `@jsr/std__testing` by `add-bun-package-manifest`.
- `@std/yaml` `parse`: `tests/utils/config-trio-sync.test.ts`.
- Non-high-risk leftovers in production: `Deno.pid` (`src/utils/omp-native-cache.ts`), `Deno.open` (`src/utils/skill-secret.ts`).
- Test-side process and server use: `tests/mocks/mock-acp-agent.ts` (`Deno.Command` 2, `Deno.kill` 2, `Deno.pid` 2, `Deno.stdin`, `Deno.stdout`), `tests/mocks/omp-mock-session.ts` (`Deno.kill`), `tests/mocks/omp-native-lifecycle-driver.ts` and `omp-bundle-smoke-driver.ts` (`Deno.args`, `Deno.exit`), `tests/utils/ssrf.test.ts` (`Deno.serve`, `Deno.NetAddr`).
- `tests/utils/omp-packaging.test.ts` calls `scripts/omp/bundle-omp-extension.sh` with a third `deno.lock` argument and spawns `node` with `Deno.Command`.
- `src/utils/omp-native-cache.ts` defaults `arch` to `Deno.build.arch` and `os` to `Deno.build.os`; the codemod turns them into `runtimeArch()` and `runtimeOs()`, which keep the `x86_64`/`aarch64` cache directory keys.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No change to the user-facing `deno task` remedy strings (`rename-deno-runtime-identifiers`).

## Decisions

### D1. File list

75 files: 39 production or script files, 22 test files and 14 test helpers.

```text
src/platforms/discord/index.ts
src/platforms/discord/discord-config.ts
src/platforms/discord/discord-utils.ts
src/platforms/discord/discord-adapter.ts
src/platforms/misskey/index.ts
src/platforms/misskey/misskey-config.ts
src/platforms/misskey/misskey-client.ts
src/platforms/misskey/misskey-utils.ts
src/platforms/misskey/misskey-adapter.ts
src/platforms/connection-manager.ts
src/platforms/index.ts
src/platforms/platform-adapter.ts
src/platforms/platform-registry.ts
src/types/errors.ts
src/types/index.ts
src/types/logger.ts
src/types/workspace.ts
src/types/memory.ts
src/types/platform.ts
src/types/events.ts
src/types/reminder.ts
src/types/audit.ts
src/types/template.ts
src/types/context.ts
src/types/config.ts
src/utils/hash.ts
src/utils/metrics.ts
src/utils/path-validator.ts
src/utils/rss-fetcher.ts
src/utils/skill-jwt.ts
src/utils/skill-secret.ts
src/utils/token-counter.ts
src/utils/ssrf.ts
src/utils/json-source.ts
src/utils/omp-native-cache.ts
src/utils/opencode-paths.ts
src/utils/omp-paths.ts
src/utils/logger.ts
src/utils/env.ts
tests/platforms/discord/discord-adapter-typing.test.ts
tests/platforms/discord/discord-emoji-filter.test.ts
tests/platforms/discord/discord-adapter.test.ts
tests/platforms/misskey/misskey-adapter.test.ts
tests/platforms/misskey/misskey-client.test.ts
tests/platforms/platform-registry.test.ts
tests/types/errors.test.ts
tests/types/events.test.ts
tests/types/audit.test.ts
tests/utils/hash.test.ts
tests/utils/logger.test.ts
tests/utils/opencode-paths.test.ts
tests/utils/rss-fetcher.test.ts
tests/utils/skill-jwt.test.ts
tests/utils/skill-secret.test.ts
tests/utils/token-counter.test.ts
tests/utils/ssrf.test.ts
tests/utils/config-trio-sync.test.ts
tests/utils/opencode-skill-discovery-declaration.test.ts
tests/utils/omp-native-cache.test.ts
tests/utils/env.test.ts
tests/utils/metrics.test.ts
tests/fixtures/events.ts
tests/helpers/assertions.ts
tests/helpers/test-context.ts
tests/helpers/recording-workspace-manager.ts
tests/helpers/email-smtp-service.ts
tests/helpers/email-imap-service.ts
tests/helpers/mime-parts.ts
tests/mocks/mock-platform-adapter.ts
tests/mocks/mock-workspace.ts
tests/mocks/mock-acp-connection.ts
tests/mocks/mock-acp-agent.ts
tests/mocks/omp-bundle-smoke-driver.ts
tests/mocks/omp-native-lifecycle-driver.ts
tests/mocks/omp-mock-session.ts
```

Scope deviations (supervisor-authorized at apply time):

- `src/core/skills-root.ts` gets the two edits its D1 owner
  (`convert-core-sessions-and-workspaces-to-bun`) would make here anyway: line 34 changes only
  `import { isAbsolute, resolve } from "@std/path";` to `from "node:path";` (same imported names),
  and the default existence probe at line 136 becomes
  `return fs.statSync(path).isDirectory();` behind the identical `try`/`catch` with the same
  `return false` fallback (plus `import fs from "node:fs";`). Without the first edit,
  `tests/utils/opencode-skill-discovery-declaration.test.ts` (in D1) aborts at module load with
  `error: Cannot find module '@std/path' from src/core/skills-root.ts`; without the second, its
  `declaration - the declared value is the root the inventory and prompts resolve` case fails with
  `ConfigError` because the swallowed `ReferenceError` from `Deno.statSync` reports every real root
  as absent, so parity cannot treat it as deferred. Every other `Deno.*` call in that file
  (`statSync`/`realPathSync` in `defaultObserveDirectory`, `cwd`) stays untouched for the owner.
- `tests/utils/omp-packaging.test.ts` is absent from the D1 list, but proposal "What Changes",
  design D4 and task 2.5 name its conversion, so it is converted here.

### D2. Mock and driver programs

The mock agent and drivers are child programs. Convert their I/O to Bun: read stdin with `for await (const chunk of process.stdin)` or `Readable.toWeb(process.stdin)` where the code expects a web stream; write with `process.stdout.write(bytes)`, awaiting the callback where the old code awaited a writer. `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, `Deno.pid` → `process.pid`, `Deno.kill(pid, sig)` → `process.kill(pid, sig)`. Their own `Deno.Command` uses go to `spawn`/`spawnSync` from `node:child_process` per README D4. Model text that a mock scripts must stay non-periodic (Go record finding 5); do not shorten or repeat scripted strings.

### D3. Test-side servers

`tests/utils/ssrf.test.ts` starts a local server with `Deno.serve`. Use `Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })` and read `server.port`; stop with `server.stop(true)`.

### D4. Bundle test

In `tests/utils/omp-packaging.test.ts`, drop the third wrapper argument (`${repoRoot}/deno.lock`) and spawn `node` with `spawnSync`. Keep every assertion.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [`FakeTime` from JSR does not patch Bun's timers] → `misskey-adapter.test.ts` shows it at once; if it fails, stop and report, because four later slices also use `FakeTime`.
