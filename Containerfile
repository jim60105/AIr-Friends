# syntax=docker/dockerfile:1
ARG UID=1000
ARG VERSION=EDGE
ARG RELEASE=0

########################################
# Copilot unpack stage
########################################
FROM docker.io/library/alpine:latest AS copilot-unpacker

WORKDIR /copilot

ADD https://github.com/github/copilot-cli/releases/latest/download/copilot-linux-x64.tar.gz /tmp/copilot-linux-x64.tar.gz

RUN tar -xzf /tmp/copilot-linux-x64.tar.gz -C /copilot

########################################
# Base stage
# Deno official Alpine image as base
# Using specific patch version for reproducible builds
########################################
FROM docker.io/denoland/deno:alpine AS base

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

# Copy static curl binary for healthcheck
# https://github.com/tarampampam/curl-docker
COPY --from=ghcr.io/tarampampam/curl:8.7.1 /bin/curl /usr/local/bin/curl

# Set up directories with proper permissions
# OpenShift compatibility: root group (GID 0) for arbitrary UID support
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /data && \
    install -d -m 775 -o $UID -g 0 /licenses

# Copy license file (OpenShift Policy)
COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Get Dumb Init
ADD --link --chown=$UID:0 --chmod=755 https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64 /usr/local/bin/dumb-init

# Copy Copilot CLI binary
COPY --link --chown=$UID:0 --chmod=775 --from=copilot-unpacker /copilot/copilot /usr/local/bin/copilot

# Copy application files
COPY --link --chown=$UID:0 --chmod=775 deno.json deno.lock /app/
COPY --link --chown=$UID:0 --chmod=775 config.yaml /app/
COPY --link --chown=$UID:0 --chmod=775 src/ /app/src/
COPY --link --chown=$UID:0 --chmod=775 prompts/ /app/prompts/

# Copy cached Deno dependencies from cache stage
COPY --link --chown=$UID:0 --chmod=775 --from=cache /deno-dir/ /deno-dir/

WORKDIR /app

# Volume for persistent data (workspaces and memory)
VOLUME ["/data"]

# Switch to non-privileged user
USER $UID

# Signal handling
STOPSIGNAL SIGTERM

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://localhost:8080/health || exit 0

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command to run the chatbot
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts"]

ARG VERSION
ARG RELEASE
LABEL name="jim60105/agent-chatbot" \
    # Authors for Agent Chatbot
    vendor="jim60105" \
    # Maintainer for this docker image
    maintainer="jim60105" \
    # Containerfile source repository
    url="https://github.com/jim60105/agent-chatbot" \
    version=${VERSION} \
    # This should be a number, incremented with each change
    release=${RELEASE} \
    io.k8s.display-name="Agent Chatbot" \
    summary="Agent Chatbot - Multi-platform AI chatbot with ACP integration" \
    description="An AI-powered conversational chatbot using the Agent Client Protocol (ACP) to connect with external AI agents. Supports Discord and Misskey platforms with persistent cross-conversation memory."
