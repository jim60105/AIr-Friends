# Proposal

## Why

The agent can write to its workspace, and a plain swap from `deno run` to `bun run` would let it run code inside a trusted skill through `.env`, `bunfig.toml` and similar files, defeating entrypoint-based approval (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 3, 4.4 and 6). The hardened shebang and exact approval grammar are decided; what is unproved is that they hold on the pinned Bun, and what Bun does when `--config=/opt/air/skill-bunfig.toml` points to a missing file.

## What Changes

- Add a fixture skill using the decided hardened shebang, and a generator for an attacker-controlled working directory holding `.env`, `.env.local`, `bunfig.toml`, `tsconfig.json`, `package.json` and `node_modules`.
- Add a prototype of the exact approval grammar, using the production command tokenizer.
- Add the `injection` and `injection-noconfig` suites, implementing criteria INJ-01 to INJ-08, in both invocation forms.
- Verify the missing-config behavior against the real path, and record it. If Bun falls back to working-directory discovery, add the launcher check the design requires and verify it.
- Add two vectors beyond the design's list: `.bunfig.toml` in `$HOME` and `$XDG_CONFIG_HOME` (INJ-07), because the agent can write its home directory, and a symlinked script spelling beside attacker files (INJ-03), because the grammar matches the canonical path while Bun may resolve imports from the spelling.
- No product file changes. Built-in skills, `src/acp/skill-inventory.ts` and `agent-config/opencode.json` keep their Deno forms.

## Capabilities

### New Capabilities

- `bun-poc-injection-defenses`: behavior the hardened skill invocation and approval grammar must prove under Bun before the migration may proceed.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/injection/`, `migration/bun/poc/fixtures/skills/`, `migration/bun/poc/suites/injection.spec.ts`, `migration/bun/poc/suites/injection-noconfig.spec.ts`.
- Reads production `src/acp/command-syntax.ts` at run time, unmodified.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: define-bun-go-no-go-gate

Needs the image with `/opt/air/skill-bunfig.toml`, the `--tmpfs` variant in `run-suite.sh` and the `observe` helper from `build-bun-poc-harness`, and the failure policy (gate design D5). Conflict note: touches only its own new files, so it can be applied in any order relative to the other `prove-*` changes.

Deferred, not part of this batch: converting the skills, the inventory and `opencode.json` is design section 8 step 6, planned only after a Go result.
