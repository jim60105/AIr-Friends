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
