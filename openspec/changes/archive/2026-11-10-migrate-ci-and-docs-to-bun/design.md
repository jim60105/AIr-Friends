# Design

## Context

See `proposal.md`. Observed facts:

- `ci.yaml` triggers on push and pull request to `master` and on `workflow_dispatch`. Jobs: `check` (setup-deno v2.x, cache, `deno task fmt:check`, `lint`, `check`), `test` (ImageMagick, `test:unit`, `test:integration`), `coverage` (coverage, `deno coverage` text table parsed for the `All files` third column, which is branch coverage, floor 75, LCOV to Codecov), `build` (Deno 2.8.3, `deno compile --check ... --output /tmp/air-friends src/main.ts`, then `/tmp/air-friends --help`).
- `release.yml` `test` job: setup-deno, cache, ImageMagick, `deno task test`. Image builds there and in `docker-publish-latest.yml` already run natively per architecture (`ubuntu-latest`, `ubuntu-24.04-arm`) with `target: final`.
- `copilot-setup-steps.yml`: setup-deno, cache keyed on `deno.json`/`deno.lock`, `deno cache src/main.ts`, `deno task check`.
- `.github/workflows/docker-reused-setup-steps/action.yml` has no Deno reference.
- Bun 1.4.2 LCOV (probed during planning): records carry `SF`, `FNF`, `FNH`, `DA`, `LF`, `LH`; no `BRF`/`BRH` branch records. The Deno baseline recorded branch 88.4%, function 94.4%, line 83.3%.
- `bun-poc-arm64.yml` prepares rootless podman on the arm runner with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
- Docs mentioning Deno (case-insensitive line counts): `AGENTS.md` 34, `tests/README.md` 11, `docs/extending/contributing.md` 8, `docs/agent/acp-engine.md` 7, `docs/extending/built-in-skills.md` 2, `docs/admin/deployment-modes.md` 2, and one each in `docs/README.md`, `docs/operations/metrics-and-health.md`, `docs/getting-started/quickstart.md`, `docs/extending/custom-skills.md`, `docs/character/template-engine.md`, `docs/architecture/memory-recall.md`.

## Goals / Non-Goals

**Goals:** Bun CI with the same gates, plus both architectures and both sandbox environments; docs that describe the Bun workflow.

**Non-Goals:**

- No Helm, Containerfile or source change.
- No change to the image publish workflows' structure.
- No rewrite of historical documents (`CHANGELOG.md` entries, `docs/superpowers/`, archived OpenSpec changes).

## Decisions

### D1. `ci.yaml`

Common setup step list `bun-setup` (repeated per job): `actions/checkout@v6`; `oven-sh/setup-bun@v2` with `bun-version: 1.4.2`; `actions/cache@v5` on `~/.bun/install/cache` keyed on `hashFiles('bun.lock')`; `bun install --frozen-lockfile`.

| Job | Runs on | Steps after setup |
| --- | --- | --- |
| `check` | `ubuntu-latest` | `bun run fmt:check`, `bun run lint`, `bun run check` |
| `test` | matrix `{ runner: ubuntu-latest, userns: open }`, `{ runner: ubuntu-latest, userns: restricted }`, `{ runner: ubuntu-24.04-arm, userns: open }` | `sudo apt-get install -y imagemagick dumb-init bubblewrap`; when `userns == open`: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`; when `restricted`: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1`; `sh scripts/install-skill-bunfig.sh`; `bun run test:unit`; `bun run test:integration` |
| `coverage` | `ubuntu-latest` | same apt, sysctl `open`, skill config; `bun run test:coverage`; `bun run --no-env-file scripts/coverage-floor.ts coverage/lcov.info 75`; Codecov upload of `coverage/lcov.info` |
| `image` | matrix `ubuntu-latest`, `ubuntu-24.04-arm` | ensure `podman` (install if missing, as `bun-poc-arm64.yml` does); sysctl `open`; `podman build --target final -t air-friends:ci .`; `podman build -f tests/image/Containerfile --build-arg IMAGE=localhost/air-friends:ci -t air-friends:ci-test .`; `sh scripts/image-smoke.sh localhost/air-friends:ci localhost/air-friends:ci-test` |

`test` and `coverage` need `check`; `image` needs `test`. Triggers stay as they are (`workflow_dispatch` lets the owner run CI on `feat/migrate-to-bun` before cutover). The `restricted` run proves the incapable path: `tests/acp/sandbox-capabilities.test.ts` asserts the probe agrees with the direct command, and `tests/acp/sandbox-manager.test.ts` asserts fail-closed decisions.

### D2. Coverage floor

`scripts/coverage-floor.ts <lcov> <floor>`: parse records split on `end_of_record`; keep records whose `SF:` path, made repository-relative, starts with `src/`; sum `LF` and `LH`; print the percentage with two decimals; exit 1 when below the floor or when no `src/` record exists. The floor applies to line coverage because Bun 1.4.2 emits no branch records; see Open Questions. `tests/scripts/coverage-floor.test.ts` covers the four spec scenarios with inline LCOV strings via an exported `computeLineCoverage(text)`.

### D3. Other workflows

`release.yml` `test` job: the `bun-setup` steps, apt (`imagemagick dumb-init bubblewrap`), `sh scripts/install-skill-bunfig.sh`, `bun run test`. `copilot-setup-steps.yml`: the `bun-setup` steps and `bun run check`; keep its trigger paths.

### D4. Docs

Replace each `deno task <x>` with `bun run <x>`, `deno test` with `bun test` (or the script), `deno fmt`/`lint`/`check` with the dprint/oxlint/tsc scripts, Deno install instructions with Bun 1.4.2 install instructions, `/home/deno` with `/home/air`, `DENO_ENV` with `ENV`, and Deno permission-flag explanations with the `--no-env-file` and trusted-config explanation of design sections 4.4 and 4.5. Add a short "Trusted skill config" note to `docs/extending/contributing.md` describing `scripts/install-skill-bunfig.sh`. The `configuration-and-deployment` Purpose sentence becomes "Defines the Bun runtime environment, YAML configuration system with environment variable overrides, container deployment strategy, project structure conventions, and external skill auto-installation."

## Risks / Trade-offs

- [`kernel.apparmor_restrict_unprivileged_userns` does not exist on a runner image] → In the `open` run the `sysctl` failure fails the job (capability cannot be proved). In the `restricted` run, a missing key means the kernel does not restrict namespaces, so the run proves nothing about the incapable path: the step then prints a warning and the job additionally runs the probe tests with an empty `PATH` stub directory (the `Tool missing` scenario), which is the incapable path without kernel help.
- [The arm64 job exposes an arm-only failure] → That is the purpose; fix it in the owning change's follow-up, not by skipping.

## Open Questions

- Coverage measure: Bun 1.4.2 LCOV has no branch data, so the 75% floor moves from branch coverage to line coverage. The owner confirmed the 75% line floor on 2026-11-09 (the Deno baseline line figure was 83.3%). The floor value is a single argument and does not change this design.

## Recorded deviations

- Owner decision (2026-11-10): pin every GitHub runner label to Ubuntu 26.04 (`ubuntu-26.04` / `ubuntu-26.04-arm`) instead of the floating `ubuntu-latest` and the explicit `ubuntu-24.04-arm`. `ubuntu-latest` is migrating to 26.04 between 2026-10-19 and 2026-11-19, so the pin is the deterministic target. This touches `ci.yaml`, `release.yml`, `copilot-setup-steps.yml`, `docker-publish-latest.yml` and the retained `bun-poc-arm64.yml`; job dependencies, `bun-version: 1.4.2` pins and image digests are unchanged.
- The coverage job invokes `bun --no-env-file test --timeout=120000 --isolate --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage tests/` instead of `bun run test:coverage`. The package script runs every file in one global object, where the process-wide metrics registry lets `tests/utils/metrics.test.ts` observe counters incremented by earlier files; `--isolate` gives each file a fresh global and `--no-env-file` keeps the config-loader environment neutral. D1's command is superseded for the coverage job only.
- The `Run unit tests` and `Run integration tests` CI steps, plus `release.yml`'s `Run all tests`, invoke `bun --no-env-file test ... --isolate` instead of the package scripts, for the same process-wide metrics-registry reason. The package scripts stay convenience entry points; the docs state the CI-equivalent command and the generated-extension/native-cache prerequisites.
- The `test`, `coverage` and `release.yml` test jobs run `bun run bundle:omp-extension` before the tests. The authored OMP suites require the generated `build/omp-extension/index.js`, which is gitignored and absent from a fresh checkout; CI now satisfies the repository's own "build it first from canonical source and locked dependencies" contract.
- Every test-running job also prepares the pinned OMP native cache: it reads the version, platform and executable SHA-256 from `src/utils/omp-native-cache.ts` (the same values the Containerfile pins), downloads the matching `omp-linux-{x64,arm64}` release asset, verifies it, and runs `bun run prepare:omp-natives --executable` before the tests. This exercises the real prepared-payload path on both runner architectures.
- The arm64 cache failures were a fixture naming defect, not a missing host prerequisite: the `email-omp-profile`, `email-intent-runtime` and `email-destination-grants-runtime` fixtures published `pi_natives.fixture.linux-aarch64.node` (or no addon at all) while the arm64 contract requires `pi_natives.*linux-arm64*.node`. They now name the addon from `ompNativeCachePlatform()`, and the production completeness assertions are unchanged.
- `SkillAPIServer.start()` returns the bound TCP port (and throws when Bun reports none), so the email endpoint tests bind port 0 and address the OS-assigned port. The previous fixed 34901-34904 ports collided when isolated test files ran in the same CI environment; the endpoint assertions are unchanged.
- The `Containerfile` drops `COPY --link` (every instance). The GitHub `ubuntu-24.04-arm` runner's podman/buildah rejected it with "COPY only supports the --chmod=<permissions> --chown=<uid:gid> and the --from=<image|stage> flags", while `ubuntu-latest` accepted it. `--link` is a caching optimisation only; every `--chown`, `--chmod`, `--from` and `RUN --mount=type=cache` usage, and the pinned base digest, are unchanged. Owning change: `package-bun-container-image`.
- The `Containerfile` `omp-unpacker` stage fetches the pinned OMP executable, LICENSE and THIRD-PARTY-NOTICES.txt from their deterministic `releases/download/v${OMP_VERSION}/...` URLs instead of enumerating the release through the unauthenticated `api.github.com` endpoint. The API is rate-limited per runner IP, so the same build returned 403 on one runner and succeeded on the other. `OMP_VERSION` and all four SHA-256 values are byte-identical and still verified before any install; `scripts/omp/` is unchanged. All pinned downloads in the image build (Node tarball, OpenCode, dumb-init and the three OMP assets) use the same bounded retry policy (`--retry 10 --retry-delay 5 --retry-all-errors --retry-max-time 900 --connect-timeout 30 --max-time 900`) because the release hosts can return transient 500s; versions and digests are unchanged. Owning change: `package-bun-container-image`.
- The user-namespace probes encode the real runner contract: an `open` job fails unless `probeNetworkNamespace()` is true; a `restricted` job fails only when `probeNetworkNamespace()` is true, while a successful `bwrap` filesystem-confinement probe is legitimate and is recorded rather than treated as a capability leak. The missing-key fallback proves the network probe is false with an empty `PATH`.
- Local non-root verification uses a composition instead of one run: host `bun --no-env-file test` over every file except the image-config-dependent ones, `metrics.test.ts` alone, and the trusted-config files inside `air-friends:bun-test`. The merged JUnit report covers 3997 cases with 0 failures and 12 skips; the host LCOV reports 92.61% line coverage over `src/` (floor 75).
