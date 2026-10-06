## Purpose

Governs container-image packaging of external agent runtimes and deployment-owned artifacts: checksum-verified pinned executables and official notices, installation of owned settings/extension trees outside agent-writable roots with an auditable digest manifest, and the explicit resolution contract between development-tree paths and installed image paths.

## ADDED Requirements

### Requirement: Pinned Official OMP Executable With Fail-Closed Checksum Verification

The container image SHALL install the official OMP executable at an exact pinned release tag (`v18.6.1`) via an explicit build argument (`ARG OMP_VERSION`) with per-architecture SHA-256 checksum build arguments (`OMP_SHA256_X64`, `OMP_SHA256_ARM64`) whose defaults are the approved release digests. The architecture mapping SHALL send `amd64` to the x64 asset and `arm64` to the arm64 asset and SHALL fail the build naming any other architecture. Because the executable asset filename for a given libc/OS variant is not stable across the base image's floating Debian tag, the build SHALL select, within the exact release tag, the unique asset matching the architecture's name prefix and SHALL pin its SHA-256 verbatim, so any asset-name or content change under the same tag fails closed rather than installing silently. Checksum verification SHALL complete before any installation step consumes the bytes, and the executable SHALL be installed at the contracted image path. The image SHALL NOT introduce a new JavaScript/Bun runtime dependency solely to host the official binary and SHALL NOT add speculative runtime packages for it.

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

The container image SHALL install the deployment-owned OMP artifacts — the owned settings overlays, the owned system-prompt artifact, and the trusted-extension module tree exactly as authored by their content changes — under a root-owned image tree whose files are not writable by the agent's runtime user. The settings files SHALL be non-writable read-only content, directories SHALL not be group/other writable, and the executable SHALL be installed owned and mode-755 by the root-equivalent user rather than the agent user, so the agent process cannot modify the binary or owned tree it is governed by. The image build SHALL NOT modify the content of any owned artifact; installation is byte-for-byte the authored tree.

#### Scenario: Owned tree is not agent-writable
- **WHEN** the finished image layout is asserted from the Containerfile install instructions
- **THEN** the settings, prompt artifact, and extension tree SHALL reside outside every agent-writable root
- **AND** their ownership and mode bits SHALL deny write to the runtime agent user

#### Scenario: Install is content-faithful
- **WHEN** owned artifacts are copied into the image
- **THEN** the copy SHALL use the authored source paths without rewriting, templating, or augmenting file content

### Requirement: Auditable Digest Manifest With Recut Invariant

The image build SHALL record a SHA-256 digest manifest covering every installed owned file (extension tree, settings overlays, prompt artifact) in a root-owned, agent-non-writable manifest file, and the manifest SHALL record the pinned version and the trusted-extension serial composition fact, including the reserved-but-unconsumed extension slot whose eventual consumption would change the digest set. The manifest SHALL be cut only over final content: any change that lands content touching the installed owned inputs SHALL recut the manifest within the same change, and a content change shipping with a stale manifest is an acceptance failure.

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

The resolution from each contracted development-tree path (trusted-extension entry, owned settings overlay, owned system-prompt artifact) to its installed image path SHALL be exported from the agent path module as a single source of truth, SHALL prefer the image path when it exists on disk, and SHALL fall back to the development-tree path otherwise, so development environments behave exactly as before installation. Operator-mounted mutable prompt overrides SHALL keep their existing mount semantics and SHALL NOT be relocated by the resolver. The launch assembly SHALL consume the resolver's result verbatim with no second path convention.

#### Scenario: Image path wins when present
- **GIVEN** a fixture filesystem containing the installed owned tree
- **WHEN** the trusted-extension, settings, and prompt paths are resolved
- **THEN** each SHALL resolve to its image path under the owned image root

#### Scenario: Development fallback unchanged
- **GIVEN** a fixture filesystem without the installed owned tree
- **WHEN** the same paths are resolved
- **THEN** each SHALL resolve to the pre-existing development-tree path
- **AND** no error SHALL be raised by the resolver itself

#### Scenario: Operator prompt mount honored
- **GIVEN** the operator-mounted prompt override path exists
- **WHEN** the system-prompt mapping is resolved
- **THEN** the existing mount-honoring mapping SHALL apply unchanged
