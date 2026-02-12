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
    git nodejs npm

########################################
# GitHub Copilot unpack stage
########################################
FROM base AS copilot-unpacker

WORKDIR /copilot

ADD https://github.com/github/copilot-cli/releases/latest/download/copilot-linux-x64.tar.gz /tmp/copilot-linux-x64.tar.gz

RUN tar -xzf /tmp/copilot-linux-x64.tar.gz -C /copilot

########################################
# Opencode unpack stage
########################################
FROM base AS opencode-unpacker

WORKDIR /opencode

ADD https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz /tmp/opencode-linux-x64.tar.gz

RUN tar -xzf /tmp/opencode-linux-x64.tar.gz -C /opencode

########################################
# Ripgrip unpack stage
########################################
FROM base AS ripgrip-unpacker

WORKDIR /ripgrip

ADD https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz /tmp/ripgrip-linux-x64.tar.gz

RUN tar -xzf /tmp/ripgrip-linux-x64.tar.gz -C /ripgrip

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
RUN deno cache --lock=deno.lock src/main.ts npm:@google/gemini-cli

########################################
# Final stage
########################################
FROM base AS final

# RUN mount cache for multi-arch: https://github.com/docker/buildx/issues/549#issuecomment-1788297892
ARG TARGETARCH
ARG TARGETVARIANT

ARG UID

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

# Set up directories with proper permissions
# OpenShift compatibility: root group (GID 0) for arbitrary UID support
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /app/data && \
    install -d -m 775 -o $UID -g 0 /licenses && \
    install -d -m 775 -o $UID -g 0 /deno-dir/ && \
    install -d -m 775 -o $UID -g 0 /home/deno/ && \
    install -d -m 775 -o $UID -g 0 /home/deno/.local && \
    install -d -m 775 -o $UID -g 0 /home/deno/.config/opencode

# Copy license file (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Get Dumb Init
ADD --link --chown=$UID:0 --chmod=755 https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64 /usr/local/bin/dumb-init

# Copy ripgrep binary for internal use (e.g. in skills)
COPY --link --chown=$UID:0 --chmod=775 --from=ripgrip-unpacker /ripgrip/ripgrep-15.1.0-x86_64-unknown-linux-musl/rg /usr/local/bin/rg

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
COPY --link --chown=$UID:0 --chmod=775 --from=copilot-unpacker /copilot/copilot /usr/local/bin/copilot
COPY --link --chown=$UID:0 --chmod=775 --from=opencode-unpacker /opencode/opencode /usr/local/bin/opencode

# Copy OpenCode configuration
COPY --link --chown=$UID:0 --chmod=775 opencode.json /home/deno/.config/opencode/opencode.json

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

# Set HOME environment variable for copilot skills discovery
ENV HOME=/home/deno

# Switch to non-privileged user
USER $UID

# Install Playwright browsers
RUN npx playwright install chromium-headless-shell

# Signal handling
STOPSIGNAL SIGTERM

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command to run the chatbot with --yolo flag (safe in container environment)
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts", "--yolo"]

ARG VERSION
ARG RELEASE
LABEL name="jim60105/air-friends" \
    # Authors for AIr-Friends
    vendor="jim60105" \
    # Maintainer for this docker image
    maintainer="jim60105" \
    # Containerfile source repository
    url="https://github.com/jim60105/AIr-Friends" \
    version=${VERSION} \
    # This should be a number, incremented with each change
    release=${RELEASE} \
    io.k8s.display-name="AIr-Friends" \
    summary="AIr-Friends - Multi-platform AI chatbot with ACP integration" \
    description="An AI-powered conversational chatbot using the Agent Client Protocol (ACP) to connect with external AI agents. Supports Discord and Misskey platforms with persistent cross-conversation memory."
