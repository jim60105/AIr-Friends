# Tasks

Prerequisite: `convert-agent-integration-suites-to-bun` is applied, and `/opt/air/skill-bunfig.toml` exists or the implementer can run `sudo`. Verify with `test -f migration/bun/convert/README.md && (test -f /opt/air/skill-bunfig.toml || sudo -n true)`. If neither holds, stop and ask the owner to run `scripts/install-skill-bunfig.sh` after task 1.1.

## 1. Host setup

- [ ] 1.1 Create `scripts/install-skill-bunfig.sh` per design D4 and run it. Verify: `stat -c '%U:%G %a %s' /opt/air/skill-bunfig.toml` prints `root:root 444 0`.

## 2. Scripts

- [ ] 2.1 Apply design D1 to every script. Verify: `grep -L '^#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml$' skills/*/scripts/*.ts skills/lib/client.ts` prints nothing.
- [ ] 2.2 Apply design D2 and D3. Verify: `grep -rn 'Deno\.\|jsr:\|@std/' skills --include='*.ts'` prints nothing (run as `grep -rn 'Deno\.\|jsr:\|@std/' skills | grep '\.ts:'` if `--include` is unavailable), and `grep -rhoE 'from "[^"]+"' skills | sort -u` lists only `node:*` modules and relative paths.
- [ ] 2.3 Add `tests/skills/skill-args.test.ts` per design D2, including the three spec scenarios. Verify: `bun test tests/skills/skill-args.test.ts` passes.

## 3. Tests

- [ ] 3.1 Convert the five test files per design D5. Verify: `bun test tests/skills/scripts.test.ts tests/skills/lib-client.test.ts tests/skills/payload.test.ts tests/skills/end-to-end-delivery.test.ts tests/skills/staging-compat.test.ts` passes.
- [ ] 3.2 Confirm the missing-config stop. Verify: `sudo mv /opt/air/skill-bunfig.toml /opt/air/skill-bunfig.toml.bak; skills/memory-stats/scripts/memory-stats.ts --session-id x; echo "exit=$?"; sudo mv /opt/air/skill-bunfig.toml.bak /opt/air/skill-bunfig.toml` prints an `ENOENT` line naming `/opt/air/skill-bunfig.toml` and `exit=1`.
- [ ] 3.3 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/skills.xml tests/skills; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/skills.xml --scope tests/skills/)` exits 0.

## 4. Housekeeping

- [ ] 4.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only `skills/`, the five converted test files, the two new files and this change directory.
