# Spec Delta

## MODIFIED Requirements

### Requirement: Skill-Instructing Templates Receive the Trusted Script Root

Every skill-instructing session SHALL deliver its selected agent's resolved absolute trusted skill-script root literally in the final prompt. Bundled and retry recipes SHALL quote complete executable paths and payload arguments alongside the existing literal session-id and staging values. Missing required root data or omission from a classified delivered prompt SHALL fail explicitly before delivery, without child-HOME, shell-token or another-session fallback.

#### Scenario: Agent-specific roots render without process HOME
- **WHEN** an OpenCode session and an OMP session render a skill-instructing template
- **THEN** each SHALL receive its selected trusted root and render an executable absolute recipe
- **AND** OMP's isolated HOME SHALL NOT be used to derive that path

#### Scenario: Missing root is not silently substituted
- **WHEN** a skill-instructing render or retry lacks the required trusted root
- **THEN** it SHALL fail explicitly before sending incomplete instructions
- **AND** it SHALL NOT fall back to a shell HOME expression or another session's root

#### Scenario: All skill-instructing session paths deliver the literal root
- **WHEN** normal/lurk reply, spontaneous, self research, summary, user maintenance, channel maintenance or scheduled reminder instructions are delivered
- **THEN** the actual final text from the selected bundled template SHALL contain that session's resolved literal absolute root
- **AND** session-id, exact staging and allowed-skill scope SHALL remain correct for that delivery path

#### Scenario: Correction retry uses the same selected root
- **WHEN** an existing missing-response or correction retry contains skill invocation instructions
- **THEN** it SHALL render the same selected root, id and staging as the session's initial prompt
- **AND** all executable and payload-file recipe arguments SHALL preserve their literal spelling

#### Scenario: Paths with spaces and shell characters remain literal
- **WHEN** the trusted root or staging contains spaces, apostrophes, dollar signs or backticks
- **THEN** each recipe SHALL quote its complete executable and payload-file arguments so those characters remain part of the argument
- **AND** recipe text SHALL NOT place free-text message, memory, query or caption content on the command line

#### Scenario: Mounted classified template omits its root
- **WHEN** a configured skill-instructing template renders without the required literal trusted root, or the root is empty or relative
- **THEN** the render/session boundary SHALL raise an explicit bounded configuration failure before prompt delivery
- **AND** it SHALL NOT send blank, unresolved or alternate-root instructions

#### Scenario: Generic and dashboard rendering do not acquire skills
- **WHEN** a generic non-skill render or dashboard web-chat prompt is produced
- **THEN** no new skills-root requirement or skill invocation recipe SHALL be imposed on the generic render
- **AND** web-chat's existing skill prohibition SHALL remain unchanged
