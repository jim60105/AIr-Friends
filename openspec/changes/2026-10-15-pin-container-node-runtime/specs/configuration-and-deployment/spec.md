# Spec Delta

## ADDED Requirements

### Requirement: External Skill Installation Runs On A Supported Node Runtime

Deploying configured `agent.externalSkills` SHALL require a Node.js runtime satisfying the installer CLI's declared engine requirement, so a configured external skill cannot fail on an unsupported Node runtime. The stock image SHALL supply that runtime; a non-container deployment SHALL document the minimum Node.js version its operator must provide. The installer's command, destination, private staging HOME, publication rules and failure isolation SHALL remain unchanged.

#### Scenario: Configured skill installs on the image-provided runtime

- **GIVEN** the stock image with one or more entries under `agent.externalSkills`
- **WHEN** bootstrap runs the external-skill installer
- **THEN** the installer CLI SHALL execute on the Node.js runtime the image provisions
- **AND** each configured skill SHALL install without an engine-mismatch warning or a `fs/promises` import error
- **AND** a per-entry failure SHALL still be logged and isolated exactly as before

#### Scenario: Host deployment documents the runtime requirement

- **GIVEN** a deployment that runs outside the image and drives the same installer
- **WHEN** its prerequisites are read
- **THEN** the minimum Node.js version the installer CLI requires SHALL be stated
- **AND** the documented minimum SHALL match the engine requirement the installer CLI declares
