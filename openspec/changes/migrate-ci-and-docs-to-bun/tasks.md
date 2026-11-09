# Tasks

Prerequisite: `package-bun-container-image` is applied. Verify with `test -f scripts/image-smoke.sh && test -f tests/image/Containerfile && ! grep -qi deno Containerfile`.

## 1. Coverage floor

- [x] 1.1 Create `scripts/coverage-floor.ts` and `tests/scripts/coverage-floor.test.ts` per design D2. Verify: `bun test tests/scripts/coverage-floor.test.ts` passes, and `bun run test:coverage && bun run --no-env-file scripts/coverage-floor.ts coverage/lcov.info 75` prints a percentage and exits 0 (record the value).
  - Verified: floor test 6 pass. Non-root composition (host `bun --no-env-file test` over 201 files + `tests/utils/metrics.test.ts` alone + the four trusted-config files in `air-friends:bun-test`): merged JUnit 3997 cases, 0 failures, 12 skips. First Bun line figure: **92.61%** (floor 75, exit 0).

## 2. Workflows

- [x] 2.1 Rewrite `.github/workflows/ci.yaml` per design D1. Verify: `grep -ni 'deno' .github/workflows/ci.yaml` prints nothing, and `bun -e 'import { parse } from "yaml"; parse(await Bun.file(".github/workflows/ci.yaml").text())'` exits 0.
  - Verified: no `deno` match; YAML parsed and the jobs/needs/matrices match D1.
- [x] 2.2 Rewrite the `release.yml` test job and `copilot-setup-steps.yml` per design D3. Verify: `grep -rni 'deno' .github/workflows/release.yml .github/workflows/copilot-setup-steps.yml .github/workflows/docker-publish-latest.yml .github/workflows/docker-reused-setup-steps/action.yml` prints nothing, and each file parses with the `yaml` check from 2.1.
  - Verified: no `deno` match in any of the four files; all five workflow files parsed.
- [x] 2.3 Delete `deno.json` and `deno.lock`. Verify: `git ls-files deno.json deno.lock` prints nothing and `bun install --frozen-lockfile && bun run check` exits 0.
  - Verified: `git ls-files` prints nothing after staging the deletions; frozen install and tsc exit 0.

## 3. Docs

- [x] 3.1 Apply design D4 to `AGENTS.md`, `README.md`, `tests/README.md` and the `docs/` files listed in design Context, and edit the Purpose line of `openspec/specs/configuration-and-deployment/spec.md`. Verify: `grep -rniE 'deno' AGENTS.md README.md tests/README.md docs --include='*.md' | grep -v 'docs/superpowers/'` prints only lines that describe the migration history (list them; expected none), and `openspec validate --specs --strict` exits 0.
  - Verified: the scoped residual prints nothing (all remaining matches are under the excluded `docs/superpowers/` history); `openspec validate --specs --strict` 87 passed, 0 failed.

## 4. CI evidence

- [x] 4.1 Ask the owner to push `feat/migrate-to-bun` and run `gh workflow run ci.yaml --ref feat/migrate-to-bun`. Verify: `gh run list --workflow ci.yaml --branch feat/migrate-to-bun --limit 1 --json conclusion,url` shows `"conclusion":"success"`; paste the run URL and the `image` job's arm64 smoke output (P0-4, P0-9 arm64; P0-7 both environments; P0-10 CI).
  - Verified: https://github.com/jim60105/AIr-Friends/actions/runs/42670377760 on headSha `9868b56a4b7e59f13911129802e43e55f44a71fe`, conclusion `success`. Jobs all `success`: Code Quality; Test Coverage; Run Tests (ubuntu-26.04, userns open); Run Tests (ubuntu-26.04, userns restricted); Run Tests (ubuntu-26.04-arm, userns open); Image Smoke (ubuntu-26.04); Image Smoke (ubuntu-26.04-arm). Arm64 `Run image smoke test`: `ok help`, `ok tools`, `ok skill-config`, `ok skill-run`, `ok in-image-tests` (40 tests, 0 fail), `ok seccomp-enosys`.
  - Flake observation: the earlier attempt of this same tip, run https://github.com/jim60105/AIr-Friends/actions/runs/42663168970, stalled in the restricted unit job and was cancelled; the rerun of the identical commit completed in the normal time. Treated as a runner-side stall, not a code defect; no code change made.

## 5. Housekeeping

- [x] 5.1 Verify: `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
  - Verified: fresh `git status --porcelain` is empty; all changed paths in this change are the proposal Impact set, the recorded deviations (Containerfile/workflows/test fixtures) and this change directory.
