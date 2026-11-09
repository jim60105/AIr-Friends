# Tasks

Prerequisite: `convert-builtin-skills-to-bun` is applied and `/opt/air/skill-bunfig.toml` exists. Verify with `head -1 skills/memory-save/scripts/memory-save.ts | grep -q 'bun run --no-env-file' && test -f /opt/air/skill-bunfig.toml`.

## 1. Gate

- [x] 1.1 Apply design D1. Verify: `grep -n 'DENO_RUN_SAFE_FLAGS\|ALLOWED_SCRIPT_INTERPRETERS\|"deno"' src/acp/skill-inventory.ts` prints nothing.
- [x] 1.2 Rewrite the grammar cases in `tests/acp/skill-inventory.test.ts` per design D4 and add `parity-exceptions.json` entries. Verify: `bun test tests/acp/skill-inventory.test.ts tests/acp/permission-gate-generic.test.ts tests/acp/command-path-canonical.test.ts` passes.

## 2. Routing

- [x] 2.1 Apply design D2. Verify: `bun -e 'const c = await Bun.file("agent-config/opencode.json").json(); const m = JSON.stringify(c); if (m.includes("deno run") || !m.includes("\"bunx *\":\"deny\"") || !m.includes("\"bun *\":\"ask\"")) process.exit(1)'` exits 0.
- [x] 2.2 Update `tests/acp/opencode-skill-permission-routing.test.ts` to assert the `bun *` and `bunx *` entries. Verify: `bun test tests/acp/opencode-skill-permission-routing.test.ts tests/utils/opencode-paths.test.ts tests/utils/opencode-skill-discovery-declaration.test.ts` passes.

## 3. Injection suite (P0-6)

- [x] 3.1 Create `tests/acp/skill-injection.test.ts` per design D3, with one test per scenario of `Exact Bun Skill Invocation Grammar` and `Trusted Skills Ignore Working-Directory Configuration` plus the ported INJ-05 table. Verify: `bun test tests/acp/skill-injection.test.ts` passes, and with `sudo` available the missing-config tests run (not skipped).

## 4. Skill integration suites

- [x] 4.1 Convert `tests/integration/omp-skill-handoff/` and `tests/integration/email-intent/` with the codemod and README; skill launches use the shebang or the literal form. Verify: `bun test tests/integration/omp-skill-handoff tests/integration/email-intent` passes.

## 5. Step 6 exit gate

- [x] 5.1 Run design D5. Verify: each command in design D5 exits 0 (or prints nothing for the `*.ts`-scoped grep; fixture prose under `tests/fixtures/**` is data and excluded per the D5 deviation); the parity command, which must not pass `--allow-deferred` (any deferred test fails the gate), is `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/full.xml tests/; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/full.xml)`.
- [x] 5.2 Verify: `git status --porcelain` lists only the files in `proposal.md` Impact, any file changed for a type fix under 5.1 (listed in the task report), and this change directory.
