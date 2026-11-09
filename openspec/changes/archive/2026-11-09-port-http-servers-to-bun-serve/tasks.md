# Tasks

Prerequisite: `convert-skills-dashboard-and-skill-api-support-to-bun` is applied. Verify with `! grep -q 'Deno\.' src/dashboard/auth.ts src/skill-api/session-registry.ts`.

## 1. Servers

- [x] 1.1 Convert `src/dashboard/server.ts` per design D1 and D2 (run the codemod first for its fs calls). Verify: `grep -n 'Deno\.' src/dashboard/server.ts` prints only comments and `bun test tests/dashboard/server.test.ts` passes.
- [x] 1.2 Convert `src/skill-api/server.ts` per design D1. Verify: `grep -n 'Deno\.' src/skill-api/server.ts` prints only comments and `bun test tests/skill-api/server.test.ts` passes.
- [x] 1.3 Convert `src/healthcheck.ts` per design D1 and D3. Verify: `grep -n 'Deno\.' src/healthcheck.ts` prints only comments, and `bun test tests/healthcheck.test.ts` passes with a test asserting the check list contains `binary:bun` and not `binary:deno` (update the existing binary-list assertion; do not rename the test).

Note: all three servers set `idleTimeout: 0`. Deno had no idle timeout, and Bun's 10 s default would cut the dashboard SSE stream and any skill/readiness handler that runs longer; the converted suites have no >10 s gap, so this is preserved by construction rather than by a new slow test.

## 2. Integration

- [x] 2.1 Convert `tests/integration/server-startup.integration.test.ts`. Verify: `bun test tests/integration/server-startup.integration.test.ts` passes.
- [x] 2.2 Parity without deferral. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/http.xml tests/dashboard tests/skill-api tests/healthcheck.test.ts tests/integration/server-startup.integration.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/http.xml --scope tests/dashboard/ --scope tests/skill-api/ --scope tests/healthcheck.test.ts --scope tests/integration/server-startup.integration.test.ts)` exits 0.

## 3. Housekeeping

- [x] 3.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
