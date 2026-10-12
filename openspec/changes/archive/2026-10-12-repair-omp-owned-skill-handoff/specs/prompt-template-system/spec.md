# Spec Delta

## ADDED Requirements

### Requirement: Skill-Instructing Templates Receive the Trusted Script Root

Every skill-instructing session render SHALL receive `skillsDir` as the resolved absolute trusted skill-script root for its selected agent and deployment. Bundled recipes SHALL render that literal root alongside the existing session-id and staging values. Missing root data SHALL produce an explicit render/session error, not a child-HOME or token fallback. The missing-response retry builder SHALL use the same resolved root.

#### Scenario: Agent-specific roots render without process HOME
- **WHEN** an OpenCode session and an OMP session render a skill-instructing template
- **THEN** each SHALL receive its selected trusted root and render an executable absolute recipe
- **AND** OMP's isolated HOME SHALL NOT be used to derive that path

#### Scenario: Missing root is not silently substituted
- **WHEN** a skill-instructing render or retry lacks the required trusted root
- **THEN** it SHALL fail explicitly before sending incomplete instructions
- **AND** it SHALL NOT fall back to a shell HOME expression or another session's root
