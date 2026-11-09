# Design

## Context

See `proposal.md`. Observed `Containerfile` structure (about 490 lines):

- `base` from `denoland/deno:debian`: apt packages (git, curl, ripgrep, imagemagick, util-linux, bubblewrap, procps, pandoc, python3, ffmpeg, and others), then Node.js 24.22.0 from the official tarball with per-arch SHA-256.
- `opencode-unpacker` (OpenCode 1.18.21, SHA-256 per arch) and `omp-unpacker` (OMP 18.6.1, binary, license and notices SHA-256), both `FROM base`.
- `cache`: `COPY deno.json deno.lock`, `src/`, `assets/`; `deno cache` for `src/main.ts` and `npm:@node-rs/jieba`; `COPY scripts/omp/`.
- In `omp-unpacker`, a `RUN --mount=type=bind,from=cache,src=/app,target=/build-src` runs `deno run --frozen --config /build-src/deno.json --lock=/build-src/deno.lock ... prepare-native-cache.ts --executable /omp/out/omp --cache-root /opt/air/omp/native-cache --platform <p> --executable-sha256 <sha>` and checks the published layout.
- `final` (`FROM base`): `dumb-init` 1.2.5 by SHA-256; `COPY --from=cache /deno-dir/`; `npm install -g agent-browser`; Playwright deps and browser; agent binaries and OMP artifacts; `COPY ... /home/deno/...` for OpenCode config, OMP models and skills; `COPY deno.json deno.lock /app/`; `src/`, `assets/`, `prompts/`; the extension bundle `RUN --mount=... bundle-omp-extension.sh /build-src /opt/air/omp/extension /build-src/deno.lock`; a long `install -d` block (UID:0 775 for `/app`, `/app/data`, `/licenses`, `/deno-dir`, `/home/deno` and children, `/opt/air/opencode`, `/opt/air/omp` subtree; root 755 for `/usr/local`, `/usr/local/bin`); `ENV HOME=/home/deno`, `AGENT_SKILLS_DIR=/home/deno/.agents/skills`, `PATH=/home/deno/.local/bin:...`; `USER $UID`; Playwright ffmpeg symlink under `/home/deno/.cache`; `ENTRYPOINT ["dumb-init", "--"]`; `CMD ["deno", "run", "--allow-*", "src/main.ts"]`; OCI labels.
- The existing comment says the `/opt` and `/opt/air` ancestors are created by linked copies as `$UID:0 0755`. A UID-owned `/opt/air` would let the runtime user replace the trusted skill config.
- The PoC image (`migration/bun/poc/Containerfile`) proved `oven/bun@sha256:4f6e31d1...` with `install -d -m 755 -o 0 -g 0 /opt/air && install -m 444 -o 0 -g 0 /dev/null /opt/air/skill-bunfig.toml`.
- `compose.yml` runs `user: "1000:0"`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `target: final`.

## Goals / Non-Goals

**Goals:** a Bun image with the same tools, users, permissions, volumes and OMP artifacts; a repeatable smoke that proves P0-4 (seccomp), P0-7 and P0-9 on amd64.

**Non-Goals:**

- No CI or release workflow change (`migrate-ci-and-docs-to-bun`).
- No Helm template change; no `compose.yml` change (it has no Deno identifier).
- No change to OpenCode, OMP, Node.js or `dumb-init` pins.

## Decisions

### D1. Stages

```dockerfile
FROM docker.io/oven/bun@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS base   # oven/bun:1.4.2-debian
# (apt and Node.js steps unchanged)

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM base AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
COPY assets/ ./assets/
COPY --link --chown=0:0 --chmod=0755 scripts/omp/ ./scripts/omp/
```

`opencode-unpacker` and `omp-unpacker` stay. The native-cache `RUN` in `omp-unpacker` binds `from=build` and runs `bun run --no-env-file /build-src/scripts/omp/prepare-native-cache.ts` with the same four arguments and layout checks. Rewrite the long comment above it to describe the Bun base (no extra runtime installed). The extension bundle `RUN` in `final` binds `from=build` and calls `bundle-omp-extension.sh /build-src /opt/air/omp/extension` (two arguments).

### D2. Final stage

- Replace `COPY --from=cache /deno-dir/ /deno-dir/` with `COPY --link --chown=$UID:0 --chmod=775 --from=deps /app/node_modules /app/node_modules`.
- Replace `COPY deno.json deno.lock /app/` with `COPY --link --chown=$UID:0 --chmod=775 package.json bun.lock bunfig.toml tsconfig.json /app/` (`tsconfig.json` carries the path aliases Bun resolves at run time).
- Every `/home/deno` becomes `/home/air` (COPY targets, `install -d` lines, `ENV HOME`, `ENV AGENT_SKILLS_DIR`, `ENV PATH`, the Playwright ffmpeg loop). Remove the `/deno-dir/` `install -d` line.
- After the existing `install -d -m 755 -o 0 -g 0 /usr/local /usr/local/bin` line, add `install -d -m 755 -o 0 -g 0 /opt /opt/air && install -m 444 -o 0 -g 0 /dev/null /opt/air/skill-bunfig.toml`, with a comment that `/opt/air` must not be writable by `$UID` because the agent runs as `$UID` and the file is the skill injection defense (design section 4.4). The subdirectories `/opt/air/omp` and `/opt/air/opencode` keep their `$UID:0 775` convention.
- `CMD ["bun", "run", "--no-env-file", "--config=/app/bunfig.toml", "src/main.ts"]` (design section 4.5).
- The base image defines a `bun` user with UID 1000; `USER $UID` and `ENV HOME=/home/air` make that user run with the `/home/air` home, so no `useradd` is needed.

### D3. Test image

`tests/image/Containerfile`:

```dockerfile
ARG IMAGE
FROM ${IMAGE}
USER 0
COPY package.json bun.lock bunfig.toml /app/
RUN cd /app && bun install --frozen-lockfile && chown -R 1000:0 /app/node_modules
USER 1000
```

Built with `podman build -f tests/image/Containerfile --build-arg IMAGE=<final> -t <test> .`; `tests/` is mounted read-only at run time because `.containerignore` excludes it from the build context.

### D4. Smoke script

`scripts/image-smoke.sh [--only <check>] <final-image> <test-image>` (`set -eu`; `--only` runs the one named check). Every `podman run` uses `--rm --user 1000:0 --cap-drop ALL --security-opt no-new-privileges`. Checks, each printing `ok <name>` or failing:

1. `help`: `podman run ... <final> bun run --no-env-file --config=/app/bunfig.toml src/main.ts --help`.
2. `tools`: `bun --version` prints `1.4.2` and `bun --revision` starts with `1.4.2+744846f84`; `opencode --version` prints `1.18.21`; `omp --version` prints `18.6.1`; `node --version` starts with `v24.`; `agent-browser --version`, `dumb-init --version`, `rg --version`, `git --version`, `bwrap --version`, `unshare --version` exit 0.
3. `skill-config`: `stat -c '%U:%G %a %s' /opt/air/skill-bunfig.toml` is `root:root 444 0`; `stat -c '%U:%G %a' /opt/air` is `root:root 755`; `rm -f`, `mv` and `sh -c ': > /opt/air/skill-bunfig.toml'` all fail.
4. `skill-run`: running `/home/air/.agents/skills/memory-stats/scripts/memory-stats.ts --session-id x` does not print `skill-bunfig.toml` (the config loads) and exits with the skill's own error for an unreachable Skill API.
5. `in-image tests` (test image, `-v "$PWD/tests:/app/tests:ro,Z"`): `bun test --timeout=120000 tests/core/memory-recall/tokenizer.test.ts tests/acp/filesystem-access-linux.test.ts tests/acp/sandbox-capabilities.test.ts tests/integration/omp-native-runtime` passes. This covers jieba, the real FFI backend, P0-7 detection agreeing with the direct command under these permissions, and the real `omp`.
6. `seccomp-enosys`: the test image with `--security-opt seccomp=tests/fixtures/seccomp/deny-openat2.json` runs a `bun -e` script that calls `performLinuxSecureAccess` on `/app/package.json` through the real backend and prints the failure reason; it must be `secure_access_unavailable`.

## Risks / Trade-offs

- [`npx playwright install-deps` behaves differently on the Bun base] → Same Debian release family; the smoke's `agent-browser --version` and the in-image tests are the check. If the base's Debian release differs from the Deno base, record it in the task report.
- [The in-image `omp` test needs network] → The OMP native-runtime suite already uses a loopback provider; run without network flags.

## Recorded deviations

- D4 check 5 (`in-image tests`) additionally mounts `scripts/omp` and `skills` read-only at
  `/app/scripts/omp` and `/app/skills` and sets `OMP_NATIVE_ACCEPTANCE=1`.
  `tests/integration/omp-native-runtime/native-runtime.integration.test.ts` statically imports
  `../../../scripts/omp/prepare-native-cache.ts` and copies the tracked `skills/` tree from its
  `REPO_ROOT` (`/app`), so the suite cannot load from the `tests/` mount alone. Acceptance mode
  turns an unavailable native prerequisite into a named failure instead of a skip, so a passing
  run proves the real `omp` dispatch rather than an unexercised leg.
- Task 3.1: the image's `/app/config.yaml` is `config.example.yaml`, whose
  `${AGENT_DEFAULT_TYPE}` / `${DISCORD_TOKEN}` placeholders make configuration load fail, so the
  literal run exits before signal handlers are registered and its `podman stop` timing would be
  vacuous. Evidence therefore pairs the literal run (Bun version line, no forbidden error
  strings) with a live-daemon run that supplies `AGENT_DEFAULT_TYPE=opencode` and a
  non-credential `DISCORD_TOKEN=smoke-invalid`, plus `--log-driver=k8s-file` because this host's
  journald driver drops the piped startup records; that run reaches a retrying Discord adapter,
  then `podman stop -t 15` logs the full graceful shutdown through `dumb-init` and exits 0.
