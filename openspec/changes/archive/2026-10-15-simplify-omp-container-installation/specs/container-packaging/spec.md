# Spec Delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Deployment-Owned OMP Artifacts Installed Outside Agent-Writable Roots

**Reason**: OMP-only physical ownership and permission hardening are cancelled.

**Migration**: Use OMP Artifact Installation Uses Existing Project Conventions; retain pinned download verification and normal notices.

### Requirement: Single Packaged Skill Tree For Every Agent Type

**Reason**: Its single-tree behavior is retained, while the old requirement also requires unchanged manifest/owned-runtime scope.

**Migration**: Use Single Authored Skill Tree Shared By Every Agent; no skill-root or content migration occurs.

### Requirement: Auditable Digest Manifest With Recut Invariant

**Reason**: The approved design removes the internal artifact-digest governance manifest while preserving download checksums.

**Migration**: Use existing pinned download SHA-256 verification and native artifact loading. No PACKAGE-MANIFEST rebuild or migration is required.
