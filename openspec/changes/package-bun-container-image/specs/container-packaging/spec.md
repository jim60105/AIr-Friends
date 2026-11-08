# Spec Delta

## MODIFIED Requirements

### Requirement: Pinned Official OMP Executable With Fail-Closed Checksum Verification

The container image SHALL install the official OMP executable at an exact pinned release tag (`v18.6.1`) via an explicit build argument (`ARG OMP_VERSION`) with per-architecture SHA-256 checksum build arguments (`OMP_SHA256_X64`, `OMP_SHA256_ARM64`) whose defaults are the approved release digests, and SHALL complete checksum verification before any installation step consumes the bytes, with the executable installed at the contracted image path.

#### Scenario: Exact-tag download with verified checksum precedes install
- **GIVEN** a container build with the default or supplied `OMP_VERSION`
- **WHEN** the OMP unpacker stage runs
- **THEN** it SHALL download the release asset for exactly that version tag, never a moving `latest` reference
- **AND** it SHALL verify the artifact against the architecture's SHA-256 build argument before any install step
- **AND** a checksum mismatch SHALL abort the build without installing the executable

#### Scenario: Unsupported architecture fails fast
- **GIVEN** a build target architecture outside `amd64`/`arm64`
- **WHEN** the asset selection runs
- **THEN** the build SHALL exit with an error naming the unsupported architecture

#### Scenario: Ambiguous or missing asset selection fails closed
- **GIVEN** a release tag whose asset set yields zero or multiple matches for the selected architecture's name prefix
- **WHEN** the asset selection runs
- **THEN** the build SHALL fail naming the match count rather than choosing arbitrarily

#### Scenario: No new runtime dependency for the binary
- **WHEN** the OMP packaging steps are inspected
- **THEN** no step SHALL install an additional JavaScript runtime or speculative helper packages to support the official executable
- **AND** the Bun application base image SHALL remain the only such dependency

#### Scenario: Architecture-to-asset mapping
- **GIVEN** a build target architecture of `amd64` or `arm64`
- **WHEN** the asset selection runs
- **THEN** the mapping SHALL send `amd64` to the x64 asset and `arm64` to the arm64 asset
- **AND** any other architecture SHALL fail the build naming the unsupported architecture

#### Scenario: Unique asset selection within the exact tag
- **GIVEN** the executable asset filename for a given libc/OS variant being unstable across the base image's floating Debian tag
- **WHEN** the build selects the executable asset within the exact release tag
- **THEN** it SHALL select the unique asset matching the architecture's name prefix and SHALL pin its SHA-256 verbatim
- **AND** any asset-name or content change under the same tag SHALL fail closed rather than install silently

### Requirement: Prepared Shared OMP Native Runtime Cache Artifact

The container image SHALL package exactly one prepared OMP native runtime payload per target platform, produced by running the checksum-verified pinned executable's real ACP initialization rather than a version probe, and publishing only the extracted native subtree. It SHALL NOT package per-channel native copies and SHALL NOT install a JavaScript runtime beyond the Bun application base to prepare them.

#### Scenario: Preparation uses the real pinned consumer
- **GIVEN** a container build with the default or supplied `OMP_VERSION`
- **WHEN** the OMP unpacker stage prepares the native payload
- **THEN** it SHALL run the already checksum-verified executable through an ACP `initialize` handshake in a temporary HOME and cwd with an existing temporary XDG `omp` directory and without provider credentials
- **AND** it SHALL require a successful initialize response and validate the extracted regular native addon files for the target platform before publishing anything, expecting `pi_natives.linux-x64-baseline.node` and `pi_natives.linux-x64-modern.node` on `linux-x64` and at least `pi_natives.linux-arm64.node` on `linux-arm64`
- **AND** an absent, failed or invalid handshake SHALL abort the build without publishing a payload

#### Scenario: One payload per target platform
- **WHEN** the finished image is inspected
- **THEN** exactly one prepared native payload SHALL exist for the image's target platform under the contracted cache layout
- **AND** the pinned executable, license and third-party notices SHALL remain installed unchanged
- **AND** no per-channel, per-mode or per-pool native copies SHALL be packaged

#### Scenario: Only native bytes are published
- **WHEN** preparation completes
- **THEN** probe databases, probe HOME and probe session state SHALL be discarded
- **AND** only the version/platform native subtree SHALL be published
- **AND** a sidecar manifest of the published file names and sizes SHALL be published outside that subtree and SHALL define payload completeness

#### Scenario: Builder can execute the preparation child
- **GIVEN** a packaging stage that prepares the payload by running the pinned executable
- **WHEN** the builder cannot execute a child process
- **THEN** the build SHALL fail explicitly instead of shipping an image without a prepared payload
- **AND** probe state SHALL NOT enter any committed image layer

#### Scenario: No new runtime dependency
- **WHEN** the native-cache packaging steps are inspected
- **THEN** no step SHALL install a JavaScript runtime beyond the Bun application base, or speculative helper packages, to prepare the payload

## ADDED Requirements

### Requirement: Trusted Skill Config Is Immutable For The Runtime User

The image SHALL contain an empty `/opt/air/skill-bunfig.toml` owned by root with mode `0444`, inside a root-owned `/opt/air` directory with mode `0755`, so the runtime user can read it but cannot replace, remove or rename it.

#### Scenario: Ownership and mode
- **WHEN** the built image is inspected
- **THEN** `/opt/air/skill-bunfig.toml` SHALL be `root:root` mode `0444` size 0 and `/opt/air` SHALL be `root:root` mode `0755`

#### Scenario: Runtime user cannot replace it
- **GIVEN** a container running as UID 1000
- **WHEN** that user tries to remove, rename or overwrite `/opt/air/skill-bunfig.toml`
- **THEN** each attempt SHALL fail and the file SHALL stay empty

### Requirement: Image Smoke Check

An image smoke script SHALL start the built image under the deployment's container permissions and SHALL fail unless the daemon prints its help, the bundled tools run, the native tokenizer segments text, and the filesystem backend loads.

#### Scenario: Help
- **WHEN** the smoke script runs the image with `--help`
- **THEN** the command SHALL exit 0

#### Scenario: Seccomp-denied openat2 fails closed
- **GIVEN** the image run with a seccomp profile returning `ENOSYS` for `openat2`
- **WHEN** protected file access is attempted through the real backend
- **THEN** it SHALL report `secure_access_unavailable` and read no content
