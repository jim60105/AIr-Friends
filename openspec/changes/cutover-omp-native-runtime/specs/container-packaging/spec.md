# Spec Delta

## ADDED Requirements

### Requirement: Native OMP Single ESM Code Artifact

The OMP extension SHALL be built from the canonical source and frozen dependencies as a single ESM artifact consumable by the pinned native runtime without an import map or runtime dependency downloads. Build-time loadability checks SHALL reflect the dependencies actually required by the thin capability handler.

#### Scenario: Native load
- **WHEN** the generated development or installed ESM artifact is loaded by the pinned executable
- **THEN** the official factory SHALL attach the usable restricted capability handler without importing unavailable aliases/packages.

#### Scenario: Authored config independent of bundling
- **WHEN** the extension is bundled
- **THEN** the build SHALL create code output only and SHALL not synthesize or rewrite OMP YAML.

## REMOVED Requirements

### Requirement: Owned Extension Has a Locked Native-Loadable Closure

**Reason**: The old requirement includes cancelled physical-trust and digest-recut scenarios.

**Migration**: Use Native OMP Single ESM Code Artifact for the retained frozen native-loadable build output. No runtime bridge or data migration is needed.

### Requirement: Generated OMP Bundle Carries Its Owned Deployment Declaration

**Reason**: Physical module admission and build-owned deployment declarations are cancelled by the approved parity architecture.

**Migration**: Build and load the single native ESM artifact using existing development/image paths. No ownership-record migration is required.
