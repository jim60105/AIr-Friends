# syntax=docker/dockerfile:1
ARG UID=1000
ARG VERSION=EDGE
ARG RELEASE=0

########################################
# Tool stage
# Get static binaries for use in final image
# The Deno Alpine image uses glibc compatibility layer which
# interferes with musl-based Alpine binaries
########################################
FROM alpine:3.21 AS tools

# dumb-init for signal handling (statically linked)
RUN apk add --no-cache dumb-init

########################################
# Base stage
# Deno official Alpine image as base
# Using specific patch version for reproducible builds
########################################
FROM denoland/deno:alpine-2.6.8 AS base

########################################
# Cache stage (optional)
# Can be used for layer caching with BuildKit
# Currently dependencies are cached in final stage
########################################
FROM base AS cache

WORKDIR /app

# Copy dependency files
COPY deno.json deno.lock ./

# Pre-cache dependencies
# This stage is not currently used but available for future optimization
RUN deno cache --lock=deno.lock deno.json || true

########################################
# Final stage
########################################
FROM base AS final

# RUN mount cache for multi-arch: https://github.com/docker/buildx/issues/549#issuecomment-1788297892
ARG TARGETARCH
ARG TARGETVARIANT

ARG UID
ARG VERSION
ARG RELEASE

# Copy static curl binary for healthcheck
# https://github.com/tarampampam/curl-docker
COPY --from=ghcr.io/tarampampam/curl:8.7.1 /bin/curl /usr/local/bin/curl

# Copy dumb-init from tools stage for signal handling
# dumb-init is statically linked so it works across libc implementations
COPY --from=tools /usr/bin/dumb-init /usr/bin/dumb-init

# Set up directories with proper permissions
# OpenShift compatibility: root group (GID 0) for arbitrary UID support
RUN install -d -m 775 -o $UID -g 0 /app && \
    install -d -m 775 -o $UID -g 0 /data && \
    install -d -m 775 -o $UID -g 0 /licenses

WORKDIR /app

# Copy license file (OpenShift Policy)
COPY --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE

# Copy application files
COPY --chown=$UID:0 --chmod=775 deno.json deno.lock ./
COPY --chown=$UID:0 --chmod=775 config.yaml ./
COPY --chown=$UID:0 --chmod=775 src/ ./src/
COPY --chown=$UID:0 --chmod=775 prompts/ ./prompts/

# Cache dependencies in final image
RUN deno cache --lock=deno.lock src/main.ts

# OCI Labels (per BDD feature 08 requirements)
# https://github.com/opencontainers/image-spec/blob/main/annotations.md
LABEL name="agent-chatbot" \
    vendor="jim60105" \
    maintainer="jim60105" \
    url="https://github.com/jim60105/agent-chatbot" \
    version=${VERSION} \
    release=${RELEASE} \
    io.k8s.display-name="Agent Chatbot" \
    org.opencontainers.image.title="agent-chatbot" \
    org.opencontainers.image.description="AI-powered conversational chatbot using Agent Client Protocol (ACP) for multi-platform support with persistent memory" \
    org.opencontainers.image.source="https://github.com/jim60105/agent-chatbot" \
    org.opencontainers.image.version=${VERSION} \
    org.opencontainers.image.licenses="GPL-3.0" \
    summary="Agent Chatbot - Multi-platform AI chatbot with ACP integration" \
    description="An AI-powered conversational chatbot using the Agent Client Protocol (ACP) to connect with external AI agents. Supports Discord and Misskey platforms with persistent cross-conversation memory."

# Volume for persistent data (workspaces and memory)
VOLUME ["/data"]

# Switch to non-privileged user
USER $UID

# Signal handling
STOPSIGNAL SIGTERM

# Health check
# NOTE: HEALTHCHECK does not function in OCI image builds and podman builds.
# It is included for Docker compatibility.
# This checks the /health endpoint provided by HealthCheckServer (port 8080).
# If the health endpoint is not enabled, the container will still be considered
# healthy as curl will fail gracefully.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://localhost:8080/health || exit 0

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command to run the chatbot
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts"]
