# syntax=docker/dockerfile:1
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
    util-linux \
    pandoc

########################################
# Opencode unpack stage
########################################
FROM base AS opencode-unpacker

ARG TARGETARCH

WORKDIR /opencode

# Map Docker TARGETARCH to OpenCode CLI naming convention
# TARGETARCH: amd64 -> x64, arm64 -> arm64
RUN case "${TARGETARCH}" in \
      amd64) OC_ARCH="x64" ;; \
      arm64) OC_ARCH="arm64" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-${OC_ARCH}.tar.gz" \
    -o /tmp/opencode.tar.gz && \
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

# Pre-cache dependencies by caching the main entry point
# Deno caches modules in DENO_DIR (default: /deno-dir/ in official image)
RUN deno cache --lock=deno.lock src/main.ts

########################################
# Final stage
########################################
FROM base AS final

# RUN mount cache for multi-arch: https://github.com/docker/buildx/issues/549#issuecomment-1788297892
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
    install -d -m 775 -o $UID -g 0 /home/deno/.config/opencode

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

# Copy OpenCode configuration
COPY --link --chown=$UID:0 --chmod=775 agent-config/opencode.json /home/deno/.config/opencode/opencode.json

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock /app/
COPY --link --chown=$UID:0 --chmod=775 config.example.yaml /app/config.yaml
COPY --link --chown=$UID:0 --chmod=775 src/ /app/src/
# Copy default prompts (can be overridden by mounting custom prompts to /app/prompts)
COPY --link --chown=$UID:0 --chmod=775 prompts/ /app/prompts/

# Copy skills to ~/.agents/skills/ for personal skills
COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/

WORKDIR /app

# Volume for persistent data (workspaces and memory)
VOLUME ["/app/data"]
# Volume for custom prompts (optional, defaults to bundled prompts)
VOLUME ["/app/prompts"]

# Set HOME environment variable for agent skills discovery
ENV HOME=/home/deno

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
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts"]

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
