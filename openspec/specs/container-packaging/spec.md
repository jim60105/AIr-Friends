# container-packaging Specification

## Purpose
Governs container-image packaging of external agent runtimes and deployment-owned artifacts: checksum-verified pinned executables and official notices, installation of the authored settings, prompt and generated extension artifacts at stable deployment paths under the image's ordinary install convention (without a physical trust authority or an internal artifact digest manifest), and the explicit resolution contract between development-tree paths and installed image paths.

## Requirements

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
- **THEN** no step SHALL install a JavaScript/Bun runtime or speculative helper packages to support the official executable
- **AND** the pre-existing application runtime base image SHALL remain the only such dependency

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

### Requirement: Official License and Third-Party Notices Installed and Verified

The container image SHALL download the release's `LICENSE` and `THIRD-PARTY-NOTICES.txt` assets from the same exact version tag, verify each against its own SHA-256 build argument before installation, and install both under the image's third-party license location without displacing the project's existing license file.

#### Scenario: Notices verified before install
- **GIVEN** the OMP unpacker stage has fetched `LICENSE` and `THIRD-PARTY-NOTICES.txt`
- **WHEN** installation proceeds
- **THEN** each file SHALL have passed its SHA-256 check first
- **AND** a mismatch SHALL abort the build

#### Scenario: Existing project license remains
- **WHEN** the finished image is inspected
- **THEN** the project's existing license file SHALL still be present at its current location
- **AND** the OMP notices SHALL be installed alongside it under the license location

### Requirement: Development-Path to Image-Path Resolution Contract

The resolution from each contracted development-tree path (the trusted-extension entry, the owned settings overlay, and the owned system-prompt artifact) to its installed image path SHALL be exported from the agent path module as a single source of truth, SHALL prefer the image path when it exists on disk, and SHALL fall back to the deterministic generated development entry for the extension and the authored development paths for settings/prompt otherwise.

#### Scenario: Image path wins when present
- **GIVEN** a fixture filesystem containing the installed owned tree
- **WHEN** the trusted-extension, settings, and prompt paths are resolved
- **THEN** each SHALL resolve to its image path under the owned image root

#### Scenario: Development fallback unchanged
- **GIVEN** a fixture filesystem without the installed owned tree
- **WHEN** the same paths are resolved
- **THEN** the extension SHALL resolve to its deterministic generated development entry and settings/prompt SHALL retain their authored development paths
- **AND** no error SHALL be raised by the resolver itself

#### Scenario: Operator prompt mount honored
- **GIVEN** the operator-mounted prompt override path exists
- **WHEN** the system-prompt mapping is resolved
- **THEN** the existing mount-honoring mapping SHALL apply unchanged

#### Scenario: Launch assembly consumes resolver output verbatim
- **GIVEN** the resolver has produced the chosen path for each contracted artifact
- **WHEN** the launch assembly starts the agent
- **THEN** it SHALL consume the resolver's result verbatim with no second path convention
- **AND** operator-mounted prompt overrides SHALL keep their existing mount semantics and SHALL NOT be relocated by the resolver

#### Scenario: Missing generated development entry fails launch closed
- **GIVEN** no installed extension and no generated development entry
- **WHEN** launch preflight consumes the resolver output
- **THEN** launch SHALL fail with the build remedy rather than import a raw Deno-only tree
- **AND** no alternative extension-root convention SHALL be selected

### Requirement: Native OMP Single ESM Code Artifact

The OMP extension SHALL be built from the canonical source and frozen dependencies as a single ESM artifact consumable by the pinned native runtime without an import map or runtime dependency downloads. Build-time loadability checks SHALL reflect the dependencies actually required by the thin capability handler.

#### Scenario: Native load
- **WHEN** the generated development or installed ESM artifact is loaded by the pinned executable
- **THEN** the official factory SHALL attach the usable restricted capability handler without importing unavailable aliases/packages.

#### Scenario: Authored config independent of bundling
- **WHEN** the extension is bundled
- **THEN** the build SHALL create code output only and SHALL not synthesize or rewrite OMP YAML.

### Requirement: OMP Artifact Installation Uses Existing Project Conventions

OMP executable, authored configuration, prompt and generated extension installation SHALL follow the project’s existing OpenCode ownership/permission conventions. Artifact location SHALL remain a deployment path rather than a physical trust authority. Official notices SHALL remain packaged.

#### Scenario: Normal installation
- **WHEN** the OMP image is built
- **THEN** the pinned binary, authored mode/model files, prompt and native-loadable ESM artifact SHALL remain usable under normal project installation conventions.

#### Scenario: Download protection retained
- **WHEN** any executable or official notice download differs from its pinned SHA-256
- **THEN** the build SHALL fail before installing or consuming those bytes.

### Requirement: Single Authored Skill Tree Shared By Every Agent

The image SHALL install exactly one authored repository skill tree at the configured personal skill root used by both agent types and external publication. No second OMP-specific skill tree SHALL be installed, and existing pinned versions SHALL remain unchanged.

#### Scenario: Shared packaged skills
- **WHEN** either agent starts with stock image settings
- **THEN** the shared installed scripts and native discovery declaration SHALL use the single packaged root.

#### Scenario: External publication
- **WHEN** an external skill is installed
- **THEN** publication SHALL continue using the configured common root without overwriting protected bundled content.

### Requirement: Pinned Official Node.js Runtime With Fail-Closed Checksum Verification

The image SHALL provide the Node.js runtime used by its `npx`/`npm` consumers from a pinned official upstream tarball (`ARG NODE_VERSION`, default `24.22.0`) with per-arch SHA-256 build arguments (`NODE_SHA256_X64`, `NODE_SHA256_ARM64`), verified before extraction against the selected architecture's digest. The image SHALL NOT provision that runtime from the distribution's `nodejs`/`npm` packages, and the installed runtime SHALL satisfy every packaged JavaScript consumer's engine requirement.

#### Scenario: Exact-version tarball with verified checksum precedes extraction

- **GIVEN** a container build with the default or supplied `NODE_VERSION`
- **WHEN** the Node.js provisioning step runs
- **THEN** it SHALL download the official tarball for exactly that version, never a moving `latest` reference
- **AND** it SHALL verify the tarball against the target architecture's SHA-256 build argument before extracting it
- **AND** a checksum mismatch SHALL abort the build without installing the runtime

#### Scenario: Architecture-to-asset mapping

- **GIVEN** a build target architecture of `amd64` or `arm64`
- **WHEN** the asset selection runs
- **THEN** the mapping SHALL send `amd64` to the `x64` tarball and `arm64` to the `arm64` tarball
- **AND** any other architecture SHALL fail the build naming the unsupported architecture

#### Scenario: No distribution Node runtime remains

- **WHEN** the built image is inspected
- **THEN** the base distribution's `nodejs`/`npm` packages SHALL NOT be installed
- **AND** exactly one Node.js interpreter SHALL be available and it SHALL be the pinned tarball install
- **AND** an unsupported-architecture or failed-checksum build SHALL NOT leave the distro runtime in place as a silent substitute

#### Scenario: Installed runtime satisfies the packaged consumers

- **GIVEN** the pinned runtime is installed in the image
- **WHEN** the external-skill installer runs `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy`
- **THEN** the command SHALL resolve a Node.js version that satisfies that CLI's declared engine requirement and SHALL NOT fail importing `glob` from `node:fs/promises`
- **AND** the image's globally installed browser-helper package's declared engine requirement SHALL likewise be satisfied by the same interpreter

### Requirement: Prepared Shared OMP Native Runtime Cache Artifact

The container image SHALL package exactly one prepared OMP native runtime payload per target platform, produced by running the checksum-verified pinned executable's real ACP initialization rather than a version probe, and publishing only the extracted native subtree. It SHALL NOT package per-channel native copies and SHALL NOT install a JavaScript/Bun runtime to prepare them.

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
- **THEN** no step SHALL install a JavaScript/Bun runtime or speculative helper packages to prepare the payload

### Requirement: OMP Native Runtime Cache Identity And Deployment Selection

Prepared cache identity SHALL be the pinned executable version `18.6.1` combined with the target OS and architecture. An installed image cache root SHALL select image-deployment bytes, an incomplete installed root SHALL fail rather than fall back to development bytes, and selection SHALL come from the agent path module rather than an invented OMP cache environment variable.

#### Scenario: Identity mismatch fails closed
- **GIVEN** a resolved launch executable whose version or platform differs from the prepared cache identity
- **WHEN** the native cache is selected
- **THEN** selection SHALL fail naming the supported pin
- **AND** mismatched payload bytes SHALL not be consumed
- **AND** no alternative cache convention SHALL be selected
- **AND** the failure SHALL come from native-cache selection and preflight, leaving the existing bootstrap version check's WARN-only non-blocking contract unchanged
- **AND** cache identity SHALL derive from the pin, never from the operator-tunable `AGENT_OMP_MIN_VERSION` override

#### Scenario: Image cache root wins
- **GIVEN** a complete installed image cache root and a development cache root both exist
- **WHEN** the native cache is resolved
- **THEN** the image payload SHALL be selected

#### Scenario: Incomplete installed root fails
- **GIVEN** an installed image cache root exists but is missing expected payload files
- **WHEN** the native cache is resolved
- **THEN** resolution SHALL fail with a preparation remedy
- **AND** it SHALL NOT fall back to development payload bytes

#### Scenario: Development cache root
- **GIVEN** no installed image cache root
- **WHEN** the native cache is resolved
- **THEN** the daemon-side development cache root `${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp/{platform}/natives/18.6.1/` SHALL be selected

#### Scenario: Canonical location guard
- **GIVEN** a configured canonical cache location inside the backup data root or inside a configured user or shared workspace root
- **WHEN** the native cache location is accepted
- **THEN** it SHALL be refused

#### Scenario: No fabricated environment override
- **WHEN** an agent launch environment is assembled
- **THEN** no invented OMP native-cache environment variable SHALL be introduced
