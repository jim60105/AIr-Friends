## MODIFIED Requirements

### Requirement: Multi-Stage Container Build

The container image SHALL use multi-stage builds with the Deno official Debian image as base.

#### Scenario: Build Stages

- **GIVEN** the Containerfile is built
- **WHEN** the build executes
- **THEN** it SHALL use separate stages: `base` (system packages), `opencode-unpacker` (OpenCode CLI binary), `cache` (Deno dependency cache), and `final` (runtime image)

#### Scenario: Dependency Caching

- **GIVEN** the `cache` stage runs
- **WHEN** `deno cache --lock=deno.lock src/main.ts` executes
- **THEN** all Deno dependencies SHALL be pre-cached for layer reuse

### Requirement: Pre-Installed Binaries

The container SHALL include pre-installed agent binaries and tools.

#### Scenario: Binary Availability

- **GIVEN** the container is built
- **WHEN** the final image is produced
- **THEN** it SHALL contain: `opencode` (OpenCode CLI), `rg` (ripgrep), and `dumb-init`
- **AND** skills SHALL be copied to `/home/deno/.agents/skills/`
- **AND** OpenCode config SHALL be at `/home/deno/.config/opencode/opencode.json`
