# Tasks

Prerequisite: `package-bun-container-image` is applied. Verify with `test -f scripts/image-smoke.sh && test -f tests/image/Containerfile && ! grep -qi deno Containerfile`.

## 1. Coverage floor

- [ ] 1.1 Create `scripts/coverage-floor.ts` and `tests/scripts/coverage-floor.test.ts` per design D2. Verify: `bun test tests/scripts/coverage-floor.test.ts` passes, and `bun run test:coverage && bun run --no-env-file scripts/coverage-floor.ts coverage/lcov.info 75` prints a percentage and exits 0 (record the value).

## 2. Workflows

- [ ] 2.1 Rewrite `.github/workflows/ci.yaml` per design D1. Verify: `grep -ni 'deno' .github/workflows/ci.yaml` prints nothing, and `bun -e 'import { parse } from "yaml"; parse(await Bun.file(".github/workflows/ci.yaml").text())'` exits 0.
- [ ] 2.2 Rewrite the `release.yml` test job and `copilot-setup-steps.yml` per design D3. Verify: `grep -rni 'deno' .github/workflows/release.yml .github/workflows/copilot-setup-steps.yml .github/workflows/docker-publish-latest.yml .github/workflows/docker-reused-setup-steps/action.yml` prints nothing, and each file parses with the `yaml` check from 2.1.
- [ ] 2.3 Delete `deno.json` and `deno.lock`. Verify: `git ls-files deno.json deno.lock` prints nothing and `bun install --frozen-lockfile && bun run check` exits 0.

## 3. Docs

- [ ] 3.1 Apply design D4 to `AGENTS.md`, `README.md`, `tests/README.md` and the `docs/` files listed in design Context, and edit the Purpose line of `openspec/specs/configuration-and-deployment/spec.md`. Verify: `grep -rniE 'deno' AGENTS.md README.md tests/README.md docs --include='*.md' | grep -v 'docs/superpowers/'` prints only lines that describe the migration history (list them; expected none), and `openspec validate --specs --strict` exits 0.

## 4. CI evidence

- [ ] 4.1 Ask the owner to push `feat/migrate-to-bun` and run `gh workflow run ci.yaml --ref feat/migrate-to-bun`. Verify: `gh run list --workflow ci.yaml --branch feat/migrate-to-bun --limit 1 --json conclusion,url` shows `"conclusion":"success"`; paste the run URL and the `image` job's arm64 smoke output (P0-4, P0-9 arm64; P0-7 both environments; P0-10 CI).

## 5. Housekeeping

- [ ] 5.1 Verify: `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
