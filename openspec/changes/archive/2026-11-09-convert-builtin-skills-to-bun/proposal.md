# Proposal

## Why

The 16 built-in skill scripts and `skills/lib/client.ts` run under `#!/usr/bin/env -S deno run --allow-*` and import `jsr:@std/flags`. Source design section 4.4 gives every built-in skill one Bun shebang, `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml <script>`, because the agent can write to the skill's working directory and a plain `bun run` would load an attacker `.env` or `bunfig.toml` `preload` (section 3 probe; Go record INJ-01 to INJ-08). The Go record also showed that a missing `/opt/air/skill-bunfig.toml` makes the script stop (`missingConfigBehavior: fail-stop`), so no launcher check is needed.

## What Changes

- Every script under `skills/*/scripts/*.ts` and `skills/lib/client.ts` uses the Bun shebang above.
- `@std/flags` `parse` becomes `parseArgs` from `node:util` with every read flag declared; numeric flags are converted explicitly; argument-behavior tests pin the old results.
- `Deno.args`, `Deno.exit`, `Deno.env` and filesystem calls in `skills/` become `process` and `node:fs` calls; skills import nothing from `src/` and nothing third-party.
- Add `scripts/install-skill-bunfig.sh`, which creates the empty, root-owned, read-only `/opt/air/skill-bunfig.toml` on a development or CI host.
- Convert `tests/skills/scripts.test.ts`, `lib-client.test.ts`, `payload.test.ts`, `end-to-end-delivery.test.ts` and `staging-compat.test.ts`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: `Shell-Based Skill Execution` (Bun scripts and shebang), `Payload-File Argument Passing` and `Invalid Payload Invocations Are Rejected Before Side Effects` (`realpath` wording); adds `Skill Argument Parsing Matches The Previous Parser`.

## Impact

- Edited: 16 skill scripts, `skills/lib/client.ts`, `skills/lib/payload.ts`, five test files. New: `scripts/install-skill-bunfig.sh`, `tests/skills/skill-args.test.ts`.
- **BREAKING** for custom deployments that run a built-in skill with `deno run`: they must use the shebang or the literal `bun run` form. The approval gate change that enforces this is `enforce-bun-skill-approval-grammar`.
- Development hosts need `/opt/air/skill-bunfig.toml` (created by `scripts/install-skill-bunfig.sh`; on an unprivileged host run it inside a rootless container). The image provides it (`package-bun-container-image`).
- P0 ownership: **P0-6** shebang half (the injection suite and gate are `enforce-bun-skill-approval-grammar`).
- No human review document.

## Batch:

depends-on: port-http-servers-to-bun-serve
depends-on: convert-skills-dashboard-and-skill-api-support-to-bun
depends-on: convert-agent-integration-suites-to-bun

Conflict note: only change that edits `skills/`. `enforce-bun-skill-approval-grammar` depends on it.
