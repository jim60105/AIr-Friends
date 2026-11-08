# Tasks

Prerequisite: `add-bun-conversion-codemod` is applied. Verify with `test -f migration/bun/convert/README.md && test -f src/utils/fs-compat.ts && bun install --frozen-lockfile`.

Follow `migration/bun/convert/README.md`. Do not edit files outside design D1 except `migration/bun/baseline/parity-exceptions.json`. Never weaken an assertion or rename a test.

## 1. Mechanical rewrite

- [ ] 1.1 Save the design D1 list to `.parity/convert-acp-client-and-factory-to-bun.files`, one path per line. Verify: `wc -l < .parity/convert-acp-client-and-factory-to-bun.files` prints `13` and `xargs -a .parity/convert-acp-client-and-factory-to-bun.files ls >/dev/null` exits 0.
- [ ] 1.2 Run the codemod. Verify: `bun run --no-env-file migration/bun/convert/codemod.ts $(cat .parity/convert-acp-client-and-factory-to-bun.files) > .parity/convert-acp-client-and-factory-to-bun.codemod.jsonl` exits 0 (rename any colliding local and rerun until it does).

## 2. Manual conversion

- [ ] 2.1 Convert `agent-factory.ts` (YAML, `Deno.pid`, Stats properties). Verify: `bun test tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts` passes or defers.
- [ ] 2.2 Convert driver launches and the email intent engine fixture per design D2. Verify: `bun test tests/acp/omp-owned-module-bundle-smoke.test.ts tests/acp/omp-native-runtime-smoke.test.ts tests/acp/email-intent-runtime.test.ts` passes or defers.
- [ ] 2.3 Apply design D3 and replace `@std/fs/copy` per README D5. Verify: `grep -n '@std/fs' $(cat .parity/convert-acp-client-and-factory-to-bun.files)` prints nothing.
- [ ] 2.4 Convert `tests/acp/client.test.ts`, including its two monkeypatches (README D1). Verify: `bun test tests/acp/client.test.ts` passes or defers.
- [ ] 2.5 Fix every Stats property use. Verify: `grep -nE '\.(isFile|isDirectory|isSymlink)\b[^(]' $(cat .parity/convert-acp-client-and-factory-to-bun.files)` prints nothing.

## 3. Verification

- [ ] 3.1 Residual check. Verify: `grep -n 'Deno\.' $(grep -v '^src/\|^scripts/' .parity/convert-acp-client-and-factory-to-bun.files) | grep -v '^[^:]*:[0-9]*: *\(//\|\*\)'` prints nothing, and `grep -noE 'Deno\.[A-Za-z]+' $(grep '^src/\|^scripts/' .parity/convert-acp-client-and-factory-to-bun.files)` prints only symbols that `migration/bun/convert/README.md` D4 assigns to a later change.
- [ ] 3.2 Parity. Verify: `mkdir -p .parity && bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/convert-acp-client-and-factory-to-bun.xml tests/acp/idle-timeout.test.ts tests/acp/client.test.ts tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts tests/acp/omp-native-runtime-smoke.test.ts tests/acp/email-omp-profile.test.ts tests/acp/email-opencode-profile.test.ts tests/acp/omp-owned-module-bundle-smoke.test.ts tests/acp/email-intent-runtime.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/convert-acp-client-and-factory-to-bun.xml --allow-deferred --scope tests/acp/idle-timeout.test.ts --scope tests/acp/client.test.ts --scope tests/acp/agent-factory.test.ts --scope tests/acp/agent-factory-omp.test.ts --scope tests/acp/omp-native-runtime-smoke.test.ts --scope tests/acp/email-omp-profile.test.ts --scope tests/acp/email-opencode-profile.test.ts --scope tests/acp/omp-owned-module-bundle-smoke.test.ts --scope tests/acp/email-intent-runtime.test.ts)` exits 0. Paste the `deferred` list into the task report.
- [ ] 3.3 Format and lint. Verify: `bun run fmt:check` and `bun run lint` exit 0.
- [ ] 3.4 Scope. Verify: `git status --porcelain` lists only files from design D1, `migration/bun/baseline/parity-exceptions.json` (only if an exception was needed) and this change directory.
