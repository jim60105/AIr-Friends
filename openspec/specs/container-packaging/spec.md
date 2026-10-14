# container-packaging Specification

## Purpose
Governs container-image packaging of external agent runtimes and deployment-owned artifacts: checksum-verified pinned executables and official notices, installation of owned settings/extension trees outside agent-writable roots with an auditable digest manifest, and the explicit resolution contract between development-tree paths and installed image paths.

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

### Requirement: Deployment-Owned OMP Artifacts Installed Outside Agent-Writable Roots

The container image SHALL install the deployment-owned OMP artifacts (the owned settings overlays, the owned system-prompt artifact, and the trusted-extension artifact reproducibly built from canonical source and locked dependencies) under a root-owned image tree not writable by the agent's runtime user, so the agent process cannot modify the binary or owned tree it is governed by.

#### Scenario: Owned tree is not agent-writable
- **WHEN** the finished image layout is asserted from the Containerfile install instructions
- **THEN** the settings, prompt artifact, and extension tree SHALL reside outside every agent-writable root
- **AND** their ownership and mode bits SHALL deny write to the runtime agent user

#### Scenario: Install is content-faithful
- **WHEN** owned artifacts are copied into the image
- **THEN** installation SHALL preserve authored settings and prompt content unchanged and use the deterministic extension bundle built only from canonical source and locked dependencies
- **AND** no independently maintained policy mirror or arbitrary generated policy augmentation SHALL be installed

#### Scenario: Ownership and mode hardening specifics
- **GIVEN** the finished image contains the owned tree
- **WHEN** file modes and ownership are inspected
- **THEN** the settings files SHALL be non-writable read-only content, directories SHALL not be group/other writable, and the executable SHALL be installed owned and mode-755 by the root-equivalent user rather than the agent user

### Requirement: Auditable Digest Manifest With Recut Invariant

The image build SHALL record a SHA-256 digest manifest covering every installed owned file (the extension tree, settings overlays, and prompt artifact) in a root-owned, agent-non-writable manifest file, and SHALL record the pinned version and the trusted-extension serial composition fact; no reserved dedicated public-code-search slot SHALL be required.

#### Scenario: Manifest covers every installed owned file
- **WHEN** the digest manifest is produced for a fixture owned tree
- **THEN** it SHALL contain one `sha256  <relative-path>` line per installed owned file
- **AND** it SHALL be non-writable by the runtime agent user

#### Scenario: Content landing forces recut
- **GIVEN** a successor change that modifies any file installed into the owned tree
- **WHEN** that change is completed
- **THEN** the digest manifest SHALL be recut in the same change
- **AND** documentation SHALL record the invariant so a stale manifest cannot pass review

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

### Requirement: Single Packaged Skill Tree For Every Agent Type

The container image SHALL install exactly one skill tree — the authored repository `skills/` content — at the personal skill root that every agent type resolves, and SHALL NOT install a second skill tree under any other path. No owned skill root, staged catalog filter or bundled-catalog packaging rule SHALL remain. The owned OMP artifact tree, its digest manifest scope and the pinned agent versions SHALL remain unchanged.

#### Scenario: One skill tree in the finished image

- **WHEN** the finished image layout is asserted from the Containerfile install instructions
- **THEN** exactly one skill tree SHALL exist, at the personal skill root that the configured value resolves
- **AND** `/opt/air/skills` SHALL be absent
- **AND** no Containerfile instruction, manifest entry, packaged script or code path SHALL name it

#### Scenario: Authored content and runtime installs share the one tree

- **GIVEN** the image ships the authored bundled skills and the deployment configures an external skill
- **WHEN** bootstrap publishes that external skill
- **THEN** the authored content SHALL be installed content-faithfully as the tree's initial content
- **AND** the external skill SHALL land in that same tree, which SHALL remain the only install location for either agent type

#### Scenario: Owned runtime tree and manifest scope are untouched

- **WHEN** the packaging change is completed
- **THEN** the owned OMP artifact tree under its own root and the SHA-256 digest manifest covering exactly the extension tree, settings overlays and prompt artifact SHALL remain unchanged
- **AND** no skill byte SHALL enter that manifest's digest set
- **AND** the generated extension bundle contract and the pinned agent versions SHALL remain unchanged

### Requirement: Native OMP Single ESM Code Artifact

The OMP extension SHALL be built from the canonical source and frozen dependencies as a single ESM artifact consumable by the pinned native runtime without an import map or runtime dependency downloads. Build-time loadability checks SHALL reflect the dependencies actually required by the thin capability handler.

#### Scenario: Native load
- **WHEN** the generated development or installed ESM artifact is loaded by the pinned executable
- **THEN** the official factory SHALL attach the usable restricted capability handler without importing unavailable aliases/packages.

#### Scenario: Authored config independent of bundling
- **WHEN** the extension is bundled
- **THEN** the build SHALL create code output only and SHALL not synthesize or rewrite OMP YAML.
