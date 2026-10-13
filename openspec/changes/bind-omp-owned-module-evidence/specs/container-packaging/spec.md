# Spec Delta

## ADDED Requirements

### Requirement: Generated OMP Bundle Carries Its Owned Deployment Declaration

The generated native-loadable OMP bundle SHALL carry a build-owned declaration of its exact contracted development artifact and fixed image artifact for physical ownership admission. The declaration SHALL originate from trusted canonical build inputs, not process cwd, model input or an arbitrary loaded-module parent. It SHALL add no public runtime configuration field, credential or environment override.

#### Scenario: Contracted development artifact is declared
- **WHEN** the existing locked bundling workflow emits the development artifact
- **THEN** its declaration SHALL identify the canonical checkout's generated `build/omp-extension/index.js` artifact
- **AND** an arbitrary source-tree copy, output root or moved artifact SHALL NOT acquire authority from its own location

#### Scenario: Same artifact can use the fixed image face
- **WHEN** the generated artifact is installed at `/opt/air/omp/extension/index.js`
- **THEN** physical ownership SHALL consume the fixed image declaration independently of mutable launch state
- **AND** the existing locked dependency/host-facade audit and installed manifest coverage SHALL remain active

#### Scenario: Moved development checkout rebuilds rather than overriding identity
- **WHEN** the development deployment path changes
- **THEN** the artifact SHALL be rebuilt from that checkout's canonical trusted build inputs
- **AND** runtime configuration, process cwd or moduleURL-parent inference SHALL NOT override the embedded declaration

#### Scenario: Build declaration is not a filesystem grant
- **WHEN** the module declaration passes physical ownership checks
- **THEN** it SHALL confer only module origin evidence
- **AND** it SHALL NOT manufacture session ids, filesystem canonical targets, destructive approvals or readiness assertions
