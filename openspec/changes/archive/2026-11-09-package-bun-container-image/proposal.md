# Proposal

## Why

The image is built `FROM docker.io/denoland/deno:debian`, caches modules into `/deno-dir`, runs `deno run --allow-*` as its command, uses `/home/deno`, and bundles and prepares OMP artifacts with Deno. Source design section 7 moves it to `oven/bun:1.4.2-debian` pinned by digest, keeping Node.js 24, `dumb-init`, UID 1000, GID 0, `cap_drop: [ALL]`, `no-new-privileges`, and the `/app/data` and `/app/prompts` semantics. P0-7 (sandbox detection under the target container permissions), P0-9 (native dependencies and external tools) and P0-4's seccomp ENOSYS path all need the real image.

## What Changes

- Rebase the `Containerfile` on `docker.io/oven/bun@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73` (Bun 1.4.2, Go record pin). Replace the `cache` stage with `deps` (production install) and `build` (full install for bundling and native-cache preparation).
- Final stage: `node_modules` from `deps`; `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json` in `/app`; `/home/air` instead of `/home/deno`; no `/deno-dir`; the trusted `/opt/air/skill-bunfig.toml` (root, `0444`) in a root-owned `/opt/air`; `CMD ["bun", "run", "--no-env-file", "--config=/app/bunfig.toml", "src/main.ts"]`.
- `.containerignore` drops the `.deno/` entry.
- Add `scripts/image-smoke.sh` and `tests/image/Containerfile` (a test image `FROM` the built image that adds dev dependencies) so the smoke and an in-image test subset run under `--user 1000:0 --cap-drop ALL --security-opt no-new-privileges`.
- Copy the seccomp profile `migration/bun/poc/fixtures/deny-openat2.json` to `tests/fixtures/seccomp/deny-openat2.json`, so it survives the cutover removal of `migration/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: `Multi-Stage Container Build`, `Non-Root Container Execution`, `Graceful Shutdown via dumb-init`, `Pre-Installed Binaries`.
- `container-packaging`: `Pinned Official OMP Executable With Fail-Closed Checksum Verification` and `Prepared Shared OMP Native Runtime Cache Artifact` (Bun is the application base; OMP needs no additional runtime); adds `Trusted Skill Config Is Immutable For The Runtime User` and `Image Smoke Check`.

## Impact

- Edited: `Containerfile`, `.containerignore`. New: `scripts/image-smoke.sh`, `tests/image/Containerfile`, `tests/fixtures/seccomp/deny-openat2.json`.
- **BREAKING**: the image's `HOME` is `/home/air`; anything mounted under `/home/deno` must move. `/app/data` and `/app/prompts` are unchanged.
- P0 ownership: **P0-7** (target container permissions), **P0-9** (amd64 image: `@node-rs/jieba`, `opencode`, `omp`, `node`, `agent-browser`, `dumb-init`, `rg`, `git`, `bwrap`, `unshare`, FFI backend), **P0-4** (seccomp-denied `openat2` fails closed in the image), **P0-10** container-deployment part. arm64 runs of the same smoke are `migrate-ci-and-docs-to-bun`.
- No human review document.

## Batch:

depends-on: rename-deno-runtime-identifiers
depends-on: bundle-omp-extension-with-bun
depends-on: port-command-call-sites-and-sandbox-probe-to-bun

Conflict note: only change that edits `Containerfile`. `migrate-ci-and-docs-to-bun` builds this image in CI and depends on it.
