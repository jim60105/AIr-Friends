# Spec Delta

## ADDED Requirements

### Requirement: Permission Guidance Matches The Session Engine And Mode

Bundled initial and corrective instructions SHALL scope permission claims to the selected engine and effective session mode. Restricted guidance SHALL retain applicable command/path constraints. YOLO guidance SHALL NOT state restricted shell-operator or command denials as universal facts. Operational recommendations SHALL be distinguishable from enforced restrictions.

#### Scenario: Restricted OpenCode retains its real restrictions
- **WHEN** bundled capability and browser instructions are rendered for restricted OpenCode
- **THEN** they SHALL retain the restricted command allowlist, OpenCode-specific pre-gate denials and per-segment chaining rule
- **AND** they SHALL distinguish tolerated standard-stream fd redirects from prohibited file redirects, pipes, backgrounding and newline separators
- **AND** an allowed `||` chain SHALL NOT be described as impossible merely because it uses `||`

#### Scenario: Restricted OMP receives shared policy without false attribution
- **WHEN** the same bundled instructions are rendered for restricted OMP
- **THEN** applicable shared command/operator/path restrictions and native OMP tool-use guidance SHALL remain present
- **AND** the instructions SHALL NOT describe OpenCode as the engine enforcing that session's upstream tool policy

#### Scenario: YOLO does not inherit restricted shell claims
- **WHEN** bundled reply, spontaneous or self-research browser/capability instructions are rendered for YOLO OpenCode or native-YOLO OMP
- **THEN** they SHALL NOT claim pipes, file redirects or named restricted-mode commands are always denied
- **AND** they SHALL NOT claim all operations or filesystem paths are permitted
- **AND** OMP guidance SHALL retain the native LSP denial and service/background tool semantics

#### Scenario: Stdout handling is a recommendation
- **WHEN** OMP shell-use instructions recommend reading stdout and exit status from the tool result
- **THEN** the recommendation SHALL NOT assert shell redirection is prohibited in native-YOLO
- **AND** the one-shot command advice and background-completion handling SHALL remain available

#### Scenario: Restricted writes are described conditionally
- **WHEN** restricted capability guidance is rendered with shared-workspace write authorization true or false
- **THEN** it SHALL describe staging writes and shared-workspace writes consistently with those flags and existing extension policy
- **AND** it SHALL NOT label every restricted operation as read-only or grant unauthorized shared writes

#### Scenario: Existing delivery and browser contracts survive
- **WHEN** any affected session prompt or correction is rendered
- **THEN** literal skill-root/session/staging recipes, allowed-skill scope, browser close instructions and the 403/429 browser fallback SHALL retain their existing meaning
- **AND** operator-provided overrides SHALL remain unchanged
