# Spec Delta

## MODIFIED Requirements

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
