# Tasks

Prerequisite: `add-bun-conversion-codemod` is applied. Verify with `test -f migration/bun/convert/README.md && test -f src/utils/fs-compat.ts && bun install --frozen-lockfile`.

Follow `migration/bun/convert/README.md`. Do not edit files outside design D1 except `migration/bun/baseline/parity-exceptions.json`. Never weaken an assertion or rename a test.

## 1. Mechanical rewrite

- [ ] 1.1 Save the design D1 list to `.parity/convert-acp-policy-and-filesystem-to-bun.files`, one path per line. Verify: `wc -l < .parity/convert-acp-policy-and-filesystem-to-bun.files` prints `36` and `xargs -a .parity/convert-acp-policy-and-filesystem-to-bun.files ls >/dev/null` exits 0.
- [ ] 1.2 Run the codemod. Verify: `bun run --no-env-file migration/bun/convert/codemod.ts $(cat .parity/convert-acp-policy-and-filesystem-to-bun.files) > .parity/convert-acp-policy-and-filesystem-to-bun.codemod.jsonl` exits 0 (rename any colliding local and rerun until it does).

## 2. Manual conversion

- [ ] 2.1 Apply design D2 to `src/acp/skill-inventory.ts` and its fixtures. Verify: `bun test tests/acp/skill-inventory.test.ts` passes or defers only on `deno run` grammar cases that spawn a process; paste any deferred names.
- [ ] 2.2 Apply design D3. Verify: `bun test tests/acp/filesystem-authorization.test.ts tests/acp/omp-bash-artifact-authorization.test.ts` passes or defers.
- [ ] 2.3 Fix every Stats/Dirent property use. Verify: `grep -nE '\.(isFile|isDirectory|isSymlink)\b[^(]' $(cat .parity/convert-acp-policy-and-filesystem-to-bun.files)` prints nothing.
- [ ] 2.4 Convert test-side `Deno.Command` and `Deno.FsFile` (README D4, D5). Verify: `bun test tests/acp/sandbox-manager.test.ts tests/acp/filesystem-roots.test.ts tests/acp/permission-gate-generic.test.ts tests/acp/opencode-skill-permission-routing.test.ts` passes or defers.

## 3. Verification

- [ ] 3.1 Residual check. Verify: `grep -n 'Deno\.' $(grep -v '^src/\|^scripts/' .parity/convert-acp-policy-and-filesystem-to-bun.files) | grep -v '^[^:]*:[0-9]*: *\(//\|\*\)'` prints nothing, and `grep -noE 'Deno\.[A-Za-z]+' $(grep '^src/\|^scripts/' .parity/convert-acp-policy-and-filesystem-to-bun.files)` prints only symbols that `migration/bun/convert/README.md` D4 assigns to a later change.
- [ ] 3.2 Parity. Verify: `mkdir -p .parity && bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/convert-acp-policy-and-filesystem-to-bun.xml tests/acp/session-config.test.ts tests/acp/command-path-canonical.test.ts tests/acp/permission-gate-generic.test.ts tests/acp/opencode-skill-permission-routing.test.ts tests/acp/skill-inventory.test.ts tests/acp/destructive-policy.test.ts tests/acp/filesystem-authorization.test.ts tests/acp/omp-restricted-tool-decisions.test.ts tests/acp/recovery-ownership.test.ts tests/acp/sandbox-manager.test.ts tests/acp/filesystem-access.test.ts tests/acp/filesystem-policy.test.ts tests/acp/filesystem-roots.test.ts tests/acp/omp-bash-artifact-authorization.test.ts tests/acp/omp-session-artifacts.test.ts tests/acp/omp-native-registration.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/convert-acp-policy-and-filesystem-to-bun.xml --allow-deferred --scope tests/acp/session-config.test.ts --scope tests/acp/command-path-canonical.test.ts --scope tests/acp/permission-gate-generic.test.ts --scope tests/acp/opencode-skill-permission-routing.test.ts --scope tests/acp/skill-inventory.test.ts --scope tests/acp/destructive-policy.test.ts --scope tests/acp/filesystem-authorization.test.ts --scope tests/acp/omp-restricted-tool-decisions.test.ts --scope tests/acp/recovery-ownership.test.ts --scope tests/acp/sandbox-manager.test.ts --scope tests/acp/filesystem-access.test.ts --scope tests/acp/filesystem-policy.test.ts --scope tests/acp/filesystem-roots.test.ts --scope tests/acp/omp-bash-artifact-authorization.test.ts --scope tests/acp/omp-session-artifacts.test.ts --scope tests/acp/omp-native-registration.test.ts)` exits 0. Paste the `deferred` list into the task report.
- [ ] 3.3 Format and lint. Verify: `bun run fmt:check` and `bun run lint` exit 0.
- [ ] 3.4 Scope. Verify: `git status --porcelain` lists only files from design D1, `migration/bun/baseline/parity-exceptions.json` (only if an exception was needed) and this change directory.
