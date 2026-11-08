# Design

## Context

See `proposal.md`. Observed facts:

- `src/acp/skill-inventory.ts` (554 lines): `ALLOWED_SCRIPT_INTERPRETERS = new Set(["deno"])`; `DENO_RUN_SAFE_FLAGS` regex; `resolveScriptEntrypoint(tokens)` returns `{ token, viaInterpreter }`; `matchScriptEntrypoint(segment, list, ctx)` rejects shell operators, filters fd-redirect tokens, calls `resolveScriptEntrypoint`, rejects NUL, requires a slash for direct execution, anchors relative paths at `ctx.sessionCwd`, applies the `..`-after-symlink guard with `lexicallyNormalize`, and checks canonical membership with `ctx.fs` (`realFs` default). `decodeLiteralToken` and `lexicallyNormalize` are exported helpers used by both.
- PoC `migration/bun/poc/injection/approval-grammar.ts` `matchTrustedInvocation(segment, grants, cwd)`: same operator and redirect handling; first decoded token equal to `bun` → the next tokens must decode to exactly `LITERAL_BUN_RUN` (`["bun", "run", "--no-env-file", "--no-install", "--config=/opt/air/skill-bunfig.toml"]`), then the script token must not start with `-` and must contain `/`; otherwise the first token is the spelling and must contain `/`. It then canonicalizes with the same guard. Anything after the spelling is a skill argument and is not inspected.
- PoC suites: `injection.spec.ts` (INJ-01 to INJ-08, 51 grammar cases in INJ-05, attacker directory built by `makeAttackerDir` in `injection/attacker-dir.ts` with `dotenv`, `bunfig`, `project` and `symlink` files; `BUN_OPTIONS` prefix observed effective) and `injection-noconfig.spec.ts` (missing config → exit 1, `ENOENT`).
- `agent-config/opencode.json` restricted `bash` map ends with `"deno run *": "ask"` and `"*.ts*": "ask"`.
- Baseline test names that mention Deno in `tests/acp/skill-inventory.test.ts`: `matcher - deno-run grammar: \`run\` must be the subcommand`, `matcher - module-affecting deno run flags deny fail-closed (B2)`, `matcher - unflagged and allow-listed-flag deno run spellings still approve`.

## Goals / Non-Goals

**Goals:** the exact two-form grammar in production; OpenCode routing to it; a production injection suite; the step 6 exit gate.

**Non-Goals:**

- No change to canonical membership, root enumeration, the fd-redirect tolerance, shell-operator rejection or `decodeLiteralToken`.
- No `/home/deno` rename outside the spec examples (`rename-deno-runtime-identifiers`).
- No Skill API authentication change (out of scope, design section 1).

## Decisions

### D1. Grammar

```ts
export const LITERAL_BUN_RUN = ["bun", "run", "--no-env-file", "--no-install", "--config=/opt/air/skill-bunfig.toml"] as const;
function resolveScriptEntrypoint(tokens: string[]): { token: string; viaInterpreter: boolean } | undefined;
```

New body, from the PoC: decode `tokens[0]`; if it is `bun`, require `tokens.length > LITERAL_BUN_RUN.length` and `decodeLiteralToken(tokens[i]) === LITERAL_BUN_RUN[i]` for every `i`, then the script token at index `LITERAL_BUN_RUN.length` must decode, must not start with `-`, and must contain `/`; return `{ token, viaInterpreter: true }`. Otherwise return `{ token: first, viaInterpreter: false }`. Delete `ALLOWED_SCRIPT_INTERPRETERS` and `DENO_RUN_SAFE_FLAGS`. In `matchScriptEntrypoint`, the slash requirement now applies to both routes: replace the `!entrypoint.viaInterpreter && ...` condition with a check on every spelling. Update the comments that describe the Deno grammar to describe this one. A first token like `BUN_OPTIONS=...` is a direct spelling without a slash and is denied by the slash rule.

### D2. OpenCode routing

In the restricted `bash` map, replace `"deno run *": "ask"` with `"bunx *": "deny"` followed by `"bun *": "ask"`, in the same position. In the `opencode-paths.ts` comments (lines 77 and 652), `deno run *` becomes `bun *`.

### D3. Injection suite

Copy `migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts` and `helper.ts` to `tests/fixtures/skills/injection-probe/scripts/` (same shebang; `report.ts` prints JSON with the marker variable, the helper value and the working directory). `tests/acp/skill-injection.test.ts` ports `migration/bun/poc/injection/attacker-dir.ts` into the test file (`makeAttackerDir` with the `.env`, `.env.local`, `bunfig.toml` preload, `tsconfig.json`, `package.json` and `node_modules` files of the spec; a `pwned(dir)` marker check), then:

- runs `report.ts` directly and through the literal prefix from the attacker directory, asserting `pwned(dir)` is false, the marker is absent and the helper value is the fixture's own;
- ports the 51 INJ-05 grammar cases to call `matchScriptEntrypoint` with an inventory built over `tests/fixtures/skills/` (use the helper in `tests/acp/skill-inventory-fixture.ts`), keeping each case's expected verdict;
- runs the missing-config cases (INJ-07) only when `sudo -n true` succeeds, renaming `/opt/air/skill-bunfig.toml` away and back in `finally`; otherwise `test.skip` with the reason. CI runs them (`migrate-ci-and-docs-to-bun`).

### D4. Test renames

The three Deno-named tests in `tests/acp/skill-inventory.test.ts` become `matcher - bun grammar: only the exact literal prefix is an interpreter route`, `matcher - any bun flag outside the literal prefix denies fail-closed (B2)` and `matcher - direct and literal bun run spellings approve`. Add three `renamed` entries to `parity-exceptions.json` with these replacements and the reason `Deno grammar replaced by the exact Bun grammar (design section 4.4)`.

### D5. Step 6 exit gate

After all tasks: `grep -rnE 'Deno\.[A-Za-z]+' src tests skills scripts | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)'` prints nothing; `bun run check`, `bun run lint`, `bun run fmt:check` exit 0; `bun test --timeout=120000 tests/` passes; full parity without `--scope` and without `--allow-deferred` exits 0. Skill-executing tests deferred in step 4 must pass here.

## Risks / Trade-offs

- [`tsc` reports errors across the converted tree] → Fix types in the file that reports them, without changing behavior, and list each file in the task report. This is the first point where the whole tree must type-check.
- [A Bun upgrade adds a new implicit config source] → The injection suite is the regression test; design section 5 requires rerunning it on every upgrade.
