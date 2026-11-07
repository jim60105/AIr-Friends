# Design

## Context

See `proposal.md` for motivation. Observed facts:

- The host is Fedora, with libc only at `/lib64/libc.so.6`, while `src/acp/filesystem-access-linux.ts` owns `/lib/x86_64-linux-gnu/libc.so.6` and `/lib/aarch64-linux-gnu/libc.so.6`. Real backend proof therefore needs a Debian userland, so the suites run in a container.
- `docker.io/oven/bun:1.4.2-debian` resolves to index digest `sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73`, covering amd64 and arm64. A throwaway run with the flags in D2 worked on the host: UID 1000, GID 0, a writable `:Z` mount, an empty tmpfs on `/opt/air`, and `openat2` reachable from `bun:ffi`.
- The host's `opencode` (1.18.23) and `omp` (18.18.0) are newer than the pins `1.18.21` and `18.6.1` in the root `Containerfile`. The image installs the pinned releases.
- `deno.lock` pins `@agentclientprotocol/sdk` 0.14.1 with `zod` 4.4.3.
- `bun test --reporter=junit --reporter-outfile=<f>` emits nested `<testsuite>` elements for `describe` blocks, marks skips with `<skipped />`, and carries an `assertions` attribute on each test case.
- `.containerignore` patterns such as `*.md` and `node_modules/` match at the context root only, so nested paths reach the image unless removed.
- Bare `deno test` does not discover `*.spec.ts`.

## Goals / Non-Goals

**Goals:** a reproducible runtime and a way to run any suite and collect bound evidence, with every file under `migration/bun/poc/` except one arm64 workflow.

**Non-Goals:**

- No criteria, evaluation or outcome record; `define-bun-go-no-go-gate` owns those.
- No checks beyond the `harness` smoke suite.
- No edit to product files, CI, `.gitignore` or `.containerignore`.
- No type-check, lint or format setup for `migration/`.

## Decisions

### D1. Layout

```text
migration/bun/poc/.gitignore            # node_modules/ and .evidence-wip/
migration/bun/poc/package.json
migration/bun/poc/bun.lock
migration/bun/poc/Containerfile
migration/bun/poc/run-suite.sh
migration/bun/poc/fixtures/deny-openat2.json
migration/bun/poc/gate/pins.ts
migration/bun/poc/gate/evidence.ts      # collect from JUnit, hashes, observe
migration/bun/poc/gate/run-in-container.ts # CLI inside the image
migration/bun/poc/gate/harness.spec.ts
migration/bun/poc/suites/harness.spec.ts
.github/workflows/bun-poc-arm64.yml
```

Tests use `.spec.ts` so Deno never discovers them.

`gate/pins.ts`, verbatim:

```ts
export const POC_PINS = {
  bunVersion: "1.4.2",
  bunRevisionPrefix: "744846f84",
  baseImageDigest: "sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73",
  opencodeVersion: "1.18.21",
  ompVersion: "18.6.1",
} as const;
export const PRODUCT_SOURCES = [
  "src/acp/filesystem-access-linux.ts",
  "src/acp/command-syntax.ts",
  "src/utils/ssrf.ts",
] as const;
```

### D2. Image and run script

`Containerfile`, built with the repository root as context:

```dockerfile
FROM docker.io/oven/bun@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
ARG OPENCODE_VERSION=1.18.21
ARG OPENCODE_SHA256_X64=d910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a
ARG OPENCODE_SHA256_ARM64=d30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72
ARG OMP_VERSION=18.6.1
ARG OMP_SHA256_X64=c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463
ARG OMP_SHA256_ARM64=cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a
ENV POC_BASE_IMAGE_DIGEST=sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl dumb-init && \
    case "$(dpkg --print-architecture)" in \
      amd64) OC=x64; OC_SHA="${OPENCODE_SHA256_X64}"; OMP=x64; OMP_SHA="${OMP_SHA256_X64}" ;; \
      arm64) OC=arm64; OC_SHA="${OPENCODE_SHA256_ARM64}"; OMP=arm64; OMP_SHA="${OMP_SHA256_ARM64}" ;; \
      *) exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC}.tar.gz" -o /tmp/opencode.tgz && \
    echo "${OC_SHA}  /tmp/opencode.tgz" | sha256sum -c - && \
    mkdir -p /tmp/oc && tar -xzf /tmp/opencode.tgz -C /tmp/oc && mv /tmp/oc/opencode /usr/local/bin/opencode && \
    curl -fsSL "https://github.com/can1357/oh-my-pi/releases/download/v${OMP_VERSION}/omp-linux-${OMP}" -o /usr/local/bin/omp && \
    echo "${OMP_SHA}  /usr/local/bin/omp" | sha256sum -c - && \
    chmod 755 /usr/local/bin/omp /usr/local/bin/opencode && \
    rm -rf /tmp/opencode.tgz /tmp/oc && \
    install -d -m 755 -o 0 -g 0 /opt/air && install -m 444 -o 0 -g 0 /dev/null /opt/air/skill-bunfig.toml
COPY src/acp/filesystem-access-linux.ts /repo/src/acp/filesystem-access-linux.ts
COPY src/acp/command-syntax.ts /repo/src/acp/command-syntax.ts
COPY src/utils/ssrf.ts /repo/src/utils/ssrf.ts
COPY migration/bun/poc/ /repo/migration/bun/poc/
WORKDIR /repo/migration/bun/poc
RUN rm -rf node_modules evidence .evidence-wip GO-NO-GO.md GO-NO-GO.json && bun install --frozen-lockfile
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
```

The three `src/` files are copied at matching relative paths so `import` statements from `migration/bun/poc/` reach real production code. Their type-only imports are erased by Bun, so no other source file is needed.

`run-suite.sh <suite> [--final]`:

```bash
#!/usr/bin/env bash
set -euo pipefail
suite="${1:?usage: run-suite.sh <suite> [--final]}"
mode="${2:-}"
repo_root="$(git rev-parse --show-toplevel)"
poc_dir="${repo_root}/migration/bun/poc"
arch="$(uname -m)"
out_root=".evidence-wip"
if [[ "${mode}" == "--final" ]]; then out_root="evidence"; fi
out_dir="${poc_dir}/${out_root}/${arch}"
mkdir -p "${out_dir}"
image="air-friends-bun-poc:local"
extra=()
case "${suite}" in
  ffi-enosys) extra+=(--security-opt "seccomp=${poc_dir}/fixtures/deny-openat2.json") ;;
  injection-noconfig) extra+=(--tmpfs "/opt/air:rw,mode=0755") ;;
  harness|process|acp|acp-failure|ffi|egress|injection) ;;
  *) echo "unknown suite: ${suite}" >&2; exit 2 ;;
esac
podman build --quiet -f "${poc_dir}/Containerfile" -t "${image}" "${repo_root}" >/dev/null
podman run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --userns=keep-id:uid=1000,gid=1000 --user 1000:0 \
  --env "POC_GIT_HEAD=$(git rev-parse HEAD)" \
  --env "POC_IMAGE_ID=$(podman image inspect --format '{{.Id}}' "${image}")" \
  --env "POC_SPAWN_BACKEND=${POC_SPAWN_BACKEND:-node}" \
  -v "${out_dir}:/evidence:Z" "${extra[@]}" "${image}" \
  bun run --no-env-file /repo/migration/bun/poc/gate/run-in-container.ts "${suite}"
```

The flags mirror production (`cap_drop: [ALL]`, `no-new-privileges`, UID 1000, GID 0, `dumb-init` as PID 1), and `--network=none` keeps every run on loopback. A throwaway check confirmed OpenCode completes an ACP prompt against a loopback provider with no external network.

Work-in-progress runs go to the git-ignored `.evidence-wip/`. Only `--final` writes the committed `evidence/` directory, because any later code change invalidates earlier evidence through the tree hash.

`fixtures/deny-openat2.json`:

```json
{ "defaultAction": "SCMP_ACT_ALLOW", "syscalls": [{ "names": ["openat2"], "action": "SCMP_ACT_ERRNO", "errnoRet": 38 }] }
```

### D3. Evidence

```ts
export interface EvidenceTest {
  name: string;
  status: "passed" | "failed" | "skipped";
  assertions: number;        // JUnit `assertions` attribute
}
export interface SuiteEvidence {
  schemaVersion: 1;
  suite: string;
  arch: string;              // `uname -m` value
  kernel: string;
  bunVersion: string;        // Bun.version
  bunRevision: string;       // Bun.revision
  baseImageDigest: string;   // POC_BASE_IMAGE_DIGEST
  opencodeVersion: string;   // parsed from `opencode --version`
  ompVersion: string;        // parsed from `omp --version`, which prints `omp/<version>`
  pocTreeSha256: string;
  productSourcesSha256: string;
  spawnBackend: string;      // POC_SPAWN_BACKEND
  gitHead: string;           // report only
  imageId: string;           // report only
  capturedAt: string;
  observations: Record<string, unknown>;
  tests: EvidenceTest[];
}
```

`run-in-container.ts <suite>`:

1. Set `POC_OBSERVATIONS_FILE=/tmp/observations.jsonl`, then run `bun test --timeout=120000 --reporter=junit --reporter-outfile=/tmp/junit.xml ./suites/<suite>.spec.ts` with working directory `/repo/migration/bun/poc`. Print its output through.
2. No JUnit file: exit 2 and write nothing. Otherwise write `/evidence/<suite>.json` and exit 0, whatever `bun test` returned.

Suites call `observe(key, value)` from `gate/evidence.ts`, which appends one JSON line to `POC_OBSERVATIONS_FILE`. `observations` holds the last value per key. Observations inform the record and never affect the outcome.

`hashPocTree(dir)`: list files recursively, skip directories named `node_modules`, `evidence` and `.evidence-wip`, skip `GO-NO-GO.json` and any `*.md`. Sort relative paths by code unit. Hash the sequence of `<relative path>\0<file bytes>\0` with SHA-256. Hashing happens inside the image and again on the host, so neither rule may depend on git.

`hashProductSources(repoRoot)`: SHA-256 over `<relative path>\0<file bytes>\0` for each entry of `PRODUCT_SOURCES`, in array order. A failing hook in Bun removes the dependent tests from the report and leaves one failed `<testcase name="(unnamed)">`; `collectTests` keeps every test case, named or not, so the gate can see it. A missing `assertions` attribute reads as 0.


### D-ARM64. Arm64 evidence workflow

The workflow runs only on a pushed `bun-poc-final-*` tag. `workflow_dispatch` is not usable because it requires the file on the default branch, and `master` is frozen. It reads no secret and holds only `contents: read`. Suite steps continue on error because a failed test is evidence, and the upload always runs. Create it verbatim:

```yaml
name: Bun PoC arm64

on:
  push:
    tags:
      - "bun-poc-final-*"

permissions:
  contents: read

jobs:
  ffi:
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 60
    steps:
      - name: Checkout code
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Prepare rootless podman
        run: |
          sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
          command -v podman || { sudo apt-get update && sudo apt-get install -y podman; }

      - name: Run ffi
        continue-on-error: true
        run: migration/bun/poc/run-suite.sh ffi --final

      - name: Run ffi-enosys
        continue-on-error: true
        run: migration/bun/poc/run-suite.sh ffi-enosys --final

      - name: Upload evidence
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: bun-poc-aarch64-evidence
          path: migration/bun/poc/evidence/aarch64/
          if-no-files-found: error
```

Rootless `podman` on this runner is unverified until the first real run in `record-bun-go-no-go`.

## Risks / Trade-offs

- [`podman` only] → Matches the host. Docker is not supported by `run-suite.sh`.
- [Rootless `podman` fails on the arm64 runner] → The sysctl step lifts the Ubuntu 24.04 user-namespace restriction. If the first run still fails, fix the workflow in this change and restart the final runs.
- [The whole repository is the build context] → Accepted. It keeps the three `COPY src/...` lines simple, and the layer cache keeps rebuilds short.
