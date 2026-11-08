# Tasks

Prerequisite: `convert-core-sessions-and-workspaces-to-bun` and `convert-acp-policy-and-filesystem-to-bun` are applied. Verify with `test -f src/utils/runtime-platform.ts && ! grep -q 'Deno.build' src/acp/sandbox-manager.ts`.

## 1. Short-lived tools

- [ ] 1.1 Port `git-credential-setup.ts`, `git-backup-service.ts` and `skill-installer.ts` per design D1. Verify: `grep -n 'Deno\.' src/core/git-credential-setup.ts src/core/git-backup-service.ts src/core/skill-installer.ts` prints only comments, and `bun test tests/core/git-backup-service.test.ts tests/core/git-backup-reserved-cache.test.ts tests/core/git-credential-setup.test.ts tests/core/skill-installer.test.ts` passes with no deferred failure.
- [ ] 1.2 Port the `convert` call in `session-orchestrator.ts`. Verify: `grep -n 'Deno\.' src/core/session-orchestrator.ts` prints only comments, and `bun test tests/core/session-orchestrator.test.ts tests/core/session-orchestrator.dry-run.test.ts tests/core/session-orchestrator.reminder.test.ts tests/core/session-orchestrator-idle-timeout.test.ts` passes; a deferred failure is acceptable only when its stack trace points at a `src/` file owned by a step 5 change that is not applied yet (list each in the task report). ImageMagick must be installed, as in CI.
- [ ] 1.3 Port both version probes and convert their tests. Verify: `bun test tests/utils/omp-version.test.ts tests/utils/opencode-version.test.ts` passes, including the missing-binary and SIGTERM-ignoring timeout tests.

## 2. Sandbox probe (P0-7)

- [ ] 2.1 Apply design D2. Verify: `grep -n 'Deno\.' src/acp/sandbox-capabilities.ts` prints only comments.
- [ ] 2.2 Add `tests/acp/sandbox-capabilities.test.ts` per design D4 with one test per spec scenario. Verify: `bun test tests/acp/sandbox-capabilities.test.ts tests/acp/sandbox-manager.test.ts` passes; record the real-host probe result in the task report.

## 3. Native cache preparer

- [ ] 3.1 Convert `scripts/omp/prepare-native-cache.ts` and add the script per design D3. Verify: `grep -n 'Deno\.' scripts/omp/prepare-native-cache.ts` prints only comments and `head -1 scripts/omp/prepare-native-cache.ts` is the Bun shebang.
- [ ] 3.2 Convert `tests/utils/prepare-native-cache.test.ts` (stub shebang per design D3). Verify: `bun test tests/utils/prepare-native-cache.test.ts` passes.

## 4. Verification

- [ ] 4.1 Parity for this change's tests and the formerly deferred core tests. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/cmd.xml tests/core/git-backup-service.test.ts tests/core/git-backup-reserved-cache.test.ts tests/core/git-credential-setup.test.ts tests/core/skill-installer.test.ts tests/core/session-orchestrator*.test.ts tests/utils/omp-version.test.ts tests/utils/opencode-version.test.ts tests/utils/prepare-native-cache.test.ts tests/acp/sandbox-manager.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/cmd.xml --allow-deferred --scope tests/core/git- --scope tests/core/skill-installer.test.ts --scope tests/core/session-orchestrator --scope tests/utils/omp-version.test.ts --scope tests/utils/opencode-version.test.ts --scope tests/utils/prepare-native-cache.test.ts --scope tests/acp/sandbox-manager.test.ts)` exits 0, and every `deferred` entry is explained as in task 1.2.
- [ ] 4.2 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
