# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 1,194 `Deno.` matches. Manual hotspots:

- `@std/yaml`: `src/acp/agent-factory.ts` (`parse`), `tests/acp/email-omp-profile.test.ts` and `tests/acp/email-intent-runtime.test.ts` (`stringify`).
- Stats properties: `agent-factory.ts` (15), `tests/acp/client.test.ts` (5), `agent-factory-omp.test.ts` (4), three more test files.
- `Deno.pid` in `agent-factory.ts` (non-high-risk use, README D4 note).
- Monkeypatching: `tests/acp/client.test.ts` replaces a `Deno.*` function twice.
- `@std/fs/copy`: `tests/acp/omp-native-runtime-smoke.test.ts`.
- Test-side process and network use: `tests/acp/omp-native-runtime-smoke.test.ts` (`Deno.Command` 5, launches `tests/mocks/omp-native-lifecycle-driver.ts`), `omp-owned-module-bundle-smoke.test.ts` (2, launches `tests/mocks/omp-bundle-smoke-driver.ts`), `agent-factory.test.ts` (`Deno.Command` 2, `Deno.listen` 1), `agent-factory-omp.test.ts` (1), `email-intent-runtime.test.ts` (1). `tests/acp/fixtures/email-intent-acp-engine.ts` is a child program using `Deno.args` and the standard streams.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No change to agent environment contents, launch arguments or OMP settings files.

## Decisions

### D1. File list

13 files: 3 production or script files, 9 test files and 1 test helpers.

```text
src/acp/mod.ts
src/acp/agent-factory.ts
src/acp/client.ts
tests/acp/idle-timeout.test.ts
tests/acp/client.test.ts
tests/acp/agent-factory.test.ts
tests/acp/agent-factory-omp.test.ts
tests/acp/omp-native-runtime-smoke.test.ts
tests/acp/email-omp-profile.test.ts
tests/acp/email-opencode-profile.test.ts
tests/acp/omp-owned-module-bundle-smoke.test.ts
tests/acp/email-intent-runtime.test.ts
tests/acp/fixtures/email-intent-acp-engine.ts
```

### D2. Driver launches

Tests that launched a driver with `new Deno.Command(Deno.execPath(), { args: ["run", <flags>, driver, ...] })` launch it with `spawn(process.execPath, ["run", "--no-env-file", driver, ...])` (or `spawnSync` where the test awaited `.output()`), keeping `env`/`clearEnv` semantics per README D4. Deno permission flags are dropped. The child programs themselves were converted by `convert-utils-platforms-and-test-support-to-bun` except `tests/acp/fixtures/email-intent-acp-engine.ts`, which is converted here like the mocks (README D4: `process.argv`, `process.stdin`, `process.stdout`).

### D3. Listener in `agent-factory.test.ts`

`Deno.listen({ port: 0 })` used to reserve or probe a port becomes `net.createServer().listen(0, "127.0.0.1")`, awaiting `listening`, reading `server.address().port`, and `server.close()`.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [YAML `stringify` text differs] → README D5: compare parsed objects unless the text is the behavior under test; report every such case.
