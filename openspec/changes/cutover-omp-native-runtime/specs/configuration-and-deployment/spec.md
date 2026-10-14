# Spec Delta

## ADDED Requirements

### Requirement: Current Native OMP Artifact And Configuration Documentation

Current launch and packaging documentation SHALL identify canonical TypeScript as build input and the selected generated ESM bundle as the native load artifact. Native configuration paths and mutable mode data SHALL be distinguished without physical module ownership, deployment declarations or internal manifest prerequisites.

#### Scenario: Development and image entry
- **WHEN** docs describe the restricted extension argument
- **THEN** they SHALL name generated build/omp-extension/index.js or installed /opt/air/omp/extension/index.js, with no raw-source load fallback.

#### Scenario: Actual build closure
- **WHEN** docs describe the current extension build
- **THEN** they SHALL describe frozen native ESM output and actual required dependencies, without obsolete façade, ownership declaration or manifest-coverage requirements.

#### Scenario: Native configuration location
- **WHEN** docs describe the model file and mode settings
- **THEN** they SHALL name inherited native HOME model provisioning and explicit authored mode YAML; no model-config-path flag SHALL be invented.

## REMOVED Requirements

### Requirement: OMP Launch Documentation Names the Generated Deployment Artifact

**Reason**: The old generated-artifact docs contract includes cancelled physical ownership, façade and manifest prerequisites.

**Migration**: Use Current Native OMP Artifact And Configuration Documentation; retain generated code load paths and source/evidence distinctions.

