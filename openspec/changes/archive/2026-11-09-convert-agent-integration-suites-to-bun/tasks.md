# Tasks

Prerequisite: every other step 5 change is applied. Verify with `grep -rnE 'Deno\.[A-Za-z]+' src | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)'` printing nothing.

Keep scripted model text non-periodic and ACP timeouts client-side.

## 1. Leak check

- [x] 1.1 Create `tests/helpers/leak-check.ts` and `tests/helpers/leak-check.test.ts` per design D2. Verify: `bun test tests/helpers/leak-check.test.ts` passes and the leak scenario's failure message names the surviving PID.

## 2. Suites

- [x] 2.1 Convert `tests/integration/shared-process.integration.test.ts` per design D1 and add the leak check per design D2. Verify: `bun test tests/integration/shared-process.integration.test.ts` passes.
- [x] 2.2 Convert both `tests/integration/omp-lifecycle/` files likewise. Verify: `bun test tests/integration/omp-lifecycle` passes.
- [x] 2.3 Convert `tests/integration/omp-native-runtime/native-runtime.integration.test.ts` likewise, keeping its skip when `omp` is absent and applying design D3. Verify: `bun test tests/integration/omp-native-runtime` passes or reports only skips on a host without `omp`.

## 3. Step 5 exit gate

- [x] 3.1 Run every test touched by step 4 and step 5 without deferral, excluding the files owned by step 6 (`tests/skills/scripts.test.ts`, `lib-client.test.ts`, `payload.test.ts`, `end-to-end-delivery.test.ts`, `staging-compat.test.ts`, `tests/integration/omp-skill-handoff/`, `tests/integration/email-intent/`). Verify: `bun test --isolate --timeout=120000 --reporter=junit --reporter-outfile=.parity/step5.xml $(git ls-files 'tests/*.test.ts' | grep -vE 'tests/skills/(scripts|lib-client|payload|end-to-end-delivery|staging-compat)\.test\.ts|tests/integration/(omp-skill-handoff|email-intent)/'); (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/step5.xml $(cd ../../.. && git ls-files 'tests/*.test.ts' | grep -vE 'tests/skills/(scripts|lib-client|payload|end-to-end-delivery|staging-compat)\.test\.ts|tests/integration/(omp-skill-handoff|email-intent)/' | sed 's/^/--scope /'))` exits 0, with no `deferred` entry. Per-file isolation is required (design D5): one Bun process otherwise shares module state between test files.
- [x] 3.2 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact, this change directory, and the recorded deviations: `migration/bun/baseline/parity-exceptions.json` (design D4), `src/dashboard/server.ts` and `tests/acp/agent-process.test.ts` (design D6).
