# syntax=docker/dockerfile:1
ARG UID=1000
ARG VERSION=EDGE
ARG RELEASE=0

########################################
# Base stage
# Deno official Debian image as base
########################################
FROM docker.io/denoland/deno:debian AS base

########################################
# GitHub Copilot unpack stage
########################################
FROM base AS copilot-unpacker

WORKDIR /copilot

ADD https://github.com/github/copilot-cli/releases/latest/download/copilot-linux-x64.tar.gz /tmp/copilot-linux-x64.tar.gz

RUN tar -xzf /tmp/copilot-linux-x64.tar.gz -C /copilot

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

# Set up directories with proper permissions
# OpenShift compatibility: root group (GID 0) for arbitrary UID support
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /data && \
    install -d -m 775 -o $UID -g 0 /licenses

# Copy license file (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Get Dumb Init
ADD --link --chown=$UID:0 --chmod=755 https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64 /usr/local/bin/dumb-init

# Copy static curl binary for healthcheck
# https://github.com/tarampampam/curl-docker
COPY --link --chown=$UID:0 --chmod=755 --from=ghcr.io/tarampampam/curl:8.7.1 /bin/curl /usr/local/bin/curl

# Copy Copilot CLI binary
COPY --link --chown=$UID:0 --chmod=775 --from=copilot-unpacker /copilot/copilot /usr/local/bin/copilot

# Copy cached Deno dependencies from cache stage
COPY --link --chown=$UID:0 --chmod=775 --from=cache /deno-dir/ /deno-dir/

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock /app/
COPY --link --chown=$UID:0 --chmod=775 config.yaml /app/
COPY --link --chown=$UID:0 --chmod=775 src/ /app/src/
COPY --link --chown=$UID:0 --chmod=775 prompts/ /app/prompts/

# Copy skills to ~/.copilot/skills/ for personal skills
COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.copilot/skills/

WORKDIR /app

# Volume for persistent data (workspaces and memory)
VOLUME ["/data"]

# Set HOME environment variable for copilot skills discovery
ENV HOME=/home/deno

# Switch to non-privileged user
USER $UID

# Signal handling
STOPSIGNAL SIGTERM

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://localhost:8080/health || exit 0

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command to run the chatbot with --yolo flag (safe in container environment)
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts", "--yolo"]

ARG VERSION
ARG RELEASE
LABEL name="jim60105/ai-friend" \
    # Authors for AI Friend
    vendor="jim60105" \
    # Maintainer for this docker image
    maintainer="jim60105" \
    # Containerfile source repository
    url="https://github.com/jim60105/ai-friend" \
    version=${VERSION} \
    # This should be a number, incremented with each change
    release=${RELEASE} \
    io.k8s.display-name="AI Friend" \
    summary="AI Friend - Multi-platform AI chatbot with ACP integration" \
    description="An AI-powered conversational chatbot using the Agent Client Protocol (ACP) to connect with external AI agents. Supports Discord and Misskey platforms with persistent cross-conversation memory."
