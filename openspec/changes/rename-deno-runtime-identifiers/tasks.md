# Tasks

Prerequisite: `enforce-bun-skill-approval-grammar` is applied. Verify with `! grep -q 'deno run' agent-config/opencode.json && bun run check`.

## 1. Source and configuration

- [ ] 1.1 Apply design D1 to the `src/` files in `proposal.md` Impact. Verify: `grep -rniE '/home/deno|DENO_DIR|DENO_ENV|DENO_NO_UPDATE|deno task|deno run|deno-dir|deno\.json|deno\.lock|"deno"' src` prints nothing.
- [ ] 1.2 Apply design D1 to `agent-config/opencode.json`, `helm/values.yaml`, `.env.example` and `config.example.yaml`. Verify: the same grep over those four files prints nothing, and `bun -e 'JSON.parse(await Bun.file("agent-config/opencode.json").text())'` exits 0.

## 2. Tests

- [ ] 2.1 Update tests per design D2, including the three new tests. Verify: `grep -rniE '/home/deno|DENO_DIR|DENO_ENV|DENO_NO_UPDATE|deno task|deno-dir|deno\.json|deno\.lock' tests` prints only lines that assert a value is absent or ignored (list them in the task report).
- [ ] 2.2 Verify: `bun test --timeout=120000 tests/` passes, and the full parity check `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/rename.xml tests/; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/rename.xml)` exits 0.

## 3. Housekeeping

- [ ] 3.1 Verify: `bun run check`, `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact, `migration/bun/baseline/parity-exceptions.json` if a test was renamed, and this change directory.
