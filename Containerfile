# syntax=docker/dockerfile:1
# Target platform must be declared before stages for --platform support
ARG BUILDPLATFORM
ARG UID=1000
ARG VERSION=EDGE
ARG RELEASE=0

########################################
# Base stage
# Deno official Debian image as base
########################################
FROM docker.io/denoland/deno:debian AS base

# RUN mount cache for multi-arch: https://github.com/docker/buildx/issues/549#issuecomment-1788297892
ARG TARGETARCH
ARG TARGETVARIANT

RUN --mount=type=cache,id=apt-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=aptlists-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl wget ca-certificates \
    build-essential ripgrep jq moreutils strace \
    zip file tree bc xz-utils \
    python3 python3-pip python-is-python3 \
    ffmpeg 7zip poppler-utils imagemagick exiftool \
     util-linux bubblewrap \
     procps \
     pandoc

# Node.js runtime for the two `npx`/`npm` consumers in this image: the daemon's
# external-skill installer (`src/core/skill-installer.ts`, External Skill
# Auto-Installation) and the build-time `npm install -g agent-browser` /
# `npx playwright install-*` steps below.
#
# Installed from the OFFICIAL Node.js tarball with per-arch SHA-256 verification
# instead of the base distribution's `nodejs`/`npm` packages. On Debian 13 those
# resolve to Node 20.19.2, which is too old for both consumers:
#   - the `skills` CLI the installer drives declares `engines.node >= 22.20.0`
#     and imports `glob` from `node:fs/promises` (exported only from Node 22),
#     so every configured external skill died at import with
#       SyntaxError: The requested module 'fs/promises' does not provide an export named 'glob'
#   - the global `agent-browser` package declares `engines.node >= 24.0.0`
# The pinned LTS line (24.x, Active LTS) satisfies every Node consumer here, and
# the tarball install keeps the swap off the moving Debian package. The verified
# digest is fail-closed: a moved upstream tarball aborts the build before install.
# Bump deliberately and recompute BOTH digests against the real assets; verify with:
#   curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | sha256sum
ARG NODE_VERSION=24.22.0
ARG NODE_SHA256_X64=cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008
ARG NODE_SHA256_ARM64=fef00bb4d36e1c50104a9775a10359beee98f162b4104dd12472c75065c6a143
# Map Docker TARGETARCH to Node.js naming convention
# TARGETARCH: amd64 -> x64, arm64 -> arm64
RUN case "${TARGETARCH}" in \
      amd64) NODE_ARCH="x64"; NODE_SHA256="${NODE_SHA256_X64}" ;; \
      arm64) NODE_ARCH="arm64"; NODE_SHA256="${NODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    -o /tmp/node.tar.xz && \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner && \
    rm -f /tmp/node.tar.xz && \
    node --version && npm --version

########################################
# Opencode unpack stage
########################################
FROM base AS opencode-unpacker

ARG TARGETARCH

# Pinned OpenCode version and per-arch SHA-256 checksums (Design Decision 4).
# The ACP permission request shape changed in v1.17.13; tracking `releases/latest`
# silently broke the permission gate when OpenCode upgraded. Bump deliberately and
# re-verify the request shape + checksums. Verify with:
#   curl -fsSL https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz | sha256sum
ARG OPENCODE_VERSION=1.18.21
ARG OPENCODE_SHA256_X64=d910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a
ARG OPENCODE_SHA256_ARM64=d30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72

WORKDIR /opencode

# Map Docker TARGETARCH to OpenCode CLI naming convention
# TARGETARCH: amd64 -> x64, arm64 -> arm64
RUN case "${TARGETARCH}" in \
      amd64) OC_ARCH="x64"; OC_SHA256="${OPENCODE_SHA256_X64}" ;; \
      arm64) OC_ARCH="arm64"; OC_SHA256="${OPENCODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz" \
    -o /tmp/opencode.tar.gz && \
    echo "${OC_SHA256}  /tmp/opencode.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/opencode.tar.gz -C /opencode && \
    rm -f /tmp/opencode.tar.gz

########################################
# Cache stage
# Pre-cache Deno dependencies for layer reuse
########################################
FROM base AS cache

WORKDIR /app

# Copy dependency files and source code
COPY deno.json deno.lock ./
COPY src/ ./src/
COPY assets/ ./assets/

# Pre-cache dependencies by caching the main entry point
# Deno caches modules in DENO_DIR (default: /deno-dir/ in official image)
# The jieba native binding is cached explicitly: nothing imports it yet, but the
# recall tokenizer (and its offline `deno eval` smoke checks) rely on it at runtime.
RUN deno cache --lock=deno.lock src/main.ts && \
    deno cache --lock=deno.lock "npm:@node-rs/jieba"

# Owned-tree build scripts (root-owned read-only; never in the runtime image).
# They stay a SIBLING of `src/` because `bundle-extension.ts` and
# `bundle-declaration.ts` import `../../src/...`, and module specifiers resolve
# against the importing file's own URL — a relocated copy looks for `/opt/src`
# and the build fails. Copied AFTER the dependency cache so editing a packaging
# script cannot invalidate the cached module graph. `deno bundle` fetches its
# own esbuild backend from the registry at build time; that fetch is intentional
# and independent of this stage's module cache.
COPY --link --chown=0:0 --chmod=0755 scripts/omp/ ./scripts/omp/

########################################
# OMP unpack stage
# Official `omp` executable + notices, pinned by exact tag + per-arch SHA-256,
# mirroring the opencode-unpacker pattern (design §12, docs/agent/acp-engine.md).
########################################
FROM base AS omp-unpacker

ARG TARGETARCH

# Pinned OMP version and per-arch SHA-256 checksums. The ACP contract shape the
# adapter consumes is pinned to v18.6.1; tracking a moving tag would let an
# upstream release silently change it. Bump deliberately and recompute ALL four
# digests (executable x64/arm64 + LICENSE + THIRD-PARTY-NOTICES) against the
# real assets before merging. The digests below are transcribed from the
# approved design table; this change performs NO download — the first real-asset
# verification is the user-owned image build (design §15), where a mismatch
# fails the build closed at the checksum step (never installs). Verify with:
#   curl -fsSL https://github.com/can1357/oh-my-pi/releases/download/v${OMP_VERSION}/omp-linux-${OMP_ARCH} | sha256sum
ARG OMP_VERSION=18.6.1
ARG OMP_SHA256_X64=c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463
ARG OMP_SHA256_ARM64=cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a
# Official release notices from the SAME exact tag, verified before install and
# installed under /licenses/omp/ (new subdir; the project's own /licenses/LICENSE
# is untouched).
ARG OMP_LICENSE_SHA256=16c45f9d667442781f03fa198914cc39abcaa48ec5ed8f644643e554ca2fbf63
ARG OMP_NOTICES_SHA256=d0c2e7c05bb4d755044b13fa560be58d01ab7c980b87892400a979397e569a8b

WORKDIR /omp

# Map Docker TARGETARCH to OMP asset naming convention
# TARGETARCH: amd64 -> x64, arm64 -> arm64 (anything else fails the build naming it)
RUN case "${TARGETARCH}" in \
      amd64) OMP_ARCH="x64"; OMP_SHA256="${OMP_SHA256_X64}" ;; \
      arm64) OMP_ARCH="arm64"; OMP_SHA256="${OMP_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    mkdir -p /omp/out /omp/licenses && \
    # Asset allowlist WITHIN the exact tag only: select the unique executable
    # asset named exactly `omp-linux-${OMP_ARCH}` or matching
    # `omp-linux-${OMP_ARCH}-<variant>`. The base image's floating `debian` tag
    # can move the libc the binary runs against, so the exact filename is
    # allowlisted (rule above), not pinned; uniqueness + the pinned digest keep
    # any asset-name/content change under the same tag failing closed at the
    # checksum step. Zero matches or >1 match aborts the build naming the count.
    # Downloads use the SAME API listing's per-asset browser_download_url (not a
    # re-derived download URL), so uniqueness and the fetched bytes bind to one
    # listing response; the pinned digests stay the fail-closed content check.
    # Observed asset name (echoed below; also recorded in docs/agent/acp-engine.md):
    #   v18.6.1 publishes plain `omp-linux-x64` / `omp-linux-arm64` names.
    listing="$(curl -fsSL "https://api.github.com/repos/can1357/oh-my-pi/releases/tags/v${OMP_VERSION}")" && \
    sel="$(printf '%s' "${listing}" | jq -r '.assets[].name' | grep -E "^omp-linux-${OMP_ARCH}[^/]*$" || true)" && \
    count="$(printf '%s\n' "${sel}" | sed '/^$/d' | wc -l)" && \
    if [ "${count}" != "1" ]; then \
      echo "OMP asset selection failed for arch ${OMP_ARCH}: expected exactly 1 asset match, found ${count}" && exit 1; \
    fi && \
    asset="$(printf '%s\n' "${sel}" | sed '/^$/d')" && \
    echo "observed OMP executable asset name: ${asset}" && \
    asset_url="$(printf '%s' "${listing}" | jq -r --arg n "${asset}" '.assets[] | select(.name==$n) | .browser_download_url')" && \
    license_url="$(printf '%s' "${listing}" | jq -r '.assets[] | select(.name=="LICENSE") | .browser_download_url')" && \
    notices_url="$(printf '%s' "${listing}" | jq -r '.assets[] | select(.name=="THIRD-PARTY-NOTICES.txt") | .browser_download_url')" && \
    curl -fsSL "${asset_url}" -o /tmp/omp.bin && \
    curl -fsSL "${license_url}" -o /tmp/LICENSE && \
    curl -fsSL "${notices_url}" -o /tmp/THIRD-PARTY-NOTICES.txt && \
    # Fail closed: every checksum verifies BEFORE any install/COPY consumption.
    echo "${OMP_SHA256}  /tmp/omp.bin" | sha256sum -c - && \
    echo "${OMP_LICENSE_SHA256}  /tmp/LICENSE" | sha256sum -c - && \
    echo "${OMP_NOTICES_SHA256}  /tmp/THIRD-PARTY-NOTICES.txt" | sha256sum -c - && \
    # The next step RUNS this executable in-stage (the native-runtime preparation drives a
    # real, bounded `omp acp` initialize against it), but the download arrives mode 0644 and
    # `mv` preserves that mode. The final stage's `COPY --chmod=775` is what the DEPLOYED
    # runtime gets; this bit is what makes the in-stage preparation possible at all. Placed
    # after the checksum line above so unverified bytes are never marked executable.
    chmod 755 /tmp/omp.bin && \
    mv /tmp/omp.bin /omp/out/omp && \
    mv /tmp/LICENSE /omp/licenses/LICENSE && \
    mv /tmp/THIRD-PARTY-NOTICES.txt /omp/licenses/THIRD-PARTY-NOTICES.txt

# Prepare the ONE shared OMP native runtime payload from the SAME checksum-verified
# executable (design D1; `deno task prepare:omp-natives` is the same entry) and publish it
# at the image layout the launch resolver reads (`src/utils/omp-native-cache.ts`).
# Ordered AFTER the checksum step above and handed that stage's OMP_SHA256 explicitly, so
# the executable pin and the cache identity cannot drift. The entry runs the pinned
# executable's real, bounded ACP initialization in a throwaway HOME/cwd/XDG and publishes
# ONLY the native subtree plus its sidecar manifest — probe databases, HOME and sessions are
# discarded. The `--mount` reuses the cache stage's root-owned copy of the committed entry
# and its sources, and the step reads that copy's own `deno.json`/`deno.lock` explicitly with
# `--frozen`, so the mount stays read-only and lock drift fails the build. The Deno runtime
# is already part of the base image, so no JavaScript/Bun runtime is installed by this step.
# A separate layer keeps preparation re-runnable without touching the verified
# executable/notices install above, and any change to the entry or its sources invalidates
# exactly this layer. Packaged as root here; the final stage installs the result under the
# ordinary $UID:0 + 775 convention.
RUN --mount=type=bind,from=cache,src=/app,target=/build-src \
    case "${TARGETARCH}" in \
      amd64) OMP_PLATFORM="linux-x64"; OMP_SHA256="${OMP_SHA256_X64}" ;; \
      arm64) OMP_PLATFORM="linux-arm64"; OMP_SHA256="${OMP_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    deno run --frozen \
    --config /build-src/deno.json \
    --lock=/build-src/deno.lock \
    --allow-read --allow-write --allow-env --allow-run \
    /build-src/scripts/omp/prepare-native-cache.ts \
    --executable /omp/out/omp \
    --cache-root /opt/air/omp/native-cache \
    --platform "${OMP_PLATFORM}" \
    --executable-sha256 "${OMP_SHA256}" && \
    # Fail closed on the published layout the launch resolver expects: exactly this
    # platform's payload directory plus its sidecar manifest.
    test -f "/opt/air/omp/native-cache/${OMP_PLATFORM}/native-manifest.json" && \
    test -d "/opt/air/omp/native-cache/${OMP_PLATFORM}/natives/${OMP_VERSION}"

########################################
# Final stage
########################################
FROM base AS final

# RUN mount cache for multi-arch: https://github.com/docker/buildx/issues/549#issuecomment-1788297892
ARG BUILDPLATFORM
ARG TARGETARCH
ARG TARGETVARIANT

ARG UID

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

# Copy license file (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Get Dumb Init
# Pinned release + per-arch SHA-256, verified BEFORE install exactly like the
# OpenCode and OMP assets: this binary is PID 1 for every container start, so a
# moved upstream tag or a tampered download must fail the build instead of
# shipping. Bump deliberately and recompute BOTH digests; verify with:
#   curl -fsSL "https://github.com/Yelp/dumb-init/releases/download/v${DUMBINIT_VERSION}/dumb-init_${DUMBINIT_VERSION}_${DUMBINIT_ARCH}" | sha256sum
ARG DUMBINIT_VERSION=1.2.5
ARG DUMBINIT_SHA256_X64=e874b55f3279ca41415d290c512a7ba9d08f98041b28ae7c2acb19a545f1c4df
ARG DUMBINIT_SHA256_ARM64=b7d648f97154a99c539b63c55979cd29f005f88430fb383007fe3458340b795e
# Map Docker TARGETARCH to dumb-init naming convention
# TARGETARCH: amd64 -> x86_64, arm64 -> aarch64
RUN case "${TARGETARCH}" in \
      amd64) DUMBINIT_ARCH="x86_64"; DUMBINIT_SHA256="${DUMBINIT_SHA256_X64}" ;; \
      arm64) DUMBINIT_ARCH="aarch64"; DUMBINIT_SHA256="${DUMBINIT_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/Yelp/dumb-init/releases/download/v${DUMBINIT_VERSION}/dumb-init_${DUMBINIT_VERSION}_${DUMBINIT_ARCH}" \
    -o /usr/local/bin/dumb-init && \
    echo "${DUMBINIT_SHA256}  /usr/local/bin/dumb-init" | sha256sum -c - && \
    chmod 755 /usr/local/bin/dumb-init && \
    chown $UID:0 /usr/local/bin/dumb-init

# Copy cached Deno dependencies from cache stage
COPY --chown=$UID:0 --chmod=775 --from=cache /deno-dir/ /deno-dir/

# Get agent-browser
RUN npm install -g agent-browser && \
    npm cache clean --force

# Install Playwright dependencies for headless Chromium
RUN --mount=type=cache,id=apt-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/cache/apt \
    --mount=type=cache,id=aptlists-$TARGETARCH$TARGETVARIANT,sharing=locked,target=/var/lib/apt/lists \
    npx playwright install-deps chromium-headless-shell

# Copy Agents CLI binary
COPY --link --chown=$UID:0 --chmod=775 --from=opencode-unpacker /opencode/opencode /usr/local/bin/opencode

# Copy the official OMP executable, following the same $UID:0 + 775 install
# convention as the OpenCode binary above. The runtime needs the exec bit; the
# install location is a deployment path, not an ownership authority.
# No-new-Bun rule: the official executable is self-contained; no OMP step
# installs a JavaScript/Bun runtime or speculative helper packages (the
# pre-existing denoland/deno base is the image's only such dependency and is
# not modified by these steps).
COPY --link --chown=$UID:0 --chmod=775 --from=omp-unpacker /omp/out/omp /usr/local/bin/omp

# Copy official OMP notices (checksum-verified in the unpacker stage above)
# under the image's third-party license location, following the normal
# $UID:0 + 775 license-packaging convention used for the project LICENSE.
COPY --link --chown=$UID:0 --chmod=775 --from=omp-unpacker /omp/licenses/LICENSE /licenses/omp/LICENSE
COPY --link --chown=$UID:0 --chmod=775 --from=omp-unpacker /omp/licenses/THIRD-PARTY-NOTICES.txt /licenses/omp/THIRD-PARTY-NOTICES.txt

# Copy the prepared shared native runtime payload (extracted by the pinned, checksum-
# verified executable in the unpacker stage above) to the same absolute image path the
# launch resolver reads (`src/utils/omp-native-cache.ts`), under the ordinary $UID:0 + 775
# install convention. Exactly ONE `{platform}` subtree is present, because the unpacker
# stage prepared only its own target platform: the executable, LICENSE and
# THIRD-PARTY-NOTICES installs above are unchanged.
COPY --link --chown=$UID:0 --chmod=775 --from=omp-unpacker /opt/air/omp/native-cache /opt/air/omp/native-cache

# Copy OpenCode configuration
COPY --link --chown=$UID:0 --chmod=775 agent-config/opencode.json /home/deno/.config/opencode/opencode.json

# Authored deny-all OpenCode intent profile (`email-opencode-intent-profile`).
# Installed at its OWN deployment path instead of beside the deployed global
# configuration above: the engine merges every document in that directory, so a
# second file there would silently change ORDINARY launches. The profile's
# factory resolves exactly this installed path (falling back to the
# development-tree spelling outside an image) and injects the document through
# OPENCODE_CONFIG_CONTENT. The ordinary configuration above stays
# byte-identical; directory modes are prepared in the post-COPY directory step
# below, like every other linked copy in this stage.
COPY --link --chown=$UID:0 --chmod=775 agent-config/email-intent-opencode.json /opt/air/opencode/config/email-intent-opencode.json

# Authored native OMP model configuration. Native OMP reads `models.yml` from
# `getAgentDir()/models.yml` (config HOME), so the authored provider header is
# installed at the NATIVE config path instead of a second overlay tree,
# following the project's ordinary $UID:0 + 775 install convention.
COPY --link --chown=$UID:0 --chmod=775 agent-config/omp/models.yml /home/deno/.omp/agent/models.yml

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock /app/
COPY --link --chown=$UID:0 --chmod=775 config.example.yaml /app/config.yaml
COPY --link --chown=$UID:0 --chmod=775 src/ /app/src/
COPY --link --chown=$UID:0 --chmod=775 assets/ /app/assets/
# Copy default prompts (can be overridden by mounting custom prompts to /app/prompts)
COPY --link --chown=$UID:0 --chmod=775 prompts/ /app/prompts/

# Copy skills to ~/.agents/skills/ for personal skills
COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/

# The COPY above is the image's ONLY skill tree (`collapse-skill-packaging-to-
# one-tree`): both agent types resolve that one path through `AGENT_SKILLS_DIR`
# and external runtime installs publish into it, so no second, separately
# staged skill root is installed anywhere.

# Authored OMP mode settings and prompt artifact, installed at the stable
# /opt/air/omp deployment paths under the project's ordinary $UID:0 + 775
# convention (the same convention as agent-config/opencode.json). Directory
# modes are prepared in the post-COPY directory step below: a `COPY --link`
# lands as an independent layer that recreates its destination's parent
# directories, so preparing them here would be discarded.
# Content-faithful install: the settings/prompt content lands byte-identical
# from these authored paths; the extension-tree step below installs the
# GENERATED native-loadable bundle — a deterministic transformation of
# canonical source plus frozen-lock dependencies (package-bun-compatible-
# omp-extension). No independently edited or augmented content exists either
# way, and the build synthesizes or rewrites no OMP YAML.
COPY --link --chown=$UID:0 --chmod=775 agent-config/omp/restricted.yml /opt/air/omp/config/restricted.yml
COPY --link --chown=$UID:0 --chmod=775 agent-config/omp/native-yolo.yml /opt/air/omp/config/native-yolo.yml
# Row-8 prompt mapping: the SYSTEM.md prompt artifact installs under its
# contracted name; operator prompt mounts keep their existing semantics and
# are never relocated (src/utils/omp-paths.ts resolveOmpSystemPromptPath).
COPY --link --chown=$UID:0 --chmod=775 prompts/system_prompt_override.md /opt/air/omp/prompt/SYSTEM.md

# Trusted-extension tree: build the native-loadable ESM bundle (the single
# generated index.js) from the committed canonical sources and frozen lock and
# install it at the stable extension path. Runs as ROOT (before USER $UID)
# reading the root-owned cache-stage copy of the committed sources (/build-src
# — a bind mount of the cache stage's /app, NOT the agent-writable /app/src 775
# copy), so nothing consumed into the tree comes from agent-modifiable bytes
# during the build.
RUN --mount=type=bind,from=cache,src=/app,target=/build-src \
    /build-src/scripts/omp/bundle-omp-extension.sh /build-src /opt/air/omp/extension /build-src/deno.lock

# Set up directories with proper permissions.
# OpenShift compatibility: root group (GID 0) for arbitrary UID support.
#
# THIS RUN MUST FOLLOW EVERY `COPY --link` IN THIS STAGE. A linked copy lands as
# an independent layer that re-creates the destination's PARENT directories as
# plain 0755 entries owned by that copy's `--chown`, discarding modes prepared
# earlier — verified under rootless podman, where /app and /home/deno came back
# 0755 while the non-parent /app/data and /deno-dir kept 0775. A linked copy
# added after this RUN silently resets /app to 0755 again.
# Deliberately NOT declared here, and therefore left at 0755: /home/deno/.config
# (the 775 entry below is its `opencode` child) and /home/deno/.agents /
# /home/deno/.agents/skills (the packaged personal-skill tree).
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /app/data && \
    install -d -m 775 -o $UID -g 0 /licenses && \
    install -d -m 775 -o $UID -g 0 /licenses/omp && \
    install -d -m 775 -o $UID -g 0 /deno-dir/ && \
    install -d -m 775 -o $UID -g 0 /home/deno/ && \
    # Native OMP config HOME (`~/.omp/agent`): holds the authored models.yml
    # installed above and the native auth/session side files.
    install -d -m 775 -o $UID -g 0 /home/deno/.omp/agent && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local/bin && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local/share/opencode && \
    install -d -m 775 -o $UID -g 0 /home/deno/.config/opencode && \
    # OpenCode intent-profile deployment tree (`email-opencode-intent-profile`):
    # holds the authored deny-all document installed above and nothing else.
    install -d -m 775 -o $UID -g 0 /opt/air/opencode && \
    install -d -m 775 -o $UID -g 0 /opt/air/opencode/config && \
    install -d -m 775 -o $UID -g 0 /home/deno/.cache && \
    install -d -m 775 -o $UID -g 0 /home/deno/.agent-browser && \
    # OMP artifact destinations (mode settings, prompt artifact, generated
    # extension bundle, prepared shared native cache). Prepared AFTER every
    # linked copy above — including the FILES in them, which is why the
    # generated tree is re-owned and re-moded here: the build-time bundler and
    # the native-cache preparation run as root while the deployment convention
    # is $UID:0 + 775. Only these named paths get 775; the `/opt` and
    # `/opt/air` ancestors are created by the linked copies as $UID:0 0755 and
    # are deliberately left that way.
    install -d -m 775 -o $UID -g 0 /opt/air/omp && \
    install -d -m 775 -o $UID -g 0 /opt/air/omp/config && \
    install -d -m 775 -o $UID -g 0 /opt/air/omp/prompt && \
    install -d -m 775 -o $UID -g 0 /opt/air/omp/extension && \
    install -d -m 775 -o $UID -g 0 /opt/air/omp/native-cache && \
    chown -R $UID:0 /opt/air/omp && \
    find /opt/air/omp -type d -exec chmod 775 {} + && \
    find /opt/air/omp -type f -exec chmod 775 {} + && \
    # Root-owned and NOT group-writable, unlike the $UID:0 entries above: this
    # is the SHARED binary directory both agents and dumb-init live in, and the
    # declaration exists to stop linked-copy parent-directory drift (an
    # un-declared parent takes the owner of whichever linked copy touched it
    # last). It is not an OMP-artifact protection property.
    install -d -m 755 -o 0 -g 0 /usr/local /usr/local/bin

WORKDIR /app

# Volume for persistent data (workspaces and memory)
VOLUME ["/app/data"]
# Volume for custom prompts (optional, defaults to bundled prompts)
VOLUME ["/app/prompts"]

# Set HOME environment variable for agent skills discovery
ENV HOME=/home/deno

# Stock-image OpenCode installed-root declaration (`unify-omp-skill-root-resolution`
# D1): the shipped config names the SAME tree the COPY above installs and the
# resolver canonicalizes, so a stock image matches the Helm default instead of
# silently resolving `skills` against the working directory. Development default
# (`skills`) stays unchanged.
ENV AGENT_SKILLS_DIR=/home/deno/.agents/skills

ENV PATH="/home/deno/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Switch to non-privileged user
USER $UID

# Install Playwright browsers
RUN npx playwright install chromium-headless-shell

# Replace Playwright's bundled ffmpeg with system ffmpeg
RUN for dir in /home/deno/.cache/ms-playwright/ffmpeg-*; do \
    rm -f "$dir/ffmpeg-linux" && \
    ln -s /usr/bin/ffmpeg "$dir/ffmpeg-linux"; \
    done

# Expose dashboard port
EXPOSE 8090

# Signal handling
STOPSIGNAL SIGTERM

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command to run the chatbot
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "--allow-ffi", "src/main.ts"]

ARG VERSION
ARG RELEASE
LABEL name="jim60105/AIr-Friends" \
    # Author for AIr-Friends
    vendor="Jim Chen" \
    # Maintainer for this docker image
    maintainer="Jim Chen" \
    # Containerfile source repository
    url="https://github.com/jim60105/AIr-Friends" \
    version=${VERSION} \
    # This should be a number, incremented with each change
    release=${RELEASE} \
    io.k8s.display-name="AIr-Friends" \
    summary="AIr-Friends - Your AIr friends custom chatbot with integrated shell and skills." \
    description="Your AIr friends custom chatbot with integrated shell and skills. Powered by ACP AI agents, it remembers conversations across channels while keeping your data organized in isolated workspaces."
