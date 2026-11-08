# Proposal

## Why

The restricted-mode approval gate (`src/acp/skill-inventory.ts`) accepts a trusted skill through `deno [safe flags] run [safe flags] <script>`, and OpenCode routes `deno run *` to the gate (`agent-config/opencode.json`). After `convert-builtin-skills-to-bun`, skills run under Bun, where a working-directory `.env`, `bunfig.toml` `preload` or `BUN_OPTIONS` prefix can run attacker code inside a trusted skill (source design sections 3 and 4.4). Section 4.4 accepts exactly two forms, removes the safe-flag set and denies every other flag; section 6 adds an injection suite. The Go record proved this grammar (`migration/bun/poc/injection/approval-grammar.ts`, INJ-01 to INJ-08) and showed that `BUN_OPTIONS` is effective, so denying the prefixed form is the defense. P0-6 is owned here.

## What Changes

- Replace `resolveScriptEntrypoint`, `ALLOWED_SCRIPT_INTERPRETERS` and `DENO_RUN_SAFE_FLAGS` in `src/acp/skill-inventory.ts` with the PoC grammar: direct execution of a slash-containing path, or the exact literal `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml` prefix followed by a slash-containing path. Canonical membership checks stay as they are.
- `agent-config/opencode.json`: replace `"deno run *": "ask"` with `"bun *": "ask"` and add `"bunx *": "deny"`. Update the matching comments in `src/utils/opencode-paths.ts`.
- Add `tests/acp/skill-injection.test.ts`, the production injection suite ported from `migration/bun/poc/suites/injection.spec.ts` and `injection-noconfig.spec.ts`.
- Rewrite the grammar cases in `tests/acp/skill-inventory.test.ts` and `tests/acp/opencode-skill-permission-routing.test.ts`; record the three renamed test names in `parity-exceptions.json`.
- Convert `tests/integration/omp-skill-handoff/` and `tests/integration/email-intent/`.
- Run the step 6 exit gate: full test suite, full parity, `bun run check`, lint and format.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sandbox-hardening`: four requirements whose scenarios used `deno run` or `/home/deno` now use the literal Bun form and `/home/air`; adds `Exact Bun Skill Invocation Grammar` and `Trusted Skills Ignore Working-Directory Configuration`.
- `acp-integration`: `Permission Handling — Restricted Mode`, `Root-Exact Script Entrypoint Approval` and `Skill Auto-Approve List Construction Over the Single Resolved Root` name the Bun forms.

## Impact

- Edited: `src/acp/skill-inventory.ts`, `src/utils/opencode-paths.ts` (comments), `agent-config/opencode.json`, `tests/acp/skill-inventory.test.ts`, `tests/acp/opencode-skill-permission-routing.test.ts`, four integration files, `migration/bun/baseline/parity-exceptions.json`. New: `tests/acp/skill-injection.test.ts`, `tests/fixtures/skills/injection-probe/scripts/report.ts`, `helper.ts`.
- **BREAKING**: `deno run <script>` invocations are no longer approved; custom deployments that override `opencode.json` must route `bun *` to the gate and deny `bunx *`.
- P0 ownership: **P0-6** (complete, with the shebang from `convert-builtin-skills-to-bun`). Each Bun upgrade must rerun `tests/acp/skill-injection.test.ts` (design section 5).
- No human review document.

## Batch:

depends-on: convert-builtin-skills-to-bun
depends-on: convert-acp-policy-and-filesystem-to-bun
depends-on: convert-agent-integration-suites-to-bun

Conflict note: edits `agent-config/opencode.json`, which `rename-deno-runtime-identifiers` also edits (the `/home/deno` external-directory entry); apply this change first.
