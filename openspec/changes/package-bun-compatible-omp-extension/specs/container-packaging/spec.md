# Spec Delta

## MODIFIED Requirements

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


## ADDED Requirements

### Requirement: Owned Extension Has a Locked Native-Loadable Closure

The installed and development extension entries SHALL have a reproducible dependency closure consumable by the pinned native runtime without a Deno import map, ambient packages, or runtime downloads. Only documented native builtins and pinned host-provided compatibility imports SHALL remain external. Canonical source SHALL be single-owned, locked dependencies SHALL be checked, and every installed output SHALL be manifested.

#### Scenario: Unresolved dependency fails packaging
- **WHEN** an emitted extension dependency still requires JSR, a Deno import-map alias, or an unapproved bare package
- **THEN** packaging SHALL fail before installation
- **AND** a sidecar import map SHALL NOT satisfy native-loadability

#### Scenario: Same reproducible closure in development and image
- **WHEN** development launch and image installation consume the built extension
- **THEN** both SHALL use the same generated artifact contract derived from canonical sources and locked dependencies
- **AND** no new JavaScript runtime SHALL be installed to support it

#### Scenario: Successor changes recut the bundle and digests
- **WHEN** a successor changes source or dependencies installed into the owned extension
- **THEN** it SHALL rebuild the closure and recut every affected owned digest in the same change
- **AND** independently edited mirror content SHALL NOT be accepted
