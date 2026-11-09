# Spec Delta

## MODIFIED Requirements

### Requirement: Multi-Stage Container Build

The container image SHALL use multi-stage builds with the official Bun Debian image, pinned by digest, as base.

#### Scenario: Build Stages

- **GIVEN** the Containerfile is built
- **WHEN** the build executes
- **THEN** it SHALL use separate stages: `base` (system packages), `opencode-unpacker` (OpenCode CLI binary), `deps` (frozen production dependency install), `build` (frozen full dependency install used to bundle the OMP extension and prepare the OMP native cache), and `final` (runtime image)

#### Scenario: Dependency Caching

- **GIVEN** the `deps` stage runs
- **WHEN** `bun install --frozen-lockfile --production` executes against `package.json` and `bun.lock`
- **THEN** the production dependencies SHALL be installed for layer reuse, and a lock mismatch SHALL fail the build

### Requirement: Non-Root Container Execution

The container SHALL run as a non-root user for security.

#### Scenario: User Setup

- **GIVEN** the container is built with default `UID=1000`
- **WHEN** the final stage runs
- **THEN** the `USER $UID` directive SHALL switch to the non-privileged user
- **AND** directories `/app`, `/app/data`, `/home/air/` SHALL be owned by that UID with group 0 (OpenShift compatibility)

### Requirement: Graceful Shutdown via dumb-init

The container SHALL use `dumb-init` as PID 1 for proper signal handling.

#### Scenario: Signal Forwarding

- **GIVEN** the container is running
- **WHEN** a `SIGTERM` signal is sent
- **THEN** `dumb-init` SHALL forward the signal to the Bun process
- **AND** the `STOPSIGNAL` SHALL be `SIGTERM`
- **AND** the entrypoint SHALL be `["dumb-init", "--"]`

### Requirement: Pre-Installed Binaries

The container SHALL include pre-installed agent binaries and tools.

#### Scenario: Binary Availability

- **GIVEN** the container is built
- **WHEN** the final image is produced
- **THEN** it SHALL contain: `bun`, `opencode` (OpenCode CLI), `omp`, `node`, `rg` (ripgrep), and `dumb-init`
- **AND** skills SHALL be copied to `/home/air/.agents/skills/`
- **AND** OpenCode config SHALL be at `/home/air/.config/opencode/opencode.json`
