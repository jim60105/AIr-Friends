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
    git nodejs npm \
    curl wget ca-certificates \
    build-essential ripgrep jq moreutils strace \
    zip file tree bc \
    python3 python3-pip python-is-python3 \
    ffmpeg 7zip poppler-utils imagemagick exiftool \
     util-linux bubblewrap \
     procps \
     pandoc

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

########################################
# Owned-skill staging stage
# `unify-omp-skill-root-resolution` D2/D7: the owned OMP root is packaged from
# the deployment-controlled bundled catalog + reserved `lib` ONLY, never a broad
# COPY of whatever a development machine has installed under `skills/`. The
# stager (daemon application source, run on the cache stage's Deno) copies each
# catalog directory with identity rechecks (linked/escaping entries fail the
# build) and logs every excluded non-catalog entry.
########################################
FROM cache AS owned-skills-stager

COPY --link skills/ /build-skills/skills/
COPY --link scripts/stage-owned-skills.ts /app/scripts/stage-owned-skills.ts
RUN deno run --allow-read --allow-write /app/scripts/stage-owned-skills.ts /build-skills/skills /owned-skills

########################################
# OMP unpack stage
# Official `omp` executable + notices, pinned by exact tag + per-arch SHA-256,
# mirroring the opencode-unpacker pattern (design §12, docs/OMP_PACKAGING.md).
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
    # Observed asset name (echoed below; also recorded in docs/OMP_PACKAGING.md):
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
    mv /tmp/omp.bin /omp/out/omp && \
    mv /tmp/LICENSE /omp/licenses/LICENSE && \
    mv /tmp/THIRD-PARTY-NOTICES.txt /omp/licenses/THIRD-PARTY-NOTICES.txt && \
    # Carry the exact pinned tag to the final stage so the digest manifest
    # header records the SAME OMP_VERSION this stage enforced (no second
    # hard-coded copy of the version string downstream).
    echo "${OMP_VERSION}" > /omp/out/OMP_VERSION

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

# Set up directories with proper permissions
# OpenShift compatibility: root group (GID 0) for arbitrary UID support
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /app/data && \
    install -d -m 775 -o $UID -g 0 /licenses && \
    install -d -m 775 -o $UID -g 0 /deno-dir/ && \
    install -d -m 775 -o $UID -g 0 /home/deno/ && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local/bin && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local/share/opencode && \
    install -d -m 775 -o $UID -g 0 /home/deno/.config/opencode && \
    install -d -m 775 -o $UID -g 0 /home/deno/.cache && \
    install -d -m 775 -o $UID -g 0 /home/deno/.agent-browser

# Copy license file (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Get Dumb Init
# Map Docker TARGETARCH to dumb-init naming convention
# TARGETARCH: amd64 -> x86_64, arm64 -> aarch64
RUN case "${TARGETARCH}" in \
      amd64) DUMBINIT_ARCH="x86_64" ;; \
      arm64) DUMBINIT_ARCH="aarch64" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_${DUMBINIT_ARCH}" \
    -o /usr/local/bin/dumb-init && \
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

# Copy the official OMP executable. Ownership divergence (deliberate): the
# binaries above follow $UID:0 + 775, but $UID is the agent's own user inside
# this image — a group-writable agent binary would be self-modifiable by the
# very process the restricted boundary governs (row 12's owned/non-writable
# ownership model). `omp` therefore installs root-owned 0755; the runtime needs
# only the exec bit. No-new-Bun rule: the official executable is
# self-contained; no OMP step installs a JavaScript/Bun runtime or speculative
# helper packages (the pre-existing denoland/deno base is the image's only such
# dependency and is not modified by these steps).
COPY --link --chown=0:0 --chmod=0755 --from=omp-unpacker /omp/out/omp /usr/local/bin/omp

# Copy official OMP notices (checksum-verified in the unpacker stage above)
# under the image's third-party license location, root-owned read-only.
COPY --link --chown=0:0 --chmod=0644 --from=omp-unpacker /omp/licenses/LICENSE /licenses/omp/LICENSE
COPY --link --chown=0:0 --chmod=0644 --from=omp-unpacker /omp/licenses/THIRD-PARTY-NOTICES.txt /licenses/omp/THIRD-PARTY-NOTICES.txt

# Copy OpenCode configuration
COPY --link --chown=$UID:0 --chmod=775 agent-config/opencode.json /home/deno/.config/opencode/opencode.json

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock /app/
COPY --link --chown=$UID:0 --chmod=775 config.example.yaml /app/config.yaml
COPY --link --chown=$UID:0 --chmod=775 src/ /app/src/
COPY --link --chown=$UID:0 --chmod=775 assets/ /app/assets/
# Copy default prompts (can be overridden by mounting custom prompts to /app/prompts)
COPY --link --chown=$UID:0 --chmod=775 prompts/ /app/prompts/

# Copy skills to ~/.agents/skills/ for personal skills
COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/

# OMP skill authority never comes from the agent-writable personal tree, and
# never from the raw source `skills/` tree either (`unify-omp-skill-root-
# resolution` D7): the owned root installs ONLY the staged catalog content —
# the authored bundled skills plus reserved `lib` — so a development-installed
# external addition under `skills/` can never enter an owned image. Root-owned
# 0755 as before; outside /opt/air/omp's manifest scope.
COPY --link --chown=0:0 --chmod=0755 --from=owned-skills-stager /owned-skills/ /opt/air/skills/

# Deployment-owned OMP artifacts — a NEW root-owned tree at /opt/air/omp,
# outside every agent-writable root (never under /app/data, /app/prompts, or
# /home/deno): the row-8 settings overlays, the row-8 SYSTEM.md prompt
# artifact, and the FINAL trusted-extension tree (serial composition
# 12 -> 13 -> 14b -> 17 -> 18). Directories 0755, files 0644, owner root: the
# agent process cannot modify the owned tree it is governed by.
# Content-faithful install: the settings/prompt content lands byte-identical
# from these authored paths; the extension-tree step below installs the
# GENERATED native-loadable bundle — a deterministic transformation of
# canonical source plus frozen-lock dependencies (package-bun-compatible-
# omp-extension), with the input digest inventory recorded in the bundle
# header. No independently edited or augmented content exists either way.
RUN install -d -m 755 -o 0 -g 0 /opt/air/omp && \
    install -d -m 755 -o 0 -g 0 /opt/air/omp/config && \
    install -d -m 755 -o 0 -g 0 /opt/air/omp/prompt && \
    install -d -m 755 -o 0 -g 0 /opt/air/omp/extension

COPY --link --chown=0:0 --chmod=0644 agent-config/omp/restricted.yml /opt/air/omp/config/restricted.yml
COPY --link --chown=0:0 --chmod=0644 agent-config/omp/native-yolo.yml /opt/air/omp/config/native-yolo.yml
COPY --link --chown=0:0 --chmod=0644 agent-config/omp/models.yml /opt/air/omp/config/models.yml
# Row-8 prompt mapping: the SYSTEM.md prompt artifact installs under its
# contracted name; operator prompt mounts keep their existing semantics and
# are never relocated (src/utils/omp-paths.ts resolveOmpSystemPromptPath).
COPY --link --chown=0:0 --chmod=0644 prompts/system_prompt_override.md /opt/air/omp/prompt/SYSTEM.md

# Trusted-extension tree: build the native-loadable ESM bundle (the single
# generated index.js) from the committed canonical sources and frozen lock,
# install it into the owned tree, and cut PACKAGE-MANIFEST.sha256 over FINAL
# content. Runs as
# ROOT (before USER $UID) reading the root-owned cache-stage copy of the
# committed sources (/build-src — a bind mount of the cache stage's /app, NOT
# the agent-writable /app/src 775 copy), so nothing consumed into the owned
# tree comes from agent-modifiable bytes during the build. Recut
# invariant (design D5): the manifest is regenerated here over final content
# on EVERY image build, and any successor change that lands content touching
# /opt/air/omp inputs must recut it in the same change (the bundle is now a
# manifest-listed input) — a stale manifest
# after a content change is a task-failure condition (docs/OMP_PACKAGING.md).
COPY --link --chown=0:0 --chmod=0755 scripts/omp/ /opt/air-build/bin-omp/
COPY --link --chown=0:0 --chmod=0644 --from=omp-unpacker /omp/out/OMP_VERSION /opt/air-build/OMP_VERSION
RUN --mount=type=bind,from=cache,src=/app,target=/build-src \
    /opt/air-build/bin-omp/bundle-omp-extension.sh /build-src /opt/air/omp/extension /build-src/deno.lock && \
    /opt/air-build/bin-omp/generate-omp-manifest.sh /opt/air/omp "$(cat /opt/air-build/OMP_VERSION)" && \
    chown 0:0 /opt/air/omp/PACKAGE-MANIFEST.sha256 && \
    chmod 0644 /opt/air/omp/PACKAGE-MANIFEST.sha256 && \
    rm -rf /opt/air-build

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
