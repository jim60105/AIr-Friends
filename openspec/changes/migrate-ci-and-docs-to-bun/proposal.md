# Proposal

## Why

CI, the release workflow and the Copilot setup still install Deno and run `deno task` commands, and the build job compiles with `deno compile` pinned to 2.8.3. Source design section 7 replaces them with Bun, drops the `deno compile` job for an image smoke test, and updates `AGENTS.md`, the `README`, `docs/` and the affected main specs. Section 6 keeps a 75% coverage floor on the equivalent Bun measure. arm64 evidence can only come from the native `ubuntu-24.04-arm` runner (Go record finding 6), so P0-4 and P0-9 on arm64 and the CI part of P0-10 are closed here. With CI on Bun, `deno.json` and `deno.lock` have no remaining reader and are deleted.

## What Changes

- `.github/workflows/ci.yaml`: Bun 1.4.2 via `oven-sh/setup-bun` and `bun install --frozen-lockfile`; `fmt:check`, `lint`, `check`; tests on `ubuntu-latest` and `ubuntu-24.04-arm`, the amd64 run twice (unprivileged user namespaces enabled and restricted) for P0-7; coverage with `scripts/coverage-floor.ts`; image build plus `scripts/image-smoke.sh` on both architectures, replacing the `deno compile` job.
- `.github/workflows/release.yml` test job and `.github/workflows/copilot-setup-steps.yml` move to Bun. `docker-publish-latest.yml` and `docker-reused-setup-steps/action.yml` contain no Deno step and stay unchanged (checked).
- Add `scripts/coverage-floor.ts` and its test. **Policy decision (owner-confirmable)**: Bun 1.4.2 LCOV has no branch records, so the 75% floor moves from branch coverage to line coverage over `src/`. The Deno baseline line figure was 83.3%; task 1.1 records the first Bun line figure in the task report so later drift is visible.
- Delete `deno.json` and `deno.lock`.
- Rewrite the Deno instructions in `AGENTS.md`, `README.md`, `tests/README.md` and `docs/`; update the `configuration-and-deployment` main spec Purpose sentence.

## Capabilities

### New Capabilities

- `ci-quality-gates`: the automated gates CI applies to the Bun application, starting with the coverage floor check.

### Modified Capabilities

None at the requirement level. The `configuration-and-deployment` Purpose sentence ("Defines the Deno 2.x runtime environment, ...") is edited directly in `openspec/specs/configuration-and-deployment/spec.md`, as OpenSpec requires for Purpose text.

## Impact

- Edited: `ci.yaml`, `release.yml`, `copilot-setup-steps.yml`, `AGENTS.md`, `README.md`, `tests/README.md`, affected `docs/**/*.md`, `openspec/specs/configuration-and-deployment/spec.md` (Purpose line only). New: `scripts/coverage-floor.ts`, `tests/scripts/coverage-floor.test.ts`. Deleted: `deno.json`, `deno.lock`.
- CI evidence requires pushing `feat/migrate-to-bun` and dispatching `ci.yaml`; that push is an owner action.
- P0 ownership: **P0-4** arm64 (FFI tests and seccomp smoke on the native arm64 runner), **P0-9** arm64 (image smoke and in-image tests), **P0-7** CI capable and incapable environments, **P0-10** CI part.
- `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md` and `CHANGELOG.md` history are not rewritten. The `0.37.0` changelog entry belongs to `cut-over-to-bun-release`.
- No human review document.

## Batch:

depends-on: package-bun-container-image
depends-on: add-bun-test-parity-check

Conflict note: only change that edits CI workflows and deletes `deno.json`/`deno.lock`. `.github/workflows/bun-poc-arm64.yml` stays until `cut-over-to-bun-release`.
