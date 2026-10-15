# Spec Delta

## ADDED Requirements

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
