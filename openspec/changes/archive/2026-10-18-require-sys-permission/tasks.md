# Tasks

Total estimate: **1 engineering hour**, well below the one engineer-day ceiling. This is a specification-artifact change: no application code, workflow, container, task, or documentation file is modified, so every task is an artifact or verification task.

## 1. Spec delta

- [x] 1.1 Add `specs/configuration-and-deployment/spec.md` with one `## MODIFIED Requirements` block for `Deno Runtime with Explicit Permissions`: append `--allow-sys` to `Scenario: Required Permission Flags` and add `Scenario: Eagerly loaded dependency requires its OS permission`. Verify the block copies the description and all four existing scenarios from `openspec/specs/configuration-and-deployment/spec.md` byte-for-byte, changing only the flag list and the added scenario.
- [x] 1.2 Confirm the change is documentation-only: run `grep -rn -- '--allow-sys' deno.json .github/workflows/ci.yaml Containerfile AGENTS.md docs/admin/deployment-modes.md docs/operations/metrics-and-health.md` and verify every launch path named in commit `183293e` already declares the flag, so no implementation task remains.

## 2. Verification gates

- [x] 2.1 Run `deno fmt --check src/ tests/` and verify it exits 0 with no reformatted file.
- [x] 2.2 Run `deno lint src/ tests/` and verify it exits 0.
- [x] 2.3 Run `deno check src/main.ts` and verify it exits 0.
- [x] 2.4 Run `deno task test` and verify all tests pass; no test asserts the previous six-flag list.
- [x] 2.5 Run `openspec validate require-sys-permission --strict` and verify it exits 0.

## Workflow follow-up

- Archive the change with `openspec archive require-sys-permission --yes` so the `MODIFIED` requirement syncs into `openspec/specs/configuration-and-deployment/spec.md`.
- Verify the synced live spec lists `--allow-sys` in `Scenario: Required Permission Flags` and passes `openspec validate configuration-and-deployment --type spec --strict`.
